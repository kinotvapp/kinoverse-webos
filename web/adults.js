// The adult-content lock as the web UI shows it. The lock and its code live on the phone (the phone checks the code and counts wrong ones); this file only
// shapes what the screen draws and what the number pad does. No DOM here: node tests import it.

/** The longest code the pad takes. The phone decides what a valid code is. */
export const MAX_CODE = 12;

/** The code after pressing [key]: a digit '0'-'9' appends, 'back' deletes the last digit; anything else changes nothing. */
export function keypadNext(entered, key) {
  const code = String(entered || '').replace(/[^0-9]/g, '');
  if (key === 'back') return code.slice(0, -1);
  if (/^[0-9]$/.test(String(key))) return code.length >= MAX_CODE ? code : code + key;
  return code;
}

/**
 * What the lock button shows, from GET /adults: `visible` whenever the phone answered (the lock exists even while the device still has its default code),
 * `unlocked`, and `canOpen` (the phone refuses to open the lock from where this page was reached, e.g. through the internet tunnel; closing it again is
 * always allowed).
 */
export function adultsView(state) {
  if (!state || typeof state.unlocked !== 'boolean') return { visible: false, unlocked: false, canOpen: false };
  const unlocked = state.unlocked === true;
  return { visible: true, unlocked: unlocked, canOpen: unlocked || state.canUnlockHere === true };
}

/** A lockout in whole minutes, at least one. */
export function lockedOutMinutes(ms) {
  const n = Number(ms);
  return isFinite(n) && n > 0 ? Math.max(1, Math.ceil(n / 60000)) : 1;
}
