// Playback helpers for the thin UI: what this browser can play, when to tell the phone how far the person got, where to seek, and which
// subtitles a <video> can show. No DOM here: node tests import this file. Plain ES2018 (the LG webOS 6 browser is Chromium 79).

/**
 * The phone names its media addresses with its LAN IP (`http://192.168.x.x:8765/__kino/media/<token>/...`). A client that reached the phone some other way
 * (a tunnel, a proxy) cannot use that host: from an https page the browser blocks it (mixed content, local network permission). The media path is the same
 * wherever the phone is reached, so it is read from the origin this page was served from. Anything that is not a media address is left as it is.
 */
export function mediaUrlFor(url, origin) {
  if (typeof url !== 'string' || typeof origin !== 'string' || !origin) return url;
  const m = /^https?:\/\/[^\/]+(\/__kino\/media\/[0-9a-f]+\/[^\s]*)$/i.exec(url);
  return m ? origin.replace(/\/+$/, '') + m[1] : url;
}

/**
 * Called inside the person's own press (the click or Enter that opened the player), before anything is awaited: a play() made while the
 * browser still counts that gesture marks this <video> as allowed to play with sound (Chromium unlocks the element), so the real start,
 * seconds later once the phone answered, is not refused. Its promise is dropped: it settles when a source arrives, or is aborted.
 */
export function primePlay(video) {
  try {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* an element that cannot play yet: the start below still tries */ }
}

/**
 * Starts the video. A browser that refuses sound without a fresh gesture (NotAllowedError) gets the same video muted, which every browser
 * plays on its own, and `onMuted()` is told so the page can ask for one key to bring the sound back. `onBlocked()` only when even a muted
 * start is refused: then the person has to start it. Any other failure is the player's own error event's to handle.
 */
export function autoplay(video, handlers) {
  const h = handlers || {};
  let p;
  try { p = video.play(); } catch (e) { p = null; }
  if (!p || typeof p.then !== 'function') return;
  p.catch((e) => {
    if (!e || e.name !== 'NotAllowedError') return;
    video.muted = true;
    let q;
    try { q = video.play(); } catch (err) { q = null; }
    if (!q || typeof q.then !== 'function') { video.muted = false; if (h.onBlocked) h.onBlocked(); return; }
    q.then(() => { if (h.onMuted) h.onMuted(); }, () => { video.muted = false; if (h.onBlocked) h.onBlocked(); });
  });
}

/** Progress goes to the phone at most this often while playing (and at once on pause, seek and leaving). */
export const REPORT_MS = 10000;

/** Whether this page runs in an LG webOS browser (its own player plays the TS playlists). */
export function isWebOs(win) {
  const ua = win && win.navigator && typeof win.navigator.userAgent === 'string' ? win.navigator.userAgent : '';
  return /Web0S|webOS/i.test(ua);
}

/**
 * What the phone needs to choose a plan: the player's own answers, plus one fact no browser reports (see tsHevc). `eme` is what
 * shakaplay.js' probeEme found (`['clearkey', 'widevine']`): the phone plans a protected stream only for a key system named here. `dash`:
 * Shaka plays DASH wherever there is Media Source.
 */
export function clientOf(video, win, eme) {
  const can = (type) => {
    try { return /^(maybe|probably)$/.test(String(video.canPlayType(type))); } catch (e) { return false; }
  };
  const ua = win && win.navigator && typeof win.navigator.userAgent === 'string' ? win.navigator.userAgent : '';
  return {
    hlsNative: can('application/vnd.apple.mpegurl'),
    mse: !!(win && win.MediaSource),
    hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"') || can('video/mp4; codecs="hev1.1.6.L93.B0"'),
    // Plays video inside MPEG-TS: a TV's platform player does (webOS); a browser with MSE and HEVC does it through hls.js' full build, which
    // converts the TS in the page (measured on Chrome 156 with a plugin's HEVC TS). Anything else is asked for the phone's remux.
    tsHevc: isWebOs(win) || !!(win && win.MediaSource && (can('video/mp4; codecs="hvc1.1.6.L93.B0"') || can('video/mp4; codecs="hev1.1.6.L93.B0"'))),
    eme: Array.isArray(eme) ? eme.filter((s) => s === 'clearkey' || s === 'widevine') : [],
    dash: !!(win && win.MediaSource),
  };
}

function whole(n) {
  const v = Number(n);
  return isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/**
 * Reports playback to the phone. `send(kind, payload)` returns a promise ('progress' | 'end'); a failed send is dropped: progress is best
 * effort and must never interrupt the video. After `finish` nothing more is sent.
 */
export function createReporter(options) {
  const send = options.send;
  const now = options.now || (() => Date.now());
  let last = -Infinity;
  let done = false;

  function fire(kind, payload) {
    try {
      const p = send(kind, payload);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* best effort */ }
  }

  return {
    /** Called on every timeupdate: reports only when REPORT_MS passed since the last report. */
    tick(positionMs, durationMs) {
      if (done) return;
      const t = now();
      if (t - last < REPORT_MS) return;
      last = t;
      fire('progress', { positionMs: whole(positionMs), durationMs: whole(durationMs) });
    },
    /** Reports now (pause, seek). */
    now(positionMs, durationMs) {
      if (done) return;
      last = now();
      fire('progress', { positionMs: whole(positionMs), durationMs: whole(durationMs) });
    },
    /** The person left or the video ended: one `end`, and no more reports. */
    finish(positionMs, durationMs, watched) {
      if (done) return;
      done = true;
      fire('end', { positionMs: whole(positionMs), durationMs: whole(durationMs), watched: watched === true });
    },
    finished() { return done; },
  };
}

/** The time to seek to, in seconds: `delta` from `current`, kept inside the video (no upper clamp while the duration is unknown). */
export function seekTarget(current, duration, delta) {
  const t = (Number(current) || 0) + delta;
  const max = isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.max(0, Math.min(max, t));
}

/**
 * The phone's remux starts at a keyframe before the title's 0:00 (`plan.offsetMs`), so the video's own clock runs behind the title's: the title
 * time is `currentTime + offset`, and playback starts at `resume - offset`. With no offset these are the plain video clock.
 */
export function titleMs(currentSeconds, offsetMs) {
  return (Number(currentSeconds) || 0) * 1000 + (Number(offsetMs) || 0);
}

/** Where playback starts in the VIDEO's clock, in seconds, for a resume in title time (ms). A remux has a growing duration: no upper check then. */
export function startInVideo(resumeMs, offsetMs, duration) {
  const off = Number(offsetMs) || 0;
  return startAt((Number(resumeMs) || 0) - off, off > 0 ? NaN : duration);
}

/** Where playback starts, in seconds, from the phone's resume (ms): nowhere past the end. */
export function startAt(resumeMs, duration) {
  const ms = Number(resumeMs);
  if (!isFinite(ms) || ms <= 0) return 0;
  const s = ms / 1000;
  if (isFinite(duration) && duration > 0 && s >= duration) return 0;
  return s;
}

/** The seconds in `00:01:02,250`, `01:02.250` or `00:01:02.250`; NaN when it is not a time. */
function seconds(t) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/.exec(t.trim());
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/**
 * Cues (seconds, text) from an SRT or WebVTT file, each moved by `shiftMs` (a remux's clock runs behind the title's: pass minus its offset). A cue that ends
 * before the video starts is dropped, one that began before it keeps its tail. ASS tags like `{\an8}` are removed, `<i>`, `<b>` and `<u>` stay. Never throws.
 */
export function parseSubtitles(text, shiftMs) {
  if (typeof text !== 'string') return [];
  const shift = (Number(shiftMs) || 0) / 1000;
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues = [];
  blocks.forEach((block) => {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (at < 0) return;
    const parts = lines[at].split('-->');
    const start = seconds(parts[0]);
    const end = seconds(parts[1].trim().split(/\s+/)[0]);
    if (!isFinite(start) || !isFinite(end) || end <= start) return;
    const body = lines.slice(at + 1).join('\n').replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?[ibu]>)[^>]*>/gi, '').trim();
    if (!body) return;
    const s = start + shift;
    const e = end + shift;
    if (e <= 0) return;
    cues.push({ start: Math.max(0, Math.round(s * 1000) / 1000), end: Math.round(e * 1000) / 1000, text: body });
  });
  return cues;
}

/** The text sizes the phone's own style allows (60 to 200 percent), as the web player steps through them. */
export const SUB_SIZES = [60, 80, 100, 120, 140, 160, 180, 200];

/** The next size up (dir 1) or down (-1) from [percent]; stays inside the allowed sizes. */
export function sizeNext(percent, dir) {
  const p = isFinite(Number(percent)) && Number(percent) > 0 ? Number(percent) : 100;
  if (dir > 0) { for (let i = 0; i < SUB_SIZES.length; i++) if (SUB_SIZES[i] > p) return SUB_SIZES[i]; return SUB_SIZES[SUB_SIZES.length - 1]; }
  for (let i = SUB_SIZES.length - 1; i >= 0; i--) if (SUB_SIZES[i] < p) return SUB_SIZES[i];
  return SUB_SIZES[0];
}

/** Subtitle sync in seconds: half a second a step, never beyond ten either way, with no floating point drift. */
export function syncNext(seconds, dir) {
  const n = Math.round((Number(seconds) || 0) * 2) + (dir > 0 ? 1 : -1);
  return Math.max(-20, Math.min(20, n)) / 2;
}

/** The cues moved by [delaySeconds]: none starts before zero, and a cue that now ends before zero is dropped. */
export function shiftCues(cues, delaySeconds) {
  const d = Number(delaySeconds) || 0;
  if (d === 0) return (cues || []).slice();
  const out = [];
  (cues || []).forEach((c) => {
    const end = Math.round((c.end + d) * 1000) / 1000;
    if (end <= 0) return;
    out.push({ start: Math.max(0, Math.round((c.start + d) * 1000) / 1000), end: end, text: c.text });
  });
  return out;
}

/** The next subtitle choice: -1 is off, then each track in turn, then off again. */
export function nextSubtitle(count, current) {
  if (!(count > 0)) return -1;
  return current + 1 >= count ? -1 : current + 1;
}

/** One label per track: its language, a repeated language numbered ("es", "es 2"), "und" when unknown. */
export function subtitleLabels(tracks) {
  const seen = {};
  return (Array.isArray(tracks) ? tracks : []).map((t) => {
    const lang = t && t.lang ? String(t.lang) : 'und';
    seen[lang] = (seen[lang] || 0) + 1;
    return seen[lang] > 1 ? lang + ' ' + seen[lang] : lang;
  });
}

/** Subtitles start on only in a language the person reads (the interface's); otherwise off. Returns a track index or -1. */
export function defaultSubtitle(tracks, uiLang) {
  const want = String(uiLang || '').toLowerCase();
  const list = Array.isArray(tracks) ? tracks : [];
  for (let i = 0; i < list.length; i++) {
    if (list[i] && String(list[i].lang || '').toLowerCase().split('-')[0] === want) return i;
  }
  return -1;
}

/** Which of the phone's subtitles a browser can show: http(s) addresses in SRT or WebVTT (they are read and turned into cues). */
export function subtitleTracks(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((s) => {
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return;
    const format = String(s.format || '').toLowerCase();
    const known = format === 'vtt' || format === 'srt' || format === '' || format === 'webvtt' || format === 'subrip';
    if (!known) return;
    out.push({ lang: s.lang ? String(s.lang) : 'und', url: s.url });
  });
  return out;
}

/** A time as the player's bar writes it: m:ss, or h:mm:ss from an hour on; nothing known is 0:00. */
export function clockOf(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const two = (n) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
}

/** How far along the bar is, 0..1: the position over the duration, 0 when the duration is not known. */
export function progressOf(positionMs, durationMs) {
  const d = Number(durationMs) || 0;
  if (d <= 0) return 0;
  return Math.max(0, Math.min(1, (Number(positionMs) || 0) / d));
}

/** Night mode: a black veil of level/10 over the video (0 = normal), as the TV's DIM_MAX_LEVEL. */
export const DIM_MAX = 10;

/** The level after one step, kept inside 0..DIM_MAX. */
export function dimStep(level, delta) {
  return Math.max(0, Math.min(DIM_MAX, (Number(level) || 0) + delta));
}

/** Zoom keeps to 100..300 % in steps of 10; the stretch and the reset are the panel's own buttons. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

export function zoomStep(zoom, delta) {
  const next = Math.round(((Number(zoom) || 1) + delta * 0.1) * 10) / 10;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
}

/**
 * The name of an audio track of a TS for the language button: the language in the person's language when the PMT declares one (ISO 639-2 such as `spa`;
 * `names` is an Intl.DisplayNames or anything with `of(code)`), else the upper-cased code, else "Audio n". The codec is added when two tracks would read the same.
 */
export function tsAudioLabelOf(track, index, names, fallback) {
  const t = track || {};
  let label = '';
  if (t.lang) {
    try { label = names && names.of ? String(names.of(t.lang) || '') : ''; } catch (e) { label = ''; }
    if (!label || label.toLowerCase() === String(t.lang).toLowerCase()) label = String(t.lang).toUpperCase();
  }
  if (!label) label = String(fallback || 'Audio {n}').replace('{n}', String(index + 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
