# CommitOnce — video shot list

Practical capture plan for both required videos. Two deliverables:

| # | Video | Length | Purpose | Script |
| --- | --- | --- | --- | --- |
| 1 | **Presentation (pitch)** | 2:00–2:59, target ~2:42 | team, problem, product, market, plan | [`PITCH_SCRIPT.md`](PITCH_SCRIPT.md) |
| 2 | **Product demo** | ≤3:00, target ~2:52 | how the product works, live on devnet | [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) |

The Colosseum FAQ and both workshop posts agree the pitch video is *"the most important element
of the submission"* and *"usually the first item judges review"*. Record the pitch first, while
you are fresh, and give the demo the second slot.

---

## 0. Pre-load before either take

Nothing here is optional. Every item on this list has cost someone a retake.

### Environment

- [ ] Terminal at **16–18pt**, dark theme, no transparency, 1920×1080 capture.
- [ ] Desktop notifications **off** (Windows: Focus assist → Alarms only). Slack, mail, Discord,
      and the DSH/agent window closed or muted — a popup in the middle of a take is a retake.
- [ ] Browser: exactly three tabs pre-opened, in order — guard program on explorer, demo counter
      program on explorer, a blank tab for pasting transaction links.
- [ ] Shell history cleared of anything containing a keypair path or token; `clear` before the take.
- [ ] `.env` **not** open on screen. The keypair file **never** on screen.
- [ ] Screen recorder: Loom (Colosseum's own recommendation) or equivalent, mic checked with a
      10-second test recording, and the recording confirmed to capture **terminal text legibly**
      at the chosen font size. Watch the test back before the real take.

### Product state

- [ ] `bash verify.sh` completes and prints PASS. If it does not, fix that before recording.
- [ ] `solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet` shows
      `Last Deployed In Slot: 501995361`; the demo counter shows `501814798`.
- [ ] Throwaway devnet payer keypair funded with at least **0.1 SOL** (`export PAYER_KEYPAIR=…`).
      The runner funds two fresh authorities with 0.05 SOL each.
- [ ] `node apps/demo/commitonce-demo.ts --help` runs.
- [ ] One full rehearsal of the A/B, so the RPC connection is warm and the numbers are known.
      It must end with `CommitOnce demo: both scenarios behaved exactly as claimed.`, with the
      counter reaching **2** without the guard and **1** with the guard. Its execution against
      devnet is not recorded in [`EVIDENCE.md`](../EVIDENCE.md), so this rehearsal is the gate —
      see [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) §1 Gate 1, including the fallback if it cannot be made
      reliable in time.
- [ ] No cleanup needed between takes: each run generates fresh authorities, so counters always
      start at zero. Change `--key` only if you want a different idempotency key on screen.

### Assets

- [ ] Logo or graphic exported for the submission form. Do **not** use Colosseum's marks or
      logos (Rules §17), and do not imply a partnership with any project named in
      [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md).
- [ ] At most **three** slides for the pitch, and only where the screen genuinely helps:
      (1) the one-transaction diagram, (2) "message hash vs intent", (3) the A/B result.
      The workshop guide lists *"overly flashy visuals with little substance"* as a mistake.
- [ ] No customer logos, no investor logos, no partner logos. There are none, and inventing a
      logo wall is fabrication.

---

## 1. Presentation video — shot list

Target **2:42** (see [`PITCH_SCRIPT.md`](PITCH_SCRIPT.md) for the timing map and word counts).

| # | Time | Shot | On screen | Spoken (section) | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:23 | Talking head, medium, no slide | You, plain background | §1 the USDC withdrawal story | This is the hook. Do not open with a logo or a title card. Look at the lens. |
| 2 | 0:23–0:49 | Screen + diagram | The one-transaction diagram, or a two-column "runtime dedup: message hash" / "your retry: new bytes" | §2 the problem | Keep the diagram on screen the whole 26s; do not cut away. |
| 3 | 0:49–1:26 | Screen + diagram | `claim` first, business instructions after, "receipt present → ERROR → reverts" | §3 what it is, and the guarantee | Pause one beat after "retention window". That sentence is the credibility line. |
| 4 | 1:26–2:04 | Terminal capture | The A/B run, or the 40-test summary line | §4 what is built and verified | The only shot where the product is visibly working. Let the screen carry it; keep narration slow. |
| 5 | 2:04–2:23 | Slide | Five archetypes as plain text: payments processor, trading bot, game backend, relayer, agent framework | §5 who it is for | Text only. No logos. |
| 6 | 2:23–2:43 | Talking head | You | §6 honest status and next three steps | Say the absences calmly. Do not apologise, and do not add a closing slogan. |

**Total: 6 shots, ~2:42.** One continuous take is fine and preferred; there is no need to edit.

**Do not** put the program ID on screen as a spoken item. If you want it visible, show it as a
lower-third or a slide footnote, spelled correctly:
`CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB`. Check it character by character against
[`EVIDENCE.md`](../EVIDENCE.md) §3 — a mistyped address in a video cannot be corrected after
upload.

---

## 2. Product demo video — shot list

Target **2:55** (see [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md) for the full beat script).

| # | Time | Shot | On screen | Spoken | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:15 | Terminal, idle prompt | Clean terminal | Framing: "watch the counter" | State the A/B up front so the viewer knows what to look for. |
| 2 | 0:15–0:45 | Terminal | The run starts: banner (problem, fix, guarantee), then the preflight line showing the demo counter's discriminators recomputed from sha256 | Setup: two programs on devnet, business program knows nothing about the guard | One command runs both scenarios. Do not read the base58 addresses aloud. |
| 3 | 0:45–1:00 | Terminal | Two fresh authority addresses, then the funding transaction and its explorer link | Fresh authorities, funded from the payer; counters start at zero | Keep this short — it is plumbing, not the product. |
| 4 | 1:00–1:45 | Terminal, then explorer | Scenario A: two different blockhashes, priority fees 1,000 → 50,000, two signatures, then `counter = 2` | Scenario A: both rebuilt transactions land | Hold on the `2` for two seconds. Then show both confirmed transactions on explorer. |
| 5 | 1:45–2:30 | Terminal | Scenario B: attempt 1 commits and creates the receipt; attempt 2 fails `AlreadyCommitted` (6000); then `counter = 1` | Scenario B: the guard blocks the duplicate | Hold on the `1`. Say explicitly that the second transaction was real and failed on chain. |
| 6 | 2:30–2:45 | Terminal summary, then explorer | The summary table, then "without the guard the counter reached 2; with the guard it reached 1", then the 202-byte receipt account | Side-by-side result, then why it works | Optional: hover the account data length so 202 is visible. |
| 7 | 2:45–2:55 | Terminal or title card | "202 bytes · 1,676,400 lamports · refundable" | Cost, refundable rent, why cleanup is not shown live | Say the one-hour minimum retention is deliberate, not an omission. |

**The single most important frame** is the two "after" numbers seen close together: **2** then
**1**. If a viewer remembers one thing, that is it.

**If you record a picture-in-picture**, keep it small and in a corner, and keep your hands off the
keyboard while the counter prints.

---

## 3. Saying it right — the phrases that must be exact

| Say this | Never say this |
| --- | --- |
| "at-most-once successful execution of a guarded logical intent, within the configured retention window" | "exactly once" (as a universal claim) |
| "it stops a second execution; it does not make the first one happen" | "guarantees your transaction lands" |
| "the receipt-PDA mechanism is prior art; what is new here is the security model and the productization" | "we invented this", "nobody has built this" |
| "live on devnet" | "live on mainnet", "in production" |
| "unaudited — an audit is the next step before anything holds value" | "battle-tested", "production-ready" |
| "no users yet; here is the concrete plan" | "we have early users", "growing fast" |
| "it does not protect an unguarded code path" | "it makes your app idempotent" |

Two more rules from the workshop guide: avoid buzzwords, and do not let the video run long.
*"Exceeding the 3 minute time limit"* is the first item on Colosseum's own list of mistakes.

---

## 4. Timing discipline

- Time every rehearsal with a visible clock. Stopwatch on a second device, not on the screen
  being recorded.
- The hard ceiling is **3:00** for both videos. If a read-through of the pitch lands at 2:55 or
  later, apply the cuts in [`PITCH_SCRIPT.md`](PITCH_SCRIPT.md) §"If you are running long" and
  re-time. Do not speed up your delivery to fit.
- Record the demo **after** the pitch. The pitch is the higher-weighted artifact and benefits
  from a fresh voice.
- Keep the raw takes. If a judge asks for a longer walkthrough in the 15-minute Zoom interview,
  the footage is useful.

---

## 5. Post-upload checks

- [ ] Both videos are **public or unlisted-with-link**, and both open in a private browser window
      while signed out. Colosseum's workshop guide lists *"forgetting to grant judges access to
      … pitch videos"* as a common mistake.
- [ ] Playback shows the terminal legibly at the smallest size a judge might view it (test on a
      phone).
- [ ] Length verified in the player, not from the file name: pitch 2:00–2:59, demo ≤3:00.
- [ ] The videos contain no third-party music or footage you do not have rights to
      (Rules §12(b)(i)–(ii)).
- [ ] No Colosseum trademarks or logos appear (Rules §17).
- [ ] Narration is entirely in English (Rules §12(a)(i)).
- [ ] URLs pasted into the submission form — never a placeholder, and never a link that requires
      a login you have not granted.
