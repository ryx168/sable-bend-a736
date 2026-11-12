/*
 * POST /api/chat  { messages: [{role:'user'|'assistant', content}], lang?: 'zh'|'en'|'auto' }
 *   -> { reply, lang }
 *
 * One llama turn, written for the ear rather than the eye: short sentences,
 * no markdown, no lists, the language the caller is speaking. The page keeps
 * the history and sends the last dozen turns back each time.
 */
import { bad, json, looksChinese, pickLang, preflight, readJson, replyText, requireAI } from './_common.js';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TURNS = 12;
const MAX_CHARS = 2000;

const SYSTEM = `You are Muse, a warm, quick personal assistant on a voice call. Everything you say is spoken aloud by a text-to-speech voice, so:
- Answer in one to three short sentences. Never more than about 60 words unless the caller asks for detail.
- Plain spoken language only: no markdown, no bullet points, no numbered lists, no headings, no emoji, no URLs.
- Give the useful part first, then at most one follow-up question.
- Reply in the caller's language. If they speak Chinese, answer in Traditional Chinese (繁體中文); if English, answer in English. Never mix the two in one reply.
- You help with everyday things: what to cook and how, plans for the day, travel ideas, quick facts, drafting a message, working something out. Be concrete: name the dish, the step, the place.
- If you cannot do something (place an order, make a real call, see their screen), say so in one clause and offer the nearest thing you can do.`;

export async function onRequestOptions() {
    return preflight();
}

export async function onRequestPost({ request, env }) {
    const body = await readJson(request);
    if (!body) return bad('Send a JSON object.');
    const raw = Array.isArray(body.messages) ? body.messages : null;
    if (!raw || !raw.length) return bad('"messages" must be a non-empty array of {role, content}.');

    const messages = raw
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-MAX_TURNS)
        .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
        return bad('The last message must be from the user.');
    }

    const { ai, error } = requireAI(env);
    if (error) return error;

    let lang = pickLang(body.lang);
    const last = messages[messages.length - 1].content;
    if (lang === 'auto') lang = looksChinese(last) ? 'zh' : 'en';
    const nudge = lang === 'zh' ? '（請用繁體中文回答，口語、簡短。）' : '(Answer in English, spoken style, brief.)';

    let out;
    try {
        out = await ai.run(MODEL, {
            messages: [{ role: 'system', content: SYSTEM + '\n' + nudge }, ...messages],
            max_tokens: 220,
            temperature: 0.7,
        });
    } catch (e) {
        return json({ error: 'The model did not answer: ' + (e && e.message ? e.message : String(e)) }, 502);
    }

    let reply = replyText(out).trim();
    // Strip anything that would be read aloud as noise.
    reply = reply
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[*_#>`]+/g, '')
        .replace(/^\s*[-•]\s+/gm, '')
        .replace(/\s+\n/g, '\n')
        .trim();
    if (!reply) return json({ error: 'The model answered with nothing.' }, 502);
    return json({ reply, lang });
}
