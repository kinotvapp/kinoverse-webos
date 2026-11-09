// Shaka Player 4.3.9 (its compiled build, Apache-2.0, shaka.LICENSE.txt) plays what hls.js does not: DASH, and protected streams (ClearKey,
// and Widevine where the browser has it). It is a classic script loaded only when a plan needs it (a `drm` block or a DASH manifest), never
// at start: 430 KB a TV parses only for such a channel. Keys are secrets: they go from the plan straight into Shaka's configuration and are
// never put in an address, a log line or the console. No DOM work at import time: node tests import the pure parts.
import { mediaUrlFor } from './player.js';

/** The key systems the phone knows by name, and what EME calls them. */
export const KEY_SYSTEMS = { clearkey: 'org.w3.clearkey', widevine: 'com.widevine.alpha' };

/** What a probe asks for: CENC-protected H.264 and AAC in MP4, what a protected DASH channel carries. */
const PROBE_CONFIG = [{
  initDataTypes: ['cenc'],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
  audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
}];

let probing = null;
let loading = null;
let polyfilled = false;

/**
 * The key systems this browser has, by the phone's names (`['clearkey', 'widevine']`), asked once per page. Empty without Media Source or
 * EME: a desktop browser offers EME only in a secure context (https, or localhost), so a page reached over the LAN's plain http has none
 * and the phone keeps refusing protected streams to it. Never rejects.
 */
export function probeEme(win) {
  if (!probing) probing = emeSystems(win);
  return probing;
}

/** [probeEme] without the cache (tests). */
export function emeSystems(win) {
  const nav = win && win.navigator;
  if (!nav || typeof nav.requestMediaKeySystemAccess !== 'function' || !win.MediaSource) return Promise.resolve([]);
  const names = Object.keys(KEY_SYSTEMS);
  return Promise.all(names.map((name) => {
    try {
      return Promise.resolve(nav.requestMediaKeySystemAccess(KEY_SYSTEMS[name], PROBE_CONFIG)).then(() => name, () => null);
    } catch (e) {
      return Promise.resolve(null);
    }
  })).then((found) => found.filter(Boolean));
}

/** Whether a plan is Shaka's to play: it is protected, or it is a DASH manifest. */
export function needsShaka(plan) {
  if (!plan || typeof plan !== 'object') return false;
  if (plan.drm) return true;
  if (plan.route === 'dash-proxy' || /dash\+xml/i.test(String(plan.mime || ''))) return true;
  return /\.mpd(\?|$)/i.test(String(plan.url || ''));
}

const HEX16 = /^[0-9a-f]{32}$/;

/**
 * Shaka's configuration for a plan's `drm` (null: a clear stream, `{}`): ClearKey's `clearKeys` (key id to key, both 32 hex digits; a
 * malformed pair is left out), or Widevine's license server (`servers`), named the way this page reaches the phone ([origin]). Null when
 * the block cannot be used: an unknown system, no valid key, no license address. The phone sends `drm` only to a client that proved the
 * system, so null means a broken answer and the title does not play.
 */
export function shakaConfigOf(drm, origin) {
  if (!drm) return {};
  if (typeof drm !== 'object') return null;
  if (drm.system === 'clearkey') {
    const keys = {};
    let n = 0;
    const given = drm.keys && typeof drm.keys === 'object' ? drm.keys : {};
    Object.keys(given).forEach((kid) => {
      const k = String(kid).toLowerCase();
      const v = String(given[kid]).toLowerCase();
      if (HEX16.test(k) && HEX16.test(v)) { keys[k] = v; n++; }
    });
    return n > 0 ? { drm: { clearKeys: keys } } : null;
  }
  if (drm.system === 'widevine') {
    const url = typeof drm.licenseUrl === 'string' ? mediaUrlFor(drm.licenseUrl, origin) : '';
    if (!/^https?:\/\//i.test(url)) return null;
    const servers = {};
    servers[KEY_SYSTEMS.widevine] = url;
    return { drm: { servers: servers } };
  }
  return null;
}

/** Loads Shaka once; resolves to the `shaka` namespace, rejects if the file does not load. */
export function loadShaka(doc, win) {
  if (win.shaka && win.shaka.Player) return Promise.resolve(win.shaka);
  if (!loading) {
    loading = new Promise(function (resolve, reject) {
      const s = doc.createElement('script');
      s.src = 'shaka-player.compiled.js';
      s.onload = function () { if (win.shaka && win.shaka.Player) resolve(win.shaka); else { loading = null; reject(new Error('shaka did not load')); } };
      s.onerror = function () { loading = null; reject(new Error('shaka did not load')); };
      doc.head.appendChild(s);
    });
  }
  return loading;
}

/** Shaka's error codes that are not a failure of the video: a load cut short because the player was destroyed or given another one. */
const NOT_FAILURES = [7000, 7001, 7002];

/**
 * Plays [url] in [video] with Shaka and [config] ([shakaConfigOf]). `startTime` (seconds, VOD only) is where it starts; `onFatal(code)` is
 * called once when it gives up (a critical error, or a load that failed; never with the error's data, which this page does not log).
 * Returns `{ destroy() }`; destroy it when playback stops. Null when this browser cannot run Shaka (no Media Source).
 */
export function attachShaka(shaka, video, url, options) {
  const o = options || {};
  if (!polyfilled) { try { shaka.polyfill.installAll(); } catch (e) { /* plays without them */ } polyfilled = true; }
  if (shaka.Player.isBrowserSupported && !shaka.Player.isBrowserSupported()) return null;
  const player = new shaka.Player(video);
  let reported = false;
  let destroyed = false;
  const fatal = (code) => {
    if (reported || destroyed || NOT_FAILURES.indexOf(code) >= 0) return;
    reported = true;
    if (o.onFatal) o.onFatal(typeof code === 'number' ? code : 0);
  };
  try { player.configure(o.config || {}); } catch (e) { fatal(0); }
  player.addEventListener('error', (ev) => {
    const d = ev && ev.detail;
    // Severity 2 is CRITICAL: Shaka stopped. A recoverable one (1) it retries by itself.
    if (!d || d.severity === 2) fatal(d && d.code);
  });
  const start = typeof o.startTime === 'number' && o.startTime > 0 ? o.startTime : undefined;
  player.load(url, start).catch((e) => fatal(e && e.code));
  return {
    destroy() {
      destroyed = true;
      try { const p = player.destroy(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* stopping anyway */ }
    },
  };
}
