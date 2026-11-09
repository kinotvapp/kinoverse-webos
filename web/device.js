// Which kind of device this page runs on: a TV, a desktop browser or a phone. It is only about how THIS page is drawn and behaves (later some screens
// will exist for one kind only); it changes nothing in the phone's app. The browser's guess can be wrong, so the person can pick another one and the
// pick is kept in this browser (localStorage). Pure: callers pass the environment and the storage, so node tests use fakes. Nothing runs at import time.

export const DEVICES = ['tv', 'desktop', 'phone'];
const KEY = 'kino.device';
const TV_AGENT = /Web0S|webOS|SmartTV|SMART-TV|Tizen|HbbTV|NetCast|BRAVIA|AFT[A-Z]|Android[^)]*\bTV\b|CrKey|Viera|Roku|AppleTV|GoogleTV/i;
const PHONE_AGENT = /Mobi|iPhone|iPod|Android/i;
const TABLET_MAX_WIDTH = 1100; // a touch screen up to this wide is a handheld, whatever its user agent says (an iPad pretends to be a Mac)

/**
 * The browser's best guess.
 * @param {?{userAgent?: string, maxTouchPoints?: number, width?: number}} env
 * @returns {'tv'|'desktop'|'phone'}
 */
export function detectDevice(env) {
  const ua = env && typeof env.userAgent === 'string' ? env.userAgent : '';
  if (TV_AGENT.test(ua)) return 'tv';
  if (PHONE_AGENT.test(ua)) return 'phone';
  const touch = env && env.maxTouchPoints > 1;
  const width = env && typeof env.width === 'number' ? env.width : 0;
  if (touch && width > 0 && width <= TABLET_MAX_WIDTH) return 'phone';
  return 'desktop';
}

/** What to use: the saved choice when it is one of the devices, else the detection. */
export function resolveDevice(detected, pref) {
  return DEVICES.indexOf(pref) >= 0 ? pref : detected;
}

/** The saved choice: one of DEVICES, or 'auto' when none (or storage is unavailable). */
export function readDevicePref(storage) {
  let value = null;
  try { value = storage ? storage.getItem(KEY) : null; } catch (e) { value = null; }
  return DEVICES.indexOf(value) >= 0 ? value : 'auto';
}

/** Keeps the choice; 'auto' (or anything unknown) clears it. A storage that refuses is ignored: the choice then lasts only until the page closes. */
export function saveDevicePref(storage, pref) {
  if (!storage) return;
  try {
    if (DEVICES.indexOf(pref) >= 0) storage.setItem(KEY, pref);
    else storage.removeItem(KEY);
  } catch (e) { /* the page keeps the choice in memory only */ }
}

/** The environment detectDevice reads, taken from a window. */
export function deviceEnvOf(win) {
  const nav = (win && win.navigator) || {};
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints, width: Math.min(win && win.screen ? win.screen.width || 0 : 0, win && win.screen ? win.screen.height || 0 : 0) || (win && win.innerWidth) || 0 };
}
