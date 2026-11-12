# Muse Voice · 語音通話

A voice call with an assistant, in the browser: you talk, it listens, thinks,
and talks back, then listens again until you hang up. Built after Meta's
Muse "Introducing Voice" demo.

- `site/index.html` — the call screen. Captures the mic, detects when you stop
  talking, sends the turn, plays the answer, loops. Tap the orb to interrupt;
  keyboard button to type instead; language switch (auto / 中文 / English).
- `functions/api/stt.js` — Whisper large-v3-turbo on Workers AI (16 kHz WAV in, text out).
- `functions/api/chat.js` — Llama 3.3 70B, prompted to answer for the ear.
- `functions/api/tts.js` — Deepgram Aura for English, MeloTTS for Chinese; the
  page falls back to the browser's own voice if the endpoint fails.

Everything runs on the `AI` binding in `wrangler.toml`; no model keys.
`.github/workflows/deploy.yml` publishes to Cloudflare Pages on every push to
`main` and smoke-tests the live endpoints, including one real model turn.

Local: `npx wrangler pages dev site --port 8793` (uses your wrangler login for
the AI binding), then open http://localhost:8793/.
