/*
 * POST /api/tts  { text, lang?: 'zh'|'en'|'auto' }
 *   -> audio/mpeg bytes
 *
 * English goes to Deepgram Aura 2 in the speaker the caller picked (`voice`),
 * Aura 1 if Aura 2 is having a bad day. Chinese
 * goes to MeloTTS, the one Workers AI voice that speaks it. MeloTTS answers
 * either raw MP3 or `{audio: <base64>}` depending on the day, so both shapes
 * are turned into bytes here. The page falls back to the browser's own
 * speechSynthesis when this endpoint fails, so a bad day for a model never
 * silences the call.
 */
import { bad, json, looksChinese, pickLang, preflight, readJson, requireAI } from './_common.js';

const EN_MODEL = '@cf/deepgram/aura-2-en';
const EN_FALLBACK = '@cf/deepgram/aura-1';
const ZH_MODEL = '@cf/myshell-ai/melotts';
const MAX_CHARS = 1200;
export const DEFAULT_VOICE = 'luna';

/* Every speaker Aura 2 knows; the page offers a curated dozen of these. */
const AURA2 = new Set(['amalthea','andromeda','apollo','arcas','aries','asteria','athena','atlas','aurora','callista','cora','cordelia','delia','draco','electra','harmonia','helena','hera','hermes','hyperion','iris','janus','juno','jupiter','luna','mars','minerva','neptune','odysseus','ophelia','orion','orpheus','pandora','phoebe','pluto','saturn','thalia','theia','vesta','zeus']);
const AURA1 = new Set(['angus','asteria','arcas','orion','orpheus','athena','luna','zeus','perseus','helios','hera','stella']);

/* The caller's voice if Aura 2 has it, else the default. Chinese ignores it:
 * MeloTTS has one voice. */
export function pickVoice(raw) {
    const v = String(raw || '').toLowerCase().trim();
    return AURA2.has(v) ? v : DEFAULT_VOICE;
}

export async function onRequestOptions() {
    return preflight();
}

function b64ToBytes(b64) {
    const bin = atob(b64.replace(/^data:[^,]*,/, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function toBytes(out) {
    if (out instanceof ArrayBuffer) return new Uint8Array(out);
    if (out instanceof Uint8Array) return out;
    if (out && typeof out.getReader === 'function') return new Uint8Array(await new Response(out).arrayBuffer());
    if (out && typeof out.arrayBuffer === 'function') return new Uint8Array(await out.arrayBuffer());
    if (out && typeof out.audio === 'string') return b64ToBytes(out.audio);
    if (typeof out === 'string') return b64ToBytes(out);
    throw new Error('unrecognised audio result');
}

export async function onRequestPost({ request, env }) {
    const body = await readJson(request);
    if (!body) return bad('Send a JSON object.');
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return bad('"text" must be a non-empty string.');
    if (text.length > MAX_CHARS) return bad('Text too long for one utterance.', 413);

    const { ai, error } = requireAI(env);
    if (error) return error;

    let lang = pickLang(body.lang);
    if (lang === 'auto') lang = looksChinese(text) ? 'zh' : 'en';
    const voice = pickVoice(body.voice);

    let bytes;
    try {
        if (lang === 'zh') {
            bytes = await toBytes(await ai.run(ZH_MODEL, { prompt: text, lang: 'zh' }));
        } else {
            try {
                bytes = await toBytes(await ai.run(EN_MODEL, { text, speaker: voice }));
            } catch (e) {
                // Aura 2 down: Aura 1 with the same name when it has it, else its own luna.
                bytes = await toBytes(await ai.run(EN_FALLBACK, { text, speaker: AURA1.has(voice) ? voice : 'luna' }));
            }
        }
    } catch (e) {
        return json({ error: 'Speech failed: ' + (e && e.message ? e.message : String(e)), lang }, 502);
    }
    if (!bytes || bytes.length < 64) return json({ error: 'Speech came back empty.', lang }, 502);

    // MeloTTS hands back WAV some days and MP3 others; label what actually arrived.
    const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
    const ogg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
    const type = riff ? 'audio/wav' : ogg ? 'audio/ogg' : 'audio/mpeg';

    return new Response(bytes, {
        status: 200,
        headers: {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'X-Voice-Lang': lang,
            'X-Voice': lang === 'zh' ? 'melotts' : voice,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'X-Voice-Lang, X-Voice',
        },
    });
}
