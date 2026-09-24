# Colosseum Crypto World's Fair 2026 — compliance requirements

Actionable summary of the **operative** requirements for the CommitOnce submission.
Every fact was retrieved on **2026-09-19** from primary sources. The full extraction —
per-source quotes, raw HTTP evidence, all 11 flagged contradictions, and the exhaustive
checkbox list — is preserved at
[`submission/COLOSSEUM_GUIDES_BRIEF.md`](../submission/COLOSSEUM_GUIDES_BRIEF.md).

**Re-verified 2026-09-21** against the live pages, because Colosseum relaunched the site
between the two reads. The results are in §10; the operative requirements did not change, but
three things were added or moved.

The Official Rules PDF is the **binding** document. Where the hackathon FAQ and the two
Colosseum blog posts disagree with it, the disagreement is recorded rather than silently
resolved.

---

## 1. Hard dates

| Fact | Value | Source |
| --- | --- | --- |
| Contest Period start | **6:00am PT, 2026-09-14** | Rules §5 |
| **Contest Period end / submissions due** | **11:59pm PT, 2026-10-12** (= `2026-10-13T06:59:00Z`) | Rules §5, §6(b); hackathon page `countdownTarget` |
| Winners announced | by **2026-12-05** | Rules §5, §13 |
| Registration disabled after | 11:59pm PT, 2026-10-12 | Rules §6(a) |

The hackathon page independently renders the same instant as `2026-10-13T06:59:00.000Z`
labelled "Submissions due", which corroborates the PDF.

**Because the deadline is the binding constraint, `submission/WORK_LOG.md` records dated
evidence of work done inside the Contest Period.**

---

## 2. What is actually judged — the "built during the hackathon" rule

This is the single most easily-missed rule and it constrains what may be claimed.

> "Teams may begin development before the hackathon, but **products are judged only on the
> work completed between the competition's start and end dates**." — hackathon FAQ

> "Builders may use pre-existing code, but teams **must disclose all relevant past
> development work in the submission form**." — hackathon FAQ

> "'Pre-existing code' **does not refer to open-source code developed by others**. We
> encourage founders to compose with existing crypto protocols." — hackathon FAQ

> "Entrants agree to **inform Administrator of the status and ownership of any open-source
> or other third party code**, intellectual property filings, or searches related to their
> Project Submission." — Rules §9

> "If a team misrepresents its product's development history or fails to disclose relevant
> information, Colosseum retains the sole right to: Disqualify the team…; Ban individual
> builders from participating in future Colosseum hackathons; Revoke prizes." — hackathon FAQ

**Consequences for CommitOnce:**

- All CommitOnce source code was written inside the Contest Period. There is **no
  pre-existing CommitOnce code to disclose**, and the submission must say so plainly.
- Third-party open-source dependencies are *not* "pre-existing code", but their status and
  ownership still has to be disclosed (Rules §9). `docs/PRIOR_ART.md` and
  `submission/TECHNICAL_OVERVIEW.md` carry that inventory, and the license/provenance of
  every dependency is recorded.
- Prior art by others must be cited, not obscured. `docs/PRIOR_ART.md` documents that the
  receipt-PDA mechanism and the prepend-a-guard UX are **already deployed prior art**, and
  what is genuinely new. Claiming invention of either would be a misrepresentation.

---

## 3. Judging criteria — two official lists that differ

**No source publishes weights.** Satisfy the **union**.

**Official Rules §8** (binding): (a) Functionality — *"How well does this Project
Submission work? What is the quality of the code?"*; (b) Potential Impact — TAM and impact
on the broader crypto ecosystem; (c) Novelty; (d) UX; (e) Open-source — *"Is this Project
Submission open-source? How well does the Project Submission compose with other primitives
in the crypto ecosystem?"*; (f) Business Plan.

**Hackathon FAQ** (adds Traction): Founder + Market Fit; Insight; Product + Execution;
Potential Market Size; Founder Communication; Viability; **Traction** — *"Does the product
already have demand or revenue? If so, how durable are its revenue and user base?"*

**What is explicitly said to matter most:**

> "**The pitch video is the most important element of the submission.** It is usually the
> first item judges review and **can determine whether a project is shortlisted** for deeper
> evaluation." — Colosseum blog, *Perfecting Your Hackathon Submission*

> "A two-to-three-minute presentation video. **This is one of the first resources judges
> review**, so it should be clear, concise, and high quality." — hackathon FAQ

**Process:** multiple rounds of Colosseum evaluation → shortlist → judging panel → an even
smaller group invited to a **15-minute Zoom interview**. Winners ~1 month after the deadline.

---

## 4. Required submission content

From the hackathon FAQ, verbatim:

- Product name and a brief description
- Which blockchains and tools are being integrated
- All teammates, with context on their backgrounds and previous experience
- Where the team is located
- A product logo or graphic
- A GitHub repository link. *"Open-source repositories are encouraged, but private
  repositories are allowed if access is granted to hackathon@colosseum.com for review."*
- **A two-to-three-minute presentation video**
- **A product-demo video of no more than three minutes**
- Go-to-market strategy, demand validation, and plans for developing distribution

Plus, from Rules §12(a)(i): **"All Content must be in English."**

Plus, from the FAQ: optional fields should be completed — *"Ignoring optional fields that
could provide important context"* is listed as a common mistake.

**Video lengths.** Three sources give three phrasings: *"under 3 minutes"* (blog, 2024),
*"two-to-three-minute"* (FAQ), *"no more than three minutes"* (blog, 2025). **Target
2:00–2:59** to satisfy all three simultaneously.

**Pitch video must cover** (union of both blog posts and the FAQ): team background; the
problem; why the team started building it; who the product is for; the market opportunity;
how initial usage will be obtained, or the traction and user feedback already received
(*"even if informal"*); how the product works; and the broader vision.

**Technical demo video must cover**: design and implementation choices, the tech stack, and
the reasoning behind prioritisation decisions — *"Judges are particularly interested in the
reasoning behind these decisions, especially with regard to Solana integration, on-chain
logic, and overall architecture."*

---

## 5. Repository expectations

From the hackathon FAQ, "What do you look for in the submitted Github repo?" — judges want
to see that the team:

- *"Did significant work during the hackathon"*
- *"Were the ones to do this work, rather than a third party"*
- *"Prioritized feature development strategically"*

Explicitly **not** sought: *"Using a particular language or framework"*; *"Specific design
patterns, best practices, or code-quality checks"*.

**Implication:** the commit history and `submission/WORK_LOG.md` are themselves evidence.
Tooling quality is neither required nor penalised; the scored signal is substantial,
self-authored, strategically-prioritised work inside the Contest Period.

---

## 6. Eligibility and limits

- Age of majority in country of residence **or** 18, whichever is older (Rules §3(a)).
- Excluded jurisdictions: Afghanistan, Belarus, Cuba, Iran, North Korea, Russia, Somalia,
  Syria, Crimea/Sevastopol, Donetsk, Luhansk, Zaporizhzhia, Kherson, Venezuela, Yemen; plus
  sanctioned individuals and employees/contractors/immediate family of the Administrator or
  Contest Sponsors (Rules §3(b)).
- Participation must not violate employer policies or third-party obligations (Rules §3(c)).
- **Every** team member must register on colosseum.com before the deadline; the team leader
  adds them during submission (Rules §6, FAQ).
- **One product submission per team, and therefore one per individual** (Rules §7, FAQ).
- Must be a **new startup** that has not raised significant outside capital (FAQ).
- **Solo founders are allowed** — *"You may submit a product as a solo founder."* — but a
  solo founder *"should explain their relevant experience and why they're uniquely suited
  to build the product."*
- Track scope: Colosseum hackathons are *"open to builders across all blockchain
  ecosystems"*. CommitOnce is a Solana primitive and is submitted to the **Solana track**.

---

## 7. Prizes (Rules §14; totals exactly $840,000)

| Award | Amount | Notes |
| --- | --- | --- |
| Grand Champion | $30,000 | in Phantom CASH stablecoin |
| Public Goods Award | $5,000 | |
| **University Award** | **$5,000** | the founder is a university engineering student — directly eligible |
| Next 20 standout teams | $15,000 each | $300,000 total |
| **Solana track** | **$100,000 across 10 projects** | $10,000 each — CommitOnce's primary track |
| Other tracks | $25k–$100k each | Tempo, Hyperliquid, Zcash, Ethereum L1, Base, Arbitrum, Robinhood Chain |

Rules §15(b): all prizes are paid to the **Team Leader**. Rules §13: winning is contingent on
Prize Acceptance Documents and passing due diligence.

---

## 8. Compliance checklist

### Submission artifacts

- [ ] **Form answers, ready to paste** → [`submission/SUBMISSION_FORM.md`](../submission/SUBMISSION_FORM.md)
- [ ] Product name + brief description → `submission/PROJECT_DESCRIPTION.md`
- [ ] Blockchains and tools integrated → `submission/TECHNICAL_OVERVIEW.md`
- [ ] All teammates, backgrounds, location → `submission/FOUNDER_STORY.md`
- [ ] Product logo or graphic → [`assets/brand/`](../assets/brand/) (`commitonce-mark-1024.png`)
- [ ] GitHub repository link (public; if private, grant `hackathon@colosseum.com`) → <https://github.com/KaiVenn52/commitonce>
- [ ] **Presentation video, target 2:00–2:59** → `submission/PITCH_SCRIPT.md`
- [ ] **Product-demo video, ≤3:00** → `submission/DEMO_SCRIPT.md`
- [ ] Video shot list / capture instructions → `submission/VIDEO_SHOTLIST.md`
- [ ] Go-to-market, demand validation, distribution → `submission/GTM.md`
- [ ] Traction — real and evidenced only → `submission/TRACTION.md`, `EVIDENCE.md`
- [ ] Business plan / viability → `submission/GTM.md`
- [ ] Founder + market fit, insight, why-now → `submission/FOUNDER_STORY.md`
- [ ] Judge orientation → `submission/JUDGE_README.md`
- [ ] FAQ → `submission/FAQ.md`
- [ ] Dated work log for the Contest Period → `submission/WORK_LOG.md`
- [ ] **Disclosure of pre-existing work** (none, stated explicitly) and third-party code
      status → `submission/TECHNICAL_OVERVIEW.md`, `docs/PRIOR_ART.md`
- [ ] All Content in English

### Engineering evidence backing "Functionality" and "Open-source"

- [ ] Working onchain program with the at-most-once invariant proven by tests
- [ ] One-command reproducible verification (`verify.sh`)
- [ ] Apache-2.0 `LICENSE`
- [ ] Composable SDK usable without modifying the downstream program
- [ ] `EVIDENCE.md` with reproducible proof of every headline claim
- [ ] Honest security model including limitations (`docs/SECURITY_MODEL.md`)

---

## 9. Colosseum developer resources

The official resource index is installable as a coding-agent skill:

```bash
npx skills add ColosseumOrg/colosseum-resources
```

The `ColosseumOrg/colosseum-resources` repository contains **exactly one** skill
(`colosseum-resources`), a multi-ecosystem hackathon resource advisor that fetches the live
corpus from `https://ColosseumOrg.github.io/hackathon-resources/current.json`. The only
other skill install command referenced anywhere in Colosseum's materials is Meteora's
`npx skills add MeteoraAg/meteora-invent`.

Resources relevant to this project: the Solana track's "Build programs and typed clients",
"Test at the right layer", "Treasury + Security", and "Payments + Commerce" sections.

---

## 10. Re-verification, 2026-09-21 and 2026-09-22

Colosseum relaunched the site between the first read and these, so every operative page was
fetched again from primary sources. **Nothing binding changed.** Several things were added, one
URL was clarified, and the judging structure turned out to be more important than first
recorded — see "the judging panel" below.

**Deadline, re-confirmed 2026-09-22:** the live page still reads *"Submissions due October 12,
2026"*. The Contest Period runs **Sep 14 — Oct 12, 2026**, which is 28 days; at the time of this
check 8 had elapsed and **20 days 21 hours remained**.

### Confirmed unchanged

* Contest Period **Sep 14 — Oct 12**, "Submissions due October 12, 2026".
* Prizes: **$30,000** grand prize, **$300,000** across the next 20 ($15,000 each), **$5,000**
  Public Good, **$5,000** University, and the **Solana Ecosystem track at $100,000 — 10
  projects at $10,000 each**. The $840,000 total is unchanged.
* The full judging list, quoted verbatim on the live page: Founder + Market Fit; Insight;
  Product + Execution; Potential Market Size; Founder Communication; Viability; Traction.
* The GitHub-repo expectations, the "pre-existing code" disclosure rule, the required
  submission fields, and the video requirements — all word-for-word as recorded in §2 and §4.

### New: weekly updates

> "Weekly updates are an opportunity to share progress, stay locked in, and give us more context
> on your product's development. They aren't strictly required for every participant, but we
> **strongly recommend them for anyone serious about competing**. Each update should be a
> concise, one-minute video highlighting progress and notable challenges from the previous week."

Not required, and not scored as a listed criterion — but it is the only channel that puts work
in front of Colosseum *during* the Contest Period rather than at the end, and "serious about
competing" is the framing. **This is an owner action** (it needs a recorded video); it is listed
in [`NEEDS_OWNER_ACTION.md`](../NEEDS_OWNER_ACTION.md).

### New: the judging panel is public, and it is technical

**The most important structural fact on the page, and it is easy to miss:** there are *two*
panels, and they do different jobs.

> "The Colosseum team reviews **all** product submissions and **determines the overall
> hackathon winners**, in addition to selecting the winning founders admitted into the
> accelerator program."

> "The following builders, investors, and operators work with the Colosseum team by providing
> feedback and evaluating submissions in the dedicated hackathon tracks."

So the Colosseum team is the primary audience for the submission itself — Clay Robbins, Matty
Taylor, Nate Levine (cofounders), Max Monciardini (engineer) and Michael Rinko (associate).
The track judges decide the **track** prizes. A submission has to work for both: a generalist
who reads the description and watches the video, and a specialist who reads the code.

The full track panel, as named on the live page:

| Judge | Affiliation |
| --- | --- |
| Adam Gutierrez | Maximizing Developer Gains, Phantom |
| Arihant Bansal | Engineer |
| Binji | Founding Member, Ethlabs |
| Daniel Sapkota | Cofounder, Lightcone |
| David Tso | Ecosystem & Ventures, Base |
| Dean | Director, Realms |
| **Jed Halfon** | **Chief Strategy Officer, Anza** |
| Jill Gunter | Chief Strategy Officer, Espresso Systems |
| Julian Deschler | Cofounder, Arcium |
| Julian Ma | Cofounder, Ethlabs |
| LBO | Angel Investor |
| Milian | Marketing, Arcium |
| Mitchell | Head of Fundraising, MetaDAO |
| Ray Zhang | Software Engineer, Ellipsis Labs |
| Sitaram | Cofounder, Avici |
| w.sol | DevRel, Drift |

**Anza builds the Agave validator.** A judge from Anza knows the message-hash deduplication
behaviour first-hand, which cuts both ways: the insight will be understood immediately, and any
overstatement about it will be caught immediately. This is the strongest argument for the
project's existing posture — `docs/PRIOR_ART.md` §0 leads with the fact that the *mechanism* is
not novel, and the guarantee is stated as at-most-once within a retention window rather than
"exactly once". That posture is not humility; with this panel it is the only defensible one.

### Developer resources, and workshops

The live page's own navigation links **`https://colosseum.com/worldsfair/resources`**. An
earlier read recorded this as having moved to `/arena/resources`; both resolve, and the
canonical link from the hackathon page is the `/worldsfair/` one. Also linked: Colosseum
Copilot at `/copilot`, and the Code of Ethics at `/code-of-ethics`.

**Livestream workshops run on Discord**, with a calendar at `https://colosseum.com/events`.
The kickoff was Sep 15; an Ethereum workshop with Austin Griffith ran Sep 22. Attending these
is free and is another channel that puts a builder in front of the organisers during the
Contest Period rather than at the end.

### Scale, for context

The live page reports **5,069 builders** registered for this hackathon, and "80,000+ builders"
across all Colosseum hackathons. Prior campaigns: Frontier 2,858 projects, Cypherpunk 1,576,
Breakout 1,416, Radar 1,360, Renaissance 1,076.

The accelerator is **12 weeks in San Francisco**, with **$250,000 pre-seed** to accepted teams —
worth noting because "would this team be worth 12 weeks of Colosseum's time" is a different
question from "is this a good hackathon project", and the answer has to come through in the
founder story.

## 11. Re-verification, 2026-09-24

Fetched again from primary sources: `https://colosseum.com/worldsfair` and
`https://colosseum.com/hackathon`. **Nothing binding changed.** Every figure, date and name
below was read off the live pages rather than recalled.

**Confirmed unchanged, verbatim from the live pages:**

* `Submissions due October 12, 2026` — the hero states it directly, and the hackathon page
  renders the window as `Hackathon Sep 14 — Oct 12`.
* `Compete for $840,000 in prizes and $2.5 million in seed funding`.
* `$30,000` Grand Prize; `$300,000` shared across the next 20 best projects at `$15,000` each;
  `$5,000` Public Good Prize; `$5,000` University Prize.
* The Solana Ecosystem track at `$100,000`, `10 projects receive $10,000 each`.
* The accelerator: `$250,000` pre-seed, `12 weeks`, `in San Francisco`.
* The **Colosseum team** judges — Clay Robbins, Matty Taylor, Nate Levine, Max Monciardini,
  Michael Rinko — and the same **16 track judges**, including Jed Halfon, Chief Strategy Officer
  at Anza.
* `Workshops stream live on Discord`, calendar at `https://colosseum.com/events`.

**One URL note, re-confirmed — and corrected.** `/worldsfair/rules` returns **404**, and
`/worldsfair/faqs` does too. Neither is the rules location. The rulebook is a **PDF**:

```
https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf
HTTP 200, 219,506 bytes, magic bytes 25 50 44 46 2D 31 2E 34 (%PDF-1.4)
```

and the FAQ anchor is `/hackathon#faqs`.

**The first version of this paragraph said the rules were "served from the hackathon page and its
FAQ anchors, not from a dedicated rules path", which was wrong.** It was written from the 404
alone, without looking for the canonical link — and
[`COLOSSEUM_GUIDES_BRIEF.md`](../submission/COLOSSEUM_GUIDES_BRIEF.md) §"COULD NOT RETRIEVE"
already recorded the correct URL, the byte count and the magic bytes, having confirmed it from
the `href` in the page HTML. The PDF was re-fetched for this check and matches those figures
exactly. Reading one adjacent file would have prevented the error; the file existed and said so.

**What this check is worth.** It cost one fetch of each page and it is the only thing that keeps
§1–§7 from becoming a memory. The deadline in particular is the one fact in this repository whose
being wrong would be unrecoverable, and it is now confirmed three times: 2026-09-19, 2026-09-22
and 2026-09-24.

**Remaining owner actions are unchanged** and are listed in
[`../NEEDS_OWNER_ACTION.md`](../NEEDS_OWNER_ACTION.md): the Colosseum account and submission
form, the two videos, and the weekly one-minute updates.
