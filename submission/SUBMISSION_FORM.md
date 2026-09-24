# Submission form — answers, ready to paste

The Colosseum portal asks for a specific set of fields. Everything needed to answer them is
already in this repository, but it is spread across eleven documents. This file collects it into
the exact text for each field, so filling the form is transcription rather than composition.

**Three things are deliberately left blank**, because they are facts this repository cannot
supply and must not invent:

| Placeholder | Who fills it | Why |
| --- | --- | --- |
| `<YOUR NAME>` | you | A fact about a person. |
| `<YOUR LOCATION>` | you | A fact about a person. |
| `<PRESENTATION VIDEO URL>` / `<DEMO VIDEO URL>` | you | The videos do not exist yet; recording them is an owner action. |

Everything else below is verified and reproducible. The authority on what is and is not verified
is [`../EVIDENCE.md`](../EVIDENCE.md).

---

## 1. Product name

```
CommitOnce
```

## 2. Brief description

The portal's own guidance is that a judge reads this first, so it leads with what the product
does rather than how it works.

```
CommitOnce is an onchain idempotency layer for Solana. Prepend one instruction to the
transaction you already build, and a rebuilt retry can no longer execute the same logical
intent a second time.

Solana's runtime deduplicates transactions by message hash, not by intent. When a client
times out and retries, it rebuilds the transaction — fresh blockhash, different priority fee,
re-signed — which produces a different message hash. The runtime sees a brand new transaction
and both attempts can land. Solana's own production-readiness guide names this and hands the
remedy back to the application: "A rebuilt transaction has a new signature, so preserve
application-level idempotency before sending it."

CommitOnce is that layer. A single `claim` instruction is prepended to the caller's existing
transaction, so it commits atomically with the business instructions. The first attempt
creates a receipt account whose address is derived from (authority, namespace, idempotency
key). A retry of the same intent finds that receipt and the whole transaction reverts before
any business instruction runs, returning a specific, actionable error: AlreadyCommitted.

The guarantee is at-most-once successful execution of a guarded logical intent within the
configured retention window. It is not a universal "exactly once" claim, and the repository
does not describe it as one.

It is live on devnet and unaudited. 55 Rust tests and 71 SDK tests pass, and the tests execute
the real compiled SBF artifact rather than a mock.
```

## 3. Which blockchains and tools are being integrated

```
Blockchain: Solana only. CommitOnce is a Solana program and does not target any other chain.
The receipt PDA derivation, the retention window and the durable-nonce policy are all
Solana-specific.

Language and framework:
- Rust, Anchor 1.2.0 (program framework and IDL)
- SBPFv3 target, built with cargo-build-sbf from the Solana 4.2.2 toolchain

Client:
- TypeScript 7.0.2
- @solana/kit 8.3.0 as the only peer dependency
- The SDK has ZERO runtime dependencies. It hand-encodes the Anchor discriminators, the Borsh
  instruction body and the base64 event decoding, and uses WebCrypto for hashing, so it imports
  nothing from Anchor's JavaScript library.

Testing:
- LiteSVM 0.16.0, executing the real compiled .so in-process — not a mock, not a
  reimplementation. The tests assert on observable onchain state: account existence, lamport
  balances, PDA addresses, account data lengths, counter values.

Composes with, verified by execution against devnet:
- System Program (lamport transfer)
- SPL Token (TransferChecked) and the Associated Token Program (CreateIdempotent), both in the
  same atomic transaction as the guard
- **Token-2022**, which is a different program with the same instruction encoding — the guard is
  indifferent to which one executes the business instructions, and that has been executed against
  devnet rather than reasoned about
- An arbitrary third-party Anchor program
- Another program calling `claim` through a CPI, so a program can guard its own actions
  rather than requiring every client to prepend the guard
- A **PDA** as the authority, signed through `invoke_signed` — the case a Squads vault or any
  program-owned account needs, verified by test

Also verified: v0 transactions with address lookup tables, which is the transaction shape most
production Solana clients build.

Licence: Apache-2.0.
```

## 4. All teammates, with backgrounds and previous experience

One founder, no team. Stated plainly, because judges verify and the rules require disclosure.

```
Solo founder: <YOUR NAME>

Background: university engineering student. I am actively learning and building on Solana,
which is an accurate description of my experience rather than a euphemism for something more
impressive.

Previous experience, stated negatively because that is the honest form: no infrastructure
background, no previous work at an RPC provider, validator operator or protocol team, no
previous exit, no professional trading experience, no cofounder, no advisor, no funding, and no
prior Solana project.

Every line of code and every document in this submission was written by me during the Contest
Period. There is no pre-existing code from me in this repository, and no third party wrote any
part of it. Commit history and a dated work log are in the repository:
https://github.com/KaiVenn52/commitonce/blob/main/submission/WORK_LOG.md

Why this is the right person to build it: I hit the problem myself. I was withdrawing USDC from
a Solana wallet, the transaction failed, and I could not tell what had failed — whether the
problem was my wallet, my account setup, or the chain. So I retried. And then I realised that
if the first attempt had actually gone through, I had just sent it twice, and nothing in the
interface or the error could tell me whether that had happened.

The question that came out of that is the one this project is built on: after a transaction
error, what is safe to do next?
```

## 5. Where the team is located

```
<YOUR LOCATION>
```

## 6. Product logo or graphic

Upload `assets/brand/commitonce-mark-1024.png` — 1024×1024, opaque, the full mark on the ink
background.

If the form caps the size, use `assets/brand/commitonce-mark-512.png`. Both are in
[`../assets/brand/`](../assets/brand/), and `../assets/brand/README.md` documents the palette,
the clear-space rule, and why a second compact mark exists for sizes below 48px.

## 7. GitHub repository link

```
https://github.com/KaiVenn52/commitonce
```

Public, Apache-2.0, default branch `main`. Readable without an account, so nothing needs to be
granted for review. CI runs on every push and is green.

## 8. Presentation video (two to three minutes)

```
<PRESENTATION VIDEO URL>
```

Script and shot list: [`PITCH_SCRIPT.md`](PITCH_SCRIPT.md),
[`VIDEO_SHOTLIST.md`](VIDEO_SHOTLIST.md). Target **2:00–2:59** — the three official sources
phrase the limit three different ways ("under 3 minutes", "two-to-three-minute", "no more than
three minutes") and 2:00–2:59 satisfies all of them.

## 9. Product-demo video (no more than three minutes)

```
<DEMO VIDEO URL>
```

Script: [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md). The demo runs against devnet and prints real explorer
links; the pre-flight gates in §1 of that script must pass before recording.

## 10. Go-to-market, demand validation, and distribution

```
WHO IT IS FOR
Anyone who retries a Solana transaction: payments processors, trading bots, game and mint
backends, relayers, subscription and payroll flows, and agent frameworks that pay autonomously.
The integration cost is one prepended instruction, with no change to the downstream program.

WHY THEY ADOPT IT
The pitch is not "add reliability" in the abstract. It is: you have a retry path, that retry
path can currently double-charge, and here is a test that shows it happening on chain plus a
one-instruction fix. The proof is checkable in the repository in under a minute, with no
cluster and no funds required.

DISTRIBUTION
The SDK is zero-dependency and Apache-2.0, so adoption has no supply-chain cost and no licence
negotiation. Distribution is through the npm package, the integration playbook, and direct
outreach to teams with a visible retry path.

LEVERAGE, WHICH IS THE REAL ARGUMENT
Each integration guards every transaction on that path. One relayer or payments integration
reaches every application behind it, so the first ten integrations matter far more than the
ten-thousandth user. That is why the go-to-market plan spends its effort on ten conversations
rather than on a growth funnel.

VALIDATION STATUS, STATED HONESTLY
No demand validation has been completed. There are no users, no integrations, no revenue and no
waitlist, and none are claimed anywhere in this submission. What exists instead is a plan for
ten specific conversations with teams that have the problem in the open, in
https://github.com/KaiVenn52/commitonce/blob/main/submission/TRACTION.md — including what would
count as a disconfirming answer.

The full plan, with the competitive analysis and the business model, is in
https://github.com/KaiVenn52/commitonce/blob/main/submission/GTM.md
```

---

## Disclosure of pre-existing work

The rules require disclosure of all relevant past development work. This is the statement to
paste where the form asks:

```
There is no pre-existing code from me in this submission. Every file in the repository was
written during the Contest Period, which the dated work log and the commit history both
demonstrate: https://github.com/KaiVenn52/commitonce/blob/main/submission/WORK_LOG.md

Third-party open-source dependencies are used and are inventoried with their licences and
provenance in the technical overview. None of them is a Solana idempotency primitive; the
closest prior art is a separate project, is surveyed with primary sources, and is explained
rather than hidden:
https://github.com/KaiVenn52/commitonce/blob/main/docs/PRIOR_ART.md

The receipt-PDA-abort-if-exists mechanism is not novel, and neither is the "prepend a guard
instruction" developer experience. The repository says so in its own README, and the prior-art
survey opens by arguing against the project's own novelty claim. What is new is the product and
its security model: authority-scoped keys enforced by the program, no RPC or prover dependency,
first-class namespaces, and an explicit retention window with a refundable deposit.
```

---

## Optional fields

The FAQ lists *"ignoring optional fields that could provide important context"* as a common
mistake, so fill these rather than skipping them.

| If the form asks for… | Paste |
| --- | --- |
| Track | `Solana` |
| Stage | `Working product on devnet, unaudited, no users yet` |
| Website | leave blank if the form requires a URL — there is no deployed site, and a placeholder would be worse than an empty field |
| Metrics | `55 Rust tests, 71 SDK tests, both suites green; CI green on a clean runner; both programs live on devnet` |
| Anything about traction | `None. No users, integrations, revenue or waitlist. Stated rather than implied away.` |
| Anything about funding raised | `None.` |

---

## Pre-submit checklist

- [ ] `<YOUR NAME>` and `<YOUR LOCATION>` filled in
- [ ] Both videos recorded, uploaded, and their URLs pasted
- [ ] Logo uploaded from `assets/brand/`
- [ ] Repository link opens in a **private browser window** (proves it is readable by someone
      who is not you)
- [ ] Every optional field either filled or deliberately left blank for a stated reason
- [ ] Submitted before **11:59pm PT on 2026-10-12**
