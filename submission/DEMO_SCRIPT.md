# CommitOnce — product demo script (≤3:00)

**Hard constraint.** The hackathon FAQ requires *"a product-demo video of no more than three
minutes explaining how the product works"*, and the workshop guide adds a technical demo of
2–3 minutes covering design and implementation choices. **Target 2:45–2:55.**

**What this demo proves, in one sentence.** The same rebuilt retry that double-executes without
the guard is blocked by the guard, on devnet, with real signatures and real explorer links.

**Why the A/B and not a slide.** A judge reviewing hundreds of submissions has read the words
"idempotency" and "at-most-once" many times. What is hard to fake is a terminal where the counter
reads **2** in scenario A and **1** in scenario B, with two confirmed devnet transactions behind
each.

**One run does both scenarios.** `apps/demo/commitonce-demo.ts` runs scenario A (without the
guard) and scenario B (with the guard) in a single invocation, mints a fresh authority for each,
funds both from one payer key, and prints a side-by-side summary. You do not need to run it twice,
and there is no `--scenario` flag.

---

## 1. Pre-flight — do not start recording until every gate passes

### Gate 1 — the runner exists, and you have run it once

```bash
cd <repo root>
node apps/demo/commitonce-demo.ts --help
```

`apps/demo/commitonce-demo.ts` is the entry declared in `apps/demo/package.json`. **Its execution
against devnet is recorded** in [`EVIDENCE.md`](../EVIDENCE.md) §3, with the raw output in
[`evidence/devnet-demo-run.log`](evidence/devnet-demo-run.log). That run is a previous date, not
today's, so the first pre-flight step is still a full rehearsal on the machine you are recording
from, and **you do not record until it passes on its own**:

```bash
export PAYER_KEYPAIR=~/.config/solana/id.json
node apps/demo/commitonce-demo.ts
```

It must end with `CommitOnce demo: both scenarios behaved exactly as claimed.` and report the
counter reaching **2** without the guard and **1** with the guard. Its exit code is **1** if either
counter disagrees with expectation and **2** on a configuration problem, so a broken demo fails
loudly rather than printing a wrong number.

**Fallback if the devnet run cannot be made reliable in time.** Do not fake the A/B and do not
record a slide. Record the *test* evidence and say plainly what it is:

```bash
bash scripts/test.sh --test invariant -- --nocapture
```

That run contains both halves of the A/B as assertions on observable state —
`without_guard_two_rebuilt_transactions_execute_twice` (counter = 2) and
`with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once` (counter = 1) — executing the
real compiled SBF artifact. It is honest, it is reproducible, and it is weaker than a live devnet
demo. Say so on camera rather than dressing it up.

### Gate 2 — the programs are live on devnet

```bash
export HOME=/home/dell2u
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet
solana program show EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 --url devnet
```

Expect `Last Deployed In Slot` **501995361** (commit_once) and **501814798** (demo_counter), and
`Owner: BPFLoaderUpgradeab1e11111111111111111111111` on both. Both are **upgradeable**; if a judge
asks, say so.

### Gate 3 — a funded payer key

```bash
export PAYER_KEYPAIR=~/.config/solana/id.json
solana balance --url devnet
```

The runner mints a fresh authority for each scenario and funds each with **0.05 SOL** from the
payer in one transaction, so it needs at least **0.1 SOL** plus fees. It refuses to start with a
clear message if the payer is short. Use a **throwaway devnet keypair**, never a key that holds
anything of value.

The payer is read from `PAYER_KEYPAIR` (a path to a solana CLI keypair file) or
`PAYER_KEYPAIR_JSON` (the same JSON array, inline, which wins if both are set). One of the two is
required. Nothing in this repository auto-loads `.env`, deliberately.

Optional flags, if you want the run to match what is spoken: `--rpc <url>`, `--namespace <ns>`
(default `demo:counter`), `--key <key>` (default `order_928`), `--retention <r>` (default `24h`).
The defaults already match the Rust invariant suite, so the recording needs no flags.

### Gate 4 — the retry is genuinely rebuilt, not byte-identical

This is the whole point: the runtime's message-hash deduplication must not be what stops the
second attempt. The runner handles it — attempt 2 fetches a **fresh blockhash** and raises the
priority fee from **1,000** to **50,000** micro-lamports per compute unit, so the two transactions
have different bytes and different signatures — and it prints both blockhashes and both fees side
by side so the viewer can see the rebuild happened.

If a second attempt were ever rejected as `AlreadyProcessed`, the demo would have accidentally
proved the *runtime's* dedup instead of the guard's, and the take would be invalid. Scenario B's
retry must fail with **`AlreadyCommitted`**, and the runner asserts that.

### Gate 5 — clean state, automatically

Each scenario gets a freshly generated authority, funded from the payer, because the counter PDA is
`[b"counter", owner]`. A fresh owner means a counter that does not exist yet, so repeated runs
behave identically with **no cleanup step**. You do not need to reset anything between takes; a
new run generates new authorities.

### Gate 6 — screen hygiene

Terminal at 16–18pt, dark theme, 1920×1080, notifications off, `clear` before the take, and a
browser window pre-opened to the two explorer tabs. Nothing else on screen: no keypair contents,
no `.env`, no shell history containing secrets.

---

## 2. Beat-by-beat script

Timings assume the runner is already warm (one rehearsal done, RPC connection live). Total
**2:55**. The run is a single command, so you are narrating a live process rather than a set of
staged commands — rehearse with the real output in front of you and match your beats to what
actually scrolls past.

### Beat 1 — Framing (0:00 – 0:15, 15s)

*[Screen: terminal, prompt visible, nothing running yet.]*

> This is a live demo on Solana devnet. The same logical intent is sent twice as two genuinely
> rebuilt transactions — first without CommitOnce, then with it. Watch the counter: it is the
> number that tells you whether the action happened once or twice.

### Beat 2 — Start the run, and the banner (0:15 – 0:45, 30s)

*[Screen: run the command. The banner prints the problem, the fix, and the guarantee; the
preflight recomputes the demo counter's Anchor discriminators from sha256 at runtime.]*

```bash
export PAYER_KEYPAIR=~/.config/solana/id.json
node apps/demo/commitonce-demo.ts
```

> Both programs are already deployed to devnet: the guard, and a demo counter that knows nothing
> about CommitOnce. That is the point — the guard is a separate instruction in the same
> transaction, so the business program does not change. Notice the preflight: the runner
> recomputes the counter program's discriminators from sha256 rather than trusting hardcoded
> constants.

### Beat 3 — Fresh authorities and funding (0:45 – 1:00, 15s)

*[Screen: two fresh authority addresses, then the funding transaction and its explorer link.]*

> Each scenario gets a brand new authority funded from the payer. The counter is a PDA of its
> owner, so a fresh owner means a counter that does not exist yet — every run starts from zero
> with no cleanup step, and the two scenarios cannot contaminate each other.

### Beat 4 — Scenario A: without the guard, the duplicate lands (1:00 – 1:45, 45s)

*[Screen: scenario A's two attempts. Let the two blockhashes, the two priority fees and the two
signatures scroll. Then the counter. Hold on `counter = 2` for two seconds and do not talk over
it.]*

> Scenario A is a client that timed out and rebuilt. Attempt one, attempt two: fresh blockhash,
> the priority fee raised from one thousand to fifty thousand, a different signature. Two
> genuinely different transactions — so Solana's message-hash deduplication cannot help, because
> that only stops a byte-identical rebroadcast. Both landed. The counter reads two. The action
> happened twice and nothing on chain stopped it.

### Beat 5 — Scenario B: with the guard, the duplicate is blocked (1:45 – 2:30, 45s)

*[Screen: scenario B. Attempt 1 commits and creates the receipt; attempt 2 fails with
`AlreadyCommitted` and error code 6000. Then the counter.]*

> Same client, same rebuild, same idempotency key — one instruction added at the front. Attempt
> one commits and creates the receipt. Attempt two is rebuilt exactly the same way, and the guard
> finds the receipt, returns `AlreadyCommitted`, and the whole transaction reverts. The counter
> reads one. The retry was a real transaction, it was accepted for processing, and it failed on
> chain.

*[Pause.]*

> That is the guarantee: at-most-once successful execution of a guarded logical intent, within the
> configured retention window.

### Beat 6 — The summary, and the receipt (2:30 – 2:45, 15s)

*[Screen: the summary table, then the closing lines — "without the guard the counter reached 2;
with the guard it reached 1". Then open the receipt PDA on the explorer.]*

> The summary puts them side by side: two, then one. The guard did not make the retry fail for an
> unrelated reason — it failed with `AlreadyCommitted`, and the guarded increment never ran a
> second time. Here is the receipt account that made that happen: two hundred and two bytes, keyed
> by my authority, the namespace, and the key.

### Beat 7 — Cost and close (2:45 – 2:55, 10s)

*[Screen: the final lines of the run, or a title card: "202 bytes · 1,676,400 lamports ·
refundable".]*

> The receipt holds about zero point zero zero one seven SOL of rent, and `close_receipt` refunds
> all of it once the retention window has passed. I am not showing cleanup live because the
> minimum retention is one hour, on purpose — it is roughly ninety-five times the window in which
> a signed duplicate is still valid. The test suite asserts it instead.

---

## 2b. Optional insert — live contention (≈20s, only if you have room)

The A/B above rebuilds one intent twice. This shows the harder case: **one key in several
transactions at once, at real validators.** It is the single strongest thing to put on screen,
because the A/B can be argued to be two sequential attempts while this cannot.

```bash
PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/concurrent-claim.ts --attempts 5
```

It mints a fresh authority, reads **one** blockhash so every attempt targets the same slot, gives
each attempt a different priority fee so each is a genuinely distinct signed transaction, fires
them all without awaiting any of them, then confirms them together.

```
  #  priority fee  slot       outcome  error
  0  1000          501956389  SUCCESS  succeeded
  1  8000          501956391  FAILED   instruction 1 failed with custom program error 6000
  2  15000         501956391  FAILED   instruction 1 failed with custom program error 6000
  3  22000         501956391  FAILED   instruction 1 failed with custom program error 6000
  4  29000         501956391  FAILED   instruction 1 failed with custom program error 6000

  counter before 0   counter after 1   business action executions 1
```

**What to say:**

> Five transactions, one idempotency key, all built against the same blockhash, fired at once.
> One committed. The other four reached a block and were rejected by the program — not stopped in
> simulation. The counter went up by exactly one.

**What you must also say, in the same breath.** The attempts landed in two slots, not one. A
slot's leader decides what to pack and a client cannot force two transactions into one slot, so
this demonstrates contention on a live cluster; the *same-slot* case is proven in-process by
`only_the_first_of_many_attempts_commits`. If you show this and imply it is a same-slot proof, a
judge who reads `EVIDENCE.md` §3 will find the caveat you skipped. Say it first and the run is
stronger, not weaker.

Run it **before** recording and check it lands in one or two slots; if it spreads over three,
re-run — it is cheap, and the script sweeps the unspent balance back to the payer.

---

## 3. What the demo deliberately does not show

- **Live cleanup.** `close_receipt` cannot run inside a recording session: `MIN_RETENTION_SECONDS`
  is one hour, and that floor exists precisely so cleanup can never outrun a live duplicate. The
  Rust suite asserts the refund path instead
  (`close_returns_rent_deposit_to_the_configured_destination`,
  `close_requires_the_configured_refund_destination`, `receipt_cannot_be_closed_before_expiry`).
  Say this on camera; do not imply the demo skipped it for convenience.
- **Mainnet.** Nothing is deployed to mainnet. Point at devnet and say devnet.
- **A payment, a swap, or a real business flow.** The counter is deliberately trivial so the
  number on screen is unambiguous. The examples directory has guarded SOL, SPL and swap-shaped
  flows, but only three of the four have been executed against a live cluster — the Jupiter swap
  needs Jupiter's live API — and the demo does not claim otherwise.
  have.
- **Any traction.** No users, no integrations, no revenue. Do not put a logo wall on screen.

---

## 4. Failure modes during recording

| Symptom | Cause | Fix |
| --- | --- | --- |
| Scenario B's retry does not fail, or fails for another reason | the guard was not in the transaction, or the key changed between attempts | the runner exits 1 and says so; do not record — this is the one failure that must never be published |
| Second attempt rejected `AlreadyProcessed` | the transaction was byte-identical, so the runtime's dedup fired first | the rebuild did not happen; check the runner's printed blockhashes and fees differ |
| Counter reads 0 after an attempt | the attempt never landed (RPC, blockhash, funding) | check the payer balance and the RPC endpoint; rerun |
| Config error, exit code 2 | `PAYER_KEYPAIR` unset or the payer holds less than 0.1 SOL | `solana airdrop 1 --url devnet`, or point `PAYER_KEYPAIR` at a funded key |
| `BlockhashNotFound` | stale blockhash on a slow RPC | rerun; consider a dedicated devnet RPC endpoint via `--rpc` |
| `IdempotencyConflict` (6001) instead of `AlreadyCommitted` | a transport detail leaked into the payload fingerprint | the runner's fingerprint excludes blockhash, fee and signature by design; if this appears, stop and investigate before recording |
| Receipt PDA already exists at scenario B start | a previous take reused an authority and key | impossible on a fresh run — the runner generates new authorities each time — but if it happens, change `--key` |

## 5. Explorer links

The runner prints an explorer URL for every transaction, using the cluster implied by the RPC
endpoint, plus the funding transaction. Have these open before the take:

| What | URL |
| --- | --- |
| Guard program | `https://explorer.solana.com/address/CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB?cluster=devnet` |
| Demo counter program | `https://explorer.solana.com/address/EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5?cluster=devnet` |
| Any transaction | `https://explorer.solana.com/tx/<signature>?cluster=devnet` |
| The receipt PDA | `https://explorer.solana.com/address/<receipt>?cluster=devnet` |

Confirm the explorer actually resolves for a signed-out viewer before recording. A dead link in a
demo video is worse than no link.

## 6. Upload

Same as the pitch video: public or unlisted-with-link, verified in a private browser window, URL
placed in the submission form. Do not paste a placeholder URL anywhere.
