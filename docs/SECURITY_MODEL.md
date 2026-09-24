# CommitOnce — security model

**Status: unaudited.** See [`SECURITY.md`](../SECURITY.md) for the disclosure policy and the
audit status. Nothing in this document is a substitute for an independent review.

This document states what CommitOnce does and does not guarantee, enumerates the threats it
was designed against, and lists the failure modes that would break the guarantee — including
the ones that are deliberately *not* defended against.

---

## 1. The guarantee, stated exactly

> For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded
> transaction may successfully commit during the receipt retention period.**

Three parts of that sentence are load-bearing and must not be dropped when describing the
product:

* **at most once**, not exactly once. CommitOnce prevents a second execution; it does not
  make the first one happen. Retrying until success is still the caller's job. Combined,
  the two give exactly-once-style semantics.
* **guarded transactions**. Only transactions that actually include the `claim`
  instruction are covered. A code path that skips the guard is unprotected.
* **within the retention period**. After the receipt expires and is cleaned up, the key is
  free again. This is a deliberate trade-off, not a defect — see §6.

It is **not** a claim of mathematically universal exactly-once execution, and it should
never be described as one.

---

## 2. What atomicity buys

Because the guard and the business instructions are in the same Solana transaction, two
properties hold without any extra machinery:

**No receipt without a committed action.** If a business instruction fails, the whole
transaction including the receipt creation is rolled back. There is no state in which a
receipt exists but the action did not happen, so a failed attempt remains retryable rather
than being permanently poisoned. Test: `downstream_failure_rolls_back_the_receipt`, which
also asserts that the rent deposit is returned (only the transaction fee is spent).

**No partial execution when blocked.** When a duplicate is detected, `claim` returns an
error. The error fails the transaction, so the business instructions after it never run.
Test: `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`.

---

## 3. Threat model

### T1 — Duplicate execution after an ambiguous timeout

**The primary threat.** A client submits, the response is lost, and the client cannot
determine whether the transaction landed. It rebuilds with a fresh blockhash (and usually a
different priority fee) and submits again.

*Why the network does not stop this:* Solana deduplicates by message hash. A rebuilt
transaction has different bytes, therefore a different hash, therefore no dedup. Solana's
own production-readiness guidance states that a rebuilt transaction has a new signature and
that applications must preserve idempotency themselves.

**Mitigation.** The receipt is onchain state keyed by the intent's identity, so the second
attempt finds it and aborts regardless of how many times the transaction was rebuilt.

**Residual risk.** None for retries within the retention window. Outside it, see §6.

**Tests:** `without_guard_two_rebuilt_transactions_execute_twice` (the failure, without the
guard), `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`,
`only_the_first_of_many_attempts_commits` (five distinct concurrently-built attempts →
exactly one commit).

---

### T2 — Third-party key consumption (griefing)

**Threat.** An attacker who learns a victim's namespace and idempotency key claims it first,
permanently blocking the victim's intent. For a payment or a mint this is a denial of
service that costs the attacker almost nothing.

**Mitigation.** The authority is part of the receipt PDA derivation. The attacker's claim
lands on a *different address* and leaves the victim's key untouched. The property is
enforced by the program's `seeds` constraint, so it holds by construction rather than
depending on a developer remembering to hash their own pubkey into the key.

**Test:** `third_party_cannot_consume_another_authoritys_key` — the attacker front-runs with
the victim's exact namespace and key, and the victim's subsequent claim still succeeds.

This is the single most important difference from prior art whose keys are not
authority-scoped.

---

### T2b — Blocking a key by pre-funding its receipt PDA

**Threat.** A receipt address is derived from `(authority, namespace, key)`. The authority
keeps an attacker from *claiming* the victim's key, but it does not keep them from *finding*
the address — and a namespace and key are usually semi-public, because they are an order id,
a job id, or a checkout reference.

So an attacker who learns them can compute the victim's receipt PDA and **send it one
lamport**. That creates a system-owned account holding lamports and no data. `claim` decides a
receipt is absent with `data_is_empty()`, which is true for such an account, so it takes the
create path — and `SystemInstruction::CreateAccount` refuses an account that already holds
lamports. One lamport plus a fee would therefore have permanently denied the victim that
idempotency key, with a failure about account creation that has nothing to do with their
intent.

**This was a real defect, found by writing the test rather than by reading the code.** The
first version of `claim` had exactly the behaviour described above, and the test failed
against it with:

```
Create Account: account ... already in use
Program 11111111111111111111111111111111 failed: custom program error: 0x0
```

**Mitigation.** `claim` now handles a PDA that already holds lamports: it tops the account up
to rent-exempt with a transfer paid by the authority, then `Allocate`s and `Assign`s it with
`invoke_signed` under the PDA's own seeds. That is the same sequence `CreateAccount` performs
internally, split so the first step can be paid by the authority and the last two can be
signed by the PDA. `Allocate` must precede `Assign`, because the System Program only allocates
for an account it still owns.

**Why this is the whole of the attack.** An attacker cannot go further than sending lamports.
`CreateAccount`, `Allocate` and `Assign` all require the *account's own signature*, and only
this program can produce one for its own PDA. So no third party can create the account with a
foreign owner, assign it to another program, or give it data. Sending lamports is the only
lever available, and the fix absorbs it.

**Residual cost.** The victim pays `rent_exempt − funded` instead of the full deposit, so an
attacker who sends lamports is donating to the victim; any excess stays in the account and is
refunded to `refund_destination` on close. There is no griefing value left in the vector.

**And a runtime rule narrows the vector further.** A runtime refuses any transaction carrying a
writable account that is not rent-exempt, *before executing anything*, with
`InsufficientFundsForRent`. Rent-exempt for zero bytes is `128 × lamports_per_byte`, so the
cheap version of this attack — one lamport — cannot even be set up: **the attacker's own
transfer is rejected** and they pay the fee for nothing. An attacker who funds above the
threshold is absorbed by the top-up path above. LiteSVM 0.10 did not implement that check, which
is why the test passed with one lamport for most of the project's life and does not now.

The check is asserted in the test rather than described here, and it has been **confirmed against
a real Agave validator** rather than only against the harness. `apps/demo/rent-exemption-check.ts`
runs the scenario against `solana-test-validator` 4.2.2 — deploy both programs, fund an attacker,
have it send the victim's receipt PDA one lamport, then have the victim submit `claim`. The
attacker's transfer is refused by the runtime:

```
REJECTED  {"InsufficientFundsForRent":{"account_index":"1n"}}
  Program 11111111111111111111111111111111 invoke [1]
  Program 11111111111111111111111111111111 success
account   does not exist
```

and the victim's claim then succeeds. So the rule is **Agave's, not LiteSVM's**, and the cheap
form of this attack cannot be constructed on the real runtime either. Raw output:
[`submission/evidence/validator-rent-exemption-check.log`](../submission/evidence/validator-rent-exemption-check.log).

This matters because it is the difference between "the attack is absorbed by our code" and "the
attack cannot be built". Both are true here, and they are different claims: the first is a
property of `claim`, the second a property of the cluster. Only the first is guaranteed on a
runtime that does not enforce the rule — which is why the top-up path stays, and why the residual
below is a donation rather than a block.

**Test:** `a_prefunded_receipt_pda_does_not_block_the_intent` — an attacker funds the victim's
receipt PDA with one lamport, the victim's claim still commits, the counter advances once, and
the receipt is then a *real* receipt: a rebuilt retry is blocked with `AlreadyCommitted`.

---

### T3 — Receipt substitution / account confusion

**Threats.** Passing someone else's receipt PDA to your own `claim`; planting an account at
your receipt address that you control; corrupting a receipt's data to make it decode as
something benign; writing a receipt with a future layout version that the current code
misreads.

**Mitigations, all enforced onchain:**

| Attack | Defense | Test |
| --- | --- | --- |
| Substitute another authority's receipt PDA | `seeds`/`bump` constraint binds the address to the signing authority | `receipt_pda_cannot_be_substituted_across_authorities` |
| Plant a foreign-owned account at the receipt address | explicit owner check before trusting any pre-existing account | `receipt_with_foreign_owner_is_rejected` |
| Corrupt the receipt's discriminator or body | Anchor discriminator check, then fail-closed deserialization | `malformed_receipt_data_is_rejected` |
| Write a future layout version | explicit `version` check | `unsupported_receipt_version_is_rejected` |

The owner/discriminator checks are manual and deliberate: `init_if_needed` cannot
distinguish "just created" from "already existed", and that distinction is the entire
semantic of the guard. See `docs/ARCHITECTURE.md` §7.

---

### T4 — Silent conflict (same key, different payload)

**Threat.** A client reuses `order_928` for a genuinely different action — 10 USDC to Alice,
then 100 USDC to Bob. Treating the second as "already done" would silently return the first
one's outcome and drop a real payment instruction.

**Mitigation.** The receipt stores a payload fingerprint. A matching fingerprint yields
`AlreadyCommitted`; a differing one yields `IdempotencyConflict`. A conflict never
overwrites the stored fingerprint, so the original commitment stays authoritative.

**Test:** `same_key_different_payload_is_an_idempotency_conflict`, which also asserts the
original fingerprint is immutable and that the original intent still resolves as an
ordinary duplicate afterwards.

**Residual risk.** Detection is only as good as the fingerprint's inputs. If two different
actions hash to the same canonical encoding, the conflict is invisible. Callers must pass
semantic fields and must never include transport details — see §5.

---

### T5 — Cross-application and cross-tenant key collision

**Threat.** Two applications independently pick the key `order_928` and collide, so one
blocks the other.

**Mitigation.** Namespaces are a first-class input to the receipt identity, and the
namespace and key hashes use distinct domain separators, so a namespace hash can never
equal a key hash.

**Tests:** `same_textual_key_under_different_namespaces_does_not_collide`,
`same_textual_key_under_different_authorities_does_not_collide`, and the domain-separation
assertions in `wire_format.rs` and the SDK's `vectors.test.ts`.

---

### T6 — Cleanup used to steal rent, or to force a premature reopen

**Threat A.** An attacker submits `close_receipt` and redirects the deposit to themselves.
**Mitigation.** The account is constrained with `address = receipt.refund_destination`, so
the program refuses any destination other than the one recorded at claim time. Because the
destination is fixed, cleanup is genuinely permissionless: anyone can pay the fee, and the
deposit still goes where it belongs.
**Test:** `close_requires_the_configured_refund_destination`.

**Threat B.** An attacker closes a receipt early to reopen the duplicate window.
**Mitigation.** Both deadlines must have passed — the monotonic slot deadline *and* the
wall-clock deadline. See §4.
**Test:** `receipt_cannot_be_closed_before_expiry`, which checks each gate in isolation.

---

### T7 — Reopen window from an expired but still-valid transaction

**Threat.** A signed transaction remains executable until its blockhash expires (~40s at
mainnet's measured 265 ms). If a receipt could be cleaned up inside that window, a still-valid
duplicate could execute after cleanup, breaking the guarantee.

**Mitigation.** `MIN_RETENTION_SECONDS` is one hour — roughly 95× the blockhash validity
window. A receipt cannot be created with a shorter finite retention, so there is no
configuration in which cleanup can outrun a live duplicate.

**Test:** `retention_below_minimum_is_rejected`.

---

### T8 — Durable-nonce transactions

**Threat.** A durable-nonce transaction never expires. An old signed duplicate stays
executable forever, so if its receipt could be cleaned up, cleanup would reopen the
duplicate window permanently.

**Mitigation.** `claim` inspects the Instructions sysvar for a System Program
`AdvanceNonceAccount` instruction (discriminator `u32` LE `4`) and rejects the transaction
with `DurableNonceUnsupported` unless `retention_seconds == 0`. Permanent receipts have no
cleanup path, so they are safe with nonces and are explicitly supported.

**Tests:** `durable_nonce_transaction_is_rejected_for_finite_retention`,
`durable_nonce_transaction_is_allowed_for_permanent_retention`, and
`ordinary_transactions_are_not_mistaken_for_nonce_transactions` (guards against an
over-eager check that would break every normal integration).

The conceptual approach is borrowed from Squads' `nonce-guard`, which inspects the same
sysvar for the same reason. That program deduplicates nothing — its PDA is per-owner, not
per-intent — but it demonstrates the introspection technique. The implementation here is
independent.

---

### T9 — Time manipulation

**Threat.** `Clock::unix_timestamp` is not independently verifiable by a program; it is
whatever the cluster's validators agree on. A receipt whose only deadline were wall-clock
could in principle be closed early under an adversarial clock.

**Mitigation.** The receipt records two deadlines and requires both. `expires_at_slot` is
derived from the monotonic slot counter, which cannot be manipulated by validators. The
wall-clock deadline exists to keep the *advertised* retention honest if slots run faster
than the assumed rate.

The asymmetry is deliberate: the two gates are combined with AND, so a change in slot
timing can only ever **delay** cleanup (the receipt lives longer than advertised — safe) and
never **accelerate** it into a live-duplicate window.

**Test:** `slot_deadline_uses_current_mainnet_slot_rate` pins the derivation to
`SLOTS_PER_SECOND = 4`, and `receipt_cannot_be_closed_before_expiry` proves the AND: a slot
deadline already passed with the wall clock still short must not permit cleanup.

The constant was chosen as "mainnet's 250 ms slots", a figure mainnet has since moved past: Measured rather than assumed: [`apps/demo/slot-rate.ts`](../apps/demo/slot-rate.ts) samples the live counter, and reports **3.77 slots/second on mainnet** (265 ms) and **6.09 on devnet** (164 ms). Raw output: [`submission/evidence/slot-rate-measurement.log`](../submission/evidence/slot-rate-measurement.log). So `4` is slightly **above** mainnet's real rate and well below devnet's, and both directions are safe for the reason below.

---

### T10 — Malicious or malformed instruction arguments

| Input | Handling | Error | Test |
| --- | --- | --- | --- |
| `retention_seconds` outside `{0} ∪ [1h, 365d]` | rejected | `InvalidRetention` | `retention_below_minimum_is_rejected`, `retention_above_maximum_is_rejected`, `retention_boundaries_are_accepted` |
| `refund_destination == Pubkey::default()` | rejected | `InvalidRefundDestination` | `refund_destination_cannot_be_the_default_pubkey` |
| `refund_destination == receipt PDA` | rejected | `InvalidRefundDestination` | `refund_destination_cannot_be_the_receipt_itself` |
| `instructions_sysvar` not the real sysvar | rejected by the `address` constraint | Anchor constraint | (covered by the account constraint) |
| `system_program` not the real one | rejected by `Program<'info, System>` | Anchor constraint | — |

---

## 4. Two deadlines, and why both

| Deadline | Source | Property |
| --- | --- | --- |
| `expires_at_slot` | `created_slot + retention * SLOTS_PER_SECOND` | monotonic; not validator-manipulable |
| `expires_at_unix_ts` | `created_unix_ts + retention` | keeps advertised retention honest if slots run fast |

`SLOTS_PER_SECOND = 4`, measured at **3.77 slots/second on mainnet** (265 ms) and **6.09 on devnet** (164 ms). Because cleanup requires *both* deadlines,
the effective deadline is the **later** of the two, so the failure mode of a wrong constant is
always a delayed cleanup — never a premature one — in either direction. An earlier version of
this paragraph said that underestimating the constant "would silently shorten the advertised
window", which contradicted the very next sentence: if both gates must pass, an early slot gate
cannot shorten anything.

---

## 5. Payload fingerprint rules

The fingerprint defines "the same intent". Getting it wrong is the most likely way for an
integrator to weaken the guarantee, so the rules are explicit.

**Include** — everything that makes the action what it is:
recipient, amount, mint, memo, order id, chain id, invoked program ids.

**Never include** — anything that changes when a transaction is rebuilt:

| Field | Why it must be excluded |
| --- | --- |
| blockhash | changes on every rebuild; the retry would look like a new intent |
| signature | derived from the message, so it is a function of transport |
| priority fee / compute budget | the most common thing a client changes between attempts |
| retry count, attempt id | literally the thing that must not affect identity |
| submission route / RPC URL | infrastructure detail, not intent |

The SDK's `encodeIntent` produces a deterministic, injective, length-prefixed encoding
(`<tag><length>:<payload>`) with object keys sorted, so insertion order cannot change the
result. It **throws** on `undefined` rather than dropping it the way `JSON.stringify` does,
because a silently dropped property could make two genuinely different intents encode
identically and hide a conflict. It also rejects `Date`, `Map`, `Set` and non-finite
numbers for the same reason: each has an ambiguous or non-deterministic encoding.

Callers who need a synchronous path, or who want to hash with their own implementation, can
pass a precomputed 32-byte fingerprint directly.

---

## 6. The retention window: the deliberate trade-off

CommitOnce's guarantee is **bounded**. This is stated up front rather than buried, because
an unbounded claim would be false.

| Retention | Deposit held | Reopen risk after cleanup |
| --- | --- | --- |
| `1h` – `365d` | 1,676,400 lamports (0.00168 SOL) per receipt | yes, after expiry |
| `0` (permanent) | 1,676,400 lamports, never returned | none — no cleanup path exists |

The rent figure is the mainnet rate since SIMD-0437 step 2: `(202 data bytes + 128 account
overhead) × 5080 lamports/byte`. Note that the `solana-rent` Rust crate still ships an
effective 6960 lamports/byte, so any estimate derived from it is **37% too high**; the test
harness overrides the sysvar to the real value so the figures reported by the suite are
accurate.

**Why cleanup exists at all.** Without it, every receipt would be permanent, and a payment
processor issuing a million intents would lock ~1,676 SOL in rent forever. Cleanup makes
the primitive economically usable at volume.

**The honest framing.** Choose the retention to exceed your maximum retry horizon. If a
client might retry an intent after a week, a one-hour retention is wrong. The test
`closing_frees_the_key_for_a_new_claim` asserts this behaviour explicitly, so the trade-off
is documented in code rather than only in prose.

---

## 7. Explicit non-goals

CommitOnce does **not**:

* **make a transaction land.** It prevents a second execution, not a first failure. Retry
  logic is still required.
* **protect unguarded code paths.** If your application can send the business instructions
  without `claim`, that path is unprotected. The guard is only as universal as its use.
* **guarantee exactly-once across independent authorities.** Two different keys are two
  different intents, by design.
* **resolve conflicts.** It detects and reports them. Deciding what to do — fail, alert,
  compensate — is the application's job.
* **replace signature-level deduplication.** Byte-identical rebroadcasts are still handled
  by the runtime's status cache; `identical_rebroadcast_still_rejected_by_the_runtime`
  asserts that CommitOnce does not interfere with that layer.
* **provide a global, network-wide key space.** Receipts are per authority, per namespace,
  per key.
* **stop a caller from choosing a short retention** for a later intent.
* **provide multisig or threshold authority.** A Squads vault can act as the authority: a PDA
  authority requires a CPI that signs for it, and both the CPI and the `invoke_signed` step are
  tested in `tests/cpi.rs`. Because the receipt is derived from the vault, members sharing one
  vault share one receipt — but
  individual member keys cannot share a single receipt.

---

## 8. The artifact a current-feature-set runtime will load — resolved

This was a live deployment risk and is now closed. It is kept because how it was found, and
how the first diagnosis of it was wrong, are both instructive.

The project shipped an **SBPFv2** artifact for most of its life, because LiteSVM 0.10.0 could
not verify a v3 ELF and the test suite is the only thing that executes the compiled artifact.
Running the program against a **real Agave validator** (`solana-test-validator` 4.2.2) showed
the cost:

```
Detected sbpf_version required by the executable which are not enabled
Program BPFLoaderUpgradeab1e11111111111111111111111111111111 failed: invalid account data for instruction
```

The same validator accepts v3. A fresh validator activates every feature the binary knows
about, so it runs ahead of devnet — which is why the v2 deployment on devnet succeeded and why
this was not visible there. The exposure was the **deploy path**: an already-deployed program
keeps running, but a future upgrade deploy of a v2 artifact would have been rejected once that
feature activated on the target cluster.

**The first diagnosis was wrong, and that is the part worth recording.** The upgrade was
recorded as blocked by litesvm 0.16's dependency tree — a `solana-hash` conflict leading to
`solana-syscalls` failing to compile for the host. The tree resolves fine once the
dev-dependencies are pinned to litesvm's own requirements (it deliberately mixes 3.x and 4.x,
which "bump everything to 4" gets wrong), and the `solana-syscalls` failure came from this
repository pinning **Rust 1.89.0** in `rust-toolchain.toml`. On 1.98.0 the same crate compiles
with no flags at all. A blocker that survives one round of investigation is not necessarily a
blocker.

**What changed.** `rust-toolchain.toml` pins 1.98.0, the dev-dependencies match litesvm 0.16's
pins, `scripts/build.sh` builds `--arch v3`, and both programs are redeployed as v3 on devnet.
The test suite runs against the v3 artifact, so the bytes that are verified are the bytes a
current-feature-set runtime will load.

---

## 9. Failure modes that would break the guarantee

These are the conditions under which the invariant would not hold. They are listed so that
they can be watched for — and so that a reviewer can check them rather than trust the
prose.

1. **A receipt is not rolled back when a downstream instruction fails.** Would break
   "retryable after failure" and could permanently poison a key.
   *Guarded by:* `downstream_failure_rolls_back_the_receipt`.
2. **A rebuilt duplicate can bypass the receipt.** Would defeat the entire product.
   *Guarded by:* `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`,
   `only_the_first_of_many_attempts_commits`.
3. **A third party can consume or block a key.** Would turn the guard into a griefing
   vector.
   *Guarded by:* `third_party_cannot_consume_another_authoritys_key`.
4. **Cleanup can run while a valid duplicate is still executable.** Would reopen the
   window. *Guarded by:* `receipt_cannot_be_closed_before_expiry` (both gates),
   `retention_below_minimum_is_rejected`, and the durable-nonce tests.
5. **A same-key/different-payload conflict goes undetected.** Would silently drop a real
   action. *Guarded by:* `same_key_different_payload_is_an_idempotency_conflict`.
6. **Rent can be redirected or lost.** *Guarded by:*
   `close_returns_rent_deposit_to_the_configured_destination`,
   `close_requires_the_configured_refund_destination`.
7. **An account at the receipt address that the program does not own is trusted.**
   *Guarded by:* `receipt_with_foreign_owner_is_rejected`,
   `malformed_receipt_data_is_rejected`,
   `unsupported_receipt_version_is_rejected`.

Every one of these is covered by a test in `programs/commit-once/tests/`, and each test
asserts on observable onchain state — counter values, account existence, lamport balances —
rather than on an error string.

---

## 10. Verification

```bash
bash scripts/build.sh   # builds both programs, verifies program IDs against deploy-keys/
bash scripts/test.sh    # runs the whole Rust suite against the compiled SBF artifact
```

The tests execute the **real compiled program** through LiteSVM, not a mock or a
reimplementation. See [`EVIDENCE.md`](../EVIDENCE.md) for the exact recorded results.
