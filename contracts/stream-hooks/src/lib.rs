#![no_std]

//! stream-hooks: read-only helpers for gating content on active streams.
//!
//! A creator's paywall calls `is_streaming_to(stream_id, from, to, min_rate)`
//! — "does subscriber `from` currently stream at least `min_rate` to me?" —
//! and unlocks content while it returns true. The subscription *is* the
//! stream; cancel it and access lapses the same second.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env};
use stream_core::StreamCoreClient;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    StreamCore,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum HooksError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

#[contract]
pub struct StreamHooks;

#[contractimpl]
impl StreamHooks {
    pub fn initialize(e: Env, stream_core: Address) -> Result<(), HooksError> {
        if e.storage().instance().has(&DataKey::StreamCore) {
            return Err(HooksError::AlreadyInitialized);
        }
        e.storage().instance().set(&DataKey::StreamCore, &stream_core);
        Ok(())
    }

    /// True while `stream_id` is a live stream from `from` to `to` at a
    /// rate of at least `min_rate` — i.e. funded past the current moment
    /// and not canceled.
    pub fn is_streaming_to(
        e: Env,
        stream_id: u64,
        from: Address,
        to: Address,
        min_rate: i128,
    ) -> Result<bool, HooksError> {
        let core: Address = e
            .storage()
            .instance()
            .get(&DataKey::StreamCore)
            .ok_or(HooksError::NotInitialized)?;
        let client = StreamCoreClient::new(&e, &core);

        let stream = match client.try_get_stream(&stream_id) {
            Ok(Ok(s)) => s,
            _ => return Ok(false),
        };

        let now = e.ledger().timestamp();
        Ok(!stream.canceled
            && stream.from == from
            && stream.to == to
            && stream.rate_per_sec >= min_rate
            && now < stream.end)
    }
}

#[cfg(test)]
mod test;
