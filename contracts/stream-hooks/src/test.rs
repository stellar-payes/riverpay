use crate::{StreamHooks, StreamHooksClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};
use stream_core::{CancelPolicy, StreamCore, StreamCoreClient};

#[test]
fn gated_content_unlocks_while_streaming_and_lapses_on_cancel() {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&e);
    let token_addr = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(&e, &token_addr).mint(&admin, &1_000_000_000);

    let core_id = e.register_contract(None, StreamCore);
    let core = StreamCoreClient::new(&e, &core_id);
    let hooks_id = e.register_contract(None, StreamHooks);
    let hooks = StreamHooksClient::new(&e, &hooks_id);
    hooks.initialize(&core_id);

    let creator = Address::generate(&e);
    let stream_id = core.create_stream(
        &admin,
        &creator,
        &token_addr,
        &100_000_000,
        &100,
        &CancelPolicy::Both,
    );

    assert!(hooks.is_streaming_to(&stream_id, &admin, &creator, &100));
    // Higher minimum rate than the stream pays: gate stays closed.
    assert!(!hooks.is_streaming_to(&stream_id, &admin, &creator, &101));
    // Wrong parties: closed.
    let stranger = Address::generate(&e);
    assert!(!hooks.is_streaming_to(&stream_id, &stranger, &creator, &100));
    // Nonexistent stream: closed, not an error.
    assert!(!hooks.is_streaming_to(&999, &admin, &creator, &100));

    core.cancel(&stream_id, &admin);
    assert!(!hooks.is_streaming_to(&stream_id, &admin, &creator, &100));
}
