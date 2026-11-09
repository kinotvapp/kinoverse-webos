// The left menu, as the Android TV app has it (TvSideRail): a thin strip of icons that opens OVER the content (the content does not move) to show the words.
// `railEntries` decides what is in it (pure, tested); `createRail` draws it. Entries of the TV's other screens (Mis listas, Plugins) are added here as their
// web screens exist. Nothing runs at import time.
import { h } from './dom.js';
import { svgIcon, svgMark } from './icons.js';

/**
 * @param {{S: object, section: string, adults: ({visible: boolean, unlocked: boolean}|null), profile: ({name: string, initial: string, color: string}|null), device?: ('tv'|'desktop'|'phone')}} ctx
 * @returns {{top: object[], bottom: object[]}} entries: {key, icon, label, on?, avatar?}
 */
export function railEntries(ctx) {
  const S = ctx.S;
  const top = [
    { key: 'home', icon: 'home', label: S.home, on: ctx.section === 'home' },
    { key: 'search', icon: 'search', label: S.search, on: ctx.section === 'search' },
  ];
  // The TV's top bar has "Mi biblioteca" (its Favoritos inside); the web keeps every screen in the menu.
  if (ctx.library) top.push({ key: 'library', icon: 'library', label: S.library, on: ctx.section === 'library' });
  // Categorías sits in the TV's rail, before En vivo.
  if (ctx.categories) top.push({ key: 'categories', icon: 'grid', label: S.categories, on: ctx.section === 'categories' });
  if (ctx.liveAvailable) top.push({ key: 'live', icon: 'live', label: S.live, on: ctx.section === 'live' });
  // The TV opens a Stremio collection from its Plugins screen; the web lists them here once the phone says there are some.
  if (ctx.collections) top.push({ key: 'collections', icon: 'plugins', label: S.collections, on: ctx.section === 'collections' });
  const bottom = [];
  if (ctx.adults && ctx.adults.visible) {
    // The word is short so it fits the panel; the closed or open padlock and the spoken label say the state.
    bottom.push({ key: 'adults', icon: ctx.adults.unlocked ? 'lock_open' : 'lock', label: S.adultsEntry, hint: ctx.adults.unlocked ? S.adultsOpen : S.adultsLocked });
  }
  if (ctx.device) bottom.push({ key: 'device', icon: ctx.device, label: S.deviceEntry, hint: S.deviceEntry });
  bottom.push({ key: 'refresh', icon: 'refresh', label: S.refresh });
  bottom.push({ key: 'profile', icon: 'profile', label: ctx.profile && ctx.profile.name ? ctx.profile.name : S.switchProfile, avatar: ctx.profile || null });
  return { top: top, bottom: bottom };
}

/**
 * The rail's element and its controls. `onSelect(key)` is called for an entry ('menu' for the brand, which opens and closes it by touch or mouse).
 * Built like the TV's: one column centred on the screen's edge (the brand, a thin line, the entries); closed it is a strip of round icons, open a floating panel.
 * @returns {{el: HTMLElement, update: function, setOpen: function, rows: function, isOpen: function, firstFocus: function}}
 */
export function createRail(doc, options) {
  const S = options.S;
  const onSelect = options.onSelect;
  const nav = h('nav', { class: 'rail', 'aria-label': S.menu });
  let buttons = [];
  let open = false;
  let activeBtn = null;

  function entryButton(e) {
    const icon = e.avatar
      ? h('span', { class: 'rail-avatar', style: { '--c': e.avatar.color } }, e.avatar.initial)
      : svgIcon(doc, e.icon, 24);
    const b = h('button', { type: 'button', class: 'rail-btn', 'data-key': 'rail:' + e.key, 'aria-label': e.hint || e.label, onclick: () => onSelect(e.key) }, [
      h('span', { class: 'rail-icon' }, [icon]),
      h('span', { class: 'rail-label' }, e.label),
    ]);
    if (e.on) { b.setAttribute('aria-current', 'page'); activeBtn = b; }
    return h('div', { class: 'rail-item' }, [b]);
  }

  function update(ctx) {
    const e = railEntries(ctx);
    activeBtn = null;
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    const brand = h('button', { type: 'button', class: 'rail-brand', 'data-key': 'rail:menu', 'aria-label': S.menu, onclick: () => onSelect('menu') }, [
      h('span', { class: 'rail-mark' }, [svgMark(doc, 40)]),
      h('img', { class: 'rail-wordmark', src: (typeof options.logo === 'function' && options.logo()) || 'logo.svg', alt: S.appName }),
    ]);
    const wraps = e.top.concat(e.bottom).map(entryButton);
    buttons = [brand].concat(wraps.map((w) => w.firstChild));
    const col = h('div', { class: 'rail-col' }, [brand, h('div', { class: 'rail-sepbox' }, [h('div', { class: 'rail-sepline' })])].concat(wraps));
    nav.appendChild(h('div', { class: 'rail-panel' }, [col]));
  }

  return {
    el: nav,
    update: update,
    setOpen(value) {
      open = !!value;
      nav.classList.toggle('open', open);
    },
    isOpen: () => open,
    /** One focus row per entry, so Up and Down walk the menu. */
    rows: () => buttons.map((b) => [b]),
    /** Where the remote lands when it opens: the screen on show, else the first entry after the brand. */
    firstFocus: () => activeBtn || buttons[1] || buttons[0],
  };
}
