#![no_std]

//! stream-core: the RiverPay streaming-payments protocol.
//!
//! A payer locks a deposit and a rate-per-second; the recipient's balance
//! grows every second and is withdrawable at any time. Cancellation splits
//! the remainder fairly at the exact moment of cancellation. All math is
//! i128 integer arithmetic — no floats, overflow-checked.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol, Vec,
};

#[derive(Clone, Copy, PartialEq, Eq)]
#[contracttype]
pub enum CancelPolicy {
    Sender,
    Recipient,
    Both,
    Neither,
}

#[derive(Clone)]
#[contracttype]
pub struct Stream {
    pub from: Address,
    pub to: Address,
    pub token: Address,
    pub rate_per_sec: i128, // in stroops of token
    pub start: u64,
    pub end: u64, // start + deposit / rate
    pub deposited: i128,
    pub withdrawn: i128,
    pub cancelable_by: CancelPolicy,
    pub canceled: bool,
}

/// Parameters for one leg of a `create_many` batch (payroll).
#[derive(Clone)]
#[contracttype]
pub struct StreamParams {
    pub to: Address,
    pub token: Address,
    pub deposit: i128,
    pub rate_per_sec: i128,
    pub cancel: CancelPolicy,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    NextStreamId,
    Stream(u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StreamError {
    StreamNotFound = 1,
    InvalidAmount = 2,
    InvalidRate = 3,
    DepositTooSmall = 4,
    NotRecipient = 5,
    NotParty = 6,
    ExceedsBalance = 7,
    NotCancelable = 8,
    AlreadyCanceled = 9,
    MathError = 10,
}

#[contract]
pub struct StreamCore;

#[contractimpl]
impl StreamCore {
    /// Locks `deposit` of `token` and starts streaming to `to` at
    /// `rate_per_sec`, beginning now. Returns the stream id.
    pub fn create_stream(
        e: Env,
        from: Address,
        to: Address,
        token: Address,
        deposit: i128,
        rate_per_sec: i128,
        cancel: CancelPolicy,
    ) -> Result<u64, StreamError> {
        from.require_auth();
        Self::create_internal(&e, &from, &to, &token, deposit, rate_per_sec, cancel)
    }

    /// Batch entry point for payroll: 50 employees, one transaction, one
    /// auth from the payer.
    pub fn create_many(
        e: Env,
        from: Address,
        params: Vec<StreamParams>,
    ) -> Result<Vec<u64>, StreamError> {
        from.require_auth();
        let mut ids: Vec<u64> = Vec::new(&e);
        for p in params.iter() {
            let id =
                Self::create_internal(&e, &from, &p.to, &p.token, p.deposit, p.rate_per_sec, p.cancel)?;
            ids.push_back(id);
        }
        Ok(ids)
    }

    /// View: `who`'s claim on the stream right now. For the recipient that
    /// is accrued-but-unwithdrawn; for the sender it is the unstreamed
    /// remainder. Anyone else sees 0.
    pub fn balance_of(e: Env, stream_id: u64, who: Address) -> Result<i128, StreamError> {
        let s = Self::load(&e, stream_id)?;
        let accrued = Self::accrued(&e, &s);
        if who == s.to {
            Ok(accrued - s.withdrawn)
        } else if who == s.from {
            Ok(s.deposited - accrued)
        } else {
            Ok(0)
        }
    }

    /// Recipient pulls up to their accrued balance.
    pub fn withdraw(e: Env, stream_id: u64, amount: i128) -> Result<(), StreamError> {
        let mut s = Self::load(&e, stream_id)?;
        s.to.require_auth();

        if amount <= 0 {
            return Err(StreamError::InvalidAmount);
        }
        let available = Self::accrued(&e, &s) - s.withdrawn;
        if amount > available {
            return Err(StreamError::ExceedsBalance);
        }

        s.withdrawn += amount;
        e.storage().persistent().set(&DataKey::Stream(stream_id), &s);

        token::Client::new(&e, &s.token).transfer(&e.current_contract_address(), &s.to, &amount);

        e.events()
            .publish((Symbol::new(&e, "withdrawn"), stream_id), (s.to, amount));
        Ok(())
    }

    /// Adds funds, extending the stream's end time at the same rate.
    pub fn top_up(e: Env, stream_id: u64, amount: i128) -> Result<(), StreamError> {
        let mut s = Self::load(&e, stream_id)?;
        s.from.require_auth();

        if s.canceled {
            return Err(StreamError::AlreadyCanceled);
        }
        if amount <= 0 {
            return Err(StreamError::InvalidAmount);
        }

        token::Client::new(&e, &s.token).transfer(&s.from, &e.current_contract_address(), &amount);

        s.deposited = s.deposited.checked_add(amount).ok_or(StreamError::MathError)?;
        // Recompute end from total deposit so rounding dust never accumulates:
        // end = start + total / rate.
        let duration = s.deposited / s.rate_per_sec;
        s.end = s
            .start
            .checked_add(duration as u64)
            .ok_or(StreamError::MathError)?;
        e.storage().persistent().set(&DataKey::Stream(stream_id), &s);

        e.events()
            .publish((Symbol::new(&e, "topped_up"), stream_id), amount);
        Ok(())
    }

    /// Stops the stream and splits funds at this exact second: the
    /// recipient gets everything accrued so far (minus prior withdrawals),
    /// the sender gets the rest back. `caller` must authorize the call and
    /// be permitted by the stream's cancel policy.
    pub fn cancel(e: Env, stream_id: u64, caller: Address) -> Result<(), StreamError> {
        let mut s = Self::load(&e, stream_id)?;
        if s.canceled {
            return Err(StreamError::AlreadyCanceled);
        }

        caller.require_auth();
        let allowed = match s.cancelable_by {
            CancelPolicy::Sender => caller == s.from,
            CancelPolicy::Recipient => caller == s.to,
            CancelPolicy::Both => caller == s.from || caller == s.to,
            CancelPolicy::Neither => false,
        };
        if !allowed {
            return Err(StreamError::NotCancelable);
        }

        let accrued = Self::accrued(&e, &s);
        let to_recipient = accrued - s.withdrawn;
        let to_sender = s.deposited - accrued;

        s.canceled = true;
        s.withdrawn = accrued;
        s.end = e.ledger().timestamp().min(s.end);
        e.storage().persistent().set(&DataKey::Stream(stream_id), &s);

        let client = token::Client::new(&e, &s.token);
        if to_recipient > 0 {
            client.transfer(&e.current_contract_address(), &s.to, &to_recipient);
        }
        if to_sender > 0 {
            client.transfer(&e.current_contract_address(), &s.from, &to_sender);
        }

        e.events().publish(
            (Symbol::new(&e, "canceled"), stream_id),
            (to_recipient, to_sender),
        );
        Ok(())
    }

    /// Recipient redirects the remainder of the stream to a new address
    /// (e.g. rotating wallets without asking the employer to recreate).
    pub fn transfer_recipient(e: Env, stream_id: u64, new_to: Address) -> Result<(), StreamError> {
        let mut s = Self::load(&e, stream_id)?;
        s.to.require_auth();
        if s.canceled {
            return Err(StreamError::AlreadyCanceled);
        }
        s.to = new_to.clone();
        e.storage().persistent().set(&DataKey::Stream(stream_id), &s);
        e.events()
            .publish((Symbol::new(&e, "recipient"), stream_id), new_to);
        Ok(())
    }

    pub fn get_stream(e: Env, stream_id: u64) -> Result<Stream, StreamError> {
        Self::load(&e, stream_id)
    }

    // -- internal helpers ------------------------------------------------------

    fn create_internal(
        e: &Env,
        from: &Address,
        to: &Address,
        token_addr: &Address,
        deposit: i128,
        rate_per_sec: i128,
        cancel: CancelPolicy,
    ) -> Result<u64, StreamError> {
        if rate_per_sec <= 0 {
            return Err(StreamError::InvalidRate);
        }
        if deposit < rate_per_sec {
            // Less than one second of streaming can never be withdrawn.
            return Err(StreamError::DepositTooSmall);
        }

        token::Client::new(e, token_addr).transfer(from, &e.current_contract_address(), &deposit);

        let start = e.ledger().timestamp();
        let duration = deposit / rate_per_sec;
        let end = start
            .checked_add(duration as u64)
            .ok_or(StreamError::MathError)?;

        let id: u64 = e
            .storage()
            .instance()
            .get(&DataKey::NextStreamId)
            .unwrap_or(0);
        e.storage().instance().set(&DataKey::NextStreamId, &(id + 1));

        let stream = Stream {
            from: from.clone(),
            to: to.clone(),
            token: token_addr.clone(),
            rate_per_sec,
            start,
            end,
            deposited: deposit,
            withdrawn: 0,
            cancelable_by: cancel,
            canceled: false,
        };
        e.storage().persistent().set(&DataKey::Stream(id), &stream);

        e.events().publish(
            (Symbol::new(e, "created"), id),
            (from.clone(), to.clone(), rate_per_sec),
        );
        Ok(id)
    }

    /// Total streamed to the recipient so far:
    /// `min(now, end).saturating_sub(start) * rate`, capped at what one
    /// full run can pay out (never exceeds `duration * rate <= deposited`).
    fn accrued(e: &Env, s: &Stream) -> i128 {
        if s.canceled {
            return s.withdrawn;
        }
        let now = e.ledger().timestamp().min(s.end);
        let elapsed = now.saturating_sub(s.start) as i128;
        elapsed.saturating_mul(s.rate_per_sec)
    }

    fn load(e: &Env, stream_id: u64) -> Result<Stream, StreamError> {
        e.storage()
            .persistent()
            .get(&DataKey::Stream(stream_id))
            .ok_or(StreamError::StreamNotFound)
    }
}

#[cfg(test)]
mod test;
