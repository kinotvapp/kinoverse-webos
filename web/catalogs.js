// The TV's catalog screens for the web, as pure shaping (no DOM: node tests import this file): "Mi biblioteca" with its
// Favoritos, Categorías and the Stremio collections. The phone already applied the app's rules (the library's order and grouping, the adult lock); this file only
// splits what it sent into the TV's sections and turns it into cards.
import { fmt } from './i18n.js';

/** The library's sections, in the TV's order (Downloads and Music stay on the phone). */
export const LIBRARY_SECTIONS = ['all', 'series', 'movies', 'watched', 'favorites'];

/**
 * The groups of [section] from `GET /library`: everything saved, its series, its movies, or what was watched (most recent first,
 * as the TV's «Vistos»). Favoritos are not library groups: their items come from `GET /favorites`.
 */
export function libraryGroupsOf(groups, section) {
  const all = Array.isArray(groups) ? groups.filter((g) => g && g.title) : [];
  if (section === 'series') return all.filter((g) => g.kind === 'series');
  if (section === 'movies') return all.filter((g) => g.kind === 'movie');
  if (section === 'watched') {
    return all.filter((g) => Number(g.watchedEpisodes) > 0)
      .map((g, i) => ({ g: g, i: i }))
      .sort((a, b) => (Number(b.g.lastWatchedAt) || 0) - (Number(a.g.lastWatchedAt) || 0) || a.i - b.i)
      .map((x) => x.g);
  }
  if (section === 'favorites') return [];
  return all;
}

/** The section tabs with their labels and how many titles each holds; [favorites] is the hearts' count (null while unknown). */
export function librarySectionTabs(groups, favorites, S) {
  const labels = { all: S.libraryAll, series: S.librarySeries, movies: S.libraryMovies, watched: S.libraryWatched, favorites: S.libraryFavorites };
  return LIBRARY_SECTIONS.map((key) => ({
    key: key,
    label: labels[key],
    count: key === 'favorites' ? (Array.isArray(favorites) ? favorites.length : null) : libraryGroupsOf(groups, key).length,
  }));
}

/**
 * A library group as the title page opens it: a card-like object (`ref` for `/title`, `poster` for its picture, `type` for the TMDB
 * logo) and the line under its name (episodes, new ones, what was watched). A group with no ref has no page: its name is searched.
 */
export function libraryCardOf(g, section, S) {
  const c = g || {};
  const series = c.kind === 'series';
  const parts = [];
  if (section === 'watched' && Number(c.watchedEpisodes) > 0 && series) parts.push(fmt(S.libraryWatchedN, { n: c.watchedEpisodes }));
  else if (series && Number(c.episodeCount) > 0) parts.push(fmt(S.episodesN, { n: c.episodeCount }));
  if (Number(c.newEpisodes) > 0) parts.push(fmt(S.libraryNewN, { n: c.newEpisodes }));
  return {
    key: 'lib:' + (c.key || c.itemId || c.title),
    ref: c.ref || '',
    title: c.title || '',
    meta: parts.join(' · '),
    card: {
      ref: c.ref || '',
      title: c.title || '',
      poster: c.thumb || '',
      overview: typeof c.overview === 'string' ? c.overview : '',
      kind: series ? 'series' : c.kind === 'movie' ? 'movie' : '',
      type: series ? 'tv' : c.kind === 'movie' ? 'movie' : undefined,
    },
  };
}

/**
 * The sections of `GET /categories` as drawn: each tile keyed for the remote, a "Tus plugins" tile marked `shelf` (it names a plugin,
 * not a list), any other one carrying the `ref` its plugin's "Ver más" opens. A tile with neither is dropped, and so is an empty section.
 */
export function categorySectionsOf(answer) {
  const sections = answer && Array.isArray(answer.sections) ? answer.sections : [];
  return sections.map((s) => {
    const shelf = s && s.kind === 'plugins';
    const tiles = (s && Array.isArray(s.tiles) ? s.tiles : [])
      .filter((t) => t && t.pluginId && t.title && (shelf || t.ref))
      .map((t) => ({
        key: 'cat:' + s.key + ':' + t.pluginId + ':' + (t.ref || ''),
        pluginId: t.pluginId,
        ref: shelf ? '' : t.ref,
        title: t.title,
        image: typeof t.image === 'string' ? t.image : '',
        pluginName: t.pluginName || '',
        color: t.color || '',
        shelf: shelf,
      }));
    return { key: String(s && s.key), kind: s && s.kind, title: (s && s.title) || '', tiles: tiles };
  }).filter((s) => s.tiles.length);
}

/** A "Tus plugins" tile's page: every list of [pluginId] the other sections hold (its own categories first), each once. */
export function pluginCatalogsOf(sections, pluginId) {
  const seen = {};
  const out = [];
  (sections || []).forEach((s) => s.tiles.forEach((t) => {
    if (t.shelf || t.pluginId !== pluginId || seen[t.ref]) return;
    seen[t.ref] = true;
    out.push(t);
  }));
  return out;
}

/** A collection's addon as its card says it: its logo (else its initials), its name, and Installed / Needs setup / what it is. */
export function collectionCardOf(a, S) {
  const c = a || {};
  const status = c.installed ? S.collectionInstalled : c.needsConfiguration ? S.collectionConfigure : '';
  return {
    key: 'addon:' + (c.id || c.name),
    title: c.name || '',
    image: typeof c.logo === 'string' ? c.logo : '',
    status: status,
    description: typeof c.description === 'string' ? c.description : '',
    installed: !!c.installed,
  };
}
