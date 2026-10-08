# Submission video production

Two English, screen-based videos using the existing pitch and a real devnet terminal session.
The narrator is synthetic, not the founder's recorded voice. No generated face, invented
customer, mainnet claim or fabricated transaction is used. Demo output is an **edited terminal
replay**, not an unedited desktop screen recording; pauses are removed and excerpts are shown.
The complete timestamped capture and four transaction links are published with the videos.

From this directory: `npm install`, then `npm run capture` with an existing funded **devnet**
payer supplied as `PAYER_KEYPAIR`. Never put a key or its contents in this folder.
`npm run prepare-media` uses the installed `edge-tts` and `ffprobe`; `npm run render` creates
both MP4s, preview PNGs and SRT captions in ignored `out/`. For efficient editorial rendering,
`node render-efficient.mjs` captures Remotion frames at caption boundaries and uses FFmpeg
for the holds and audio; it preserves the same narration, evidence and duration.
Rendering needs Chromium downloaded
by Remotion. English speech is sent to Microsoft's Edge speech service for synthesis; no key
or personal file is sent. There is no paid service or mainnet transaction.

Run `node test.mjs` before publishing, then `node publish-assets.mjs` to produce a checksum
manifest and public capture copies with the local payer path redacted. `pace.mjs` spaces
capture requests by 700ms to avoid shared-RPC bursts; it changes no transaction contents.
Inspect the preview frames and listen to the actual MP4s. Captions follow the written
narration with proportionally estimated phrase timing, not a separate speech transcription.
Do not label a rendering success as final Colosseum submission.
