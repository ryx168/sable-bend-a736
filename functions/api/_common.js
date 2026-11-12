/*
 * Shared plumbing for the three speech endpoints.
 *
 * Every endpoint answers JSON (or raw audio) with permissive CORS, refuses
 * anything but POST, and refuses a body that is not the shape it expects with
 * a 400 that says why. The 400s matter beyond politeness: the deploy's smoke
 * test posts `{}` to each endpoint and treats a 400 as proof that the function
 * is routed and its imports resolve. A 404 or 500 there means the deploy is
 * broken, not the caller.
 */

export const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(body, status = 200, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
    });
}

export function bad(message, status = 400) {
    return json({ error: message }, status);
}

export function preflight() {
    return new Response(null, { status: 204, headers: CORS });
}

/* The parsed JSON body, or null when it is absent or not an object. */
export async function readJson(request) {
    try {
        const body = await request.json();
        return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
    } catch {
        return null;
    }
}

/* 'zh' or 'en' from whatever the client sent; anything else becomes 'auto'. */
export function pickLang(raw) {
    const s = String(raw || '').toLowerCase();
    if (s.startsWith('zh')) return 'zh';
    if (s.startsWith('en')) return 'en';
    return 'auto';
}

/* Does the text read as Chinese? Enough CJK characters among the letters. */
export function looksChinese(text) {
    const s = String(text || '');
    const cjk = (s.match(/[㐀-鿿豈-﫿]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    return cjk > 0 && cjk >= latin / 4;
}

/* The AI binding, or a 500 explaining that the deploy forgot it. */
export function requireAI(env) {
    if (!env || !env.AI || typeof env.AI.run !== 'function') {
        return { error: json({ error: 'Workers AI binding "AI" is not attached to this deployment.' }, 500) };
    }
    return { ai: env.AI };
}

/* Workers AI text models answer in two shapes now: the older `{response}`
 * (which is pre-parsed into an object when the reply is bare JSON) and the
 * OpenAI-shaped `{choices:[{message:{content}}]}`. Accept both, and never
 * hand "[object Object]" to a voice. */
export function replyText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    const c = result.choices && result.choices[0] && result.choices[0].message;
    if (c && typeof c.content === 'string') return c.content;
    const r = result.response;
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object') return r.text || r.reply || r.content || JSON.stringify(r);
    if (typeof result.text === 'string') return result.text;
    return '';
}
