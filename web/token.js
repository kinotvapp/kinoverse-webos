// The pairing token. The phone's pairing address is `http://<phone>:<port>/?t=<token>`: the page reads `t` once, keeps it
// in sessionStorage (this tab only, gone when the tab closes) and takes it out of the address bar with
// history.replaceState, so it is not left in the address, the history entry or a bookmark; the page's
// `<meta name="referrer" content="no-referrer">` keeps it out of any Referer. After that it only travels in the
// `x-kino-token` header. Storage may be unavailable (private mode, a locked-down TV browser): every access is guarded,
// and the token then lives only as long as the page.
// Pure: the caller passes {location, history, storage}, so node tests use fakes.

const TOKEN_KEY = 'kino.token';
const PROFILE_KEY = 'kino.profile';
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,64}$/; // what the phone mints (the same rule as the webOS client's pairing)

function get(storage, key) {
  if (!storage) return null;
  try { return storage.getItem(key); } catch (e) { return null; }
}

function set(storage, key, value) {
  if (!storage) return;
  try { storage.setItem(key, value); } catch (e) { /* storage refused: the value lives only in this page */ }
}

function remove(storage, key) {
  if (!storage) return;
  try { storage.removeItem(key); } catch (e) { /* nothing to remove */ }
}

/**
 * The token for this page: the one in the address (then removed from it and stored), else the stored one, else null.
 * @param {{location: {href: string}, history: {state?: *, replaceState: function}, storage: ?Storage}} env
 */
export function takeToken(env) {
  let url = null;
  try { url = new URL(env.location.href); } catch (e) { url = null; }
  // The fragment (`#t=…`) is preferred: a browser never sends it to the server that hosts this page. The query (`?t=…`) still works when the
  // phone itself serves the page.
  const hash = url ? new URLSearchParams((url.hash || '').replace(/^#/, '')) : null;
  if (url && (hash.has('t') || url.searchParams.has('t'))) {
    const raw = ((hash.has('t') ? hash.get('t') : url.searchParams.get('t')) || '').trim();
    const hadHashToken = hash.has('t');
    hash.delete('t');
    url.searchParams.delete('t');
    const rest = hash.toString();
    // Only a fragment that carried the token is rewritten; any other fragment (an anchor like `#top`) is left exactly as it was.
    const keptHash = hadHashToken ? (rest ? '#' + rest : '') : url.hash;
    try {
      // A local file (the installed LG app) is named in full: its page sets a <base> on kinoverse.app, which a bare path would resolve against.
      const where = url.protocol === 'file:' ? 'file://' + url.host + url.pathname : url.pathname;
      env.history.replaceState(env.history.state === undefined ? null : env.history.state, '', where + url.search + keptHash);
    } catch (e) { /* a history that refuses: the page still works, the address keeps the token */ }
    if (TOKEN_SHAPE.test(raw)) {
      if (get(env.storage, TOKEN_KEY) !== raw) remove(env.storage, PROFILE_KEY); // another pairing: the old choice may not exist there
      set(env.storage, TOKEN_KEY, raw);
      return raw;
    }
  }
  const stored = get(env.storage, TOKEN_KEY);
  return stored && TOKEN_SHAPE.test(stored) ? stored : null;
}

/**
 * Hosted mode: when this page is NOT served by the phone (a public site that only holds the interface), the phone's address comes in the
 * `p` query parameter (`?p=http://192.168.2.23:8765`). Returns its origin, or '' (same-origin: the page was served by the phone) when `p`
 * is absent or is not an http(s) address. Not a secret: the token travels apart, in `t`.
 * @param {{search?: string, href?: string}} location
 */
export function phoneBase(location) {
  let raw = null;
  try {
    const u = new URL(location.href || ('http://x/' + (location.search || '')));
    raw = new URLSearchParams((u.hash || '').replace(/^#/, '')).get('p') || u.searchParams.get('p');
  } catch (e) { return ''; }
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.host ? u.origin : '';
  } catch (e) { return ''; }
}

/**
 * Whether this browser can let an https page talk to a plain-http address in the home network. Only Chromium off iOS can (its "local
 * network access" permission asks the person); Safari, Firefox and every browser on an iPhone or iPad (all WebKit) block it as mixed content,
 * with no setting to allow it.
 */
export function reachesLocalHttp(navigator) {
  const ua = navigator && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  if (/iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS/i.test(ua)) return false;
  // iPadOS reports itself as a Mac: a Mac with a touch screen is an iPad.
  if (/Macintosh/i.test(ua) && navigator && Number(navigator.maxTouchPoints) > 1) return false;
  return /Chrome\/|Chromium\/|Edg\//.test(ua);
}

/**
 * Where a hosted page must go instead of staying: an https page whose phone answers only on plain http, in a browser that blocks that
 * ([reachesLocalHttp] false), opens the page the phone serves itself (same address, no mixed content) with the long code. Null when the
 * hosted page can talk to the phone where it is.
 */
export function phonePageInstead(pageHref, base, token, navigator) {
  if (!base || !token) return null;
  let page;
  try { page = new URL(String(pageHref)); } catch (e) { return null; }
  if (page.protocol !== 'https:' || !/^http:\/\//i.test(base) || reachesLocalHttp(navigator)) return null;
  return base.replace(/\/+$/, '') + '/?t=' + encodeURIComponent(token);
}

/**
 * Whether Chrome will ask the person about the local network while this page first reaches the phone, and how to point at that question:
 * 'arrow' on a computer (Chrome hangs it under the address bar, top left), 'text' on a phone (no fixed place to point at), null where no
 * question comes: another browser (it cannot reach the phone at all, see [phonePageInstead]), a phone on https, a page that is not on
 * https (the phone's own page, the LG app's local file, the TV box app's WebView, which asks nothing).
 */
export function localNetworkAsk(pageHref, base, navigator) {
  if (!base || !/^http:\/\//i.test(base)) return null;
  let page;
  try { page = new URL(String(pageHref)); } catch (e) { return null; }
  if (page.protocol !== 'https:' || !reachesLocalHttp(navigator)) return null;
  const ua = navigator && typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
  if (/; wv\)/.test(ua)) return null;
  return /Android|Mobile/i.test(ua) ? 'text' : 'arrow';
}

/** The phone refused the token (401): drop it, and the profile chosen with it. */
export function forgetToken(storage) {
  remove(storage, TOKEN_KEY);
  remove(storage, PROFILE_KEY);
}

export function loadProfile(storage) {
  const id = get(storage, PROFILE_KEY);
  return id ? id : null;
}

export function saveProfile(storage, id) {
  set(storage, PROFILE_KEY, id);
}

export function forgetProfile(storage) {
  remove(storage, PROFILE_KEY);
}

/** The code service the phone publishes its address to: GET /<code> answers {url} (CORS open), the address with the long code in `t`. */
export const CODE_SERVICE = 'https://url-code.kinotv.workers.dev/';

/** Whether [code] is the five digits the phone shows (spaces allowed, as the phone prints "12 345"). */
export function isPairCode(code) {
  return /^[0-9]{5}$/.test(String(code == null ? '' : code).replace(/\s+/g, ''));
}

/**
 * Where this page goes once the code service answered [url] (the phone's address with `t`): served by the phone itself, to that address as is;
 * hosted on a site of its own ([here] is this page's origin and path), to this same page with the phone's origin in `p` and the long code in `t`.
 * Null when [url] is not an http(s) address carrying a `t`.
 */
export function pairTargetOf(url, here) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.searchParams.get('t')) return null;
  const token = u.searchParams.get('t');
  let page;
  try { page = new URL(String(here)); } catch (e) { return null; }
  if (page.origin === u.origin) return u.origin + '/?t=' + encodeURIComponent(token);
  // The packaged TV app is a local file: its origin reads "null", so the page is named by its scheme, host and path instead.
  const self = page.protocol === 'file:' ? 'file://' + page.host + page.pathname : page.origin + page.pathname;
  return self + '?p=' + encodeURIComponent(u.origin) + '&t=' + encodeURIComponent(token);
}
