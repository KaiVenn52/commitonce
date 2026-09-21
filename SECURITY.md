# Security policy

## Status: unaudited

**CommitOnce is not audited. No audit has been performed, no audit firm has been engaged, and
no audit is scheduled.** This is a pre-audit project. Treat every part of this repository as
unreviewed code written by its own authors.

What that means concretely:

* Nothing here has been independently reviewed. The 45 Rust tests and 71 SDK tests in this
  repository were written by the same authors as the code they test. They are evidence that
  the code does what its authors intended, not evidence that the intent is correct.
* `commit_once` is **not deployed to mainnet**. Neither program holds user value.
* A devnet deployment of both programs exists, and it is **upgradeable** — the upgrade
  authority is a single key. See [`EVIDENCE.md`](EVIDENCE.md) §3 for the addresses and the
  transaction signatures. An upgradeable program is a weaker trust model than an immutable
  one, and nothing on devnet should be treated as production.
* There is **no bug bounty** and no financial reward for reports. This is stated up front so
  that nobody spends effort expecting payment.
* `@commitonce/solana` is **not published to npm**. No third party uses CommitOnce.

If you need a guarantee stronger than "the authors read it carefully", this project does not
currently offer one. See [`NEEDS_OWNER_ACTION.md`](NEEDS_OWNER_ACTION.md) §6 for the audit
status as the owner records it.

---

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request, or discussion for a security finding.**
A public report is a working exploit against everyone who integrates the guard before a fix
ships.

### Private channel

<!-- PLACEHOLDER: the address below is a non-deliverable placeholder. `.invalid` is reserved
     by RFC 2606 precisely so that it can never be a real mailbox. The repository owner MUST
     replace it with a monitored address before this repository is made public, and MUST
     either remove this comment or confirm the replacement. Until then, this policy has no
     working private channel and reports cannot be received. -->

> **PLACEHOLDER — NOT A WORKING CONTACT.** The address
> `SECURITY-CONTACT-NOT-SET@example.invalid` is a placeholder that the repository owner must
> replace with a monitored mailbox before publication. Mail sent to it is not delivered to
> anyone. If you are reading this in a published repository and the placeholder is still
> present, the private channel does not exist yet — please open a minimal public issue that
> says only *"security contact needed"* and nothing about the finding, so the owner can
> establish a channel.

Once the owner has set a real address, a report should be a single email to it with the
subject line:

```
CommitOnce security report: <one-line summary>
```

Please send **one** email. Include everything requested in "What to include" below in that
first message, so that triage does not require a round trip. If the finding is not
encryptable and you are worried about interception, say so and send a non-sensitive summary
first; the owner will reply with an encrypted channel.

GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") is the
preferred channel **if the button is present** on the published repository. The owner is
expected to enable it before publication; this document cannot confirm that it has been
enabled, so check before relying on it.

### What not to do

* Do not disclose the finding publicly before a fix is available, unless the finding is
  already public through someone else's disclosure.
* Do not test against mainnet, and do not test with funds you are not prepared to lose.
* Do not test against third-party RPC providers in a way that constitutes abuse, and do not
  run denial-of-service tests against any shared infrastructure.
* Do not consume, block, or grief idempotency keys that belong to anyone but yourself. The
  receipt key space is authority-scoped, so a test that claims another party's key is a
  denial-of-service attempt against that party, not a proof of concept.

### What to expect

This project has one maintainer and no security team, so the following are good-faith
targets rather than a contractual SLA:

| Stage | Target |
| --- | --- |
| Acknowledgement that the report arrived | 3 business days |
| Initial assessment (in scope / not in scope, severity) | 10 business days |
| Fix or documented mitigation for Critical and High findings | 30 days, best effort |
| Public credit, if you want it | with the fix, or on request |

If a report is out of scope or will not be fixed, you will get the reasoning, not silence.
No embargo length is imposed by this project: if you need to publish after a reasonable
window and no fix exists, that is a legitimate choice, and the owner will not threaten you
for it.

---

## Scope

### In scope

| Area | Files | Why it matters |
| --- | --- | --- |
| The guard program | `programs/commit-once/src/**` | `claim`, `close_receipt`, `IntentReceipt` state, the `seeds`/`bump` constraints, retention and expiry arithmetic, the durable-nonce policy, owner/discriminator/version checks, rent refund destination, error codes |
| Program ID integrity | `programs/commit-once/src/lib.rs` (`declare_id!`), `deploy-keys/commit_once-keypair.json`, `Anchor.toml` | A program deployed at an address other than its compiled-in `declare_id!` refuses to run; a mismatch between these would make every integration fail, or make a deployment land somewhere nobody controls |
| SDK hashing | `packages/sdk/src/hash.ts` | Domain separation and encoding of `namespace_hash`, `idempotency_key_hash`, `payload_hash`. A collision or a missing domain separator silently merges two different intents |
| SDK PDA derivation | `packages/sdk/src/pda.ts` | The receipt address. A derivation that differs from the program's `seeds` by one byte produces a receipt the program will reject — or, worse, an address that a different authority could occupy |
| SDK instruction encoding | `packages/sdk/src/instructions.ts`, `packages/sdk/src/client.ts` | `encodeIntent`, the retention bounds, the 144-byte wire layout, the `undefined`-rejecting fingerprint rules |
| SDK account decoding | `packages/sdk/src/accounts.ts` | The 202-byte offset table. A wrong offset makes a tool report a committed intent as uncommitted |
| Build and verification scripts | `scripts/build.sh`, `scripts/test.sh`, `verify.sh` | These decide what artifact is built, for which SBPF architecture, and whether the program ID check actually runs. A script that reports success without checking is a security defect in its own right |

### Out of scope

| Area | Why |
| --- | --- |
| `programs/demo-counter` | A test fixture. It exists only to be a business action for the A/B demonstration; it is not a product and nobody is expected to deploy it with value at risk |
| Third-party dependencies | `anchor-lang`, `solana-*` crates, `litesvm`, `@solana/kit`, `typescript`, `vitest`, and everything in `pnpm-lock.yaml`. Report those upstream. A finding that CommitOnce *misuses* a dependency API is in scope; the dependency's own bug is not |
| `examples/`, `apps/` | Demonstration code. A bug that only makes a demo print the wrong thing is not a security finding, unless it demonstrates that the SDK derives the wrong receipt or fingerprint |
| `docs/`, `submission/`, `EVIDENCE.md` | Prose. A documentation error that overstates the guarantee **is** worth reporting, but it is a documentation issue, not a vulnerability — see the guarantee section below |
| CI configuration, linting, formatting | No security property depends on them |
| Off-chain infrastructure | There is none. CommitOnce runs no servers, holds no keys, and has no backend to compromise |
| The Solana runtime itself | Message-hash deduplication, blockhash expiry and transaction atomicity are the platform's, not this project's |

---

## The intended guarantee

Judge every finding against this sentence. A finding that makes it false is a security
finding regardless of how small the code change looks; a finding that does not touch it is
still welcome, but should be described as a correctness or quality issue.

> For one (authority, namespace, idempotency key) tuple, no more than one guarded
> transaction may successfully commit during the receipt retention period

Three parts of that sentence are load-bearing:

* **at most once**, not exactly once. The guard prevents a second execution; it does not make
  a first execution succeed. Retrying until success remains the caller's job.
* **guarded transactions**. Only transactions that include the `claim` instruction are
  covered. A code path that skips the guard is unprotected by design.
* **during the receipt retention period**. After a receipt expires and is closed, the key is
  free again. This is a deliberate, tested trade-off (`closing_frees_the_key_for_a_new_claim`),
  not a defect.

**Never describe CommitOnce as providing "exactly once" execution as a universal claim.** The
honest formulation is *at-most-once successful execution of a guarded logical intent within
the configured retention window*. Any document, comment or package description in this
repository that says otherwise is a documentation bug worth reporting.

For the full threat model — T1 through T10, the residual risks, the explicit non-goals, and
the seven failure modes that would break the guarantee with the test that guards each one —
see [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md). That document is the right place to
start before writing a report: if the behaviour you found is listed there as a known
limitation, say so in your report and explain why you think the limitation is worse than
documented.

---

## Severity guide

Severity is about the guarantee above, not about how interesting the bug is.

| Severity | Definition | Examples |
| --- | --- | --- |
| **Critical** | Breaks the guarantee for an ordinary integrator with no unusual configuration: two guarded transactions for one `(authority, namespace, key)` tuple both commit inside the retention window, or a receipt can be created without its business action committing, or the rent deposit can be stolen or permanently lost. | A rebuilt duplicate bypasses the receipt; a downstream failure that leaves the receipt behind; `close_receipt` paying a destination other than the recorded `refund_destination` |
| **High** | Breaks the guarantee under a configuration an integrator could plausibly reach, or hands an attacker a cheap, reliable denial of service on someone else's key space, or makes a third party's intent silently unclaimable. | A third party able to claim or block another authority's key; cleanup able to run while a still-valid signed duplicate is executable; a retention/expiry path that lets a finite receipt be closed early |
| **Medium** | Silently weakens the guarantee rather than breaking it: a case where the caller believes they are protected and are not, or where two genuinely different intents collapse into one identity. | A fingerprint encoding that drops a field (`undefined` handling), a hash domain-separation gap, an SDK PDA derivation that disagrees with the program for a specific input, a conflict that goes undetected |
| **Low** | No effect on the guarantee, but a real defect in the guard or its tooling. | A wrong error code returned for a malformed account, a decoder offset that misreports a non-security field, an account constraint that is redundant but harmless, a verification script that can print success after a step silently did nothing |
| **Informational** | Quality, clarity, documentation accuracy, or hardening suggestions. | Prose that overstates the guarantee, a missing test for a documented behaviour, a confusing error message, a build reproducibility suggestion |

When in doubt, report it and state your own severity estimate with the reasoning. An
incorrect severity estimate is not a reason for a report to be dismissed.

---

## What to include in a report

A report that can be reproduced in ten minutes gets triaged in ten minutes. Please include:

1. **Cluster.** `localnet`, `devnet`, or `mainnet-beta`. State it explicitly. Mainnet is not
   deployed, so a mainnet report is either a mistake or a very interesting finding.
2. **Program ID.** The full base58 address, and whether it is the `commit_once` program
   (`CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB`), the `demo_counter` fixture
   (`EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5`), or something else.
3. **A transaction signature, or reproducible steps.** Either is acceptable; both is better.
   * A signature, plus the cluster, plus the approximate time, lets the owner read the exact
     accounts and logs back from chain state.
   * Steps should be runnable from a clean checkout: the commands, the environment variables
     used, the exact versions of `solana-cli`, `anchor`, `cargo`, `node` and `pnpm`, and the
     inputs (authority, namespace, key, payload) in a form that can be pasted.
   * For a test-harness finding, the exact `cargo test` or `pnpm test` invocation and the
     test name are the ideal report.
4. **Expected vs actual.** State the expected behaviour and cite the source: the guarantee
   sentence above, a line in `docs/SECURITY_MODEL.md`, or a comment in the code. Then state
   what actually happened. This is the part that makes a report actionable — "the receipt
   exists but the counter is 0" is a finding; "the program is unsafe" is not.
5. **Impact.** Who is affected: every integrator, integrators who choose a particular
   retention, integrators using a specific SDK version, or only a caller who has already
   done something unusual. Include the cost to an attacker if the finding is a griefing or
   denial-of-service issue.
6. **Whether the guarantee is broken**, and if not, what property is affected instead.
7. **Your severity estimate**, from the table above, with reasoning.
8. **Anything you tried that did not work**, if you were probing a hypothesis. Negative
   results save the owner from re-testing the same thing.

If you have a fix, a patch or a pull request is welcome — but send the report first, so the
finding is not sitting in public while it is being reviewed.

---

## Economics worth knowing before you report

A receipt is a 202-byte program-owned account. At mainnet's current rent rate of 5080
lamports per byte, that is a deposit of **1,676,400 lamports (0.0016764 SOL) per receipt**,
paid by the authority at claim time and refunded in full by `close_receipt` once both
deadlines have passed. `retention: 'permanent'` (`retention_seconds == 0`) has no cleanup
path, so a permanent receipt holds that deposit forever.

Two consequences that are relevant to severity assessment:

* The `solana-rent` Rust crate still ships a stale effective rate of 6960 lamports/byte, so
  any rent estimate derived from it is about 37% too high. The test harness overrides the
  Rent sysvar to the real 5080 value. A report that depends on rent arithmetic should state
  which figure it used.
* A griefing attack that requires an attacker to lock 1,676,400 lamports per attempt is
  meaningfully more expensive than one that costs only a transaction fee. Where that
  asymmetry is the only thing limiting an attack, say so — it is a real mitigation, but it is
  not a guarantee, and the owner would rather know.

---

## Scope of this policy

This policy covers the code in this repository only. It does not cover the Solana cluster,
any RPC provider, any wallet, any integrator's application, or any deployment this project
does not control. Nothing in this document is a warranty, a service-level agreement, a bug
bounty term, or a promise that a report will be fixed.
