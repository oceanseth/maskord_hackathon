# maskord_hackathon

Maskord's Burning Token 2026 fork, branched from `oceanseth/maskord` so sponsor
integrations can be built — and abandoned — without touching the product repo.

Maskord is a replacement for Discord with true end-to-end encryption and
anonymity. Even in voice channels with many users the audio cannot be read by
anyone in the middle; it is only sent between people on the call. On top of
that, Maskord lets you speak or be seen as an avatar from masky.ai, so you can
wear whatever mask you like when interacting with others.

- **Live:** https://hackathon.maskord.com
- **Convex origin:** https://impressive-skunk-614.convex.site
- **Sponsor plan:** the site root — what each sponsor does inside Maskord, the
  official entry requirement it satisfies, and how a judge verifies it.
- **The app:** `/server` — the Maskord web client, with Convex-backed file
  sharing added.
- **Public demo channel:** `/channel` — no login, drag and drop a file.

## Layout

| Path | What it is |
|------|-----------|
| `www/` | Marketing site, the sponsor plan page, and the Convex backend. |
| `www/convex/` | Convex schema and functions — see its README for deploy steps. |
| `app/desktop` | The Maskord client. `build:web` produces the browser build. |
| `app/shared` | Firebase hooks and types shared by the clients. |
| `firebase/` | Firestore/RTDB rules and Cloud Functions. Note that the authoritative rules live in the `masky_auth` repo. |
| `terraform/` | Upstream maskord.com infrastructure. Do not apply from this repo. |

## Voice transcript (speech-to-text)

Voice channels with AI assistance transcribe each speaker's microphone in
their own client with [AssemblyAI Universal-Streaming](https://www.assemblyai.com/docs/streaming),
and write finished utterances to the channel transcript in Firestore. The
browser never sees the account key: the `getSttToken` Cloud Function mints a
single-use temporary token per session.

Set the key once per Firebase project, then deploy that one function:

```bash
cd firebase
firebase functions:secrets:set ASSEMBLYAI_API_KEY
firebase deploy --only functions:getSttToken
```

Until the secret is set the clients fall back to the browser's Web Speech
API, which works in Chrome and Safari but not in the Electron build.
Streaming is billed per hour the socket is open, so the client only holds a
session while the user is connected, unmuted, and either the transcript or
avatar voice mode wants it.

## Deploying

Push to `main`. Anything touching `www/` publishes to the prod Convex
deployment, which is what hackathon.maskord.com serves — see
`.github/workflows/README.md`.

By hand, if needed:

```bash
cd www
npx convex deploy -y
npm run build
npx @convex-dev/static-hosting upload --prod -d ./dist
```
