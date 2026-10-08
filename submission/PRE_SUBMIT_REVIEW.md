# CommitOnce — pre-submit review, 2026-10-08

The program remains an onchain idempotency guard. Its guarantee is **at-most-once
successful execution of a guarded logical intent within the configured retention window**.
This review started from public `main` at `eb7c2d8`. The reviewed corrections were committed
and pushed as `199aaf6`; [CI run 37793107667](https://github.com/KaiVenn52/commitonce/actions/runs/37793107667)
passed both program and SDK jobs. A result validates that SHA, not subsequent edits.

## What was corrected

- **SDK error handling:** Kit's RPC status payload uses bigint custom codes. The SDK used to
  miss `{ InstructionError: [0n, { Custom: 6000n }] }` without logs, and to incorrectly classify
  `{ slot: 6000 }` as `AlreadyCommitted`. Two existing error-classification tests were expanded
  with all 12 documented codes in number, bigint and decimal-string form, plus unrelated
  numeric fields and an unknown custom code. Both failed before the fix; all four tests in
  that group pass after it. Test coverage grew without changing the suite's test-case count.
- **Deployment verification:** the verifier used to label any trailing bytes as zero padding
  without checking them. A synthetic dump with a matching prefix and a non-zero suffix
  reproduced the false PASS. It is now rejected. The offline regression script accepts real
  artifact bytes with zero padding and rejects changed, truncated and non-zero-tailed dumps.
  It runs in local verification and in the CI program job.
- **Submission clarity:** the brief description now leads with payments and the guarded
  retry result. The distribution plan distinguishes source installation from planned npm
  publication and names the Kit peer dependency. Removed claims of zero supply-chain cost,
  guaranteed bugs in other teams' code and exemption from integration review.
- **Pitch focus:** the first market is payments teams whose retry paths lack idempotency.
  Ten design-partner conversations are a plan, not completed validation. The founder's
  student status, AI assistance, lack of funding and lack of a full-time commitment remain
  accurately disclosed.
- **Reviewer notes:** updated the dated live-demo gate, removed stale CI comments, and made
  clear that both video URLs remain placeholders until the owner records and uploads them.
- **Source attribution and competitor evidence:** the live Solana guide now describes safe
  rebroadcast but lacks the rebuilt-retry quotation previously attributed to it. Current
  submission materials now rely on the runtime mechanism and direct A/B for the rebuild
  case. Removed claims that registry search proves an empty market or that package downloads
  prove negligible protocol adoption. The raw September research is retained with an
  editorial note; it is not current usage evidence.

## Fresh live evidence

Both devnet programs were readable and executable on 2026-10-08. The verifier checked their
deployment slots, upgrade authority, artifact prefixes and zero-only trailing loader capacity.
The [captured deployment output](evidence/devnet-deployment-2026-10-08.log) ends with
`DEPLOYMENT MATCHES THE REPOSITORY`:

| Program | Deployment slot | Artifact bytes | Verified zero padding |
| --- | --- | --- | --- |
| `commit_once` | 503174994 | 148,640 | 15,072 |
| `demo_counter` | 503175063 | 158,432 | 10,808 |

The live A/B then passed. Within each scenario the two attempts share one semantic intent,
but the retry changes its blockhash, priority fee and signature. Scenario A ends at 2;
scenario B ends at 1, with the retry rejected onchain as `AlreadyCommitted` (6000).
The [captured terminal excerpt](evidence/devnet-demo-2026-10-08.log) preserves the signatures
and final summary. This is a counter demonstration, not a claim of external adoption or a
mainnet payment integration.

| Attempt | Result | Transaction |
| --- | --- | --- |
| A1 | Success; counter 1 | [Devnet transaction](https://explorer.solana.com/tx/4qmgrW61LT6MCuwn1TP4GKxRFuDGxEe44SBG2TBcUT1FV1oXU5rJeSY4Fnp2A6dEwJaeaeFwuRJVojvDRsGfAeU9?cluster=devnet) |
| A2 | Success; counter 2 | [Devnet transaction](https://explorer.solana.com/tx/mPRqpgoHD33ijNpQNCTc17GTqW4PamUx1wg7okj2ad9MfdxgviiBQKtp9ZTum3RZsjYRcjddRJ5xyzKnpTwNqU5?cluster=devnet) |
| B1 | Success; counter 1 | [Devnet transaction](https://explorer.solana.com/tx/2yeC8G6k8dMY5LPLyiBNzNcQc5xZQyfYCqKT3mGSQsS7jWifkeJUcVgXFkTpYotRkAo2NsJmpt6HfDFWi59MDif9?cluster=devnet) |
| B2 | AlreadyCommitted; counter stays 1 | [Devnet transaction](https://explorer.solana.com/tx/3aVfhi7nJxU6zVRem8j9jG3fhjAkk3aL7PsRrtkPcbU22aWg7j3JghMXbccoeDbZrke2Ewnrh34CWo2fBJHWnAxz?cluster=devnet) |

The 2026-09-27 RPC failure remains a historical inconclusive check, superseded by this
successful recheck. Rehearse again before recording; deployment evidence is a dated result.

## Remaining submission priorities

The [current Colosseum FAQ](https://colosseum.com/hackathon) requires a 2–3 minute presentation,
a product-demo video of at most 3 minutes, the repository, founder information and a
go-to-market plan. It evaluates business viability and demand as well as implementation.
The [official rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf)
set the deadline at 2026-10-12 11:59pm PT: **2026-10-13 14:59 in Malaysia**.

The next priority is recording those two videos and completing the
[submission form](SUBMISSION_FORM.md). Name, location and both video URLs still require owner
input. No mainnet deployment is stated as an entry requirement in these sources. Mainnet,
an external audit and npm publication are separate release work, not reasons to miss submission.
The npm registry lookup for `@commitonce/solana` returned E404 on 2026-10-08.

Demand remains unvalidated. If the owner can arrange one developer conversation before the
deadline, document the actual retry path, existing protection and integration objections;
otherwise submit the current zero-traction statement honestly. No outreach was sent in this review.

## Final validation

`bash verify.sh` passed all 17 steps with exit code 0 on the final code state: 60 Rust tests,
79 SDK tests, builds, typechecks, ESM/CJS loading, program-ID checks and repository consistency.
The [captured verification summary](evidence/local-verification-2026-10-08.log) records the
result. The new untracked files were additionally decoded as strict UTF-8 without a BOM;
the tracked-file encoding check cannot cover them until they are added to Git.

The pitch still contains 414 spoken words (about 2:46 at 150 words/minute); actual delivery
must be timed when recording. Documentation checks are rerun after adding this final record.
The new CI step also passed publicly in run 37793107667 for `199aaf6`. Video production and
hosting are subsequent submission work, tracked separately from the engineering verification.
