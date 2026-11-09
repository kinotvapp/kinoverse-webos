// Whether the phone still answers (owner, 2026-11-07): the proxy now keeps running with Kino closed and comes back by itself, but a
// phone switched off, out of the network or with the proxy turned off leaves the page asking a dead address. The page asks every
// HEALTH_EVERY_MS; a refused code is lost at once (the proxy came back with another one), silence only after HEALTH_MISSES in a row.
// Plain ES2018 (Chromium 79), no DOM: node tests import this file.

export const HEALTH_EVERY_MS = 20000;
export const HEALTH_TIMEOUT_MS = 8000;
export const HEALTH_MISSES = 3;

/**
 * The next health from [prev] (`{misses, lost}`) and a probe's [outcome] ('ok' | 'unauthorized' | 'down'): `lost` is null while the
 * phone is there, 'unauthorized' when it refused the code, 'down' after HEALTH_MISSES silences in a row.
 */
export function nextHealth(prev, outcome) {
  const misses = prev && typeof prev.misses === 'number' ? prev.misses : 0;
  if (outcome === 'ok') return { misses: 0, lost: null };
  if (outcome === 'unauthorized') return { misses: misses + 1, lost: 'unauthorized' };
  const n = misses + 1;
  return { misses: n, lost: n >= HEALTH_MISSES ? 'down' : null };
}

/**
 * One question to the phone at [base] (the page's own origin when ''): its session, with the pairing [token] in the header, never in
 * the URL. Resolves 'ok', 'unauthorized' (401) or 'down' (any other answer, no answer, or none within [timeoutMs]).
 */
export function probe(fetchFn, base, token, timeoutMs, setTimeoutFn) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeoutFn(() => finish('down'), timeoutMs);
    let p;
    try {
      p = fetchFn(String(base || '') + '/__kino/api/v1/session', { method: 'GET', cache: 'no-store', credentials: 'omit', headers: { 'x-kino-token': token } });
    } catch (e) { finish('down'); return; }
    Promise.resolve(p).then(
      (res) => finish(res && res.ok ? 'ok' : res && res.status === 401 ? 'unauthorized' : 'down'),
      () => finish('down'),
    );
  });
}
