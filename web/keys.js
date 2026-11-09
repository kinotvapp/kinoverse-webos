// Remote-control keys (the webOS spike's keys.js mapping). webOS sends the standard arrows and Enter and 461 for Back;
// a desktop browser uses Escape, and Backspace outside a text box.
/** The digit a physical number key (row or keypad, the TV remote's too) gives, or null. */
export function digitOf(ev) {
  if (typeof ev.key === 'string' && /^[0-9]$/.test(ev.key)) return ev.key;
  const k = ev.keyCode;
  if (k >= 48 && k <= 57) return String(k - 48);
  if (k >= 96 && k <= 105) return String(k - 96);
  return null;
}

export function actionOf(ev) {
  const typing = ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName || '');
  switch (ev.keyCode) {
    case 37: return 'left';
    case 38: return 'up';
    case 39: return 'right';
    case 40: return 'down';
    case 13: return 'enter';
    case 461: case 27: return 'back';
    case 415: return 'play';
    case 19: return 'pause';
    case 179: return 'playpause';
    case 413: return 'stop';
    case 417: return 'ff';
    case 412: return 'rew';
    case 405: return 'subtitles'; // the yellow key
    case 8: return typing ? null : 'back';
    default: return null;
  }
}
