use crate::{CancelPolicy, StreamCore, StreamCoreClient, StreamError, StreamParams};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, Vec,
};

const UNIT: i128 = 10_000_000; // 7 decimals
const RATE: i128 = 100; // stroops/sec
const DEPOSIT: i128 = 100 * UNIT; // 10^9 stroops -> 10^7 seconds of runway

struct TestFixture<'a> {
    e: Env,
    sc: StreamCoreClient<'a>,
    token: Address,
    token_client: token::Client<'a>,
    payer: Address,
    worker: Address,
}

fn setup() -> TestFixture<'static> {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&e);
    let token = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin = token::StellarAssetClient::new(&e, &token);
    let token_client = token::Client::new(&e, &token);

    let sc_id = e.register_contract(None, StreamCore);
    let sc = StreamCoreClient::new(&e, &sc_id);

    let payer = Address::generate(&e);
    let worker = Address::generate(&e);
    token_admin.mint(&payer, &(1_000_000 * UNIT));

    TestFixture {
        e,
        sc,
        token,
        token_client,
        payer,
        worker,
    }
}

fn advance(e: &Env, secs: u64) {
    e.ledger().with_mut(|l| l.timestamp += secs);
}

#[test]
fn balance_accrues_per_second() {
    let f = setup();
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &RATE, &CancelPolicy::Both);

    assert_eq!(f.sc.balance_of(&id, &f.worker), 0);
    assert_eq!(f.sc.balance_of(&id, &f.payer), DEPOSIT);

    advance(&f.e, 1_000);
    assert_eq!(f.sc.balance_of(&id, &f.worker), 1_000 * RATE);
    assert_eq!(f.sc.balance_of(&id, &f.payer), DEPOSIT - 1_000 * RATE);

    // A stranger has no claim.
    let stranger = Address::generate(&f.e);
    assert_eq!(f.sc.balance_of(&id, &stranger), 0);
}

#[test]
fn accrual_caps_at_end_never_exceeds_deposit() {
    let f = setup();
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &RATE, &CancelPolicy::Both);

    // Way past the end of the stream.
    advance(&f.e, 10_u64.pow(9));
    let accrued = f.sc.balance_of(&id, &f.worker);
    assert_eq!(accrued, DEPOSIT); // 100 * UNIT divides evenly by RATE
    assert_eq!(f.sc.balance_of(&id, &f.payer), 0);
}

#[test]
fn withdraw_transfers_accrued_and_rejects_over_withdrawal() {
    let f = setup();
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &RATE, &CancelPolicy::Both);

    advance(&f.e, 500);
    let accrued = 500 * RATE;

    let err = f.sc.try_withdraw(&id, &(accrued + 1));
    assert_eq!(err, Err(Ok(StreamError::ExceedsBalance)));

    f.sc.withdraw(&id, &accrued);
    assert_eq!(f.token_client.balance(&f.worker), accrued);
    assert_eq!(f.sc.balance_of(&id, &f.worker), 0);

    // More accrues after a withdrawal.
    advance(&f.e, 100);
    assert_eq!(f.sc.balance_of(&id, &f.worker), 100 * RATE);
}

#[test]
fn cancel_splits_at_exact_moment() {
    let f = setup();
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &RATE, &CancelPolicy::Both);

    advance(&f.e, 2_000);
    let payer_before = f.token_client.balance(&f.payer);

    f.sc.cancel(&id, &f.payer);

    assert_eq!(f.token_client.balance(&f.worker), 2_000 * RATE);
    assert_eq!(
        f.token_client.balance(&f.payer),
        payer_before + DEPOSIT - 2_000 * RATE
    );

    // Nothing accrues after cancellation; double cancel rejected.
    advance(&f.e, 1_000);
    assert_eq!(f.sc.balance_of(&id, &f.worker), 0);
    let err = f.sc.try_cancel(&id, &f.payer);
    assert_eq!(err, Err(Ok(StreamError::AlreadyCanceled)));
}

#[test]
fn cancel_policy_enforced() {
    let f = setup();
    let id = f.sc.create_stream(
        &f.payer,
        &f.worker,
        &f.token,
        &DEPOSIT,
        &RATE,
        &CancelPolicy::Neither,
    );
    let err = f.sc.try_cancel(&id, &f.payer);
    assert_eq!(err, Err(Ok(StreamError::NotCancelable)));

    let id2 = f.sc.create_stream(
        &f.payer,
        &f.worker,
        &f.token,
        &DEPOSIT,
        &RATE,
        &CancelPolicy::Recipient,
    );
    // Sender can't cancel a Recipient-only stream.
    let err = f.sc.try_cancel(&id2, &f.payer);
    assert_eq!(err, Err(Ok(StreamError::NotCancelable)));
    f.sc.cancel(&id2, &f.worker); // recipient can
}

#[test]
fn top_up_extends_end_time() {
    let f = setup();
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &RATE, &CancelPolicy::Both);
    let end_before = f.sc.get_stream(&id).end;

    f.sc.top_up(&id, &DEPOSIT);
    let s = f.sc.get_stream(&id);
    assert_eq!(s.deposited, 2 * DEPOSIT);
    assert_eq!(s.end - end_before, (DEPOSIT / RATE) as u64);
}

#[test]
fn transfer_recipient_redirects_remaining_stream() {
    let f = setup();
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &RATE, &CancelPolicy::Both);

    advance(&f.e, 100);
    let new_wallet = Address::generate(&f.e);
    f.sc.transfer_recipient(&id, &new_wallet);

    advance(&f.e, 100);
    // Accrual history carries over; the new recipient can withdraw it all.
    assert_eq!(f.sc.balance_of(&id, &new_wallet), 200 * RATE);
    f.sc.withdraw(&id, &(200 * RATE));
    assert_eq!(f.token_client.balance(&new_wallet), 200 * RATE);
}

#[test]
fn create_many_batches_payroll_in_one_call() {
    let f = setup();
    let mut employees: Vec<StreamParams> = Vec::new(&f.e);
    for _ in 0..5 {
        employees.push_back(StreamParams {
            to: Address::generate(&f.e),
            token: f.token.clone(),
            deposit: DEPOSIT,
            rate_per_sec: RATE,
            cancel: CancelPolicy::Sender,
        });
    }

    let ids = f.sc.create_many(&f.payer, &employees);
    assert_eq!(ids.len(), 5);
    assert_eq!(f.token_client.balance(&f.sc.address), 5 * DEPOSIT);

    advance(&f.e, 60);
    for (i, id) in ids.iter().enumerate() {
        let s = f.sc.get_stream(&id);
        assert_eq!(s.to, employees.get(i as u32).unwrap().to);
        assert_eq!(f.sc.balance_of(&id, &s.to), 60 * RATE);
    }
}

#[test]
fn rejects_zero_rate_and_dust_deposits() {
    let f = setup();
    let err = f.sc.try_create_stream(&f.payer, &f.worker, &f.token, &DEPOSIT, &0, &CancelPolicy::Both);
    assert_eq!(err, Err(Ok(StreamError::InvalidRate)));

    let err = f.sc.try_create_stream(&f.payer, &f.worker, &f.token, &50, &100, &CancelPolicy::Both);
    assert_eq!(err, Err(Ok(StreamError::DepositTooSmall)));
}

#[test]
fn indivisible_deposit_dust_returns_to_sender_on_cancel() {
    let f = setup();
    // 1000 stroops at 300/sec -> end after 3s, 100 stroops of dust.
    let id = f
        .sc
        .create_stream(&f.payer, &f.worker, &f.token, &1_000, &300, &CancelPolicy::Both);

    advance(&f.e, 10); // stream fully vested (capped at end = 3s)
    assert_eq!(f.sc.balance_of(&id, &f.worker), 900);
    assert_eq!(f.sc.balance_of(&id, &f.payer), 100);

    let payer_before = f.token_client.balance(&f.payer);
    f.sc.cancel(&id, &f.payer);
    assert_eq!(f.token_client.balance(&f.worker), 900);
    assert_eq!(f.token_client.balance(&f.payer), payer_before + 100);
}
