# Crypto World's Fair 2026 — Operative Requirements Extraction

Retrieval date: September 2026. All fetches via `pwsh` + `Invoke-WebRequest` (web_search not used; it was reported broken).
Raw evidence files saved in `C:\Users\Dell2u\Downloads\`.

## Retrieval log

| # | URL | Result |
|---|-----|--------|
| 1 | https://blog.colosseum.com/how-to-win-a-colosseum-hackathon/ | **HTTP 200**, 45,493 bytes. Title line: `How to Win a Colosseum Hackathon`. Byline `mattytay`, `20 Feb 2024` |
| 2 | https://blog.colosseum.com/perfecting-your-hackathon-submission/ | **HTTP 200**, 37,894 bytes. Title: `Perfecting Your Hackathon Submission: Key Insights from the Colosseum Workshop`. Byline `Mike Hale`, `08 May 2025` |
| 3 | https://colosseum.com/worldsfair/resources | **HTTP 200**, 405,781 bytes. Title: `Developer Resources \| Solana Crypto World's Fair Hackathon` |
| 4a | https://raw.githubusercontent.com/ColosseumOrg/colosseum-resources/main/README.md | **HTTP 200**, 556 bytes. First line: `# Colosseum Resources Skill` |
| 4b | https://api.github.com/repos/ColosseumOrg/colosseum-resources/contents/ | **HTTP 403 (Forbidden)** — blocked/unauthenticated |
| 4c | https://api.github.com/repos/ColosseumOrg/colosseum-resources | **HTTP 403** |
| 4d | https://api.github.com/repos/ColosseumOrg/colosseum-resources/git/trees/main?recursive=1 | **HTTP 403** |
| 4e | `git clone --depth 1 https://github.com/ColosseumOrg/colosseum-resources.git` | **SUCCESS** — full tree obtained. HEAD `27d5cb876cc44ba0b7a9656ebd3956953f784f2b`, `Mon Sep 14 09:10:09 2026 -0600`, `feat: support multi-ecosystem resource tracks (#1)` |
| 5 | https://colosseum.com/hackathon | **HTTP 200**, 147,204 bytes. Title: `Hackathon - Colosseum`; hero `Crypto World's Fair — Live Now`, `Sep 14 — Oct 12` |
| 6 | https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf | **HTTP 200**, 219,506 bytes, magic bytes `25 50 44 46 2D 31 2E 34` (`%PDF-1.4`), **10 pages, 33,763 chars extracted** via pypdf |
| + | https://colosseum.com/worldsfair | **HTTP 200**, 118,888 bytes. Title: `Crypto World's Fair Hackathon - Colosseum` |
| + | https://ColosseumOrg.github.io/hackathon-resources/current.json | **HTTP 200**, 349,392 bytes — the live corpus the skill fetches |

**COULD NOT RETRIEVE (explicit):**
- GitHub REST API (`api.github.com`) — 403 on all three endpoints. Worked around successfully by `git clone`; the repo contents *were* fully retrieved.
- `https://colosseum.com/worldsfair/faqs` — **HTTP 404**. The real FAQ anchor is `/hackathon#faqs` (confirmed from `href="/hackathon#faqs"` in the worldsfair HTML).
- `https://colosseum.com/worldsfair/rules` — **HTTP 404**. The real rules link is `/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf` (confirmed from `href`).

---

## SOURCE 1 — https://blog.colosseum.com/how-to-win-a-colosseum-hackathon/ (HTTP 200)

Dated **20 Feb 2024**. This is a general guidance essay, NOT the 2026 rulebook. It contains no legally binding deadlines.

**Operative content:**

- **Format:** "Colosseum hackathons will always be online, rather than IRL."
- **Length (2024-era, stale):** "Colosseum hackathons are 5 weeks long to give teams enough time to complete a full engineering sprint in order to reach Solana devnet. Also, while projects are judged just on the work completed during the hackathon, participants can start building 2 months prior to the start date."
- **Judging basis / pre-existing code:** "projects are judged just on the work completed during the hackathon" and "participants can start building 2 months prior to the start date."
- **Bounties:** "we removed specific bounties and tech requirements (other than integrating with Solana in some capacity)."
- **Who wins:** "prizes will be awarded to teams who intend to build full-time and develop products with potentially viable business models (although, there will always be an award for the best public good)."
- **Team size:** "our hackathons are competitive, with the average winning team size now above 3." Also: "If you're a solo dev or founder, we highly encourage joining forces with at least 1 other cofounder." And: "non-technical entrepreneurs should team up with a technical lead to compete in our hackathons."
- **Sprint allocation:** "we recommend spending at least 4 of the weeks on the engineering sprint... The final week should be spent on testing the demo to ensure functionality and creating the submission presentation pitch."
- **Video length (HARD, quoted):** "Judges have to review hundreds of project submissions, so **presentations are required to be under 3 minutes.**"
- **Presentation required contents (6 items):** Team background; Product description; Why you started building the product; The potential market opportunity unlocked by your product; How you will get initial product usage (or if applicable, the traction and user feedback already received); How the product works (your demo).
- **Tooling recommendation:** "we recommend using Loom over a slide deck."
- **Scale:** "There are usually 40 individual prizes per hackathon and every submission in the top 100 is typically exceptional in their own way."
- **Open source / grants:** "There are also grants available to bolster open-source projects, even if the creators have no intention to commit to a startup full-time."
- **Build in public:** "we strongly recommend that hackathon participants build in the open from the start. After registering for the hackathon, create a project Twitter X account and begin sharing your product vision."
- **Deliverable location:** "Builders can find all the information required during the product submission process within the FAQs."

**Not stated:** no IP/licensing clause, no eligibility rules, no repo requirements, no weights.

---

## SOURCE 2 — https://blog.colosseum.com/perfecting-your-hackathon-submission/ (HTTP 200)

Dated **08 May 2025**. Written for the *Solana Breakout Hackathon*, not Crypto World's Fair 2026. Quotes are workshop guidance.

**Pitch video (HARD):**
- "The pitch video is the most important element of the submission. It is usually the first item judges review and can determine whether a project is shortlisted for deeper evaluation."
- "**The video should be no more than three minutes long** and should include a concise explanation of the team's background, the problem they are solving, and who the product is for."
- "Teams should also mention any feedback or validation they have received from users, even if informal, and outline the broader vision for the project."
- "A clear and well-structured narrative is more valuable than professional video editing, such as a voiceover accompanying a slide deck. Teams are encouraged to treat their pitch like a brief startup pitch, not a product demo."

**Mistakes to avoid (quoted list):** "Exceeding the 3 minute time limit"; "Using overly flashy visuals with little substance."; "Over-relying on buzzwords."; "Vague or overly technical descriptions"; "Omitting team background information"; "Failing to clearly explain the core idea and its impact."

**Technical demo video (HARD — second required video):**
- "The technical demo video is a new addition to this year's hackathon."
- "This **2-3 minute video** allows teams to explain the design and implementation choices behind their product, particularly how it leverages Solana."
- "teams should walk through the core features they built, explain their tech stack, and outline the decisions made in prioritizing specific components. Judges are particularly interested in the reasoning behind these decisions, especially with regard to Solana integration, on-chain logic, and overall architecture."

**Validation / traction:**
- "judges look for evidence that a team is solving a real problem for real users. Projects that stand out typically demonstrate early traction, conversations with potential users, via feedback on platforms like Twitter or Telegram."
- "Even projects building in public goods categories should show evidence of product-market fit through usage, community involvement, or open-source adoption."

**Team size:** "Solo founders are allowed. However, many of the top-performing teams are two or three people, which is more typical for startups. Solo founders should explain their relevant experience and why they're uniquely suited to build the product."

**Accelerator (not a submission requirement):** "The Colosseum Accelerator accepts 10 to 15 teams from the hackathon winner pool. Each selected team receives a $250,000 investment."

**Post-submission:**
- "Teams are encouraged to continue building after the submission deadline."
- "While weekly update videos are not required, they can strengthen a submission by demonstrating momentum and iteration."
- "Teams should remain responsive and proactive in the weeks following the submission, particularly if shortlisted for further evaluation or investment."

**Common mistakes (quoted list):** "Submitting incomplete or unpolished pitch videos"; "Failing to explain Solana integration clearly"; "Ignoring optional fields that could provide important context"; "Relying on buzzwords instead of articulating a clear product hypothesis"; "Treating the hackathon as a finished endpoint rather than a starting point"; "**Forgetting to grant judges access to google docs, pitch videos, github repos, etc.**"

---

## SOURCE 3 — https://colosseum.com/worldsfair/resources (HTTP 200)

**This is NOT a rules page.** It is the Developer Resources index (a directory of tools/SDKs/docs), scoped to the hackathon. It contains **no eligibility, deadline, judging, or deliverable requirements.**

**Operative content it does contain:**
- Ecosystem tabs (8): `Solana, Ethereum, Hyperliquid, Base, Tempo, Arbitrum, Zcash, Robinhood Chain`.
- The install command, verbatim and repeated twice on the page:
  ```
  npx skills add ColosseumOrg/colosseum-resources
  ```
  under the heading "Building with a coding agent? Install Colosseum's resources skill for docs and tool recommendations."
- A **"Register"** CTA and a **"FAQs"** link that both resolve to `/hackathon#faqs`, and an **"Official rules"** link resolving to `/legal/Crypto World's Fair Hackathon Rules.pdf`.
- 23 topic sections: Start building; Sponsored tools and offers; RPC providers; JavaScript and TypeScript clients; Development setup; Wallets and onboarding; Learn Solana; Examples + Reference; Build programs and typed clients; Test at the right layer; Ship the application; Tokens and permissions; Payments and commerce; DeFi and stablecoins; Blinks and Actions; Mobile; Games; Agents and tokenization; Privacy and confidential compute; Governance and DAOs; Treasury and security; Integrations; Company formation and banking.
- Sponsored offers: Phantom Connect, Altitude (Squads), Reflect, Meteora DBC; Raydium = "Coming soon".
- RPC providers: Helius, RPC Fast, FluxRPC, Triton One, Quicknode.
- Company formation perk: Stablecorp — "Colosseum builder perks: 30% off incorporation, priority EIN processing, priority banking KYB, and a free 30-minute entity setup call."

---

## SOURCE 4 — ColosseumOrg/colosseum-resources (repo retrieved by git clone)

**Complete file inventory (no manifest, no plugin/marketplace/index file exists):**
```
.gitignore
README.md
skills/colosseum-resources/SKILL.md
skills/colosseum-resources/agents/openai.yaml
tests/golden-prompts.md
```

**Exact skill count: ONE skill.** There is exactly one `SKILL.md` in the repo.

**Skill name:** `colosseum-resources` (from SKILL.md frontmatter `name:`)

**Frontmatter description (verbatim):**
> "Multi-ecosystem hackathon resource advisor for Colosseum builders. Use when a builder needs project-specific sponsor tools, SDKs, RPC providers, frameworks, wallets, infrastructure, or build paths from Colosseum's published resource index."

**What it does (from SKILL.md body):**
1. **Fetches the live corpus first** — `curl --fail --silent --show-error https://ColosseumOrg.github.io/hackathon-resources/current.json`. Payload keys: `tracks`, `resources`, `resourceGroups`, `sponsors`, `rpcProviders`.
2. **Selects the ecosystem before choosing tools** — matches the user's ecosystem against `tracks[].id`/`tracks[].name`; if none named, lists available track names and asks. "Do not recommend tools yet."
3. **Isolates tracks** — "use only that track's `resources`, `resourceGroups`, `sponsors`, `rpcProviders`, and `comingSoon`. Do not merge in top-level arrays or another track's entries."
4. **Legacy fallback** — when `tracks` is absent/empty, the top-level bundle is a Solana-only fallback, usable only for Solana.
5. **Understands the project** — asks only about core mechanism, user surface, and constraints.
6. **Recommends up to four strong matches**, each with what it does, one concrete integration move, a live doc link, preserved caveats, and exact offers. Sponsor skills only via the exact `skillInstallCommand`.
7. **Fails honestly** — "If the fetch fails, say that the live resource index could not be reached. Do not make corpus-based recommendations or invent links, offers, sponsor relationships, or install commands."

**Install command (verbatim, identical in README.md, SKILL.md, and the live resources page):**
```bash
npx skills add ColosseumOrg/colosseum-resources
```

**`agents/openai.yaml` (verbatim):**
```yaml
interface:
  display_name: "Colosseum Resources"
  short_description: "Multi-ecosystem hackathon resource advisor"
  default_prompt: "Use $colosseum-resources to recommend current resources for my hackathon project and target ecosystem."
```

**`tests/golden-prompts.md`** — 6 pass criteria + 10 behavioral cases + 2 legacy-payload cases. Pass criteria include: "The agent fetches the current resource index before making corpus-based recommendations"; "It selects an ecosystem before recommending tools and uses only that track's entries"; "It does not imply cross-ecosystem compatibility that the selected track does not establish."

**The only OTHER installable skill command found anywhere in Colosseum's materials** — from the live corpus `current.json` (sponsor `Meteora`, `hasSkill: true`, present in both the top-level and `solana` track):
```bash
npx skills add MeteoraAg/meteora-invent
```

**Live corpus inventory (`current.json`, HTTP 200, 349,392 bytes)** — `hackathon: {name: "Crypto World's Fair", slug: "crypto-worlds-fair"}`; **8 tracks**: solana (18 resources, 7 groups, 4 sponsors, 5 RPC), ethereum (7/5/0/0), hyperliquid (6/5/0/0), base (7/5/0/0), tempo (5/5/0/0), arbitrum (7/5/0/0), zcash (6/4/0/0), robinhood (6/5/0/0). `comingSoon`: Raydium ("Developer resources coming soon."). Note the corpus is a **resource index**, not a rules source.

---

## SOURCE 5 — https://colosseum.com/hackathon (HTTP 200) — the operative FAQ

Hero: **"Crypto World's Fair — Live Now"**, **"Sep 14 — Oct 12"**, "Builders 4,585". Body: "Colosseum's hackathons are not traditional hackathons. They are global, online competitions where founders sprint over **4 weeks** to build impactful products."

**Dates / cadence:** "Colosseum runs two primary hackathons per year, from April to May and from September to October. Between these, builders can compete in our perpetual hackathon, Eternal, to be considered for venture funding."

**Registration (HARD):** "Yes. Sign up for a Colosseum account and join the currently running hackathon. **If you are part of a team, every team member must create an account, and the team leader must add them during the product-submission process.**" … "To be eligible for prizes and Accelerator consideration, team leaders must complete the submission before the deadline."

**One entry only (HARD):** "**Only one product submission is allowed per team—and therefore one per individual—during each hackathon.**" … "**No. Each builder can submit only one product and be part of only one team.**"

**Blockchain scope:** "No, Colosseum hackathons are open to builders across all blockchain ecosystems, and every submission is eligible for prizes regardless of the crypto infrastructure used. We also offer dedicated prize tracks for several of the leading ecosystems."

**Eligibility / who can win (verbatim):**
> "Colosseum hackathons are for new startups that haven't raised significant outside capital. They're not intended for established companies that have been building the same product for years and have already raised venture funding."
>
> "**Eligibility criteria:**
> - Teams may begin development before the hackathon, but **products are judged only on the work completed between the competition's start and end dates.**
> - If you're an entrepreneur or developer building a new product that hasn't raised significant funding, you may compete and be eligible to win.
> - **Builders may use pre-existing code, but teams must disclose all relevant past development work in the submission form.**
> - If a team misrepresents its product's development history or fails to disclose relevant information, Colosseum retains the sole right to: Disqualify the team from the competition; Ban individual builders from participating in future Colosseum hackathons; Revoke prizes if applicable"
>
> "'Pre-existing code' does not refer to open-source code developed by others. We encourage founders to compose with existing crypto protocols."

**Solo allowed:** "You may submit a product as a solo founder."

**Non-technical allowed:** "You don't need to be an engineer to participate."

**Submission portal required fields (verbatim list):**
> "The portal asks comprehensive questions and invites any other information needed to understand the product and business plan, including:
> - Product name and a brief description
> - Which blockchains and tools are being integrated
> - All teammates, with context on their backgrounds and previous experience
> - Where the team is located
> - A product logo or graphic
> - **A GitHub repository link. Open-source repositories are encouraged, but private repositories are allowed if access is granted to hackathon@colosseum.com for review.**
> - **A two-to-three-minute presentation video.** This is one of the first resources judges review, so it should be clear, concise, and high quality.
> - **A product-demo video of no more than three minutes** explaining how the product works
> - Go-to-market strategy, demand validation, and plans for developing distribution"

**Judging criteria (verbatim, 7 items):** Founder + Market Fit; Insight; Product + Execution; Potential Market Size; Founder Communication; Viability; Traction — full quotes in "WHAT JUDGES REWARD" below.

**Process:** "After submissions close, the Colosseum team conducts multiple rounds of evaluation and advances a shortlist of the highest-quality products to the judging panel. After individual judging, an even smaller group of teams is invited to a **15-minute Zoom interview**." … "winners are announced roughly one month after the submission deadline."

**GitHub repo expectations (verbatim):**
> "Mostly, we want to see that you and your team:
> - Did significant work during the hackathon
> - Were the ones to do this work, rather than a third party
> - Prioritized feature development strategically
>
> A few things that we are **not** looking for:
> - Using a particular language or framework
> - Specific design patterns, best practices, or code-quality checks"

**Weekly updates (verbatim):** "They aren't strictly required for every participant, but we strongly recommend them for anyone serious about competing. Each update should be a concise, **one-minute video** highlighting progress and notable challenges from the previous week."

**Accelerator optional:** "No. Hackathon winners are not required to join the Accelerator."

**Code of Conduct (mandatory):** "Hackathon administrators, judges, and participants must follow this Code of Conduct throughout the competition. Colosseum may disqualify any individual or team that violates it." — Be Respectful; Be Professional; Be Thoughtful; Be Open; Believe in Yourself.

**Feedback:** "the volume of hackathon submissions prevents us from providing direct feedback to every participant. We can guarantee that every product submission will be reviewed by the Colosseum team and/or the judging panel."

---

## SOURCE 6 — Crypto World's Fair Hackathon Rules PDF (HTTP 200, 10 pages) — LEGALLY BINDING

URL: `https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf`

**Timing (§5) — HARD:**
> "The Contest Period starts at **6:00am PT on September 14, 2026** and ends at **11:59pm PT on October 12, 2026**. The winners will be announced by **December 5, 2026**. Administrator's computer is the official time-keeping device for the Contest." … "Dates listed in the above chart may vary slightly. If any date is changed, Administrator will post the changes on the Contest site."

**Registration (§6) — HARD:**
> "(a) Individual Registration - In order to participate in the Contest, **each Member must visit and register on the colosseum.com platform before 11:59pm PT on October 12, 2026** and provide the requested information. **After 11:59pm PT on October 12, 2026, the individual registration form will be disabled and any Member who does not provide the requested information to Colosseum's reasonable satisfaction before then will be disqualified.**"
> "(b) Registration of a Team - **Each Team member must visit colosseum.com to register for the Contest and the team leader must upload the Project Submission before the end of the Entry Period.**"
> "(c) An Entrant's failure to provide Profile Information and provide express consent in accordance with this Section is grounds for disqualification."
> "(d) The Profile Information must conform to the guidelines and content restrictions set forth below in Section 12. Failure to conform constitutes grounds for disqualification."

**Limits (§7) — HARD:**
> "Entrant may only be a Member of one (1) Team. A Team may only submit one (1) Project Submission at a time."

**Eligibility (§3) — HARD:**
> "(a) Individuals who are the **age of majority in their country or residence or at least 18 years of age, whichever is older** as of the start of the Contest. If an Individual does not satisfy this age requirement but is still interested in participating, please reach out to **hello@colosseum.com** and the Administrator will make a determination on a case-by-case basis in its sole discretion."
>
> "(b) Exclusions: … the following are not eligible: (i) persons located or ordinarily resident in: **Afghanistan, Belarus, Cuba, Iran, North Korea, Russia, Somalia, Syria, the Crimea/Sevastopol, Donetsk, Luhansk, Zaporizhzhia and Kherson regions of Ukraine, Venezuela, and Yemen**, or temporary or permanent residents of any country in which the Contest participation is prohibited by law…; (ii) an Individual subject to U.S. or other applicable sanctions, including those imposed by the U.S. Office of Foreign Assets Control; (iii) an Individual employed by an entity which is subject to U.S. blocking sanctions, Entity List restrictions, or other applicable asset freeze or prohibited party sanctions; and (iii) employees, contractors, directors and officers of the Administrator, Contest Sponsors, or any of their subsidiaries, affiliates and agents, as well as the Immediate Family of each such employee."
>
> "(c) Employer/Entity Permission/Acknowledgement - Individuals hereby represent and warrant that their participation in the Contest will not violate any third-party rights or obligations, including without limitation policies or procedures of an employer or contractual obligations to or restrictions of an employer or other third party. (d) Void where prohibited."

**Acceptance of rules (§4a) — HARD:** "By clicking on the Official Rules checkbox at registration, Entrant signifies Entrant's acceptance of these Official Rules in their entirety. Receipt of any prize offered in this Contest is dependent upon Entrant's compliance in full with these Official Rules."

**Rules may change (§4g):** "Entrant agrees that Administrator may change or modify these Official Rules at any time in its sole discretion."

**Winner Determination (§8) — the 6 legal judging criteria:** (a) Functionality; (b) Potential Impact; (c) Novelty; (d) UX; (e) Open-source; (f) Business Plan. **No weights are stated anywhere in the PDF.**

**Intellectual Property (§9–10) — operative:**
> "Administrator does not claim ownership of any Project Submission. At all times during and after the Contest, Entrants retain any intellectual property rights they may have that are contained in and to their Project Submission. **The protection of such intellectual property is the sole responsibility of the Entrant.** Entrants should ensure that third parties do not have rights or claims on information or software programming language included in Entrant's Project Submission. **Entrants agree to inform Administrator of the status and ownership of any open-source or other third party code, intellectual property filings, or searches related to their Project Submission.**"
> "Administrator shall, at all times, retain all rights, title, and interest, in and to any Creative Materials."

**Content Guidelines (§12) — HARD:**
> "(a) Technical Guidelines and Restrictions: **(i) All Content must be in English**"
> "(b) Content Restrictions: (i) Entrant owns or otherwise has all rights in the Profile Information…; (ii) All Content must not contain material that violates or infringes another's rights, including without limitation, intellectual property rights infringement, privacy, or publicity; (iii) All Content must not disparage or adversely affect the name, brand image, reputation or goodwill of Administrator…; (iv) Entrant must have permission from all Individuals that appear in any Content (if any) to use their name and likeness…; (v) All Content submitted must not contain any viruses, worms, spyware, or other components…; (vi) All Content must not contain material that is inappropriate, indecent, obscene hateful, tortious, defamatory, slanderous or libelous; (vii) All Content must not contain material that promotes bigotry, racism, hatred or harm against any group or Individual or promotes discrimination based on race, gender, religion, nationality, disability, sexual orientation or age; and (viii) All Content must not contain material that is unlawful… or that violates the terms and conditions of any third-party video platform to which content has been uploaded."

**Winner Announcement & Requirements (§13) — HARD:**
> "The winners will be announced on or about December 5, 2026. **Winning is contingent upon the execution of Prize Acceptance Documents and/or any other documents that Administrator and/or the Contest Sponsors require and passing of the due diligence requirements of the Administrator and/or the Contest Sponsors.**"

**Prizes (§14) — verbatim, total $840,000:**
> "(a) Grand Champion: **$30,000 Phantom CASH stablecoin**; (b) Public Goods Award: **$5,000 CASH**; (c) University Award: **$5,000 CASH**; (d) An additional **$15,000 CASH** will be awarded to each of the next **20** standout teams beyond those mentioned above. (e) **Solana track: $100,000** will be awarded across **10** of the best products that integrate with the Solana blockchain (f) **Tempo track: $100,000** … across 10 … (g) **Hyperliquid track: $100,000** … across 10 of the best products that integrate with **Hypercore or HyperEVM**. (h) **Zcash track: $100,000** … across 10 of the best products that integrate with the Zcash blockchain or asset (i) **Ethereum L1 track: $25,000** … across 5 … (j) **Base track: $25,000** … across 5 … (k) **Arbitrum track: $25,000** … across 5 … (l) **Robinhood Chain track: $25,000** … across 5 …"

**Taxes / prize mechanics (§15):** "(b) **All prizes, including cash or cash equivalent, will be provided to the Team Leader.** Each winning team may be required to set up a wallet address, as directed by Administrator, in order to receive the cash component of the prize. (c) The prizes are non-transferable and no substitution is permitted… (d) winners are responsible for all tax reporting and payments…"

**Entrant Behavior (§17) — HARD:**
> "During the Contest, Entrants may be subject to **background checks** in Administrator's sole and absolute discretion. **If Entrants are sponsored by any third parties, including any brands, such sponsors must be approved in advance and in writing by Administrator. Entrant shall not use, or permit others (including their sponsors) to use Administrator's trademarks, logos or other intellectual property without the advance written consent of Administrator.**"

**Personal information (§11):** BY agreeing, entrants share info with judges and Contest Sponsors and opt in to Colosseum emails. Contact: `hackathon@colosseum.com`; rights requests to `hello@colosseum.com`.

**Disputes (§19):** ICC arbitration, one arbitrator, legal place **State of Florida, USA**, language English, governing law substantive laws of the United States / State of Florida. Class actions waived.

**Publication of winners (§21):** "For a list of winners, visit colosseum.com/worldsfair"

**NOT in the PDF:** no video length limit, no team-size limit, no repo requirement, no weekly-update requirement, no pre-existing-code clause, no traction requirement, no judging weights.

---

## SOURCE 7 (bonus) — https://colosseum.com/worldsfair (HTTP 200)

- Hero: "Compete for **$840,000** in prizes and **$2.5 million** in seed funding"
- "**Submissions due October 12, 2026**"
- Awards: "$30,000 Grand Prize"; "$300,000 Shared across the next 20 best projects / $15,000 per project"; "$5,000 Public Good Prize"; "$5,000 University Prize"
- Tracks: "Choose an ecosystem and compete for its dedicated prize pool. Track prizes are awarded in addition to the awards above." — Solana: "$100,000 Track prize pool, 10 projects receive $10,000 each"
- Accelerator: "All Hackathon winners will be interviewed and considered for Colosseum's accelerator program." — "$250,000 Pre-seed funding"; "**For 12 weeks**, collaborate directly with the Colosseum team at our office in SF."
- Judges: Colosseum team (Clay Robbins, Matty Taylor, Nate Levine, Max Monciardini, Michael Rinko) + 16 named track judges.
- Workshops: Kickoff Sep 15, 2026 10 AM Pacific; Tempo Workshop Sep 16; Ethereum Foundation Sep 22.
- Link: "Official rules" → the PDF above.

---

## COMPLIANCE CHECKLIST

### A. Eligibility & registration
- [ ] Every team member is at least the age of majority in their country of residence **or** 18, whichever is older (PDF §3(a)); minors must email hello@colosseum.com for a case-by-case ruling.
- [ ] No member is located/ordinarily resident in Afghanistan, Belarus, Cuba, Iran, North Korea, Russia, Somalia, Syria, Crimea/Sevastopol, Donetsk, Luhansk, Zaporizhzhia, Kherson, Venezuela, or Yemen (PDF §3(b)(i)).
- [ ] No member is subject to US/OFAC sanctions or employed by a sanctioned/Entity-List entity (PDF §3(b)(ii)-(iii)).
- [ ] No member is an employee/contractor/director/officer of Colosseum, a Contest Sponsor, or their affiliates, nor their Immediate Family (PDF §3(b)(iii)).
- [ ] Participation does not violate any member's employer policy or third-party contractual obligation (PDF §3(c)).
- [ ] **Every** member has created a Colosseum account on colosseum.com (PDF §6(a)-(b); FAQ).
- [ ] The **Team Leader** has added all members during the product-submission process (FAQ).
- [ ] The Official Rules checkbox was accepted at registration (PDF §4(a)).
- [ ] Each member is a member of **only one** team (PDF §7; FAQ).
- [ ] The project is a **new** startup that has **not raised significant outside capital**; not an established company that has built the same product for years with venture funding (FAQ).
- [ ] All registration completed **before 11:59pm PT on October 12, 2026** — after that the registration form is disabled and incomplete registrants are disqualified (PDF §6(a)).

### B. Deadline & submission mechanics
- [ ] Project Submission uploaded by the Team Leader **before the end of the Entry Period** (= Contest Period end, **11:59pm PT on October 12, 2026**) (PDF §6(b), §5).
- [ ] Only **one** Project Submission per team (PDF §7).
- [ ] Submission made through the platform dashboard product-submission portal after joining the competition (FAQ).
- [ ] Submission is in **English** (PDF §12(a)(i)).
- [ ] All Content is rights-clear, non-infringing, non-disparaging, virus-free, non-obscene, non-discriminatory, and lawful (PDF §12(b)(i)-(viii)).
- [ ] Permission obtained from every individual appearing in any Content (PDF §12(b)(iv)).

### C. Required submission fields (FAQ — all items)
- [ ] Product name and a brief description.
- [ ] Which blockchains and tools are being integrated.
- [ ] All teammates, with context on their backgrounds and previous experience.
- [ ] Where the team is located.
- [ ] A product logo or graphic.
- [ ] A **GitHub repository link** — public is encouraged; private is allowed **only if access is granted to hackathon@colosseum.com**.
- [ ] A **two-to-three-minute presentation video** (pitch).
- [ ] A **product-demo video of no more than three minutes** explaining how the product works.
- [ ] Go-to-market strategy, demand validation, and plans for developing distribution.
- [ ] Optional fields completed (FAQ + blog 2 flag "ignoring optional fields that could provide important context" as a common mistake).
- [ ] Disclosure of **all relevant past development work** (pre-existing code) in the submission form (FAQ).

### D. Video / presentation constraints
- [ ] Pitch presentation video ≤ 3 minutes (PDF has no limit; FAQ says "two-to-three-minute"; blog 1 says "required to be under 3 minutes"; blog 2 says "no more than three minutes"). **Target 2:00–2:59 to satisfy every source.**
- [ ] Product-demo video ≤ 3 minutes (FAQ).
- [ ] Technical demo video 2–3 minutes, covering design/implementation choices, tech stack, and prioritization reasoning (blog 2).
- [ ] Pitch video covers: team background, problem, target user, validation/feedback received, broader vision (blog 2); team background, product description, why you started building, market opportunity, initial usage/traction, working demo (blog 1).
- [ ] Videos grant the judges access — do not leave them behind a permission wall (blog 2: "Forgetting to grant judges access to google docs, pitch videos, github repos, etc.").
- [ ] Video hosted on a platform whose terms and conditions the content complies with (PDF §12(b)(viii)).
- [ ] Avoid: flashy visuals without substance, buzzwords, vague/overly technical descriptions, omitted team background, unclear core idea, incomplete/unpolished video (blog 2).

### E. Repository requirements
- [ ] Repo link provided in the submission.
- [ ] If private, access granted to **hackathon@colosseum.com** (FAQ).
- [ ] Repo shows **significant work done during the hackathon** (FAQ).
- [ ] Repo shows the work was done **by this team, not a third party** (FAQ).
- [ ] Commit history demonstrates **strategic feature prioritization** (FAQ).
- [ ] Judges can actually open the repo (blog 2).
- [ ] No specific language/framework/design pattern/code-quality bar is required (FAQ).
- [ ] Open source is **not** strictly required, but the legal criteria score Open-source (§8(e)), so public is materially better.

### F. Pre-existing code & "built during the hackathon"
- [ ] Product is judged **only** on work completed between September 14, 2026 and October 12, 2026 (FAQ).
- [ ] Pre-existing code is allowed (FAQ) and development may begin before the hackathon (FAQ), but must be disclosed.
- [ ] Open-source code by others is explicitly **not** "pre-existing code" — composing with existing crypto protocols is encouraged (FAQ).
- [ ] Third-party/open-source code status and ownership disclosed to Administrator (PDF §9).
- [ ] No misrepresentation of development history — penalty is disqualification, a **ban from future Colosseum hackathons**, and prize revocation (FAQ).

### G. IP / licensing
- [ ] Entrant retains IP in the Project Submission; Administrator claims none (PDF §9).
- [ ] Entrant accepts that protecting that IP is solely their own responsibility (PDF §9).
- [ ] Entrant is prepared to inform Administrator of open-source/third-party code, IP filings, and searches (PDF §9).
- [ ] Entrant accepts Administrator retains all rights to Creative Materials (name, image, likeness, Content) (PDF §2, §10).
- [ ] Any third-party sponsorship of the team is approved **in advance and in writing** by Colosseum (PDF §17).
- [ ] No use of Colosseum trademarks/logos without advance written consent (PDF §17).

### H. Traction / real users
- [ ] Evidence of solving a real problem for real users (blog 2).
- [ ] Early traction and/or documented conversations with potential users (blog 2 — Twitter/Telegram feedback counts, "even if informal").
- [ ] Public-good projects must still show product-market fit via usage, community involvement, or open-source adoption (blog 2).
- [ ] Response to the Traction criterion: does the product already have demand or revenue, and how durable are they? (FAQ).
- [ ] Optional but recommended: build in public from day one via a project X/Twitter account to recruit beta testers (blog 1).

### I. Optional-but-recommended (explicitly encouraged)
- [ ] Weekly update videos — one minute each, progress + notable challenges. "not strictly required" / "not required" but strongly recommended (FAQ; blog 2).
- [ ] Continue building after the deadline and stay responsive; judges may ask about post-hackathon progress in the 15-minute Zoom interview (blog 2; FAQ).
- [ ] Team of 2–3 (blog 2: "many of the top-performing teams are two or three people"); solo is allowed but the solo founder must explain relevant experience (blog 2).
- [ ] A technical lead on the team if the founder is non-technical (blog 1).

### J. Post-submission / winner obligations
- [ ] Accept the 15-minute Zoom interview if shortlisted (FAQ).
- [ ] Execute Prize Acceptance Documents and pass due diligence (PDF §13).
- [ ] Accept background checks at Colosseum's discretion (PDF §17).
- [ ] Accept that prizes are paid to the **Team Leader**, who may need to set up a wallet address (PDF §15(b)).
- [ ] Accept responsibility for all tax reporting and payment (PDF §15(a),(d)).
- [ ] Follow the Code of Conduct throughout (FAQ) — violation is grounds for disqualification.
- [ ] Accept ICC arbitration seated in Florida, English, no class actions (PDF §19).

---

## CONTRADICTIONS / AMBIGUITIES FLAGGED

1. **Hackathon length.** Blog 1 (Feb 2024): "Colosseum hackathons are **5 weeks** long". Current FAQ: "founders sprint over **4 weeks**". Current rules: Sep 14 → Oct 12, 2026 = **4 weeks**. → **Use 4 weeks.**
2. **Pre-build window.** Blog 1: "participants can start building **2 months prior** to the start date." Current FAQ: "Teams may begin development before the hackathon" — **no window stated**. → The 2-month figure is stale; any pre-existing work is allowed but must be disclosed.
3. **Presentation video length.** Blog 1: "**required to be under 3 minutes**" (i.e. <3:00). FAQ: "**two-to-three-minute** presentation video". Blog 2: "**no more than three minutes**". → Slight tension: "two-to-three-minute" could be read as requiring ≥2:00. **Safest: 2:00–2:59.**
4. **Two different judging-criteria sets.** PDF §8 (legally binding): Functionality, Potential Impact, Novelty, UX, Open-source, Business Plan. FAQ: Founder + Market Fit, Insight, Product + Execution, Potential Market Size, Founder Communication, Viability, Traction. **Neither states any weights.** A submission must satisfy the union.
5. **Blockchain scope.** Blog 1: "we removed specific bounties and tech requirements (**other than integrating with Solana in some capacity**)". Current FAQ: "open to builders across **all** blockchain ecosystems, and every submission is eligible for prizes regardless of the crypto infrastructure used." Current rules: 8 separate tracks. → The Solana-only framing is stale; the 2026 event is multi-ecosystem.
6. **Average winning team size.** Blog 1: "the average winning team size now **above 3**". Blog 2: "many of the top-performing teams are **two or three** people". No hard limit either way.
7. **Technical demo video's provenance.** Blog 2 calls it "a new addition to this year's hackathon" (2025 Breakout), yet the 2026 FAQ independently requires a "product-demo video of no more than three minutes" — treat both as required in 2026.
8. **Weekly updates.** Blog 2: "not required". FAQ: "aren't strictly required… but we strongly recommend them." Not mentioned in the PDF at all.
9. **"Entry Period" is undefined.** PDF §6(b) refers to "the end of the Entry Period", but §2 Definitions defines only "Contest" and §5 defines "Contest Period". → Treat Entry Period = Contest Period = 11:59pm PT October 12, 2026.
10. **Prize total cross-check.** PDF §14 sums to exactly $840,000 ($30k + $5k + $5k + $300k + $100k×4 + $25k×4), matching the worldsfair page's "$840,000 in prizes". No contradiction.
11. **PDF silent on several FAQ/blog requirements.** Video length limits, the demo video, the repo access requirement, the pre-existing-code disclosure clause, and the weekly updates appear only in the FAQ/blogs — not in the binding rules. They remain operative platform requirements regardless.

---

## WHAT JUDGES REWARD (priority order)

No source states numeric weights. Priority below is inferred **only** from explicit "most important"/"first" language, then from ordering in the binding rules.

### Tier 1 — The pitch video (explicitly first and decisive)
> "**The pitch video is the most important element of the submission. It is usually the first item judges review and can determine whether a project is shortlisted for deeper evaluation.**" — blog 2
> "**A two-to-three-minute presentation video. This is one of the first resources judges review**, so it should be clear, concise, and high quality." — FAQ
> "Judges have to review hundreds of project submissions, so presentations are required to be under 3 minutes." — blog 1

### Tier 2 — Functionality / Product + Execution
> "(a) **Functionality**: How well does this Project Submission work? What is the quality of the code?" — rules §8
> "**Product + Execution**: How well does the product work? How does it stack up against the competition? How quickly is the team shipping product updates and addressing user feedback?" — FAQ
> "Did significant work during the hackathon / Were the ones to do this work, rather than a third party / Prioritized feature development strategically" — FAQ (repo)

### Tier 3 — Potential Impact / Market Size
> "(b) **Potential Impact**: How big is the total addressable market for this Project Submission? What will be the impact of this Project Submission on the broader crypto ecosystem?" — rules §8
> "**Potential Market Size**: How big is the total addressable market for this project? Is it already large, or small but growing rapidly? What will be the impact of this project on the growth rate of their market?" — FAQ

### Tier 4 — Founder + Market Fit / Insight (the "venture-fund" lens)
> "**Founder + Market Fit**: Does the team have the right skills and experience to succeed in this market, and why is it motivated to solve this problem?" — FAQ
> "**Insight**: Does the founding team have some unique insight based on their deep understanding of the problem space? Is there a new technology, or a new trend that creates an opportunity for their startup to succeed?" — FAQ
> "We evaluate more than the product itself. We want to understand founder-market fit, how the opportunity was uncovered, how the team prioritizes, and whether the founders are committed to building a venture-scale business." — FAQ

### Tier 5 — Traction & Viability
> "**Traction**: Does the product already have demand or revenue? If so, how durable are its revenue and user base?" — FAQ
> "**Viability**: Can this project become a scalable, sustainable business? Colosseum hackathons and Eternal are startup competitions, so presentations should provide a holistic view of the company." — FAQ
> "judges look for evidence that a team is solving a real problem for real users. Projects that stand out typically demonstrate early traction, conversations with potential users…" — blog 2

### Tier 6 — Novelty, UX, Open-source, Business Plan (rules §8 remainder)
> "(c) **Novelty**: How unique is this Project Submission's concept?" — rules §8
> "(d) **UX**: How well does this Project Submission utilize blockchain to create great UX for downstream users?" — rules §8
> "(e) **Open-source**: Is this Project Submission open-source? How well does the Project Submission compose with other primitives in the crypto ecosystem?" — rules §8
> "(f) **Business Plan**: Is there a viable business that can be built in the future around this Submission? How adept is the team building the product to execute on the vision?" — rules §8

### Tier 7 — Founder Communication
> "**Founder Communication**: Are the founders communicating the product vision clearly and capable of growing the product's user base?" — FAQ

### Overarching intent (why the criteria skew this way)
> "prizes will be awarded to teams who intend to build full-time and develop products with potentially viable business models (although, there will always be an award for the best public good)." — blog 1
> "First and foremost, Colosseum hackathons are startup competitions. Although the hackathon is a speed run through technical development, participants should also refine their go-to-market strategy and presentation." — FAQ
> "Hackathon builders should view their product submission as a pitch to Colosseum's venture fund, other investors, and an application to our Accelerator." — FAQ
