# CommitOnce demos

Two runnable programs. Both talk to **devnet** against the deployed programs, and both print
real explorer links.

| | `commitonce-demo.ts` | `concurrent-claim.ts` |
| --- | --- | --- |
| What it shows | the same rebuilt retry, with and without the guard | many claims of one key, fired at once |
| Result | counter reaches **2** unguarded, **1** guarded | exactly **1** of N commits; the rest fail `AlreadyCommitted` |
| Runtime | sequential, two transactions | concurrent, 5–8 transactions |
| Costs | ~0.1 SOL of devnet SOL, not recovered | ~0.003 SOL net; the unspent balance is swept back |
| Evidence | [`devnet-demo-run.log`](../../submission/evidence/devnet-demo-run.log) | [`devnet-contention-run.log`](../../submission/evidence/devnet-contention-run.log) |

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

## Layout

```text
apps/demo/
├── commitonce-demo.ts    the A/B: same rebuilt retry, with and without the guard
├── concurrent-claim.ts   one idempotency key in N transactions, at real validators
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
