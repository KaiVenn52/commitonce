# CommitOnce — founder story

Written in the first person, because this is the part of the submission where a judge is deciding
whether to believe the rest of it. Everything here is true, including the parts that are not
impressive.

**Two fields are deliberately left for the submission form rather than guessed at here: my name,
and where I am located.** They are facts about a person, and this repository does not invent
facts about people.

---

## Who I am

I am a **university engineering student**, and a solo founder. I am actively learning and building
on Solana, which is an accurate description of my experience and not a euphemism for something
more impressive.

What I am not: I have no infrastructure background. I have not worked at an RPC provider, a
validator operator, or a protocol team. I have no previous exit. I have no professional trading
experience. I have no team, no cofounder, no advisor, and no funding. Every line of code in this
repository, and every document in it, was written by me during the Contest Period.

I am saying that plainly at the top because judges verify, the rules require disclosure, and
overstating experience is the fastest way to lose the room. The honest case for this project is
not that I have done this before. It is that I hit the problem myself, and then did the work
properly.

---

## Why I started building it

I was withdrawing USDC from a Solana wallet, and the transaction failed.

What stuck with me was not the failure. It was that **I could not tell what had failed.** The
error did not say whether the problem was my wallet, my account setup, or the chain. There was no
way to look at the outcome and know which of those three things to go and fix. So like anyone
else, I hit retry.

And then I realised I had a worse problem than the first one. If the first attempt had actually
gone through, and my retry also went through, then I had just sent it twice — and nothing in the
interface, the error, or my own understanding could tell me whether that had happened.

The question that came out of that is the one this project is built on:

> **After a transaction error, what is safe to do next?**

That question is not really about a wallet, and it is not about USDC. It is about the fact that
"the transaction failed" and "the intent did not happen" are two different statements, and a user
is given no way to tell them apart.

---

## How that question led here

I went looking for the answer, and it turned out to be a protocol-level gap rather than a UX bug.

Solana's runtime deduplicates transactions by **message hash** — that is in Agave's own runtime
source, which says the message hash is added to the status cache *"to ensure that this message
won't be processed again with a different signature."* That protects *signed bytes*.

But the thing I actually cared about — *did my payment happen?* — is not signed bytes. It is an
intent. And the moment a client retries properly, it does the sensible engineering thing: it
rebuilds. Fresh blockhash, a higher priority fee because the first attempt was slow, maybe a
different route, re-signed. New bytes, new message hash, and the runtime sees a brand new
transaction. **Both can land.**

The part that made me decide to build rather than write a blog post: Solana's own
production-readiness guide names this and then hands the problem back to the application —
*"A rebuilt transaction has a new signature, so preserve application-level idempotency before
sending it."* The same page adds that a `null` result from the recent signature-status cache is
inconclusive, so even *asking* whether the first attempt landed is not reliable.

The chain tells you to solve it yourself, at the application layer, with the tools you have. The
tool that would let the chain answer the question directly did not exist as a product.

So I built it. One instruction, prepended to the transaction you were already building, that makes
a rebuilt retry unable to execute the same intent twice — **at-most-once successful execution of a
guarded logical intent, within the configured retention window.**

---

## Founder–market fit, honestly

The Colosseum guidance says a solo founder *"should explain their relevant experience and why
they're uniquely suited to build the product."* Here is the real answer, split into what I have
and what I do not.

**What I have.**

1. **I have had the failure myself, as a user, before I had any theory about it.** I was not
   looking for a protocol gap to build on; I was confused by a wallet and annoyed about it. The
   product's framing — *"after a transaction error, what is safe to do next?"* — comes from that,
   and it is the framing that makes the problem legible to developers who have not thought about
   message hashes.
2. **I read the primary sources and quoted them.** The claim that the runtime deduplicates by
   message hash is backed by Agave's own source comment, not by a blog post. The claim that
   Solana hands the problem to the application is a verbatim quote from Solana's documentation.
   The prior-art survey was built from primary sources and on-chain reads, and it says in its first
   section that the mechanism I used is **not novel** — which is the least comfortable and most
   useful thing in the whole repository.
3. **I built the boring parts that make a claim checkable.** A test suite that executes the real
   compiled SBF artifact through LiteSVM rather than a mock. Assertions on observable onchain
   state — counter values, account existence, lamport balances — rather than on error strings. A
   matched pair of tests that demonstrates the bug without the guard and the fix with it. Golden
   vectors pinned in three independent implementations. Measured overhead instead of "negligible".
   And an evidence document whose most important section is the list of what is **not** verified.
4. **I had the time and treated it as a full engineering sprint.** Four weeks, one program, one
   SDK, one test suite, one devnet deployment, one security model, one prior-art survey.

**What I do not have, stated without hedging.**

- **No infrastructure or protocol-team background.** I have not operated production Solana
  infrastructure. When a judge asks what I know about validator behaviour under load, the honest
  answer is "less than someone who has run it."
- **No prior company, exit, or funding.**
- **No professional trading experience** — which matters specifically for the trading-bot segment
  in [`GTM.md`](GTM.md). I can argue why a duplicated order is a risk; I cannot claim I have
  managed that risk with real capital.
- **No team.** Solo. The average winning Colosseum team is larger than one, and the guidance says
  so openly.
- **No security-audit experience.** I wrote a threat model with the specific failure modes that
  would break the guarantee, and paired each with the test that guards it — but a security model
  written by the author is a specification to be checked, not evidence, and I have said that in
  [`docs/SECURITY_MODEL.md`](../docs/SECURITY_MODEL.md) rather than letting it read as reassurance.

**What I would want a judge to weigh instead of credentials.** Whether the work is real, whether
the numbers are checkable, and whether the founder is honest about the limits. All three are
verifiable in about ten minutes with `bash verify.sh` and a read of
[`EVIDENCE.md`](../EVIDENCE.md) §7.

---

## Why I am building this as a company rather than a public good

Both are defensible, and the repository is Apache-2.0 either way, so the code is a public good
regardless of what happens commercially.

The reason it is a company: **a primitive that sits in front of money movement has to be
maintained, audited and supported for years.** Someone has to answer "is this still safe to use in
production?" after I stop being the only person who has read the code. The audit, the
observability around receipt state, the cleanup automation, and the on-call answer are real work
that has to be paid for — see [`GTM.md`](GTM.md) §5. A public good with no maintenance path is a
liability in exactly the place this product is meant to be trustworthy.

And the honest version of the ambition: the durable asset is not the instruction. It is being the
place a Solana team goes when it needs to answer *"did this already happen?"* with something
stronger than a log line.

---

## Being a student, and the University Award

There is a **$5,000 University Award** in this competition, and I am directly eligible: I am a
university engineering student.

I am not hiding it, and I am not leading with it either. Being a student is a real constraint on
what I can claim — it is why there is no audit, no mainnet deployment, and no team in this
submission. It is also why the four weeks of the Contest Period were spent on the program, the
tests and the evidence rather than on a website, and why the pitch says the next three steps are
publish, validate, and audit rather than anything more glamorous.

What a student has, in this particular case, is the willingness to read the primary sources
instead of the summary, and the time to write the test that proves the claim instead of asserting
it.

---

## Commitment

I intend to build this full-time after the Contest Period. The concrete plan, with dates and
thresholds, is in [`GTM.md`](GTM.md) §6 and [`TRACTION.md`](TRACTION.md) §4:

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
