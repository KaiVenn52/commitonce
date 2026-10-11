# Submission status — 2026-10-08

> **FINAL UPDATE — 2026-10-11: SUBMITTED.** CommitOnce project **16838** was
> entered for judging at **03:49 AM PDT / 18:49 Malaysia**. The official receipt
> was re-opened and still displayed `Submitted` and `Your project is entered for judging.`
> [Official receipt](https://colosseum.com/arena/projects/16838/submission) ·
> [Final portal record](PORTAL_CHECK_2026-10-11.md) ·
> [Pitch](https://youtu.be/F4FF48-f_RM) · [Demo](https://youtu.be/m-rIjDHJmC0).
> Earlier incomplete/draft states below are historical, not the current status.

> Superseded operational status, 2026-10-11: supported browser connection was
> repaired through the official plugin installation. Authenticated CommitOnce
> draft **16838** now exists; project details, logo, code links and confirmed
> founder background were saved. Final submission has **not** occurred.
> [Current portal check](PORTAL_CHECK_2026-10-11.md) records the remaining fields
> and the actual video limits. The browser-blocker narrative below is historical.

## Completed

- Engineering fixes published at `199aaf6`; CI run 37793107667 passed.
- Video-production sources and reviewer website published at `138b6d9`; CI run 37797304119
  passed. Pages deployment run 37797303752 passed.
- [Website](https://kaivenn52.github.io/commitonce/) and
  [video players](https://kaivenn52.github.io/commitonce/apps/web/videos.html) return HTTP 200
  without authenticated browser state.
- [Public release](https://github.com/KaiVenn52/commitonce/releases/tag/submission-2026-10-08)
  contains both MP4s, captions, capture and scene data, checksum manifest, six preview frames,
  four transaction links and `commitonce-submission.zip`.
- Video validator passes, including negative controls for failed execution, wrong unguarded
  count and an unrelated rejection. Both complete MP4s decode successfully locally. Anonymous
  remote media probing confirms 164.0 seconds and 152.8 seconds, with H.264/AAC video/audio.
- The public capture redacts the local payer-file path; no private key was captured or uploaded.
- Anonymous retrieval of both published MP4s and the public capture JSON/log matched the
  local manifest byte lengths and SHA-256 exactly (`video/verify-public.mjs`).
- The form has prepared product, team, country, repository, video, website and GTM answers.
  Public founder name is Kai Venn, country Malaysia. No city or legal name is invented.

## Not completed: final authenticated Colosseum submission

The supported browser connection was attempted again after the assets were published. It failed
before browser discovery because the installed runtime references a missing `browser-service.mjs`
component (expected version directory `26.930.31730`; installed browser directories are older).
The previous Windows control attempt separately stopped when it could not reliably determine
the browser URL for its safety checks. No raw browser protocol, authentication-store extraction
or security-check bypass was used as an alternative.

Therefore the Colosseum form/profile has not been inspected in this production pass, no final
submit click occurred, and no submission receipt or entry ID exists in this record. Authenticated
profile values and any portal-specific video URL validation still need to be checked through a
working supported connection. Repository publication and a release are not final submission.

To resume, restore the supported browser connection and continue from the existing prepared
form and release. Do not rebuild the project, re-record the videos or invent a submission ID.
The owner has already delegated the submission work; another broad authorization is unnecessary.
