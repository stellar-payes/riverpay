# RiverPay — Real-Time Money Streaming for Salaries, Rent & Subscriptions

> Get paid by the second. Cancel a subscription and stop paying that instant.

## Problem
Salaries arrive monthly but bills arrive daily. Freelancers chase invoices for 30–60 days. Subscriptions bill you for a full month you stopped using on day 3. Money moves in chunks; life happens continuously.

## Solution
A Soroban streaming-payments protocol: a payer locks funds and a rate-per-second; the recipient's balance grows every second and is withdrawable anytime. Cancellation splits the remainder fairly at the exact moment of cancellation. Use cases shipped in the app: **payroll**, **rent**, **subscriptions**, **allowances**.

## Monorepo Structure
```
riverpay/
├── contracts/
│   ├── stream-core/       # The protocol (audited surface kept minimal)
│   └── stream-hooks/      # Optional: interfaces for gated content ("is_streaming_to")
├── sdk/                   # TypeScript SDK (npm: @riverpay/sdk)
├── backend/               # Indexer + notification service (Go or Node)
└── frontend/              # Next.js dashboard
```

## Contract: stream-core
```rust
pub struct Stream {
    from: Address, to: Address, token: Address,
    rate_per_sec: i128,      // in stroops of token
    start: u64, end: u64,    // end = start + deposit/rate
    deposited: i128, withdrawn: i128,
    cancelable_by: CancelPolicy,   // Sender | Recipient | Both | Neither
}

fn create_stream(e: Env, from: Address, to: Address, token: Address, deposit: i128, rate_per_sec: i128, cancel: CancelPolicy) -> u64;
fn balance_of(e: Env, stream_id: u64, who: Address) -> i128;      // view: accrued vs remaining
fn withdraw(e: Env, stream_id: u64, amount: i128);                // recipient pulls accrued
fn top_up(e: Env, stream_id: u64, amount: i128);                  // extends end time
fn cancel(e: Env, stream_id: u64);                                // splits at now()
fn transfer_recipient(e: Env, stream_id: u64, new_to: Address);   // recipient can redirect
```
- Math: `accrued = min(now, end).saturating_sub(start) * rate_per_sec`; all i128, no floats; overflow tests mandatory.
- Events: `created`, `withdrawn`, `topped_up`, `canceled`
- Batch entry point: `create_many(e, Vec<StreamParams>)` for payroll (50 employees, one tx).

## TypeScript SDK (`@riverpay/sdk`)
```ts
const rp = new RiverPay({ rpcUrl, networkPassphrase });
await rp.streams.create({ to, token: USDC, amountPerMonth: "3000", months: 6 });
rp.streams.watchBalance(streamId, (b) => setBalance(b)); // client-side ticker, no polling chain
```
Client-side balance ticking is computed locally from stream params — the UI counts up smoothly without RPC spam.

## Backend
- Indexer → `streams`, `withdrawals` tables; materialized view `active_streams_by_address`
- Notifications: "stream ends in 3 days — top up", "you received a new salary stream"
- Public API: `GET /address/:addr/streams`, `GET /streams/:id`
- Optional keeper: auto-withdraw cron for recipients who opt in

## Frontend (Next.js)
1. **Payroll page:** CSV upload of employees → preview → one batch tx; runway indicator.
2. **Stream detail:** live counting balance (the money-goes-up animation is the demo).
3. **Subscriptions:** creator sets a rate; subscriber's stream doubles as access token (`stream-hooks`).
4. **My income:** all incoming streams, projected monthly income, withdraw-all button.

## Milestones
1. stream-core + exhaustive unit tests (good-first-issue: fuzz `balance_of` invariants)
2. SDK with local ticker
3. Indexer + notifications
4. Dashboard MVP on testnet
5. Batch payroll + CSV import
6. stream-hooks + example gated-content demo
7. Security review checklist + testnet bug bounty via GrantFox UX Bounties

## Getting Started
```bash
cd contracts && stellar contract build && cargo test
cd sdk && npm i && npm run build && npm test
cd frontend && npm i && npm run dev
```

## FUNDING.json
```json
{ "drips": { "ethereum": { "ownedBy": "0xYOUR_ADDRESS" } } }
```

## License
Apache-2.0 (protocol), MIT (SDK/app)
