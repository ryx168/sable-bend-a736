/*
 * POST /api/stt  { audio: <base64 WAV>, lang?: 'zh'|'en'|'auto' }
 *   -> { text, language }
 *
 * The page records a turn, resamples it to 16 kHz mono PCM, and sends the WAV
 * as base64. Whisper large-v3-turbo transcribes it; `language` is only pinned
 * when the caller chose one, otherwise Whisper detects it and the page follows
 * that detection for the reply voice.
 */
import { bad, json, pickLang, preflight, readJson, requireAI } from './_common.js';

const MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_B64 = 4 * 1024 * 1024; // ~3 MB of audio: a 90-second turn at 16 kHz

export async function onRequestOptions() {
    return preflight();
}

export async function onRequestPost({ request, env }) {
    const body = await readJson(request);
    if (!body) return bad('Send a JSON object.');
    const audio = typeof body.audio === 'string' ? body.audio.replace(/^data:[^,]*,/, '') : '';
    if (!audio) return bad('"audio" must be a base64 string.');
    if (audio.length > MAX_B64) return bad('Audio too long; keep a turn under 90 seconds.', 413);

    const { ai, error } = requireAI(env);
    if (error) return error;

    const lang = pickLang(body.lang);
    const input = { audio, task: 'transcribe', vad_filter: true };
    if (lang !== 'auto') input.language = lang;

    let out;
    try {
        out = await ai.run(MODEL, input);
    } catch (e) {
        return json({ error: 'Transcription failed: ' + (e && e.message ? e.message : String(e)) }, 502);
    }
    const text = String((out && out.text) || '').trim();
    const info = (out && out.transcription_info) || {};
    return json({ text, language: info.language || (lang === 'auto' ? '' : lang) });
}
