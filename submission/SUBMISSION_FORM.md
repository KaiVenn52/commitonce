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

**Live-demo gate passed on 2026-10-08:** the deployment verifier matched both programs to
the local artifacts, including zero-only loader padding. The live A/B ended at 2 without
the guard and 1 with it; the guarded retry failed with `AlreadyCommitted`.
The evidence and transaction links are in [`PRE_SUBMIT_REVIEW.md`](PRE_SUBMIT_REVIEW.md).
Rehearse again immediately before recording; this dated result is not a permanent uptime claim.

The technical claims below have recorded evidence.
The authority on what is and is not verified is [`../EVIDENCE.md`](../EVIDENCE.md).

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
transaction you already build to prevent a rebuilt retry from executing the same guarded
intent twice within its retention window.

The first target is Solana payments teams: after an ambiguous timeout, rebuilding a payment
changes its message hash and both attempts can land. CommitOnce records the intent in the
same atomic transaction as the payment. A duplicate aborts; a failed payment leaves no receipt.

The guarantee is at-most-once successful execution of a guarded logical intent within the
configured retention window. The open-source program and SDK have 60 Rust tests and 79 SDK
tests. Devnet deployment is verified separately; there is no mainnet deployment, audit or
external adoption yet.
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

Background: university engineering student and solo founder. I have built other Solana
prototypes, but I do not claim production infrastructure experience.

I led CommitOnce's development with AI coding assistance during the Contest Period. The
repository's commit history and dated work log show the development and verification work;
I am responsible for the claims in this submission. There is no pre-existing CommitOnce code
from me in this repository. The work log is here:
https://github.com/KaiVenn52/commitonce/blob/main/submission/WORK_LOG.md

Why this problem: a client can time out after submitting a Solana transaction without knowing
whether it landed. Rebuilding and retrying creates new signed bytes, so runtime message-hash
deduplication cannot protect the underlying action. The project turns that failure mode into
a reproducible A/B test and an onchain guard. The question is: after an ambiguous outcome,
what can an application safely retry?
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
The first target is Solana payments, checkout and recurring-billing teams whose retry paths
lack application-level idempotency. Validate those paths before proposing an integration.
Trading, gaming, relayers and agent payments are later expansion opportunities. The integration
adds one instruction, with no change to the downstream program.

WHY THEY ADOPT IT
The pitch is not "add reliability" in the abstract. It is: you have a retry path, that retry
path can currently double-charge, and here is a test that shows it happening on chain plus a
one-instruction guard. The paired regression tests reproduce the unguarded and guarded
outcomes locally, with no cluster or funds required; building the toolchain takes longer.

DISTRIBUTION
The SDK declares no runtime dependencies and one peer dependency, @solana/kit. Apache-2.0
permits integration under its licence terms; adopters still need to review the code and its
toolchain. Today it is installed from source. npm publication is planned, alongside the
integration playbook and outreach to teams with a visible retry path.

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
There is no pre-existing CommitOnce code from me in this submission. I led the project with
AI coding assistance during the Contest Period. The dated work log and commit history record
that development: https://github.com/KaiVenn52/commitonce/blob/main/submission/WORK_LOG.md

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
| Metrics | `60 Rust tests, 79 SDK tests, both suites green; CI green on a clean runner; both programs live on devnet` |
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
