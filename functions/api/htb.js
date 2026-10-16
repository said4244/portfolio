// Cloudflare Pages Function: GET /api/htb
//
// Fetches the owner's Hack The Box stats server-side using an App Token stored
// as a Cloudflare secret (HTB_TOKEN). The token never reaches the browser.
// The App Token identifies the account, so we resolve the numeric user id via
// /user/info and then read the public profile. Response is cached ~30 min.
//
// Add ?debug=1 to see the raw upstream payloads (your own data) so the exact
// field names can be mapped.

const API = 'https://labs.hackthebox.com/api/v4';

async function htbGet(path, token) {
  const res = await fetch(API + path, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      'User-Agent': 'offsecsaid-portfolio/1.0',
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* non-JSON (e.g. HTML error) */ }
  return { ok: res.ok, status: res.status, json, text };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';
  const token = env.HTB_TOKEN;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=1800, s-maxage=1800',
    'Access-Control-Allow-Origin': 'same-origin',
  };

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'HTB_TOKEN not configured' }), {
      status: 503, headers,
    });
  }

  // Serve from the edge cache when possible.
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/htb' + (debug ? '?debug=1' : ''), url.origin), request);
  if (!debug) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    // 1) Resolve the account (numeric id + whatever the account endpoint exposes).
    const info = await htbGet('/user/info', token);
    const id = info.json && (info.json.info?.id ?? info.json.id);

    // 2) Classic profile stats (owns, rank, ranking).
    let basic = null;
    if (id) basic = await htbGet('/user/profile/basic/' + id, token);

    const p = basic && basic.json ? (basic.json.profile || basic.json) : {};
    const normalized = {
      ok: true,
      name: p.name ?? info.json?.info?.name ?? null,
      rank: p.rank ?? null,
      ranking: p.ranking ?? null,
      points: p.points ?? null,
      userOwns: p.user_owns ?? null,
      systemOwns: p.system_owns ?? null,
      respects: p.respects ?? null,
      rankProgress: p.current_rank_progress ?? null,
      updatedAt: new Date().toISOString(),
    };

    const body = debug
      ? { ...normalized, _raw: { info: info.json ?? info.text, basic: basic?.json ?? basic?.text } }
      : normalized;

    const response = new Response(JSON.stringify(body), { status: 200, headers });
    if (!debug) await cache.put(cacheKey, response.clone());
    return response;
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 502, headers });
  }
}
