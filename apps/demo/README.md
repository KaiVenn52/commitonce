# CommitOnce demos

Eight runnable scripts, all talking to **devnet** against the deployed programs.

Two of them demonstrate the product. The other six **measure things the product's claims rest
on** — they exist because those claims were, at some point in this project, asserted rather than
checked. Each one is listed below with the question it answers.

| Script | What it does | Needs |
| --- | --- | --- |
| [`commitonce-demo.ts`](#the-ab-demo) | the same rebuilt retry, with and without the guard | devnet, ~0.1 SOL |
| [`concurrent-claim.ts`](#the-live-contention-test) | many claims of one key, fired at once | devnet |
| [`receipt-lifecycle.ts`](#the-receipt-lifecycle) | claim, wait out the retention, close, get the rent back | devnet, **~1 hour** |
| [`nonce-policy.ts`](#the-durable-nonce-policy) | the durable-nonce policy against a real nonce account | devnet |
| [`rent-exemption-check.ts`](#rent-exemption-on-a-real-validator) | does the runtime refuse a non-rent-exempt writable account? | a local validator |
| [`cu-on-runtime.ts`](#compute-units-on-a-real-runtime) | what `claim` actually costs | devnet or a local validator |
| [`slot-rate.ts`](#the-slot-rate) | the real slots-per-second, on mainnet and devnet | either cluster |
| [`blockhash-window.ts`](#the-blockhash-window) | how long a signed transaction stays executable | either cluster |

## Setup

Both need a funded devnet keypair. Either variable works; `PAYER_KEYPAIR_JSON` wins if both are
set.

```bash
export PAYER_KEYPAIR=~/.config/solana/id.json
# or, inline:
export PAYER_KEYPAIR_JSON="$(cat ~/.config/solana/id.json)"
```

On Windows, reading the WSL keypair over the UNC path works:

```powershell
$env:PAYER_KEYPAIR = '\\wsl.localhost\Ubuntu\home\<user>\.config\solana\id.json'
```

The key is only ever used to pay for and sign a funding transfer. It is never the intent
authority: each run mints a **fresh authority in memory** and drops it at exit, which is why
repeated runs behave identically with no cleanup step.

If the payer is short:

```bash
solana airdrop 1 --url devnet
```

## The A/B demo

```bash
node apps/demo/commitonce-demo.ts
node apps/demo/commitonce-demo.ts --help
```

Options: `--rpc <url>`, `--namespace <text>`, `--key <text>`, `--retention <1h|24h|7d|30d|permanent>`.
There is **no `--scenario` flag** — both scenarios always run, because the comparison is the point.

`$SOLANA_RPC_URL` sets the endpoint if `--rpc` is absent. The public devnet endpoint is shared and
rate limited; a dedicated endpoint makes the run faster but changes nothing about the result.

Exit codes: **0** both scenarios behaved as claimed, **1** a counter disagreed with expectation,
**2** a configuration problem. A broken demo fails loudly rather than printing a wrong number.

## The live contention test

```bash
node apps/demo/concurrent-claim.ts
node apps/demo/concurrent-claim.ts --attempts 8
```

It mints a fresh authority, creates its counter, reads **one** blockhash so every attempt targets
the same slot, gives each attempt a different priority fee so each is a genuinely distinct signed
transaction rather than a rebroadcast, fires them all without awaiting any of them, and confirms
them with a single batched status poll.

**Read the caveat it prints.** In every run so far the attempts landed across 2–3 slots rather
than one: a slot's leader decides what to pack and a client cannot force two transactions into one
slot. So it demonstrates contention on a live cluster, and the **same-slot** case rests on the
in-process test `only_the_first_of_many_attempts_commits`. The script says which it got instead of
asserting a single slot.

The first run of this script died with HTTP 429 from the public devnet endpoint. That was a real
bug in the script, not in the product: confirming each transaction separately means N concurrent
`getSignatureStatuses` polling loops, and devnet rate-limits per method. `submitManyAndConfirm`
in `src/solana.ts` fixes it with one batched status call and a retry that honours the server's
`retry-after`.

## The receipt lifecycle

```bash
node apps/demo/receipt-lifecycle.ts
```

Claims with the **minimum finite retention (one hour)**, waits for both deadlines to pass, then
closes the receipt and checks that the deposit reached the configured refund destination.

**It takes about an hour, and that is the point.** Every other on-chain path in this repository
has been executed against devnet; this one had not, for the boring reason that demonstrating a
refund means waiting out the retention. The Rust suite covers it in LiteSVM by warping the
clock, which is a real test of the program but not a real demonstration of the refund — and
"an explicit retention window with a full rent refund" is a claim this project makes, where the
refund is the half that returns the user's money.

Run it in the background. It prints a timestamped line every 30 seconds while it waits.

## The durable-nonce policy

```bash
node apps/demo/nonce-policy.ts
```

Creates a **real nonce account**, then builds transactions whose blockhash *is* the stored nonce
with `AdvanceNonceAccount` first — genuine durable-nonce transactions, not an injected marker.
Finite retention is refused with `DurableNonceUnsupported`; `permanent` is accepted.

This exists because LiteSVM cannot express a real nonce transaction, so the Rust test asserts
the program's stricter behaviour by injecting the marker. The policy needed checking somewhere
real.

## Rent-exemption on a real validator

```bash
RPC_URL=http://127.0.0.1:8899 node apps/demo/rent-exemption-check.ts
```

Has an attacker send a receipt PDA **one lamport** and then has the victim claim. The runtime
refuses the attacker's own transfer with `InsufficientFundsForRent`, so the account is never
created.

LiteSVM 0.16 implements that rule; whether real Agave did was inference until this ran. It does.

## Compute units on a real runtime

```bash
node apps/demo/cu-on-runtime.ts
```

Reads the runtime's own per-program figures. `claim` costs **9,292 CU** on devnet and on a local
validator, against a harness median of 9,283 — within 0.1%.

The repository used to say the harness under-reported and that devnet cost 14,669 CU. That
figure came from a build predating the pre-funded-PDA fix and was never re-measured.

## The slot rate

```bash
node apps/demo/slot-rate.ts
```

Samples the live slot counter. **3.77 slots/second on mainnet** (265 ms), **6.09 on devnet**
(164 ms). The program's `SLOTS_PER_SECOND` is 4, which is at or above mainnet's real rate.

Because `close_receipt` requires **both** deadlines, the effective window is the later of the
two — so a wrong constant can only delay cleanup, never shorten the window.

## The blockhash window

```bash
node apps/demo/blockhash-window.ts
```

Takes a blockhash and polls `isBlockhashValid` until the cluster says no. **40.1 s / 145 slots on
mainnet**, 24.4 s / 149 slots on devnet.

This is the window `MIN_RETENTION_SECONDS` (one hour) is a margin against, and it is the
quantity `the_retention_floor_dwarfs_the_blockhash_window` asserts in the Rust suite.

## Layout

```text
apps/demo/
├── commitonce-demo.ts       the A/B: same rebuilt retry, with and without the guard
├── concurrent-claim.ts      one idempotency key in N transactions, at real validators
├── receipt-lifecycle.ts     claim, wait out the retention, close, get the rent back
├── nonce-policy.ts          the durable-nonce policy, against a real nonce account
├── rent-exemption-check.ts  does the runtime refuse a non-rent-exempt writable account?
├── cu-on-runtime.ts         what claim actually costs, from the runtime's own figures
├── slot-rate.ts             the real slots-per-second, on mainnet and devnet
├── blockhash-window.ts      how long a signed transaction stays executable
└── src/
    ├── solana.ts         RPC plumbing: build, sign, submit, confirm, read back
    ├── payer.ts          where the funding keypair comes from
    ├── demo-counter.ts   the business program, and its wire format
    ├── report.ts         terminal formatting
    └── errors.ts         ConfigError / DemoFailure, so exit codes mean something
```

`demo-counter.ts` recomputes every Anchor discriminator from its preimage at startup and fails
loudly on a mismatch. A demo whose entire claim is "the second attempt did not run the business
instruction" must not be reading the counter out of the wrong offset because an IDL changed
under it.
