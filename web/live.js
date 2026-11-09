// En vivo as the TV's live guide draws it (TvLiveGuideScreen): pure shaping of what the phone's /live endpoints answer. No DOM here: node tests import this file.

/** The channel's initials for a logo-less tile: up to two letters of its first words. */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter((w) => /[A-Za-z0-9À-ɏ]/.test(w));
  if (!words.length) return '?';
  const first = Array.from(words[0])[0] || '';
  const second = words.length > 1 ? Array.from(words[1])[0] || '' : '';
  return (first + second).toUpperCase();
}

/** The channel number as the list writes it: nothing when the channel has none. */
export function numberText(ch) {
  const n = Number(ch && ch.number);
  return n > 0 ? String(Math.round(n)) : '';
}

/**
 * The rail rows from the phone's `rail` array: Favoritos, Recientes, genre headers and categories, in order. The gear row ("manage my sources")
 * is the phone's business and is left out. Each row: {type: 'row'|'header', key, label, count?, icon?, gap?, on}.
 */
export function railItemsOf(rail, S, selected) {
  const out = [];
  (Array.isArray(rail) ? rail : []).forEach((e) => {
    if (!e) return;
    if (e.kind === 'favorites') out.push({ type: 'row', key: '__favoritos__', label: S.favorites, icon: 'star', on: selected === '__favoritos__' });
    else if (e.kind === 'recents') out.push({ type: 'row', key: '__recientes__', label: S.liveRecents, icon: 'history', on: selected === '__recientes__' });
    else if (e.kind === 'header') out.push({ type: 'header', label: e.label || '' });
    else if (e.kind === 'category') out.push({ type: 'row', key: String(e.id), label: e.name || '', count: typeof e.count === 'number' ? e.count : null, gap: !!e.headerGap, on: selected === String(e.id) });
  });
  return out;
}

/** Whether a list shows several providers at once (then every row carries its provider's badge). */
export function isMixed(category, searching) {
  return !!searching || category === '__favoritos__' || category === '__recientes__';
}

/** The line under the channel's name in the panel: "Provider · Canal 725", or only the provider when there is no number. */
export function metaLineOf(ch, providerName, S) {
  const n = numberText(ch);
  const prov = providerName || (ch && ch.provider) || '';
  return n ? prov + ' · ' + S.liveChannelN.replace('{n}', n) : prov;
}

/** The hint under the panel, as the TV's action line writes it. */
export function actionLineOf(zone, ch, S) {
  if (zone === 'mini') return S.liveWatchFull;
  if (zone === 'list' && ch) return S.liveWatchChannel.replace('{name}', ch.name || '');
  return '';
}

/** The provider of a channel from the providers list ({id, name, color}); an unknown one keeps its id. */
export function providerOf(providers, id) {
  const list = Array.isArray(providers) ? providers : [];
  return list.find((p) => p && p.id === id) || { id: id, name: id || '', color: '#9A9AA6' };
}

/** The channels merged by live code, the first one winning (pages never repeat a channel). */
export function mergeChannels(have, more) {
  const seen = {};
  const out = [];
  (Array.isArray(have) ? have : []).concat(Array.isArray(more) ? more : []).forEach((c) => {
    if (!c || !c.liveCode || seen[c.liveCode]) return;
    seen[c.liveCode] = true;
    out.push(c);
  });
  return out;
}

/** The channel card's programme lines as the TV writes them: "Ahora: ..." and "Despu\u00e9s: ..."; either is left out when the guide does not know it. */
export function nowLinesOf(now, S) {
  const n = now && typeof now === 'object' ? now : null;
  if (!n || !n.title) return [];
  const out = [S.liveNowLine.replace('{t}', n.title)];
  if (n.next && n.next.title) out.push(S.liveNextLine.replace('{t}', n.next.title));
  return out;
}

/** The index to land on after a zap in a list the phone answered with: the channel's own place, else the first. */
export function indexOfCode(list, code) {
  const i = (Array.isArray(list) ? list : []).indexOf(code);
  return i >= 0 ? i : 0;
}

/** A name without accents or case, so "camara" finds "C\u00e1mara" (the TV's plugins modal does the same). */
export function foldName(text) {
  return String(text == null ? '' : text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** The plugins whose name contains the query (accents and case ignored); a blank query keeps them all, in their order. */
export function pluginsMatching(plugins, query) {
  const q = foldName(query);
  const list = Array.isArray(plugins) ? plugins : [];
  return q ? list.filter((p) => foldName(p && p.name).indexOf(q) >= 0) : list.slice();
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

/** "21:05": the hour of [sec] (Unix seconds) on this device's clock, as the TV's guide writes it. */
export function clockText(sec) {
  const d = new Date(Number(sec) * 1000);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/**
 * One channel's line of the channel guide, from `GET /live/guide`: its programmes still to end at [nowSec], in order, the one on
 * now marked, each with its hours ("21:00 – 22:30"); at most [max]. Anything without a title or with no time is left out.
 */
export function guideRowOf(programs, nowSec, max) {
  const list = (Array.isArray(programs) ? programs : [])
    .filter((p) => p && p.title && Number(p.end) > Number(nowSec) && Number(p.end) > Number(p.start))
    .slice()
    .sort((a, b) => Number(a.start) - Number(b.start));
  return list.slice(0, max > 0 ? max : list.length).map((p) => ({
    title: String(p.title),
    start: Number(p.start),
    end: Number(p.end),
    now: Number(p.start) <= Number(nowSec),
    hours: clockText(p.start) + ' – ' + clockText(p.end),
  }));
}
