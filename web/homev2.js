// Home as the TV draws it, from the phone's `GET /home/v2` answer (the cache alone: the phone never asks a plugin for it). Pure shaping, no DOM: node tests import this file.
// The phone already composed the sections with the app's own rules (layout, shelves that mix every plugin, order, the adult lock); this file only turns them into cards
// with the TV's measures and into what the hero shows for the focused card. The TV's numbers are in ui/data/HomeCardStyle.kt (TV_CARD_HEIGHTS, TV_POSTER_HEIGHTS).
import { episodeLabel } from './views.js';

const HEIGHTS = {
  cards: { small: 100, medium: 120, large: 144, xlarge: 176 },
  posters: { small: 130, medium: 160, large: 190, xlarge: 200 },
};

/** The phone's own picture addresses are relative (`/__kino/media/...`); on a page served elsewhere they go to the phone's origin. Returns a copy. */
export function withBase(value, base) {
  if (!base) return value;
  if (typeof value === 'string') return value.indexOf('/__kino/') === 0 ? String(base).replace(/\/+$/, '') + value : value;
  if (Array.isArray(value)) return value.map((v) => withBase(v, base));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => { out[k] = withBase(value[k], base); });
    return out;
  }
  return value;
}

function isImageUrl(v) {
  return typeof v === 'string' && v !== '' && !/\s/.test(v);
}

/** A card's size in dp on a TV: its height by style and size, and the width of its shape (16:9 for a backdrop, 2:3 for a poster). */
export function cardMetrics(style, size, wide) {
  const table = style === 'posters' ? HEIGHTS.posters : HEIGHTS.cards;
  const hgt = table[size] || table.medium;
  return { h: hgt, w: Math.round(hgt * (wide ? 16 / 9 : 2 / 3)) };
}

function initialOf(text) {
  const t = String(text || '').trim();
  return t ? Array.from(t)[0].toUpperCase() : '?';
}

/** "1 h 39 min", "45 min", "" for nothing. */
export function runtimeText(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m <= 0) return '';
  return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '') : m + ' min';
}

/**
 * The facts line under the hero's name, as the TV writes it: ★ rating · year · runtime · age rating · genres. `info` is what /hero-info added (it may be null).
 * Every part is optional.
 */
export function factsOf(c, info) {
  const i = info && info.found ? info : {};
  const rating = Number(c.rating) > 0 ? c.rating : Number(i.rating) > 0 ? i.rating : 0;
  const runtime = Number(c.runtimeMinutes) > 0 ? c.runtimeMinutes : i.runtimeMinutes;
  const genres = (Array.isArray(c.genres) && c.genres.length ? c.genres : Array.isArray(i.genres) ? i.genres : []).slice(0, 2);
  const parts = [];
  if (rating > 0) parts.push('★ ' + (Math.round(rating * 10) / 10).toFixed(1));
  const year = c.year || i.year;
  if (year) parts.push(String(year));
  const rt = runtimeText(runtime);
  if (rt) parts.push(rt);
  if (i.certification) parts.push(i.certification);
  if (genres.length) parts.push(genres.join(', '));
  return parts.join(' · ');
}

/** What to ask /hero-info about a card: by TMDB id when there is one, else by exact title; null for what TMDB cannot know (music, live). */
export function askOf(c) {
  const type = c && (c.type === 'movie' || c.type === 'tv') ? c.type : '';
  if (!type) return null;
  const tmdbId = Number(c.tmdbId);
  if (tmdbId > 0) return { type: type, tmdbId: tmdbId };
  if (c.imdbId && type === 'movie') return { type: type, imdbId: c.imdbId };
  if (c.title) return { type: type, title: c.title, year: c.year ? String(c.year).slice(0, 4) : undefined };
  return null;
}

function artOf(src, title, wide) {
  return isImageUrl(src) ? { type: 'image', src: src, wide: wide } : { type: 'letter', letter: initialOf(title), wide: wide };
}

/** A title card (a favorite, a shelf or plugin row item): the image the phone chose for the person's card style, and what the hero shows when it has focus. */
export function titleCardOf(it, settings, rowKey) {
  const c = it || {};
  const style = settings && settings.homeCardStyle === 'posters' ? 'posters' : 'cards';
  // The phone's `art` when it chose one (Home); else the picture the style asks first (a plugin screen's titles bring both).
  const first = style === 'cards' ? c.backdrop : c.poster;
  const second = style === 'cards' ? c.poster : c.backdrop;
  const src = isImageUrl(c.art) ? c.art : isImageUrl(first) ? first : isImageUrl(second) ? second : '';
  // The phone picked `art` by the style; it is a backdrop (landscape) exactly when it is the card's backdrop, else a poster.
  // The shape is the person's style, never the picture's: a poster-only title is still a card in "cards" (its picture covers the
  // box), a backdrop-only one still a poster in "posters", so a row never mixes shapes.
  const wide = style === 'cards';
  return {
    key: 'card:' + rowKey + ':' + c.ref,
    kind: 'title',
    ref: c.ref,
    title: c.title || '',
    art: artOf(src, c.title, wide),
    wide: wide,
    hero: { title: c.title || '', overview: typeof c.overview === 'string' ? c.overview : '', image: isImageUrl(c.backdrop) ? c.backdrop : isImageUrl(c.poster) ? c.poster : src, facts: factsOf(c, null), card: c, ask: askOf(c), extra: '' },
  };
}

/** A continue-watching card: its wide still with how far the person got, and the hero's lines (episode, time left). */
export function continueCardOfV2(it, S) {
  const c = it || {};
  const title = c.displayName || c.title || '';
  const pos = Number(c.positionMs) || 0;
  const dur = Number(c.durationMs) || 0;
  const hasEpisode = c.episode !== undefined && c.episode !== null;
  const src = isImageUrl(c.backdrop) ? c.backdrop : isImageUrl(c.thumb) ? c.thumb : '';
  return {
    key: 'continue:' + String(c.itemId) + '/' + String(c.episodeId),
    kind: 'continue',
    ref: typeof c.ref === 'string' ? c.ref : '',
    seriesRef: typeof c.seriesRef === 'string' ? c.seriesRef : '',
    itemId: c.itemId,
    title: title,
    meta: hasEpisode ? episodeLabel({ season: c.season, number: c.episode }, S) : '',
    episodeTitle: c.episodeTitle || '',
    overview: typeof c.overview === 'string' ? c.overview : '',
    art: artOf(src, title, true),
    wide: true,
    progress: dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0,
    positionMs: pos,
    durationMs: dur,
    raw: c,
    hero: { title: title, overview: typeof c.overview === 'string' ? c.overview : '', image: isImageUrl(c.backdrop) ? c.backdrop : isImageUrl(c.thumb) ? c.thumb : '', facts: factsOf(c, null), card: c, ask: askOf(c), extra: typeof c.subtitle === 'string' ? c.subtitle : '' },
  };
}

/**
 * The Home, from the /home/v2 answer: {settings: {style, size}, sections: [{key, kind, title, cards, pluginName?}], hero, pending, asOf, fresh}.
 * Live channels are left for the En vivo screen; a section with no card is left out.
 */
export function homeModelOf(v2, S) {
  const a = v2 || {};
  const settings = a.settings || {};
  const style = settings.homeCardStyle === 'posters' ? 'posters' : 'cards';
  const sections = [];
  (Array.isArray(a.sections) ? a.sections : []).forEach((s, n) => {
    if (!s) return;
    if (s.kind === 'continue') {
      const cards = (s.items || []).map((it) => continueCardOfV2(it, S));
      if (cards.length) sections.push({ key: 'continue', kind: 'continue', title: S.continueWatching, cards: cards });
    } else if (s.kind === 'favorites') {
      const cards = (s.items || []).map((it) => titleCardOf(it, settings, 'favorites'));
      if (cards.length) sections.push({ key: 'favorites', kind: 'favorites', title: S.favorites, cards: cards });
    } else if (s.kind === 'shelf') {
      const cards = (s.items || []).map((it) => titleCardOf(it, settings, 'shelf:' + s.key));
      if (cards.length) sections.push({ key: 'shelf:' + s.key, kind: 'shelf', title: s.title || '', cards: cards });
    } else if (s.kind === 'plugin') {
      (Array.isArray(s.rows) ? s.rows : []).forEach((r) => {
        const cards = (r.items || []).map((it) => titleCardOf(it, settings, s.pluginId + '/' + r.id));
        if (cards.length) sections.push({ key: s.pluginId + '/' + r.id, kind: 'plugin', title: r.title || '', pluginName: s.pluginName || '', cards: cards });
      });
    }
  });
  return {
    settings: { style: style, size: settings.homeCardSize || 'medium', byCategories: settings.homeByCategories !== false },
    sections: sections,
    hero: heroOfV2(a.hero, settings),
    pending: a.cache && Array.isArray(a.cache.pending) ? a.cache.pending : [],
    asOf: a.cache && typeof a.cache.asOf === 'number' ? a.cache.asOf : null,
    fresh: !!(a.cache && a.cache.fresh),
    refreshing: a.refreshing === true,
    needsPhone: a.pluginsNeedPhone === true,
  };
}

/** What the hero shows before any card has focus: the phone's pick (the first continue item, else the library, else a plugin's). */
export function heroOfV2(hero, settings) {
  if (!hero || !hero.title) return null;
  return {
    title: hero.title,
    overview: typeof hero.overview === 'string' ? hero.overview : '',
    image: isImageUrl(hero.backdrop) ? hero.backdrop : isImageUrl(hero.image) ? hero.image : isImageUrl(hero.poster) ? hero.poster : '',
    facts: factsOf(hero, null),
    card: hero,
    ask: askOf(hero),
    extra: typeof hero.meta === 'string' && hero.source === 'continue' ? hero.meta : typeof hero.subtitle === 'string' && hero.source === 'continue' ? hero.subtitle : '',
    square: hero.square === true,
  };
}

/** The cards of a tab on the sources screen: all of them for the first tab (no plugin), else the ones of that plugin. */
export function sourceCardsOf(cards, pluginId) {
  const list = Array.isArray(cards) ? cards : [];
  return pluginId ? list.filter((c) => c && c.pluginId === pluginId) : list;
}

/** "Dirección: A · Reparto: B, C, D" as the TV's title page writes it; the parts TMDB did not answer are left out. */
export function creditsOf(info, S) {
  const i = info && info.found ? info : {};
  const parts = [];
  const directors = Array.isArray(i.directors) ? i.directors.slice(0, 2) : [];
  const cast = Array.isArray(i.cast) ? i.cast.slice(0, 4) : [];
  if (directors.length) parts.push(S.directedBy + ': ' + directors.join(', '));
  if (cast.length) parts.push(S.castLabel + ': ' + cast.join(', '));
  return parts.join(' \u00b7 ');
}

/** "Película · <plugin>": what the title is and which plugin it came from. */
export function kickerOf(card, S) {
  const c = card || {};
  const kind = c.type === 'tv' || c.kind === 'series' ? S.kindSeries : c.type === 'movie' || c.kind === 'movie' ? S.kindMovie : '';
  return [kind, c.pluginName].filter((v) => v).join(' \u00b7 ');
}

const MONTHS = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** "2015-07-05" as "5 jul 2015" (Spanish) or "Jul 5, 2015" (English); anything else is left out. */
export function dateText(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const month = Number(m[2]);
  if (month < 1 || month > 12) return '';
  const day = Number(m[3]);
  const names = MONTHS[lang === 'en' ? 'en' : 'es'];
  return lang === 'en' ? names[month - 1] + ' ' + day + ', ' + m[1] : day + ' ' + names[month - 1] + ' ' + m[1];
}
