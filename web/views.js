// Pure shaping of API answers into what the screens draw. No DOM here: node tests import this file.
import { fmt } from './i18n.js';

// Profile.color on the phone is an index into this palette (ui/profile/ProfileAvatars.kt, ProfileColors).
const PROFILE_COLORS = ['#C62828', '#1565C0', '#2E7D32', '#6A1B9A', '#BF360C', '#00695C', '#AD1457', '#455A64'];

function isImageUrl(v) {
  return typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v);
}

function initialOf(text) {
  const t = String(text || '').trim();
  if (!t) return '?';
  return Array.from(t)[0].toUpperCase();
}

function artOf(poster, backdrop, title) {
  if (isImageUrl(poster)) return { type: 'poster', src: poster };
  if (isImageUrl(backdrop)) return { type: 'backdrop', src: backdrop };
  return { type: 'letter', letter: initialOf(title) };
}

/** Year · quality · language, whatever of it the card has. Nothing about adult content is ever written. */
export function metaOf(card) {
  const c = card || {};
  return [c.year, c.quality, c.lang].filter((v) => v !== undefined && v !== null && String(v).trim() !== '').join(' · ');
}

/**
 * The rows Home shows, in order: continue watching first (only when it has items), then every plugin row that has
 * cards, in the order the phone sent them. Each: {key, kind: 'continue'|'plugin', title, pluginId, pluginName, items}.
 */
export function rowsOf(home) {
  const h = home || {};
  const out = [];
  const cont = Array.isArray(h.continue) ? h.continue : [];
  if (cont.length) out.push({ key: 'continue', kind: 'continue', title: null, pluginId: null, pluginName: null, items: cont });
  (Array.isArray(h.rows) ? h.rows : []).forEach((r) => {
    if (!r || !Array.isArray(r.items) || !r.items.length) return;
    out.push({ key: r.pluginId + '/' + r.id, kind: 'plugin', title: r.title || '', pluginId: r.pluginId, pluginName: r.pluginName || '', items: r.items });
  });
  return out;
}

/**
 * The Home's big featured title: the first plugin card with a picture (its backdrop first, else its poster). Continue-watching items are never the hero.
 * Returns {ref, title, meta, overview, image} or null.
 */
export function heroOf(home) {
  const rows = home && Array.isArray(home.rows) ? home.rows : [];
  for (let r = 0; r < rows.length; r++) {
    const items = rows[r] && Array.isArray(rows[r].items) ? rows[r].items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const image = isImageUrl(it.backdrop) ? it.backdrop : isImageUrl(it.poster) ? it.poster : '';
      if (!image || !it.ref) continue;
      return { ref: it.ref, title: it.title || '', meta: metaOf(it), overview: typeof it.overview === 'string' ? it.overview : '', image: image };
    }
  }
  return null;
}

/** A card as drawn: the poster, else the backdrop, else a letter placeholder. */
export function cardOf(card) {
  const c = card || {};
  return {
    ref: c.ref,
    title: c.title || '',
    kind: c.kind || '',
    year: c.year || '',
    meta: metaOf(c),
    overview: c.overview || '',
    art: artOf(c.poster, c.backdrop, c.title),
  };
}

export function episodeLabel(ep, s) {
  const e = ep.number !== undefined ? ep.number : ep.episode;
  if (ep.season !== undefined && ep.season !== null) return fmt(s.episodeShort, { s: ep.season, e: e });
  return fmt(s.episodeOnly, { e: e });
}

/** A continue-watching item as drawn: its still (a wide picture), how far the person got (0..1), the episode. */
export function continueCardOf(item, s) {
  const it = item || {};
  const title = it.displayName || it.title || '';
  const pos = Number(it.positionMs) || 0;
  const dur = Number(it.durationMs) || 0;
  const progress = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
  const hasEpisode = it.episode !== undefined && it.episode !== null;
  return {
    key: String(it.itemId) + '/' + String(it.episodeId),
    title: title,
    meta: hasEpisode ? episodeLabel({ season: it.season, number: it.episode }, s) : '',
    episodeTitle: it.episodeTitle || '',
    overview: it.overview || '',
    art: artOf(null, it.thumb, title),
    progress: progress,
    ref: typeof it.ref === 'string' && it.ref ? it.ref : '',
    seriesRef: typeof it.seriesRef === 'string' && it.seriesRef ? it.seriesRef : '',
  };
}

/** A profile tile: its name, initial and colour (the avatar id has no picture here, so colour + initial). */
export function profileOf(p) {
  const n = Number(p.color);
  const i = isFinite(n) ? ((Math.trunc(n) % PROFILE_COLORS.length) + PROFILE_COLORS.length) % PROFILE_COLORS.length : 0;
  return { id: p.id, name: p.name || '', initial: initialOf(p.name), color: PROFILE_COLORS[i] };
}

const CODE_TEXT = {
  needs_phone: 'errNeedsPhone',
  plugin_timeout: 'errTimeout',
  profile_unknown: 'errProfileUnknown',
  profile_required: 'errProfileRequired',
  unauthorized: 'errUnauthorized',
  network: 'errNetwork',
  unsupported_here: 'errUnsupportedHere',
  not_found: 'errNotFound',
  busy: 'errBusy',
  wrong_code: 'errWrongCode',
  unlock_not_allowed: 'errUnlockNotAllowed',
  no_code: 'errNoCode',
};

/** The sentence for an error, in the person's language. Anything unknown gets the generic sentence. */
export function errorText(err, s) {
  if (err && err.needsPhone) return s.errNeedsPhone;
  const key = err && typeof err.code === 'string' ? CODE_TEXT[err.code] : null;
  return key ? s[key] : s.errGeneric;
}
