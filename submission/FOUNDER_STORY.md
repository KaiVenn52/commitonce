# CommitOnce — founder story

Written in the first person where the founder's facts are confirmed. This is a draft for owner
review, not a source of invented personal history.

**Two fields are deliberately left for the submission form rather than guessed at here: my name,
and where I am located.** They are facts about a person, and this repository does not invent
facts about people.

---

## Who I am

I am a **university engineering student** and a solo founder. I have built other Solana
prototypes, but I do not claim to have operated production Solana infrastructure. I led
CommitOnce's development with AI coding assistance during the Contest Period. The work log and
commit history document that work; I am responsible for the claims in this submission.

The case for this project is the checkable work, not a fabricated personal incident or an
inflated résumé.

---

## The question behind the product

A client can submit a Solana transaction, time out, and have no conclusive answer about whether
the transaction landed. Rebuilding it with a fresh blockhash creates a different signed message;
both attempts can land. This is a concrete developer failure mode, not a claim about a personal
wallet incident.

The question CommitOnce addresses is:

> **After a transaction error, what is safe to do next?**

"The client did not receive a success response" and "the intent did not happen" are different
statements. A safe retry path has to account for that difference.

---

## How that question led here

The answer lies at the boundary between transaction delivery and application intent.

Solana's runtime deduplicates transactions by **message hash** — that is in Agave's own runtime
source, which says the message hash is added to the status cache *"to ensure that this message
won't be processed again with a different signature."* That protects *signed bytes*.

But what the application cares about — *did this action happen?* — is not signed bytes. It is an
intent. And the moment a client retries, it does the sensible engineering thing: it
rebuilds. Fresh blockhash, a higher priority fee because the first attempt was slow, maybe a
different route, re-signed. New bytes, new message hash, and the runtime sees a brand new
transaction. **Both can land.**

Solana's own production-readiness guide names this and hands the problem back to the application —
*"A rebuilt transaction has a new signature, so preserve application-level idempotency before
sending it."* The same page adds that a `null` result from the recent signature-status cache is
inconclusive, so even *asking* whether the first attempt landed is not reliable.

The chain tells you to solve it yourself, at the application layer, with the tools you have. The
tool that would let the chain answer the question directly did not exist as a product.

CommitOnce addresses it with one instruction, prepended to the transaction you were already building, that makes
a rebuilt retry unable to execute the same intent twice — **at-most-once successful execution of a
guarded logical intent, within the configured retention window.**

---

## Founder–market fit, honestly

The Colosseum guidance says a solo founder *"should explain their relevant experience and why
they're uniquely suited to build the product."* Here is the real answer, split into what I have
and what I do not.

**What I have.**

1. **The failure mode is demonstrable.** The A/B demo rebuilds two transactions for one intent.
   Without the guard the counter reaches two; with the guard it reaches one. The framing —
   *"after an ambiguous outcome, what is safe to retry?"* — is grounded in that behavior,
   not in an invented personal wallet story.
2. **The repository cites primary sources.** The claim that the runtime deduplicates by
   message hash is backed by Agave's own source comment, not by a blog post. The claim that
   Solana hands the problem to the application is a verbatim quote from Solana's documentation.
   The prior-art survey was built from primary sources and on-chain reads, and it says in its first
   section that the mechanism I used is **not novel** — which is the least comfortable and most
   useful thing in the whole repository.
3. **The build includes the boring parts that make a claim checkable.** A test suite that executes the real
   compiled SBF artifact through LiteSVM rather than a mock. Assertions on observable onchain
   state — counter values, account existence, lamport balances — rather than on error strings. A
   matched pair of tests that demonstrates the bug without the guard and the fix with it. Golden
   vectors pinned in three independent implementations. Measured overhead instead of "negligible".
   And an evidence document whose most important section is the list of what is **not** verified.
4. **The work is dated.** The visible repository history starts on September 21, inside the
   Contest Period. One program, one SDK, test suites, devnet deployment evidence, a security
   model, and a prior-art survey can all be inspected independently.

**What the project does not claim.**

- No mainnet deployment, external security audit, production usage, customers, or revenue.
- No production infrastructure operation or professional trading record is offered as a
  qualification; the submission stands on the checkable artifact instead.
- No team. This is a solo-founder entry, developed with AI coding assistance.
- The threat model is a specification for review, not an independent audit; see
  [`docs/SECURITY_MODEL.md`](../docs/SECURITY_MODEL.md).

**What I would want a judge to weigh instead of credentials.** Whether the work is real, whether
the numbers are checkable, and whether the founder is honest about the limits. All three are
verifiable in about ten minutes with `bash verify.sh` and a read of
[`EVIDENCE.md`](../EVIDENCE.md) §7.

---

## A possible business beyond the public-good code

Both are defensible, and the repository is Apache-2.0 either way, so the code is a public good
regardless of what happens commercially.

The business case to validate is that **a primitive that sits in front of money movement has to be
maintained, audited and supported for years.** Someone has to answer "is this still safe to use in
production?" over time. The audit, the
observability around receipt state, the cleanup automation, and the on-call answer are real work
that has to be paid for — see [`GTM.md`](GTM.md) §5. A public good with no maintenance path is a
liability in exactly the place this product is meant to be trustworthy.

And the honest version of the ambition: the durable asset is not the instruction. It is being the
place a Solana team goes when it needs to answer *"did this already happen?"* with something
stronger than a log line.

---

## Being a student, and the University Award

There is a **$5,000 University Award** in this competition. I am a university engineering
student, so I may qualify, subject to the organizer's award criteria and verification.

Student status is a confirmed fact, not an explanation for every product limitation. The lack
of an audit, mainnet deployment, team, and external users is stated separately and directly.

---

## Commitment

The next-stage plan, with dates and thresholds, is in [`GTM.md`](GTM.md) §6 and
[`TRACTION.md`](TRACTION.md) §4. I have not committed to working on CommitOnce full-time after
the Contest Period. The concrete near-term steps are:

1. **Make it installable** — publish the SDK to npm (not published yet).
2. **Ten conversations** with the archetypes in [`GTM.md`](GTM.md) §3, documented, with a
   pre-committed definition of what counts as validation and what would count as failure.
3. **Shadow mode with one team** — the number that matters is "N retries, M of which would have
   double-executed without the guard."
4. **An audit** before anything holds real value, and a public statement if the budget does not
   exist rather than an implication that it happened.

## What I would tell a judge to check first

Do not take any of this on trust. Run `bash verify.sh`, read the two tests that carry the whole
product — `without_guard_two_rebuilt_transactions_execute_twice` and
`with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once` — and then read
[`EVIDENCE.md`](../EVIDENCE.md) §7 and [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §0. Those two
sections are where this submission deliberately argues against itself, and they are the reason the
rest of it can be believed.
