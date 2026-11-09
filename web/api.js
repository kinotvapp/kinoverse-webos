// The phone's read API (/__kino/api/v1). Every call sends the pairing token in `x-kino-token` (never in a URL) and, once a
// profile is chosen, its id in `x-kino-profile`. An `{error}` body or a non-2xx answer becomes an ApiError the screens word
// for the person (views.errorText). Plain ES2018: this runs in the LG webOS 6 browser (Chromium 79).

const PREFIX = '/__kino/api/v1';

export class ApiError extends Error {
  constructor(code, message, needsPhone, status, lockedOutMs) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.needsPhone = !!needsPhone;
    this.status = status || 0;
    this.lockedOutMs = typeof lockedOutMs === 'number' ? lockedOutMs : undefined;
  }
}

function query(params) {
  const parts = [];
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === '' || v === false) return;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  return parts.length ? '?' + parts.join('&') : '';
}

function errorOf(body, status) {
  const e = body && typeof body === 'object' ? body.error : null;
  if (e && typeof e === 'object' && typeof e.code === 'string') {
    return new ApiError(e.code, typeof e.message === 'string' ? e.message : '', e.needsPhone === true, status, e.lockedOutMs !== undefined ? e.lockedOutMs : body.lockedOutMs);
  }
  return new ApiError(status === 401 ? 'unauthorized' : 'server', 'HTTP ' + status, false, status);
}

/**
 * @param {{base?: string, token: string, profile?: string|null, fetchImpl?: function}} options
 *   base is '' when the page is served by the phone itself (same origin).
 */
export function createApi(options) {
  const base = String(options.base || '').replace(/\/+$/, '');
  const token = options.token;
  const doFetch = options.fetchImpl || ((u, i) => fetch(u, i));
  let profile = options.profile || null;

  function get(path, params) { return request('GET', path, params, undefined); }

  function post(path, payload) { return request('POST', path, null, payload); }

  async function request(method, path, params, payload) {
    const headers = { 'x-kino-token': token };
    if (profile) headers['x-kino-profile'] = profile;
    const init = { method: method, headers: headers, cache: 'no-store', credentials: 'omit' };
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }
    let res;
    try {
      res = await doFetch(base + PREFIX + path + query(params || {}), init);
    } catch (e) {
      throw new ApiError('network', e && e.message ? e.message : 'network', false, 0);
    }
    let body;
    let parsed = true;
    try { body = await res.json(); } catch (e) { parsed = false; }
    const ok = res.status >= 200 && res.status < 300;
    if (!ok || (parsed && body && typeof body === 'object' && body.error)) throw errorOf(parsed ? body : null, res.status);
    if (!parsed) throw new ApiError('bad_answer', 'not JSON', false, res.status);
    return body;
  }

  return {
    setProfile(id) { profile = id || null; },
    profile() { return profile; },
    profiles: () => get('/profiles'),
    session: () => get('/session'),
    home: (force) => get('/home', { force: force ? 'true' : null }),
    /** Home as the phone composed it from its cache (never asks a plugin); pictures come as the phone's own addresses. */
    homeV2: (device) => get('/home/v2', { device: device, images: 'proxy' }),
    /** Asks the phone to renew its Home cache (it gates this to once a minute); answers at once. */
    homeRefresh: () => post('/home/refresh', {}),
    /** The title's TMDB logo and facts (`ask` is {type, tmdbId|imdbId|title, year}); `cachedOnly` answers from the phone's memory with no request. */
    heroInfo: (ask, cachedOnly) => get('/hero-info', Object.assign({}, ask, { cachedOnly: cachedOnly ? '1' : null, images: 'proxy' })),
    /** Where a title can be watched, as the TV's search-sources screen lists it: the title searched in every plugin, with a tab per plugin (`ask` may add {type, tmdbId}). */
    sources: (title, ask, cursor) => get('/sources', Object.assign({ title: title, images: 'proxy', cursor: cursor }, ask || {})),
    /** Whether the title is one of the profile's favorites (the TV's heart). */
    favorite: (ref) => get('/favorite', { ref: ref }),
    /** Sets the heart; the phone saves it as its own heart does, so it syncs. `card` carries what a favorite is saved from (ref, title, poster...). */
    setFavorite: (card, on) => post('/favorite', Object.assign({}, card, { favorite: !!on })),
    /** The profile's lists, each with whether the title (`ref`) is already in it. */
    lists: (ref) => get('/lists', { ref: ref }),
    listAdd: (listId, card) => post('/lists/add', Object.assign({ listId: listId }, card)),
    listRemove: (listId, ref) => post('/lists/remove', { listId: listId, ref: ref }),
    listCreate: (name, card) => post('/lists/create', Object.assign({ name: name }, card || {})),
    /** En vivo as the TV's live guide: the providers and where to land, the rail of a provider, its channels, the merged search, the star and what is on now. */
    live: () => get('/live', { images: 'proxy' }),
    /** [cacheOnly]: what the phone kept from its last read, with no plugin call when it has something (`fromCache` says so). */
    liveCategories: (provider, cacheOnly) => get('/live/categories', { provider: provider, cache: cacheOnly ? '1' : null }),
    liveChannels: (q) => get('/live/channels', Object.assign({ images: 'proxy' }, q)),
    liveChannel: (liveCode) => get('/live/channel', { liveCode: liveCode, images: 'proxy' }),
    liveSearch: (q) => get('/live/search', { q: q, images: 'proxy' }),
    liveFavorite: (liveCode, on) => post('/live/favorite', { liveCode: liveCode, favorite: !!on }),
    /** Starts a live channel: the phone resolves it and answers a plan like /play (no resume, no duration); end it with end(playId). */
    livePlay: (liveCode, client, preview) => post('/live/play', { liveCode: liveCode, client: client || {}, preview: !!preview }),
    /** The next or previous channel of the list the person entered with, by the app's own zapping rule (narrowed to the provider, wrapping). */
    liveZap: (entry, current, dir) => post('/live/zap', { entry: entry, current: current, dir: dir }),
    liveNow: (codes) => get('/live/now', { codes: codes.join(',') }),
    /** The channel guide: each channel's programmes still to end (at most 40 channels a call). */
    liveGuide: (codes) => get('/live/guide', { codes: codes.join(',') }),
    /** An address on the phone (a picture the phone served), from the page's own origin. */
    url: (path) => base + path,
    title: (ref) => get('/title', { ref: ref }),
    /** "Mi biblioteca": the saved titles in the TV's order, each with the ref its page opens by and what of it was watched. */
    library: () => get('/library', { images: 'proxy' }),
    /** «Favoritos»: the profile's hearts as cards, newest first. */
    favorites: () => get('/favorites', { images: 'proxy' }),
    /** Categorías as the TV lays it out: "Tus plugins", each plugin's own categories, the rows by genre; a tile with a ref opens browse(). */
    categories: () => get('/categories', { images: 'proxy' }),
    /** "Tus colecciones de Stremio": the collections the person added on the phone, each with its lists. */
    stremioCollections: () => get('/stremio/collections'),
    /** One list of a collection as the TV's browser shows it (no type/list: its first); installing stays on the phone. */
    stremioCollection: (id, type, list) => get('/stremio/collection', { id: id, type: type, list: list, images: 'proxy' }),
    plugins: () => get('/plugins', { images: 'proxy' }),
    /** The app theme already resolved for this device (the active theme with the person's adjustments): colours, corners, background, logo. */
    theme: (device) => get('/theme', { device: device }),
    /** A plugin's own screen: the phone runs the plugin and sends its node tree; the web names nodes and kinds, never actions. */
    screenOpen: (body) => post('/screens/open', body),
    /** Long poll: answers `{rev, changed:false}` after ~25 s with nothing new, else `{rev, changed:true, ui, go?}`. */
    screenUi: (id, since) => get('/screens/' + encodeURIComponent(id) + '/ui', { since: since, images: 'proxy' }),
    screenEvent: (id, event) => post('/screens/' + encodeURIComponent(id) + '/event', event),
    /** A plugin's catalog behind "Ver más": {title, cards, next?}; `cursor` asks for the next page. */
    browse: (pluginId, ref, title, cursor) => get('/browse', { pluginId: pluginId, ref: ref, title: title, cursor: cursor, images: 'proxy' }),
    screenClose: (id) => post('/screens/' + encodeURIComponent(id) + '/close', {}),
    /** `extra` carries what the phone needs to save the card: seriesRef (an episode), title, poster, backdrop. */
    play: (ref, client, extra) => post('/play', Object.assign({ ref: ref, client: client || {} }, extra || {})),
    progress: (playId, positionMs, durationMs) => post('/play/progress', { playId: playId, positionMs: positionMs, durationMs: durationMs }),
    end: (playId, state) => post('/play/end', Object.assign({ playId: playId }, state || {})),
    adults: () => get('/adults'),
    adultsUnlock: (code) => post('/adults/unlock', { code: String(code) }),
    adultsLock: () => post('/adults/lock', {}),
  };
}
