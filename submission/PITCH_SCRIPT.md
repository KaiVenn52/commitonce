# CommitOnce — presentation (pitch) video script

**Hard constraint.** Every Colosseum source agrees the pitch video must be short of three
minutes: the FAQ says *"a two-to-three-minute presentation video"*, the 2024 guide says
*"presentations are required to be under 3 minutes"*, and the 2025 workshop guide says
*"no more than three minutes"*. **Target 2:00–2:59.** This script is written for **2:32–2:48**
depending on pace.

**Timing basis.** 405 words of spoken script. At 150 words per minute that is **2:42**; at
145 wpm **2:48**; at 160 wpm **2:32**. Word counts below were counted mechanically from the
script text, not estimated. Before recording, read the whole script aloud once with a timer and
adjust the pace rather than the words.

**Delivery.** Loom or an equivalent screen recorder, one continuous take, no cuts needed. Talk
to the camera for §1 and §6 and over the screen for the rest. Do not read the numbers with a
flat voice; the numbers are the argument.

---

## Timing map

| § | Content | Words | Time | Cumulative |
| --- | --- | --- | --- | --- |
| 1 | The story: a USDC withdrawal that failed, and the question it left | 58 | 23s | 0:00 – 0:23 |
| 2 | The problem in the protocol: message-hash dedup is not intent dedup | 64 | 26s | 0:23 – 0:49 |
| 3 | What CommitOnce is, and the guarantee stated precisely | 92 | 37s | 0:49 – 1:26 |
| 4 | What is built and verified today | 95 | 38s | 1:26 – 2:04 |
| 5 | Who it is for and why the market is every application that retries | 47 | 19s | 2:04 – 2:23 |
| 6 | Honest status and the next three steps | 49 | 20s | 2:23 – 2:43 |
| | **Total** | **405** | **~2:43** | |

*The total is 405 words ÷ 150 wpm = 2:42; the cumulative column reads 2:43 because each section's
seconds are rounded individually. Both are inside the 2:00–2:59 window.*

---

## The script

> Read the script text verbatim. The bracketed lines are camera and screen directions, not
> spoken words, and are excluded from the word counts above.

### §1 — The story (0:00 – 0:23, 58 words)

*[On camera, medium shot, no slides. This is the hook; do not open with a logo.]*

> I was withdrawing USDC from a Solana wallet and the transaction failed. I did what everyone
> does: I hit retry. Then I realised I had no idea whether the first attempt had landed, or
> whether my retry had just sent it twice. That question, after a transaction error, what is
> safe to do next, is why CommitOnce exists.

### §2 — The problem (0:23 – 0:49, 64 words)

*[Screen: the transaction diagram from `README.md`, or a two-column slide — "runtime dedup:
message hash" / "your retry: new bytes".]*

> Solana deduplicates transactions by message hash. That is in Agave's own runtime source. It
> protects signed bytes, not intent. When your client times out and rebuilds, with a fresh
> blockhash and a higher priority fee, the message hash changes and the runtime sees a brand new
> transaction. Both can land. Solana's production-readiness guide names this and tells
> developers to preserve application-level idempotency before sending.

### §3 — What it is, and the guarantee (0:49 – 1:26, 92 words)

*[Screen: the one-transaction diagram — `claim` first, business instructions after, "receipt
present → ERROR → whole transaction reverts".]*

> CommitOnce is that layer: idempotency keys for Solana. One instruction,
> `commit_once::claim`, prepended to the same atomic transaction as your business instructions.
> It creates a receipt PDA keyed by your authority, a namespace, and your key. If the receipt
> already exists, the instruction errors and the whole transaction reverts, so your business
> instructions never run a second time. Your program does not change. The guarantee is precise:
> at-most-once successful execution of a guarded logical intent, within the configured
> retention window. It stops a second execution; it does not make the first one happen.

*[Pause for one beat after "retention window." The next sentence is the credibility line. Do
not rush it, and do not say "exactly once".]*

### §4 — What is built and verified (1:26 – 2:04, 95 words)

*[Screen: switch to the terminal and run the A/B demo, or show the test summary. This is the
only section where a judge can see the product working, so let the screen carry the weight.]*

> The program is deployed and live on devnet. Forty Rust tests pass with exit code zero,
> executing the real compiled SBF artifact through LiteSVM. Two of them are the whole story.
> Without the guard, two rebuilt transactions both land and the counter reads two. With the
> guard, the second is blocked and the counter reads one. Forty-eight SDK tests pass, with
> golden vectors cross-checked by an independent implementation. Measured cost: under ten
> thousand compute units, four hundred bytes, usually three extra accounts. The receipt is two
> hundred and two bytes, and the rent is refundable.

### §5 — Who it is for (2:04 – 2:23, 47 words)

*[Screen: a simple list of five archetypes. No logos — none of these are customers.]*

> The people who need this already have the bug: payments processors, trading bots, game
> backends, relayers. Anyone whose code rebuilds a transaction after an ambiguous failure. That
> is most applications that retry. It is infrastructure: one prepended instruction, no changes
> to your program, Apache-2.0, no RPC dependency.

### §6 — Honest status and next steps (2:23 – 2:43, 49 words)

*[On camera. Say the absences calmly and without apology; they are disclosed, not concealed.]*

> What I will not claim: no mainnet deployment, no audit, no npm release, no users, no revenue.
> I am one founder, a university engineering student, and this is what I built during the
> contest period. Next: publish the SDK, land ten design partners, and audit before anything
> holds value.

*[Stop. Do not add a closing slogan. The last sentence is the ask.]*

---

## Coverage check against the required pitch contents

The required contents are the union of the two Colosseum blog posts and the hackathon FAQ.

| Required | Where |
| --- | --- |
| Team background | §6 (one founder, university engineering student, solo) |
| Product description | §3 |
| Why you started building it | §1 |
| Who the product is for | §5 |
| The problem being solved | §1 and §2 |
| The potential market opportunity | §5, expanded in [`GTM.md`](GTM.md) and [`FAQ.md`](FAQ.md) |
| How you will get initial usage, or traction already received | §6 (truthfully: none yet), expanded in [`TRACTION.md`](TRACTION.md) |
| How the product works (demo) | §4, and the full walkthrough in [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |
| Broader vision | §6 (audit before anything holds value; infrastructure primitive) |

## Things this script deliberately does not do

- It never says **"exactly once"**. The guarantee is stated as *at-most-once successful
  execution of a guarded logical intent within the configured retention window*, and the
  distinction is made out loud in §3. Overclaiming here is the fastest way to lose a judge who
  reads the security model.
- It never claims **novelty of mechanism**. The honest positioning — productization and security
  model — is expanded in [`FAQ.md`](FAQ.md) and `docs/PRIOR_ART.md`. If a judge asks on the
  Zoom call, the answer is already written.
- It never claims **traction, users, integrations, revenue, an audit, or a mainnet deployment.**
- It does not read a base58 program ID aloud. The ID, the deploy slot and the deploy signature
  are in the submission form and in [`PROJECT_DESCRIPTION.md`](PROJECT_DESCRIPTION.md) where
  they can be checked, not listened to.
- It does not use the words "revolutionary", "game-changing", "seamless", or "the future of".

## If you are running long

The hard ceiling is 3:00 and the target is 2:00–2:59. If a read-through lands over 2:55, cut in
this order, and re-time after each cut:

1. §5 — drop the final sentence ("It is infrastructure: one prepended instruction, no changes to
   your program, Apache-2.0, no RPC dependency"). **−16 words, −6s.**
2. §4 — drop "Two of them are the whole story." and start directly at "Without the guard…".
   **−7 words, −3s.**
3. §2 — drop "Solana's production-readiness guide names this and tells developers to preserve
   application-level idempotency before sending." **−16 words, −6s.** (Do this last: it is the
   strongest external corroboration in the script.)

Do **not** cut §1, the guarantee sentence in §3, the A/B result in §4, or §6. Those four are the
submission.

## Upload and access

- Upload to a platform whose terms the content complies with (Rules §12(b)(viii)). Loom is what
  Colosseum itself recommends.
- Set the video to **public or unlisted-with-link**, and check it in a private browser window
  while signed out. The workshop guide lists *"forgetting to grant judges access to … pitch
  videos"* as a common, fatal mistake.
- Put the URL in the submission form. Do not paste a placeholder URL anywhere.
