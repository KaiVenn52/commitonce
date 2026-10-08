# CommitOnce — submission videos, 2026-10-08

Presentation: **2:44**. Product demo: **2:32.8**. Both are 1920×1080 English videos with
synthetic narration, captions, and explicit devnet-only / unaudited disclosure.

The demo is an edited replay of actual terminal output captured from a successful Solana
devnet run on 2026-10-08, not an unedited screen recording. Waiting time is removed. No
transaction, account state, founder face, customer, revenue or deployment is invented.
The local payer-file path is the only redaction in the public capture copies.

- [Presentation player](https://kaivenn52.github.io/commitonce/apps/web/videos.html#presentation)
- [Product demo player](https://kaivenn52.github.io/commitonce/apps/web/videos.html#demo)
- [Product website](https://kaivenn52.github.io/commitonce/)
- [Source and setup](https://github.com/KaiVenn52/commitonce)
- [Production source](video/README.md)

Release assets include both MP4s, SRT captions, timestamped capture JSON, complete captured
terminal output, four devnet transaction links, video scene data, preview frames and SHA-256
manifest. Caption phrase timing is proportionally estimated from each spoken section.

Without the guard, two genuinely rebuilt transactions succeed and the counter reaches **2**.
With the guard, attempt one succeeds, attempt two fails onchain with **AlreadyCommitted**,
and the counter remains **1**. Requests were paced to avoid public-RPC rate limiting; the
transaction contents and result assertions were not changed.

The guarantee is at-most-once successful execution of a guarded logical intent within the
configured retention window. The project has no mainnet deployment, external audit,
published npm package, external users or revenue. Public CI run 37793107667 passed for the
engineering corrections at `199aaf6`; that is distinct from this video production.

These assets are submission materials. Publishing them is **not** evidence that Colosseum
has received a final project submission.
