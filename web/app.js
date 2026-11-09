// The thin UI the phone serves at `/`: profile picker, Home, search and a title page, driven by the phone's read API.
// Screens are plain DOM built with h() (text nodes only); the remote moves focus through each screen's rows (FocusGrid),
// Enter presses the focused button and Back goes up one screen. Nothing runs at import time, so node tests can import it.
import { createApi } from './api.js';
import { fmt, langOf, strings } from './i18n.js';
import { cardOf, continueCardOf, episodeLabel, errorText, heroOf, profileOf, rowsOf } from './views.js';
import { FocusGrid, rowsByTop } from './focus.js';
import { actionOf, digitOf } from './keys.js';
import { svgIcon } from './icons.js';
import { DIM_MAX, autoplay, primePlay, clientOf, clockOf, createReporter, dimStep, isWebOs, progressOf, tsAudioLabelOf, zoomStep, defaultSubtitle, mediaUrlFor, nextSubtitle, parseSubtitles, seekTarget, shiftCues, sizeNext, SUB_SIZES, startInVideo, subtitleLabels, subtitleTracks, syncNext, titleMs } from './player.js';
import { attachHls, loadHls } from './hlsplay.js';
import { attachShaka, loadShaka, needsShaka, probeEme, shakaConfigOf } from './shakaplay.js';
import { createScreenView } from './screen.js';
import { sizedSrc } from './imgsize.js';
import { HEALTH_EVERY_MS, HEALTH_TIMEOUT_MS, nextHealth, probe } from './health.js';
import { THEME_VARS, inkWordmarkUrl, logoDataUrl, themeVars } from './theme.js';
import { adultsView, keypadNext, lockedOutMinutes } from './adults.js';
import { createRail } from './rail.js';
import { actionLineOf, foldName, guideRowOf, indexOfCode, pluginsMatching, initialsOf, isMixed, mergeChannels, metaLineOf, nowLinesOf, numberText, providerOf, railItemsOf } from './live.js';
import { createImageQueue } from './imgqueue.js';
import { askOf, cardMetrics, creditsOf, titleCardOf, factsOf, dateText, homeModelOf, kickerOf, sourceCardsOf, withBase } from './homev2.js';
import { LIBRARY_SECTIONS, categorySectionsOf, collectionCardOf, libraryCardOf, libraryGroupsOf, librarySectionTabs, pluginCatalogsOf } from './catalogs.js';
import { DEVICES, deviceEnvOf, detectDevice, readDevicePref, resolveDevice, saveDevicePref } from './device.js';
import { clear, h } from './dom.js';
import { CODE_SERVICE, isPairCode, pairTargetOf, forgetProfile as dropStoredProfile, forgetToken as dropStoredToken, loadProfile, saveProfile, takeToken, phoneBase, phonePageInstead, localNetworkAsk } from './token.js';

const HINT_MS = 5000; // hosted mode: after this long without an answer, explain the browser's permission
const ASK_MS = 500; // Chrome on kinoverse.app: after this long without an answer, point at its local-network question
const POLL_MS = 3000; // Home answers `settled: false` while plugins are still loading: ask again, cheaply
const POLL_MAX = 10;
const HERO_ASK_MS = 250; // the TV rests on a card this long before TMDB is asked (HERO_ASK_DELAY_MS)
const HERO_TEXT_WAIT_MS = 2500; // the name waits this long for a logo (HERO_TEXT_DELAY_MS)

/** localStorage (the device choice outlives the tab), or null where reading the property itself throws. */
function localStorageOf(win) {
  try { return win.localStorage || null; } catch (e) { return null; }
}

/** sessionStorage, or null where reading the property itself throws (storage blocked). */
function storageOf(win) {
  try { return win.sessionStorage || null; } catch (e) { return null; }
}

export function startApp(win) {
  const doc = win.document;
  const mount = doc.getElementById('app');
  const grid = new FocusGrid();
  const lang = langOf(win.navigator.language);
  let S = strings(lang);
  let api = null;
  let current = null; // { el, rows(), back(), last }
  let profile = null; // the chosen profile as drawn (profileOf)
  let homeScreen = null;
  let searchScreen = null;
  let liveScreen = null;
  let generation = 0; // bumps on every profile choice: answers for an older choice must not paint
  let hasCollections = false; // the phone keeps some Stremio collection: the menu lists them
  let adultsState = null; // GET /adults for the chosen profile: { hasCode, unlocked, canUnlockHere }
  let shell = null; // { el, content }: the menu and the place screens go, once a profile is chosen
  let rail = null;
  let railOpen = false;
  let railFrom = null; // what had focus when the menu opened, to give it back when it closes
  let section = 'home'; // which entry of the menu is on screen
  const detectedDevice = detectDevice(deviceEnvOf(win)); // the browser's guess: a TV, a desktop or a phone
  let devicePref = readDevicePref(localStorageOf(win)); // the person's own choice: 'auto' or one of DEVICES
  const deviceNow = () => resolveDevice(detectedDevice, devicePref);

  // Touch or keys: the page moves the focus by itself (the remote's model), and on a touch screen that focus is no choice of the
  // person's, so it shows no zoom there; a finger's press does. A key press (a keyboard, a remote) brings the focus effect back.
  (function trackInput() {
    const root = doc.documentElement;
    if (!root || !root.classList || !win.addEventListener) return;
    root.classList.toggle('touch', deviceNow() === 'phone');
    win.addEventListener('keydown', () => root.classList.remove('touch'), true);
    win.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'touch') root.classList.add('touch'); }, true);
  })();

  // ------------------------------------------------------------------ the app theme (the phone's active theme, as the app paints it)

  /** The person's Home card look ({style: cards|posters, size}) as the last Home answer said: a plugin's titles take it too. */
  let homeLook = { style: 'cards', size: 'medium' };
  /** A plugin screen's posters, one size up from what it asks (owner, 2026-11-07: they read too small beside the Home's). */
  const POSTER_STEP_UP = { small: 'medium', medium: 'large', large: 'xlarge' };

  let themeRev = null;
  let themeLogo = null; // {wordmark, mark}: data addresses of the theme's own logo, null for Kino's

  /** Kino's logo or the theme's: the long wordmark for headers and the open menu. */
  function logoSrc() { return (themeLogo && themeLogo.wordmark) || 'logo.svg'; }

  /** Puts the theme's logo in every logo already on screen (the menu, a message screen). */
  function refreshLogos() {
    if (typeof doc.querySelectorAll !== 'function') return;
    Array.prototype.forEach.call(doc.querySelectorAll('img.logo-img, img.rail-wordmark'), (img) => { if (img.getAttribute('src') !== logoSrc()) img.setAttribute('src', logoSrc()); });
  }

  /** The app theme's text, secondary text and focus colours as painted now (a plugin's palette keeps them when they read on it). */
  function appColors() {
    const root = doc.documentElement;
    if (!root || !win.getComputedStyle) return {};
    const cs = win.getComputedStyle(root);
    const v = (n) => (cs.getPropertyValue(n) || '').trim();
    return { text: v('--text'), muted: v('--muted'), ring: v('--ring') };
  }

  /** Paints a theme answer: every variable a previous theme set goes first, then this one's (a value it does not give keeps Kino's). */
  function applyTheme(t) {
    const rootStyle = doc.documentElement && doc.documentElement.style;
    if (!rootStyle || typeof rootStyle.setProperty !== 'function') return;
    THEME_VARS.forEach((name) => rootStyle.removeProperty(name));
    const vars = themeVars(t);
    Object.keys(vars).forEach((name) => rootStyle.setProperty(name, vars[name]));
    const logo = t && t.logo ? t.logo : null;
    const ink = t && t.lightPage && t.colors ? inkWordmarkUrl(t.colors.textPrimary) : null;
    const own = logo ? logoDataUrl(logo.wordmark) : null;
    themeLogo = own || ink || (logo && logoDataUrl(logo.mark)) ? { wordmark: own || ink, mark: logo ? logoDataUrl(logo.mark) : null } : null;
    refreshLogos();
  }

  /** Asks the phone for its theme and repaints when it changed; an older phone without themes leaves Kino's look. */
  async function loadTheme() {
    let t;
    try { t = await api.theme(deviceNow() === 'phone' ? 'phone' : 'tv'); } catch (e) { return; }
    if (!t || (t.rev && t.rev === themeRev)) return;
    themeRev = t.rev || null;
    applyTheme(t);
  }

  // ------------------------------------------------------------------ screen plumbing

  /** The phone serves pictures slowly and a browser opens six connections to it: pictures still loading on a screen that is left would hold the player's own request in line. They stop, and start again when the screen comes back. */
  function dropPendingImages(root) {
    Array.prototype.slice.call(root.querySelectorAll('img')).forEach((img) => {
      if (img.complete || !img.getAttribute('src')) return;
      if (!img._src) img._src = img.getAttribute('src');
      img.removeAttribute('src');
    });
  }

  function restoreImages(screen) {
    if (screen.acquire) { screen.acquire(); return; }
    Array.prototype.slice.call(screen.el.querySelectorAll('img')).forEach((img) => { if (img._src && !img.getAttribute('src')) img.setAttribute('src', img._src); });
  }

  function show(screen) {
    if (current && current !== screen) {
      if (current.release) current.release();
      dropPendingImages(current.el);
    }
    if (screen !== current) restoreImages(screen);
    if (current && current !== screen && current.el.contains(doc.activeElement)) current.last = doc.activeElement;
    current = screen;
    if (screen.section && screen.section !== section) { section = screen.section; updateRail(); }
    if (railOpen) { railOpen = false; if (rail) rail.setOpen(false); }
    if (shell) shell.el.classList.toggle('no-rail', !!screen.noRail);
    addPhoneBack(screen);
    clear(shell ? shell.content : mount).appendChild(screen.el);
    if (screen.start) screen.start();
    refocus();
  }

  // ------------------------------------------------------------------ the menu (the TV's side rail)

  function leaveShell() {
    if (!shell) return;
    shell = null; rail = null; railOpen = false;
    clear(mount);
  }

  function enterShell() {
    rail = createRail(doc, { S: S, onSelect: railSelect, logo: logoSrc }); // the theme's logo also when the menu redraws
    const content = h('div', { class: 'content' });
    content.addEventListener('click', () => { if (railOpen) closeRail(false); });
    shell = { el: h('div', { class: 'shell' }, [rail.el, content]), content: content };
    clear(mount).appendChild(shell.el);
    refreshLogos();
    updateRail();
  }

  function updateRail() {
    if (rail) rail.update({ S: S, section: section, adults: adultsView(adultsState), profile: profile, device: deviceNow(), liveAvailable: true, library: true, categories: true, collections: hasCollections });
    if (rail && railOpen) rail.setOpen(true);
  }

  /**
   * A phone's or tablet's top bar, as the Kino app's: the menu, the logo and search on the left (the apps button stays on the right).
   * The stylesheet shows it on narrow screens only; a TV and a desktop keep the side menu.
   */
  function phoneBar() {
    const bar = h('div', { class: 'phone-bar' }, [
      h('button', { type: 'button', class: 'phone-btn', 'aria-label': S.menu, onclick: (ev) => { ev.stopPropagation(); if (railOpen) closeRail(false); else openRail(); } }, [svgIcon(doc, 'menu', 26)]),
      h('img', { class: 'logo-img phone-logo', src: logoSrc(), alt: S.appName }),
      h('button', { type: 'button', class: 'phone-btn', 'aria-label': S.search, onclick: () => railSelect('search') }, [svgIcon(doc, 'search', 24)]),
    ]);
    return bar;
  }

  /**
   * A phone's or tablet's back arrow at the top of a screen that can go back, as the Kino app's top bar: the screen's own Back button
   * sits at the end of a long list there. The stylesheet shows it on narrow screens only; screens whose Back is already at the top
   * keep theirs.
   */
  function addPhoneBack(screen) {
    const el = screen.el;
    if (!shell || !screen.back || screen.phoneBack || typeof el.insertBefore !== 'function' || typeof el.querySelector !== 'function') return;
    const cls = ' ' + (el.getAttribute ? el.getAttribute('class') || '' : '') + ' ';
    if (cls.indexOf(' home ') >= 0 || cls.indexOf(' plugin-screen ') >= 0 || el.querySelector('.title-back, .player-back, .lv-back')) return;
    screen.phoneBack = h('button', { type: 'button', class: 'phone-btn phone-back', 'aria-label': S.back, onclick: () => screen.back() }, [svgIcon(doc, 'arrow_back', 24)]);
    el.setAttribute('class', cls.trim() + ' has-phone-back');
    el.insertBefore(screen.phoneBack, el.firstChild);
  }

  // A tap outside the open menu closes it (a phone has no Back key on the page).
  doc.addEventListener('click', (ev) => {
    // The menu's own backdrop (a phone's dimmed, blurred page behind it) is the rail element itself: a tap there closes it too.
    if (railOpen && rail && rail.el && (ev.target === rail.el || !rail.el.contains(ev.target))) closeRail(false);
  });

  function openRail() {
    if (!rail || railOpen || (current && current.noRail)) return;
    railFrom = doc.activeElement;
    railOpen = true;
    rail.setOpen(true);
    grid.setRows(rail.rows());
    grid.focus(rail.firstFocus());
  }

  /** Closes the menu; with [restore] the remote goes back to where it was. */
  function closeRail(restore) {
    if (!railOpen) return;
    railOpen = false;
    rail.setOpen(false);
    if (!current) return;
    grid.setRows(current.rows());
    if (restore && railFrom && grid.position(railFrom)) grid.focus(railFrom);
    else if (restore) grid.focusFirst();
  }

  function railSelect(key) {
    if (key === 'menu') { if (railOpen) closeRail(true); else openRail(); return; }
    closeRail(false);
    if (key === 'home') show(homeScreen);
    else if (key === 'search') openSearch();
    else if (key === 'live') show(liveScreen);
    else if (key === 'library') openLibrary('all');
    else if (key === 'categories') openCategories();
    else if (key === 'collections') openCollections();
    else if (key === 'adults') openAdults();
    else if (key === 'device') openDevice();
    else if (key === 'refresh') { show(homeScreen); homeScreen.load(true); }
    else if (key === 'profile') { forgetProfile(); showProfiles(); }
  }

  function refocus() {
    if (!current) return;
    grid.setRows(current.rows());
    if (current.last && grid.position(current.last)) grid.focus(current.last);
    else grid.focusFirst();
  }

  /** Repaints the current screen's rows keeping focus on the element with the same data-key, when there still is one. */
  function repaint(keyBefore) {
    if (!current) return;
    const key = keyBefore !== undefined ? keyBefore : focusedKey();
    grid.setRows(current.rows());
    const same = key ? findKey(current.el, key) : null;
    if (same) grid.focus(same);
    else if (!current.el.contains(doc.activeElement)) grid.focusFirst();
  }

  /** The data-key of the focused element: read it BEFORE a repaint removes that element. */
  function focusedKey() {
    const active = doc.activeElement;
    return active && active.getAttribute ? active.getAttribute('data-key') : null;
  }

  function findKey(root, key) {
    const all = root.querySelectorAll('[data-key]');
    for (let i = 0; i < all.length; i++) if (all[i].getAttribute('data-key') === key) return all[i];
    return null;
  }

  /** [src] asked at the width its box takes on this screen ([sizedSrc]): [cssPx] CSS pixels, or the whole screen's width. */
  function sized(src, cssPx) { return sizedSrc(src, cssPx || win.innerWidth || 1920, win.devicePixelRatio || 1); }

  function svgPlay() { return svgIcon(doc, 'play', 28); }

  function button(label, onPress, extra) {
    return h('button', Object.assign({ type: 'button', class: 'btn', onclick: onPress }, extra || {}), label);
  }

  /** The picture of a card; the letter placeholder sits under a real picture and shows when the picture fails to load. */
  function art(a, wide, title, scheduled) {
    const letter = a.type === 'letter' ? a.letter : cardOf({ title: title }).art.letter;
    const children = [h('span', null, letter)];
    if (a.type !== 'letter') {
      // A Home card is about 284 CSS px wide (landscape) or 200 (poster) at 1920: what the picture is asked at, times the density.
      a = Object.assign({}, a, { src: sized(a.src, wide ? 300 : 200) });
      // `scheduled` ({queue, pos}): the picture waits its turn in the Home's queue (nearest to the focus first) instead of loading at once.
      const img = h('img', Object.assign({ alt: '', referrerpolicy: 'no-referrer', onerror: () => { img.style.visibility = 'hidden'; } }, scheduled ? {} : { src: a.src, loading: 'lazy' }));
      if (scheduled) { img._pos = scheduled.pos; img._src = a.src; scheduled.queue.add(img, a.src); }
      children.push(img);
    }
    return h('div', { class: 'art art-letter' + (wide ? ' wide' : '') }, children);
  }

  // ------------------------------------------------------------------ messages (pairing, errors, loading)

  function messageScreen(title, body, detail, actions, back) {
    const btns = actions || [];
    const el = h('main', { class: 'screen message' }, [
      h('h1', { class: 'logo' }, [h('img', { class: 'logo-img', src: logoSrc(), alt: S.appName })]),
      h('h2', null, title),
      body ? h('p', null, body) : null,
      detail ? h('p', { class: 'detail' }, detail) : null,
      btns.length ? h('div', { class: 'actions' }, btns) : null,
    ]);
    return { el: el, rows: () => [btns], back: back || (() => {}) };
  }

  function showLoading() {
    const screen = messageScreen(S.loading, null, null, [], null);
    show(screen);
    // Hosted mode: while the browser waits for the person to answer its local-network permission the page just hangs; say what is going on.
    if (lnaAsk) {
      // A moment's wait first: when the phone answers at once (the permission was given before) the pointer never flashes.
      win.setTimeout(() => {
        if (!screen.el.parentNode) return;
        // Only while Chrome is asking: given before, nothing to answer; refused before, the phone's error screen says how to undo it.
        localNetworkState().then((state) => {
          if ((state === 'prompt' || state === 'unknown') && screen.el.parentNode) {
            placePointer(screen.el, lnaAsk === 'arrow' ? S.localNetworkArrow : S.localNetworkPhone);
          }
        });
      }, ASK_MS);
    } else if (hostedBase) {
      win.setTimeout(() => {
        if (screen.el.parentNode) screen.el.appendChild(h('p', { class: 'note' }, S.localNetworkHint));
      }, HINT_MS);
    }
  }

  /** Hosted mode only: the phone's own page, which always works (same origin, no browser permission). */
  function openOnPhone() {
    win.location.href = hostedBase + '/' + (token ? '?t=' + encodeURIComponent(token) : '');
  }

  /**
   * For whoever lands here with no code yet (owner, 2026-11-09): get the app (a QR to the download), open ⋮ → Send to the TV, turn on the
   * proxy and copy the 5 numbers. The screenshots are the phone's, in Kino's own dark theme, in the page's language.
   */
  function pairSteps() {
    const en = lang === 'en' ? '-en' : '';
    const step = (n, title, body, img) => h('li', { class: 'pair-step' }, [
      h('div', { class: 'pair-step-head' }, [h('span', { class: 'pair-step-num' }, String(n)), h('h4', null, title)]),
      h('p', null, body),
      img,
    ]);
    return h('section', { class: 'pair-steps' }, [
      h('h3', null, S.pairStepsTitle),
      h('ol', { class: 'pair-grid' }, [
        step(1, S.pairStep1Title, S.pairStep1Body, h('img', { class: 'pair-shot pair-qr', src: 'pair-qr.svg', alt: S.pairStep1Alt })),
        step(2, S.pairStep2Title, S.pairStep2Body, h('img', { class: 'pair-shot', src: 'pair-menu' + en + '.webp', alt: S.pairStep2Alt })),
        step(3, S.pairStep3Title, S.pairStep3Body, h('img', { class: 'pair-shot', src: 'pair-code' + en + '.webp', alt: S.pairStep3Alt })),
      ]),
      h('p', { class: 'pair-wifi' }, S.pairSameWifi),
    ]);
  }

  /**
   * Chrome asks once whether this page may reach the home network; until the person answers, the phone's first answer just waits.
   * A computer gets an arrow at the address bar, where the question hangs; a phone gets the words alone.
   */
  function localNetworkPointer(kind, text) {
    return h('div', { class: 'lna-hint lna-kind-' + kind, role: 'status' }, [
      kind === 'arrow' ? h('img', { class: 'lna-arrow', src: 'lna-arrow.svg', alt: '' }) : null,
      h('p', { class: 'lna-text' }, text),
    ]);
  }

  /** The arrow goes first on the screen, under the address bar it points at, and pushes the rest down; the words alone go last. */
  function placePointer(el, text) {
    const pointer = localNetworkPointer(lnaAsk, text);
    if (lnaAsk === 'arrow') el.insertBefore(pointer, el.firstChild); else el.appendChild(pointer);
  }

  /** Chrome's local-network permission: 'granted', 'denied', 'prompt' (it will ask), or 'unknown' (a Chrome that cannot tell). */
  function localNetworkState() {
    try {
      return win.navigator.permissions.query({ name: 'local-network-access' }).then((s) => s.state, () => 'unknown');
    } catch (e) { return Promise.resolve('unknown'); }
  }

  /**
   * No long code yet: the person types the 5 numbers the phone shows. The code service answers the phone's address with its long code, and
   * the page goes there (served by the phone) or reloads itself with the phone's address in `p` (hosted on a site of its own).
   */
  function showPair(reason) {
    leaveShell();
    const input = h('input', { class: 'pair-input', type: 'tel', inputmode: 'numeric', maxlength: '6', autocomplete: 'off', 'aria-label': S.pairCodeLabel, placeholder: '12345', 'data-key': 'pair:code' });
    const note = h('p', { class: 'pair-note' }, '');
    const go = button(S.pairCodeGo, submit, { 'data-key': 'pair:go' });
    const form = h('form', { class: 'pair-form', onsubmit: (ev) => { ev.preventDefault(); submit(); } }, [input]);
    const el = h('main', { class: 'screen message pair' }, [
      h('h1', { class: 'logo' }, [h('img', { class: 'logo-img', src: logoSrc(), alt: S.appName })]),
      // The code first (owner, 2026-11-07): the title asks for it, the field and Conectar follow, and where to find it comes last,
      // for whoever does not have it yet.
      h('h2', null, S.pairCodeTitle),
      reason ? h('p', { class: 'notice' }, reason) : null,
      h('label', { class: 'pair-label' }, S.pairCodeLabel),
      form,
      h('div', { class: 'actions' }, [go]),
      note,
      pairSteps(),
    ]);
    let busy = false;
    async function submit() {
      const code = String(input.value || '').replace(/\s+/g, '');
      if (busy) return;
      if (!isPairCode(code)) { note.textContent = S.pairCodeBad; return; }
      busy = true;
      note.textContent = S.pairCodeChecking;
      let target = null;
      try {
        const res = await win.fetch(CODE_SERVICE + code, { cache: 'no-store', credentials: 'omit' });
        const body = res.ok ? await res.json() : null;
        target = body && body.url ? pairTargetOf(body.url, win.location.href) : null;
      } catch (e) { target = null; }
      busy = false;
      if (!target) { note.textContent = S.pairCodeBad; return; }
      win.location.replace(target);
    }
    show({ el: el, rows: () => [[input], [go]], back: () => {} });
    win.setTimeout(() => { try { input.focus(); } catch (e) { /* the remote focuses it */ } }, 0);
  }

  /** Words an API error for the person. Pairing and profile problems go to their screens; anything else offers a retry. */
  function fail(err, retry, back) {
    const code = err && err.code;
    if (code === 'unauthorized') { forgetToken(); showPair(); return; }
    if (code === 'profile_unknown' || code === 'profile_required') { forgetProfile(); showProfiles(errorText(err, S)); return; }
    if (hostedBase && code === 'network') {
      const denied = [button(S.retry, retry), button(S.openOnPhone, openOnPhone)];
      const screen = messageScreen(S.localNetworkDenied, null, null, denied, back);
      // Refused in Chrome: the arrow points at the icon left of the address, where the permission is given back.
      if (lnaAsk) placePointer(screen.el, S.localNetworkUnblock);
      show(screen);
      return;
    }
    const detail = err && err.needsPhone && err.message ? err.message : null;
    const actions = [button(S.retry, retry)];
    if (back) actions.push(button(S.back, back));
    show(messageScreen(errorText(err, S), null, detail, actions, back));
  }

  // ------------------------------------------------------------------ token and profile memory (token.js)

  const storage = storageOf(win);
  const hostedBase = phoneBase(win.location); // '' when the phone itself served this page
  const lnaAsk = localNetworkAsk(win.location.href, hostedBase, win.navigator); // 'arrow' | 'text' | null: Chrome's local-network question
  let token = null; // kept here too: with storage blocked, a retry must not lose the token the address gave
  function forgetToken() { token = null; dropStoredToken(storage); api = null; }
  function forgetProfile() { profile = null; dropStoredProfile(storage); if (api) api.setProfile(null); }

  // ------------------------------------------------------------------ profiles

  async function showProfiles(notice) {
    const mine = ++generation;
    leaveShell();
    showLoading();
    let list;
    try {
      const answer = await api.profiles();
      list = Array.isArray(answer && answer.profiles) ? answer.profiles : [];
    } catch (e) {
      if (mine === generation) fail(e, () => showProfiles(notice));
      return;
    }
    if (mine !== generation) return;
    // A reload keeps the profile chosen in this tab, as long as the phone still has it.
    const remembered = loadProfile(storage);
    if (remembered) {
      const known = list.filter((p) => p && p.id === remembered)[0];
      if (known) { enterProfile(profileOf(known)); return; }
      dropStoredProfile(storage);
    }
    const tiles = list.map((p) => {
      const v = profileOf(p);
      return h('button', { type: 'button', class: 'profile', 'data-key': 'profile:' + v.id, onclick: () => enterProfile(v) }, [
        h('span', { class: 'avatar', style: { '--c': v.color } }, v.initial),
        h('span', { class: 'profile-name' }, v.name),
      ]);
    });
    const el = h('main', { class: 'screen profiles' }, [
      h('h1', { class: 'logo' }, [h('img', { class: 'logo-img', src: logoSrc(), alt: S.appName })]),
      h('h2', null, list.length ? S.whoIsWatching : S.noProfiles),
      notice ? h('p', { class: 'notice' }, notice) : null,
      h('div', { class: 'profile-grid' }, tiles),
    ]);
    show({ el: el, rows: () => rowsByTop(tiles), back: () => {} });
  }

  function enterProfile(v) {
    generation++;
    profile = v;
    saveProfile(storage, v.id);
    api.setProfile(v.id);
    adultsState = null;
    hasCollections = false;
    section = 'home';
    homeScreen = createHome();
    searchScreen = createSearch();
    liveScreen = createLive();
    leaveShell();
    enterShell();
    show(homeScreen);
    homeScreen.load(false);
    refreshAdults();
    refreshCollections();
  }

  // ------------------------------------------------------------------ cards

  /**
   * A focusable element that acts like a button but is NOT a <button>: Chromium 79 (the LG's browser) shrinks a button's contents to the width of
   * their text, so a card's cover came out as narrow as its title. A div with role and tabindex lays out like any block; Enter and Space press it.
   */
  function pressable(props, children, onPress) {
    const el = h('div', Object.assign({ role: 'button', tabindex: '0', onclick: onPress }, props), children);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPress(ev); } });
    return el;
  }

  function cardButton(c, key, onPress, wide) {
    const children = [art(c.art, wide, c.title), h('span', { class: 'card-title' }, c.title)];
    if (c.meta) children.push(h('span', { class: 'card-meta' }, c.meta));
    if (c.progress !== undefined) children.push(h('span', { class: 'progress' }, h('span', { style: { width: Math.round(c.progress * 100) + '%' } })));
    return pressable({ class: 'card' + (wide ? ' card-wide' : ''), 'data-key': key }, children, onPress);
  }

  // ------------------------------------------------------------------ home

  function createHome() {
    const mine = generation;
    const rowsEl = h('div', { class: 'home-rows' });
    const hero = createHomeHero();
    let cardRows = [];
    let sectionEls = [];
    let polls = 0;
    let pollTimer = null;
    let loads = 0;
    let focusTimer = null;
    let heroSeq = 0;
    // The phone serves six pictures at a time: card pictures load four at a time, nearest to the focus first, so the hero's own picture and logo never wait behind them.
    const focusPos = { r: 0, c: 0 };
    const imgQueue = createImageQueue(4, (img) => {
      const p = img._pos || { r: 0, c: 0 };
      return Math.abs(p.r - focusPos.r) * 40 + Math.abs(p.c - focusPos.c);
    });
    const infoCache = {}; // JSON(ask) -> /hero-info answer, so a card seen before shows its logo at once

    // The TV's red Apps button, top right: it opens the person's plugins in a modal. Hidden while the phone lists none.
    const appsBtn = h('button', { type: 'button', class: 'home-apps', 'data-key': 'home:apps', 'aria-label': S.pluginsTitle, onclick: () => openPluginsModal() }, [svgIcon(doc, 'apps', 26)]);
    appsBtn.style.display = 'none';
    async function refreshLauncher() {
      let listed = [];
      try { const r = await api.plugins(); listed = (r && r.plugins) || []; } catch (e) { listed = []; }
      appsBtn.style.display = listed.length ? '' : 'none';
    }
    refreshLauncher();

    const screen = {
      el: h('main', { class: 'screen home' }, [hero.el, rowsEl, phoneBar(), appsBtn]),
      section: 'home',
      rows: () => cardRows,
      // Up from the first row reaches the corner's button, and Down from it comes back (the TV's "up exits to the corner").
      onKey: (action) => {
        const a = doc.activeElement;
        if (a === appsBtn) { if (action === 'down') { grid.focusFirst(); return true; } return action === 'up' || action === 'left' || action === 'right'; }
        if (action === 'up' && appsBtn.style.display !== 'none' && cardRows.length && cardRows[0].indexOf(a) >= 0) { appsBtn.focus(); return true; }
        return false;
      },
      back: () => { forgetProfile(); showProfiles(); },
      load: load,
      paintAdults: paintAdults,
      // Leaving Home: the pictures not started yet are dropped; coming back they queue again, nearest to the focus first.
      release: () => imgQueue.clear(),
      acquire: () => { Array.prototype.slice.call(rowsEl.querySelectorAll('img')).forEach((img) => { if (img._src && !img.getAttribute('src')) imgQueue.add(img, img._src); }); },
    };

    /** The menu's lock entry follows what the phone said; hidden when it has not answered. */
    function paintAdults() {
      updateRail();
    }

    /** The phone composes Home in the TV's order for a TV or a desktop and in its own for a phone; the person can correct what this page thinks it is. */
    const deviceParam = () => (deviceNow() === 'phone' ? 'phone' : 'tv');

    async function load(force) {
      const call = ++loads;
      loadTheme();
      if (pollTimer) { win.clearTimeout(pollTimer); pollTimer = null; }
      if (force) { polls = 0; try { await api.homeRefresh(); } catch (e) { /* the phone keeps its cache; read it as it is */ } }
      if (!cardRows.length) { clear(rowsEl).appendChild(h('p', { class: 'note' }, S.loading)); }
      let v2;
      try {
        v2 = await api.homeV2(deviceParam());
      } catch (e) {
        if (mine !== generation || call !== loads || current !== screen) return;
        fail(e, () => { show(screen); load(force); }, () => { forgetProfile(); showProfiles(); });
        return;
      }
      if (mine !== generation || call !== loads) return;
      const model = homeModelOf(withBase(v2, api.url('')), S);
      const firstPaint = !cardRows.length;
      const key = focusedKey();
      render(model);
      if (current === screen) {
        repaint(key);
        // On the first answer the remote lands on the first card; the hero then follows the focus.
        if (firstPaint && !current.el.contains(doc.activeElement)) grid.focusFirst();
      }
      // The phone is still asking its plugins (or has none cached yet): read its cache again in a moment.
      if ((model.refreshing || model.pending.length) && polls < POLL_MAX) {
        polls++;
        pollTimer = win.setTimeout(() => { if (mine === generation && current === screen) load(false); }, POLL_MS);
      }
    }

    function cardEl(c, r, ci) {
      const m = cardMetrics(model0.settings.style, model0.settings.size, c.wide);
      const size = { width: 'calc(' + m.w + ' * var(--dp))', height: 'calc(' + m.h + ' * var(--dp))' };
      const kids = [art(c.art, c.wide, c.title, { queue: imgQueue, pos: { r: r, c: ci } })];
      if (c.kind === 'continue') kids.push(h('span', { class: 'progress' }, h('span', { style: { width: Math.round(c.progress * 100) + '%' } })));
      // As on the TV: a continue card plays; any other card goes to the search of its title across the plugins, and the person picks the source there.
      const press = c.kind === 'continue' ? () => openContinue(c) : () => openSources(c.title, screen, c.hero.ask);
      const el = pressable({ class: 'tv-card', 'data-key': c.key, style: size, 'aria-label': c.title }, kids, press);
      el.addEventListener('focus', () => onCardFocus(c));
      // A pointer (a mouse, the LG's magic remote) resting on a card focuses it, so the hero follows it as it follows the arrows; the rows do not scroll under the pointer.
      el.addEventListener('mouseenter', () => {
        if (railOpen || current !== screen || doc.activeElement === el) return;
        hoverFocus = true;
        try { el.focus({ preventScroll: true }); } finally { hoverFocus = false; }
      });
      return el;
    }

    let model0 = { settings: { style: 'cards', size: 'medium' } };

    function render(model) {
      model0 = model;
      homeLook = model.settings || homeLook;
      imgQueue.clear();
      clear(rowsEl);
      cardRows = [];
      sectionEls = [];
      const empty = !model.sections.length;
      if (model.needsPhone) rowsEl.appendChild(h('p', { class: 'note' }, S.pluginsOnPhone));
      else if (empty && (model.refreshing || model.pending.length)) rowsEl.appendChild(h('p', { class: 'note' }, S.stillLoading));
      else if (empty) rowsEl.appendChild(h('p', { class: 'note' }, S.homeEmpty));
      model.sections.forEach((sec, r) => {
        const cards = sec.cards.map((c, ci) => cardEl(c, r, ci));
        cardRows.push(cards);
        const el = h('section', { class: 'tv-row' }, [
          h('h3', { class: 'row-title' }, [sec.title, sec.pluginName ? h('span', { class: 'row-plugin' }, sec.pluginName) : null]),
          // Each card with its name under it (the owner, 2026-11-07: posters and cards alike); the remote still walks the cards.
          h('div', { class: 'tv-cards' }, cards.map((el_, ci) => h('div', { class: 'tv-cardwrap', style: { width: el_.style.width } }, [el_, h('p', { class: 'tv-cardcap' }, sec.cards[ci].title || '')]))),
        ]);
        sectionEls.push(el);
        rowsEl.appendChild(el);
      });
      // Room under the last row so it can come up to the top as every other one does.
      rowsEl.appendChild(h('div', { class: 'tv-row-tail' }));
      if (!heroLocked) hero.show(model.hero, null, false);
    }

    let hoverFocus = false; // the focus came from the pointer, not the arrows
    let heroLocked = false; // once a card had focus the hero follows the focus, not the phone's first pick

    /** The remote rests on a card: its row comes to the top, the hero shows the card at once and then its TMDB logo and facts. */
    function onCardFocus(c) {
      heroLocked = true;
      const idx = cardRows.findIndex((r) => r.some((el) => el.getAttribute('data-key') === c.key));
      if (idx >= 0) { focusPos.r = idx; focusPos.c = cardRows[idx].findIndex((el) => el.getAttribute('data-key') === c.key); }
      if (idx >= 0 && sectionEls[idx] && !hoverFocus) rowsEl.scrollTop = sectionEls[idx].offsetTop - 4;
      if (focusTimer) win.clearTimeout(focusTimer);
      const seq = ++heroSeq;
      const ask = c.hero.ask;
      const cached = ask ? infoCache[JSON.stringify(ask)] : undefined;
      hero.show(c.hero, cached || null, !!ask && cached === undefined);
      if (!ask || cached !== undefined) return;
      // The TV waits a beat so a D-pad passing over cards asks nothing; memory first (no request), then the phone asks TMDB.
      focusTimer = win.setTimeout(async () => {
        let info = null;
        const key = JSON.stringify(ask);
        try { info = await api.heroInfo(ask, true); } catch (e) { info = null; }
        if (!(info && info.found)) {
          try { info = await api.heroInfo(ask, false); } catch (e) { info = null; }
        }
        infoCache[key] = info && info.found ? info : { found: false };
        if (seq === heroSeq && mine === generation) hero.show(c.hero, infoCache[key], false);
      }, HERO_ASK_MS);
    }

    return screen;
  }

  /** The Home's big featured title, drawn as the TV does: the backdrop top-right (a new one crossfades over the old), the title's logo (or its name), facts, and the synopsis. */
  function createHomeHero() {
    const layers = [h('img', { class: 'hero-img', alt: '', referrerpolicy: 'no-referrer' }), h('img', { class: 'hero-img', alt: '', referrerpolicy: 'no-referrer' })];
    const logo = h('img', { class: 'hero-logo', alt: '' });
    const name = h('h2', { class: 'hero-title' }, '');
    const facts = h('p', { class: 'hero-facts' }, '');
    const extra = h('p', { class: 'hero-extra' }, '');
    const overview = h('p', { class: 'hero-overview' }, '');
    const el = h('section', { class: 'hero' }, [
      h('div', { class: 'hero-art' }, layers),
      h('div', { class: 'hero-shade' }),
      h('div', { class: 'hero-text' }, [logo, name, facts, extra, overview]),
    ]);
    let top = 0;
    let shownImage = '';
    let waitTimer = null;

    function setImage(src) {
      if (src === shownImage) return;
      shownImage = src;
      const next = layers[1 - top];
      const prev = layers[top];
      if (!src) { prev.classList.remove('on'); return; }
      next.onload = () => { next.classList.add('on'); prev.classList.remove('on'); top = 1 - top; };
      next.onerror = () => { next.classList.remove('on'); };
      next.src = sized(src);
    }

    return {
      el: el,
      /** @param hero {title, overview, image, facts, extra}|null  @param info /hero-info answer|null  @param waiting true while a logo may still come (the name waits a beat) */
      show(hero, info, waiting) {
        if (waitTimer) { win.clearTimeout(waitTimer); waitTimer = null; }
        if (!hero) { el.classList.add('empty'); return; }
        el.classList.remove('empty');
        setImage(hero.image);
        const logoUrl = info && info.found && info.logo ? info.logo : '';
        const logoSrc = logoUrl && logoUrl.indexOf('/__kino/') === 0 ? api.url(logoUrl) : logoUrl;
        name.textContent = hero.title; // always the focused card's own name, so a hidden one never keeps the previous card's
        if (logoSrc) {
          if (logo.getAttribute('src') !== logoSrc) {
            // The old logo must not stay on screen while the new one loads.
            logo.style.visibility = 'hidden';
            logo.onload = () => { logo.style.visibility = ''; };
            logo.src = logoSrc;
          } else logo.style.visibility = '';
          logo.style.display = '';
          logo.onerror = () => { logo.style.display = 'none'; name.style.display = ''; name.classList.remove('wait'); };
          name.style.display = 'none';
        } else {
          logo.style.display = 'none';
          logo.removeAttribute('src');
          name.style.display = '';
          // While TMDB may still bring a logo the name stays invisible (its room kept) so it does not flash before the logo; after a while it shows anyway.
          name.classList.toggle('wait', !!waiting);
          if (waiting) waitTimer = win.setTimeout(() => name.classList.remove('wait'), HERO_TEXT_WAIT_MS);
        }
        facts.textContent = info && info.found ? factsOf(hero.card, info) : hero.facts;
        extra.textContent = hero.extra || '';
        overview.textContent = info && info.found && info.overview && !hero.overview ? info.overview : hero.overview;
      },
    };
  }

  // ------------------------------------------------------------------ En vivo (the TV's live guide)

  /**
   * One screen like the TV's: the provider tabs with search and reload on top, the category rail, the channel list and the live panel. The phone serves it
   * (`/live*`); the remote walks the four regions by hand (left/right/up/down), OK on a channel plays it, a long OK stars it.
   */
  function createLive() {
    const mine = generation;
    const tabsEl = h('div', { class: 'live-tabs' });
    const iconBtn = (key, label, icon, onPress) => h('button', { type: 'button', class: 'live-ibtn', 'data-key': key, 'aria-label': label, onclick: onPress }, [svgIcon(doc, icon, 22)]);
    const searchBtn = iconBtn('live:search', S.search, 'search', () => toggleSearch());
    const reloadBtn = iconBtn('live:reload', S.refresh, 'refresh', () => reload());
    // The channel guide of the list on screen: shown once some provider has a guide.
    const guideBtn = iconBtn('live:guide', S.liveGuide, 'calendar', () => openGuide());
    guideBtn.style.display = 'none';
    const headerEl = h('div', { class: 'live-header' }, [tabsEl, h('div', { class: 'live-hbtns' }, [guideBtn, searchBtn, reloadBtn])]);
    const railEl = h('div', { class: 'live-rail' });
    const searchInput = h('input', { type: 'text', class: 'live-search-input', placeholder: S.liveSearchPlaceholder, 'aria-label': S.liveSearchPlaceholder, autocomplete: 'off', maxlength: '80', 'data-key': 'live:q' });
    const clearBtn = h('button', { type: 'button', class: 'live-clear', 'data-key': 'live:clear', onclick: () => closeSearch() }, S.liveClearSearch);
    const searchEl = h('div', { class: 'live-searchcol' }, [searchInput, clearBtn]);
    const noteEl = h('p', { class: 'live-note' }, '');
    const listEl = h('div', { class: 'live-list' });
    // A finger scrolls the list on a phone (no focus walking to its end): the next page loads near the bottom.
    listEl.addEventListener('scroll', () => { if (listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 300) more(); }, { passive: true });
    const miniEl = h('div', { class: 'live-mini', role: 'button', tabindex: '0', 'data-key': 'live:mini', onclick: () => playChannel(shown) }, []);
    const nameEl = h('p', { class: 'live-name' }, '');
    const metaEl = h('p', { class: 'live-meta' }, '');
    const hintEl = h('p', { class: 'live-hint' }, '');
    const onAirEl = h('p', { class: 'live-onair' }, [h('span', { class: 'live-dot' }), S.liveOnAir]);
    const panelEl = h('div', { class: 'live-panel' }, [miniEl, onAirEl, nameEl, metaEl, hintEl]);
    const body = h('div', { class: 'live-body' }, [h('div', { class: 'live-col-rail' }, [railEl, searchEl]), h('div', { class: 'live-col-list' }, [noteEl, listEl]), panelEl]);

    let started = false;
    let data = null; // GET /live
    let provider = '';
    let category = '';
    let rail = [];
    let channels = [];
    let next = null;
    let loadingMore = false;
    let searching = false;
    let query = '';
    let searchSeq = 0;
    let searchTimer = null;
    let shown = null; // the channel the panel is about
    let tabEls = [];
    let railEls = [];
    let listEls = [];
    let calls = 0;
    let hudTimer = null;

    const screen = {
      el: h('main', { class: 'screen live' }, [headerEl, body]),
      section: 'live',
      rows: () => [tabEls.concat(headerBtns())].concat(listEls.length ? [listEls.slice(0, 1)] : []),
      back: () => { if (searching) { closeSearch(); return; } show(homeScreen); },
      onKey: onKey,
      release: () => stopPreview(),
      acquire: () => {
        Array.prototype.slice.call(screen.el.querySelectorAll('img')).forEach((img) => { if (img._src && !img.getAttribute('src')) img.setAttribute('src', img._src); });
        if (shown) { pvCode = null; paintPanel(''); }
      },
    };
    // The screen loads itself the first time it is shown.
    const firstShow = () => { if (!started) { started = true; boot(); } };
    const origShow = screen.el;
    screen.start = firstShow;

    const channelOf = (el) => channels[listEls.indexOf(el)];
    const headerBtns = () => (guideBtn.style.display === 'none' ? [] : [guideBtn]).concat([searchBtn, reloadBtn]);
    const providerName = (id) => providerOf(data && data.providers, id).name;
    const zoneOf = (el) => (tabEls.indexOf(el) >= 0 || el === guideBtn || el === searchBtn || el === reloadBtn ? 'header' : railEls.indexOf(el) >= 0 ? 'rail' : listEls.indexOf(el) >= 0 ? 'list' : el === miniEl ? 'mini' : el === searchInput || el === clearBtn ? 'search' : '');

    async function boot() {
      const call = ++calls;
      clear(listEl).appendChild(h('p', { class: 'live-msg' }, S.liveLoading));
      let live;
      try { live = withBase(await api.live(), api.url('')); } catch (e) { if (mine === generation && call === calls && current === screen) fail(e, () => { started = false; show(screen); }, () => show(homeScreen)); return; }
      if (mine !== generation || call !== calls) return;
      data = live || {};
      guideBtn.style.display = (data.providers || []).some((p) => p && p.hasGuide) ? '' : 'none';
      paintTabs();
      const landing = data.landing || {};
      const first = landing.provider || (data.providers && data.providers[0] && data.providers[0].id) || '';
      await openProvider(first, landing.category || '', landing.channel || '');
    }

    function paintTabs() {
      clear(tabsEl);
      tabEls = [];
      const providers = (data && data.providers) || [];
      if (data && data.showProviders === false) { tabsEl.appendChild(h('h2', { class: 'live-title' }, S.live)); return; }
      providers.forEach((p) => {
        const b = h('button', { type: 'button', class: 'live-tab' + (p.id === provider ? ' on' : ''), 'data-key': 'live:tab:' + p.id, onclick: () => openProvider(p.id, '', '') }, [h('span', { class: 'live-pdot', style: { background: p.color || '#9A9AA6' } }), p.name]);
        tabEls.push(b);
        tabsEl.appendChild(b);
      });
    }

    let openSeq = 0;

    /**
     * A provider's screen in two steps: what the phone kept from its last read (rail and channels, no plugin call) paints at once, then
     * the plugin's fresh answer replaces it in place, the focus staying on its channel. A plugin's first call can take seconds.
     */
    async function openProvider(id, cat, wantedCode) {
      const seq = ++openSeq;
      calls++;
      provider = id;
      closeSearch(true);
      paintTabs();
      const stale = () => mine !== generation || seq !== openSeq || provider !== id;
      let kept = null;
      try { kept = await api.liveCategories(id, true); } catch (e) { kept = null; }
      if (stale()) return;
      const painted = !!(kept && kept.fromCache);
      if (painted) {
        applyRail(kept, cat);
        await loadChannels(true, wantedCode, { cacheOnly: true });
        if (stale()) return;
      }
      let r;
      try { r = await api.liveCategories(id); } catch (e) {
        if (!stale() && !painted && current === screen) fail(e, () => openProvider(id, cat, wantedCode), () => show(homeScreen));
        return;
      }
      if (stale()) return;
      applyRail(r, painted ? category : cat);
      await loadChannels(true, wantedCode, painted ? { refresh: true } : {});
    }

    function applyRail(r, cat) {
      rail = (r && r.rail) || [];
      category = cat || (r && r.selected) || '';
      if (!category) { const firstCat = rail.find((e) => e && e.kind === 'category'); category = firstCat ? String(firstCat.id) : '__favoritos__'; }
      noteEl.textContent = (r && r.notice) || '';
      paintRail();
    }

    function paintRail() {
      clear(railEl);
      railEls = [];
      railItemsOf(rail, S, category).forEach((it) => {
        if (it.type === 'header') { railEl.appendChild(h('p', { class: 'live-rhead' }, it.label)); return; }
        const kids = [];
        if (it.icon) kids.push(svgIcon(doc, it.icon, 18));
        kids.push(h('span', { class: 'live-rlabel' }, it.label));
        if (it.count !== null && it.count !== undefined) kids.push(h('span', { class: 'live-rcount' }, String(it.count)));
        const b = h('button', { type: 'button', class: 'live-rrow' + (it.on ? ' on' : '') + (it.gap ? ' gap' : ''), 'data-key': 'live:cat:' + it.key, onclick: () => chooseCategory(it.key) }, kids);
        railEls.push(b);
        railEl.appendChild(b);
      });
    }

    function chooseCategory(key) {
      category = key;
      paintRail();
      loadChannels(true, '');
    }

    /**
     * The category's channels. [opts.cacheOnly]: what the phone kept (painted only when it has some; the loading line stays otherwise).
     * [opts.refresh]: the fresh answer over a list already painted from the cache, the focus kept on its channel.
     */
    async function loadChannels(reset, wantedCode, opts) {
      const o = opts || {};
      const call = ++calls;
      const wasEmpty = !listEls.length;
      const focusedCode = o.refresh && listEls.indexOf(doc.activeElement) >= 0 ? (channelOf(doc.activeElement) || {}).liveCode : null;
      if (reset && !o.refresh) { channels = []; next = null; clear(listEl).appendChild(h('p', { class: 'live-msg' }, S.liveLoading)); listEls = []; }
      let r;
      try { r = withBase(await api.liveChannels({ provider: provider, category: category, offset: reset ? 0 : (next || 0), limit: 60, cache: o.cacheOnly ? '1' : null }), api.url('')); }
      catch (e) {
        if (o.cacheOnly || (o.refresh && !wasEmpty)) return; // the fresh call (or the list already shown) stands
        if (mine === generation && call === calls) { clear(listEl).appendChild(h('div', { class: 'live-msg' }, [h('p', null, S.liveFailed), h('button', { type: 'button', class: 'btn', 'data-key': 'live:retry', onclick: () => loadChannels(true, wantedCode) }, S.liveRetry)])); }
        return;
      }
      if (mine !== generation || call !== calls) return;
      const got = (r && r.channels) || [];
      if (o.cacheOnly && !got.length) return;
      channels = mergeChannels(reset ? [] : channels, got);
      next = r && r.canLoadMore && typeof r.next === 'number' ? r.next : null;
      if (r && r.notice) noteEl.textContent = r.notice;
      paintList(isMixed(category, false));
      if (current !== screen || !reset) return;
      // A refresh keeps the focus where it was; a first paint lands on the wanted channel, else the first. The panel follows it.
      if (o.refresh && !wasEmpty && !focusedCode) return;
      const keep = focusedCode || wantedCode;
      const at = keep ? channels.findIndex((c) => c.liveCode === keep) : -1;
      const el = listEls[at >= 0 ? at : 0];
      if (el) { el.focus(); shown = channelOf(el); paintPanel('list'); }
    }

    function logoOf(ch) {
      const tile = h('span', { class: ch.logo ? 'live-logo has-logo' : 'live-logo' }, []);
      if (ch.logo) {
        const img = h('img', { src: sized(ch.logo, 64), alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', onerror: () => { img.style.display = 'none'; tile.className = 'live-logo'; tile.appendChild(h('span', { class: 'live-init' }, initialsOf(ch.name))); } });
        tile.appendChild(img);
      } else tile.appendChild(h('span', { class: 'live-init' }, initialsOf(ch.name)));
      return tile;
    }

    function rowOf(ch, mixed) {
      const kids = [logoOf(ch), h('span', { class: 'live-cname' }, ch.name || '')];
      if (ch.favorite) kids.push(svgIcon(doc, 'star', 18));
      if (mixed) kids.push(h('span', { class: 'live-badge' }, providerName(ch.provider)));
      const n = numberText(ch);
      if (n) kids.push(h('span', { class: 'live-num' }, n));
      const row = h('div', { class: 'live-row', role: 'button', tabindex: '0', 'data-key': 'live:ch:' + ch.liveCode, onclick: () => playChannel(ch) }, kids);
      row.addEventListener('focus', () => { shown = ch; paintPanel('list'); if (next !== null && listEls.indexOf(row) >= listEls.length - 6) more(); });
      return row;
    }

    function paintList(mixed) {
      clear(listEl);
      listEls = [];
      if (!channels.length) {
        const msg = searching ? S.liveNoResults : category === '__favoritos__' ? S.liveNoFavorites : category === '__recientes__' ? S.liveNoRecents : S.liveNoChannels;
        listEl.appendChild(h('p', { class: 'live-msg' }, msg));
        shown = null;
        paintPanel('');
        return;
      }
      channels.forEach((ch) => { const row = rowOf(ch, mixed); listEls.push(row); listEl.appendChild(row); });
      if (!shown || !channels.some((c) => c.liveCode === shown.liveCode)) shown = channels[0];
      paintPanel('');
    }

    async function more() {
      if (loadingMore || next === null || searching) return;
      loadingMore = true;
      try { await loadChannels(false, ''); } finally { loadingMore = false; }
    }

    // The mini player, as the TV's: the channel under the focus plays muted once the focus rests on it for a moment; until then (and when it cannot play here) its picture stays.
    let pvSeq = 0;
    let pvTimer = null;
    let pvCode = null; // the channel the mini is about (pending, playing or refused)
    let pvCur = null; // { code, video, playId, hls, live }
    function stopPreview() {
      pvSeq++;
      if (pvTimer) { win.clearTimeout(pvTimer); pvTimer = null; }
      pvCode = null;
      const c = pvCur;
      pvCur = null;
      if (!c) return;
      if (c.hls) { try { c.hls.destroy(); } catch (e) { /* stopping anyway */ } }
      try { c.video.pause(); c.video.removeAttribute('src'); c.video.load(); } catch (e) { /* stopping anyway */ }
      if (c.video.parentNode) c.video.parentNode.removeChild(c.video);
      if (c.playId) api.end(c.playId, { positionMs: 0, durationMs: 0, watched: false }).catch(() => {});
    }
    function schedulePreview(ch) {
      stopPreview();
      pvCode = ch.liveCode;
      if (!panelEl.offsetParent) return; // a phone hides the panel: no muted preview playing out of sight
      const my = pvSeq;
      pvTimer = win.setTimeout(() => { pvTimer = null; startPreview(ch, my); }, 900);
    }
    async function startPreview(ch, my) {
      const video = h('video', { class: 'live-pv', playsinline: true, muted: true });
      video.muted = true;
      const client = clientOf(video, win, await probeEme(win));
      client.tsHevc = isWebOs(win);
      let plan;
      try { plan = await api.livePlay(ch.liveCode, client, true); } catch (e) { return; } // refused here (DRM, a setup question, ...): its picture stays
      if (my !== pvSeq) { if (plan && plan.playId) api.end(plan.playId, { positionMs: 0, durationMs: 0, watched: false }).catch(() => {}); return; }
      const base = hostedBase || win.location.origin;
      const url = plan && plan.plan && typeof plan.plan.url === 'string' ? mediaUrlFor(plan.plan.url, base) : '';
      const cur = { code: ch.liveCode, video: video, playId: plan && plan.playId, hls: null, live: false };
      pvCur = cur;
      if (!/^https?:\/\//i.test(url)) { stopPreview(); return; }
      video.onplaying = () => {
        if (pvCur !== cur || cur.live) return;
        cur.live = true;
        if (shown && shown.liveCode === cur.code) { clear(miniEl); miniEl.appendChild(video); }
      };
      video.onerror = () => { if (pvCur === cur) { const keep = pvCode; stopPreview(); pvCode = keep; } };
      // A protected or DASH channel: Shaka, with the plan's keys (never anywhere but its configuration).
      if (needsShaka(plan.plan)) {
        const cfg = shakaConfigOf(plan.plan.drm, base);
        let shaka = null;
        if (cfg) { try { shaka = await loadShaka(doc, win); } catch (e) { shaka = null; } }
        if (my !== pvSeq) return;
        if (shaka) cur.hls = attachShaka(shaka, video, url, { config: cfg, onFatal: () => { if (pvCur === cur) { const keep = pvCode; stopPreview(); pvCode = keep; } } });
        if (!cur.hls) { const keep = pvCode; stopPreview(); pvCode = keep; return; }
        const q = video.play();
        if (q && q.catch) q.catch(() => {});
        return;
      }
      let Hls = null;
      const native = /^(maybe|probably)$/.test(String(video.canPlayType('application/vnd.apple.mpegurl')));
      if (plan.plan.route === 'hls-proxy' && (!native || !isWebOs(win))) { try { Hls = await loadHls(doc, win); } catch (e) { Hls = null; } }
      if (my !== pvSeq) return;
      if (Hls && Hls.isSupported()) cur.hls = attachHls(Hls, video, url, { startPosition: -1, onFatal: () => { if (pvCur === cur) { const keep = pvCode; stopPreview(); pvCode = keep; } } });
      else video.src = url;
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    }

    /** The panel about the channel: its picture, "EN VIVO", name, provider and number, and the hint of what OK does. */
    function paintPanel(zone) {
      clear(miniEl);
      if (!shown) { stopPreview(); nameEl.textContent = S.livePickOne; metaEl.textContent = ''; hintEl.textContent = ''; return; }
      if (pvCur && pvCur.live && pvCur.code === shown.liveCode) {
        miniEl.appendChild(pvCur.video);
      } else {
        const tile = h('div', { class: 'live-poster' }, []);
        if (shown.logo) tile.appendChild(h('img', { src: sized(shown.logo, 96), alt: '', referrerpolicy: 'no-referrer' }));
        else tile.appendChild(h('span', { class: 'live-pinit' }, initialsOf(shown.name)));
        miniEl.appendChild(tile);
        if (pvCode !== shown.liveCode) schedulePreview(shown);
      }
      nameEl.textContent = shown.name || '';
      metaEl.textContent = metaLineOf(shown, providerName(shown.provider), S);
      hintEl.textContent = actionLineOf(zone, shown, S);
    }

    function say(text) {
      hintEl.textContent = text;
      if (hudTimer) win.clearTimeout(hudTimer);
      hudTimer = win.setTimeout(() => { hintEl.textContent = ''; }, 2000);
    }

    async function toggleFavorite(ch) {
      if (!ch) return;
      const want = !ch.favorite;
      try {
        const r = await api.liveFavorite(ch.liveCode, want);
        ch.favorite = r && typeof r.favorite === 'boolean' ? r.favorite : want;
      } catch (e) { say(errorText(e, S)); return; }
      const at = channels.indexOf(ch);
      const key = focusedKey();
      if (category === '__favoritos__' && !ch.favorite) channels.splice(at, 1);
      paintList(isMixed(category, searching));
      const el = listEls[Math.min(at, listEls.length - 1)];
      if (el && key) el.focus();
      say(ch.favorite ? S.liveFavAdded : S.liveFavRemoved);
    }

    function playChannel(ch) {
      if (!ch) return;
      const idx = channels.indexOf(ch);
      if (idx >= 0 && listEls[idx]) screen.last = listEls[idx];
      openLive(ch, channels.slice(), (code) => { const i = channels.findIndex((c) => c.liveCode === code); if (i >= 0 && listEls[i]) screen.last = listEls[i]; }, screen);
    }

    async function reload() {
      if (searching) return;
      calls++;
      channels = []; next = null;
      clear(listEl).appendChild(h('p', { class: 'live-msg' }, S.liveLoading));
      await loadChannels(true, '');
    }

    function toggleSearch() { if (searching) closeSearch(); else openSearch(); }

    /** The guide of the channels on screen (the category, the favourites, a search's results), each row playing its channel. */
    function openGuide() {
      if (!channels.length) { say(searching ? S.liveNoResults : S.liveNoChannels); return; }
      const on = railItemsOf(rail, S, category).filter((it) => it.on)[0];
      const heading = searching ? query : on ? on.label : providerName(provider);
      stopPreview();
      openChannelGuide(channels.slice(), heading, screen, (ch, guideScreen) => openLive(ch, channels.slice(), () => {}, guideScreen));
    }

    function openSearch() {
      searching = true;
      screen.el.classList.add('searching');
      searchInput.value = query = '';
      channels = []; paintList(true);
      searchInput.focus();
    }

    function closeSearch(quiet) {
      if (!searching) return;
      searching = false;
      screen.el.classList.remove('searching');
      searchInput.value = query = '';
      searchSeq++;
      if (!quiet) { loadChannels(true, ''); searchBtn.focus(); }
    }

    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      if (searchTimer) win.clearTimeout(searchTimer);
      searchTimer = win.setTimeout(() => runSearch(query, 0), 300);
    });

    async function runSearch(q, tries) {
      const seq = ++searchSeq;
      if (!String(q).trim()) { channels = []; paintList(true); return; }
      let r;
      try { r = withBase(await api.liveSearch(q), api.url('')); } catch (e) { if (seq === searchSeq) say(errorText(e, S)); return; }
      if (seq !== searchSeq || mine !== generation || !searching) return;
      channels = (r && r.results) || [];
      if (r && r.note) noteEl.textContent = r.note;
      paintList(true);
      if (r && r.pending && tries < 6) searchTimer = win.setTimeout(() => runSearch(q, tries + 1), 700);
    }

    function moveIn(list, el, d) {
      const i = list.indexOf(el);
      const t = list[Math.max(0, Math.min(list.length - 1, i + d))];
      if (t) t.focus();
    }

    function onKey(action, ev) {
      const el = doc.activeElement;
      const zone = zoneOf(el);
      if (!zone) return false;
      const flat = tabEls.concat(headerBtns());
      if (zone === 'search') {
        if (action === 'down') { (listEls[0] || clearBtn).focus(); return true; }
        if (action === 'up' || action === 'left') return action === 'left' ? el !== searchInput : false;
        return false;
      }
      if (action === 'enter' && ev.repeat && zone === 'list') { toggleFavorite(channelOf(el)); return true; }
      if (action === 'enter' && ev.repeat) return true;
      switch (zone) {
        case 'header':
          if (action === 'left') { if (flat.indexOf(el) > 0) { moveIn(flat, el, -1); return true; } return false; }
          if (action === 'right') { moveIn(flat, el, 1); return true; }
          if (action === 'down') { (listEls[0] || (searching ? searchInput : railEls[0]) || miniEl).focus(); return true; }
          if (action === 'enter') { el.click(); return true; }
          return false;
        case 'rail':
          if (action === 'up') { if (railEls.indexOf(el) === 0) { (tabEls[0] || searchBtn).focus(); } else moveIn(railEls, el, -1); return true; }
          if (action === 'down') { moveIn(railEls, el, 1); return true; }
          if (action === 'right') { (listEls[0] || miniEl).focus(); return true; }
          if (action === 'enter') { el.click(); return true; }
          return false;
        case 'list':
          if (action === 'up') { if (listEls.indexOf(el) === 0) searchBtn.focus(); else moveIn(listEls, el, -1); return true; }
          if (action === 'down') { moveIn(listEls, el, 1); return true; }
          if (action === 'left') { const on = railEls.find((b) => b.classList.contains('on')) || railEls[0]; if (searching) { searchInput.focus(); return true; } if (on) { on.focus(); return true; } return false; }
          if (action === 'right') { miniEl.focus(); return true; }
          if (action === 'enter') { playChannel(channelOf(el)); return true; }
          return false;
        case 'mini':
          if (action === 'left') { (listEls[channels.indexOf(shown)] || listEls[0] || railEls[0]).focus(); return true; }
          if (action === 'enter') { playChannel(shown); return true; }
          if (action === 'up') { searchBtn.focus(); return true; }
          return action === 'down';
        default:
          return false;
      }
    }

    return screen;
  }

  // ------------------------------------------------------------------ the channel guide (En vivo's programme lines as a grid)

  /**
   * The channel guide of [list]: a row per channel (its logo, number and name) with what is on now and what comes next, from
   * `/live/guide` 40 channels at a time. OK (or a click) on a row plays its channel; Back returns to En vivo.
   */
  function openChannelGuide(list, heading, origin, play) {
    const mine = generation;
    const channels = list.slice(0, 200);
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'guide:back' });
    const status = h('p', { class: 'note' }, S.loading);
    const rowsEl = h('div', { class: 'guide-rows' });
    const el = h('main', { class: 'screen browse guide' }, [
      h('div', { class: 'browse-head' }, [backBtn, h('h1', { class: 'browse-title' }, heading ? S.liveGuide + ' · ' + heading : S.liveGuide)]),
      status, rowsEl,
    ]);
    const progEls = {};
    const rowEls = channels.map((ch) => {
      const tile = h('span', { class: 'live-logo' + (ch.logo ? ' has-logo' : '') }, []);
      if (ch.logo) tile.appendChild(h('img', { src: sized(ch.logo, 64), alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', onerror: () => { tile.className = 'live-logo'; clear(tile).appendChild(h('span', { class: 'live-init' }, initialsOf(ch.name))); } }));
      else tile.appendChild(h('span', { class: 'live-init' }, initialsOf(ch.name)));
      const n = numberText(ch);
      const progs = h('div', { class: 'guide-progs' }, [h('span', { class: 'guide-none' }, '…')]);
      progEls[ch.liveCode] = progs;
      const row = pressable({ class: 'guide-row', 'data-key': 'guide:' + ch.liveCode, 'aria-label': ch.name || '' }, [
        h('div', { class: 'guide-ch' }, [tile, h('span', { class: 'guide-num' }, n), h('span', { class: 'guide-name' }, ch.name || '')]),
        progs,
      ], () => play(ch, screen));
      rowsEl.appendChild(row);
      return row;
    });
    const screen = { el: el, noRail: true, rows: () => [[backBtn]].concat(rowEls.map((r) => [r])), back: () => show(origin) };
    show(screen);
    if (rowEls.length) grid.focus(rowEls[0]);
    load();

    async function load() {
      let any = false;
      for (let i = 0; i < channels.length; i += 40) {
        const codes = channels.slice(i, i + 40).map((c) => c.liveCode);
        let r = null;
        try { r = await api.liveGuide(codes); } catch (e) { r = null; }
        if (mine !== generation) return;
        const guide = (r && r.guide) || {};
        const nowSec = Math.floor(Date.now() / 1000);
        codes.forEach((code) => {
          const progs = progEls[code];
          const items = guideRowOf(guide[code], nowSec, 6);
          clear(progs);
          if (!items.length) { progs.appendChild(h('span', { class: 'guide-none' }, S.liveGuideNoInfo)); return; }
          any = true;
          items.forEach((p) => progs.appendChild(h('div', { class: 'guide-prog' + (p.now ? ' on' : '') }, [
            h('span', { class: 'guide-hours' }, p.now ? S.liveGuideNow + ' · ' + p.hours : p.hours),
            h('span', { class: 'guide-title' }, p.title),
          ])));
        });
        status.textContent = any ? '' : S.loading;
      }
      status.textContent = any ? '' : S.liveGuideEmpty;
      status.style.display = any ? 'none' : '';
    }
  }

  // ------------------------------------------------------------------ the live player (the TV's: no bar, a channel card, zapping, a drawer and an options panel)

  /**
   * Plays a live channel full screen. `entryList` is the list the person entered with (the phone narrows it to the provider and wraps it when zapping);
   * `onPlayed(code)` tells the guide which channel was watched last, so it gets the focus back. Keys: up/down zap, left the channel drawer, right the
   * options, Enter pauses, Back leaves. The phone resolves every channel (`/live/play`) and `/play/end` frees the session on every zap and on leaving.
   */
  function openLive(channel, entryList, onPlayed, origin) {
    const mine = generation;
    const entry = entryList.map((c) => c.liveCode);
    const byCode = {};
    entryList.forEach((c) => { byCode[c.liveCode] = c; });
    byCode[channel.liveCode] = channel;
    const video = h('video', { class: 'video', playsinline: true });
    primePlay(video); // inside the press that opened the channel: it may start with sound once the phone answers
    const spinner = h('p', { class: 'lv-spinner' }, S.liveSwitching);
    spinner.style.display = 'none';
    const message = h('p', { class: 'lv-message' }, '');
    message.style.display = 'none';
    const logoBox = h('span', { class: 'lv-logo' }, []);
    const nameEl = h('span', { class: 'lv-name' }, '');
    const nowEl = h('span', { class: 'lv-now' }, '');
    const hintEl = h('span', { class: 'lv-hint' }, S.liveHintOptions);
    const card = h('div', { class: 'lv-card' }, [logoBox, h('div', { class: 'lv-text' }, [nameEl, nowEl, hintEl])]);
    const drawer = h('div', { class: 'lv-drawer' }, []);
    const options = h('div', { class: 'lv-options' }, []);
    const veil = h('div', { class: 'pl-veil' });
    // With the mouse (a desktop browser) the TV's keys have buttons: the back arrow at the top left, "find a channel" (the drawer) and the channel's options at the top right.
    // They come up with the pointer and fade after a few seconds without it, as a film's controls do.
    const topBack = h('button', { type: 'button', class: 'lv-top lv-back', 'data-key': 'lv:back', onclick: () => leave() }, S.back);
    const topFind = h('button', { type: 'button', class: 'lv-top', 'data-key': 'lv:find', onclick: () => openDrawer() }, S.liveFind);
    const topOpts = h('button', { type: 'button', class: 'lv-top', 'data-key': 'lv:opts', onclick: () => openOptions() }, S.liveOptions);
    const topBar = h('div', { class: 'lv-topbar' }, [topBack, h('span', { class: 'lv-topgap' }), topFind, topOpts]);
    const el = h('main', { class: 'screen livep' }, [video, veil, card, topBar, spinner, message, drawer, options]);
    let current_ = channel; // the channel on screen (or being asked for)
    let cursor = channel; // the channel the card shows (a zap in progress moves it before the stream follows)
    let playId = null;
    let seq = 0;
    let hls = null;
    let left = false;
    let cardTimer = null;
    let zapTimer = null;
    let retries = 0;
    let dim = 0;
    let panelOpen = '';
    let panelItems = [];
    const nowCache = {};
    let held = null; // the OK press in the drawer, until it is released
    const onKeyUp = (ev) => {
      if (actionOf(ev) !== 'enter' || !held) return;
      const h0 = held;
      held = null;
      if (!h0.done && panelOpen === 'drawer' && h0.row && h0.row.click) h0.row.click();
    };
    doc.addEventListener('keyup', onKeyUp);

    const screen = { el: el, noRail: true, rows: () => (panelItems.length ? [panelItems] : []), back: () => { if (panelOpen) closePanel(); else leave(); }, onKey: onKey };
    show(screen);
    win.setTimeout(() => { if (doc.activeElement && doc.activeElement.blur && current === screen) doc.activeElement.blur(); }, 0);
    let barTimer = null;
    function showBar() {
      topBar.classList.add('on');
      if (barTimer) win.clearTimeout(barTimer);
      barTimer = win.setTimeout(() => { barTimer = null; if (!topBar.matches(':hover')) topBar.classList.remove('on'); }, 3000);
    }
    el.addEventListener('mousemove', () => { showCard(); showBar(); });
    el.addEventListener('dblclick', (ev) => {
      if (ev.target !== video) return;
      try { if (doc.fullscreenElement) doc.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); } catch (e) { /* the browser refused */ }
    });
    el.addEventListener('click', (ev) => { if (ev.target === video) { if (card.classList.contains('on')) hideCard(); else showCard(); } });
    paintCard(channel);
    showCard();
    start(channel);

    function paintCard(ch) {
      clear(logoBox);
      logoBox.className = ch.logo ? 'lv-logo has-logo' : 'lv-logo';
      if (ch.logo) logoBox.appendChild(h('img', { src: sized(ch.logo, 64), alt: '', referrerpolicy: 'no-referrer' }));
      else logoBox.appendChild(h('span', { class: 'lv-init' }, initialsOf(ch.name)));
      nameEl.textContent = (ch.favorite ? '\u2605 ' : '') + (ch.name || '');
      const lines = nowLinesOf(nowCache[ch.liveCode], S);
      nowEl.textContent = lines.join('  \u00b7  ');
      if (nowCache[ch.liveCode] === undefined) {
        nowCache[ch.liveCode] = null;
        api.liveNow([ch.liveCode]).then((r) => { const n = r && r.now ? r.now[ch.liveCode] : null; nowCache[ch.liveCode] = n || null; if (cursor === ch && !left) nowEl.textContent = nowLinesOf(n, S).join('  \u00b7  '); }, () => {});
      }
    }
    function showCard() {
      card.classList.add('on');
      if (cardTimer) win.clearTimeout(cardTimer);
      cardTimer = win.setTimeout(hideCard, 3000);
    }
    function hideCard() { if (cardTimer) { win.clearTimeout(cardTimer); cardTimer = null; } if (!panelOpen) card.classList.remove('on'); }

    function stopMedia() {
      if (hls) { try { hls.destroy(); } catch (e) { /* stopping anyway */ } hls = null; }
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* stopping anyway */ }
    }
    function endSession() {
      const id = playId;
      playId = null;
      if (id) api.end(id, { positionMs: 0, durationMs: 0, watched: false }).catch(() => {});
    }
    function say(text) { message.textContent = text || ''; message.style.display = text ? '' : 'none'; }
    function leave() {
      if (left) return;
      left = true;
      doc.removeEventListener('keyup', onKeyUp);
      if (cardTimer) win.clearTimeout(cardTimer);
      if (barTimer) win.clearTimeout(barTimer);
      if (zapTimer) win.clearTimeout(zapTimer);
      try { if (doc.fullscreenElement) doc.exitFullscreen(); } catch (e) { /* not fullscreen */ }
      seq++;
      endSession();
      stopMedia();
      if (current === screen) show(origin);
    }

    /** Asks the phone for the channel and plays what it answers; a newer request (a zap) makes an older answer moot. */
    async function start(ch) {
      const mySeq = ++seq;
      current_ = ch;
      onPlayed(ch.liveCode);
      endSession();
      stopMedia();
      say('');
      spinner.style.display = '';
      const client = clientOf(video, win, await probeEme(win));
      client.tsHevc = isWebOs(win); // a browser does not play an endless raw TS (hls.js reads HLS); only the LG's own player does
      let plan;
      try { plan = await api.livePlay(ch.liveCode, client); } catch (e) {
        if (left || mySeq !== seq || mine !== generation) return;
        spinner.style.display = 'none';
        if (e && e.code === 'unsupported_here') { say(S.liveUnsupported); return; }
        if (e && e.needsPhone) { say(errorText(e, S)); return; }
        say(errorText(e, S));
        return;
      }
      if (left || mySeq !== seq || mine !== generation) { if (plan && plan.playId) api.end(plan.playId, { positionMs: 0, durationMs: 0, watched: false }).catch(() => {}); return; }
      playId = plan && plan.playId;
      const base = hostedBase || win.location.origin;
      const url = plan && plan.plan && typeof plan.plan.url === 'string' ? mediaUrlFor(plan.plan.url, base) : '';
      if (!playId || !/^https?:\/\//i.test(url)) { spinner.style.display = 'none'; say(S.liveNoResponse); return; }
      video.onplaying = () => { spinner.style.display = 'none'; retries = 0; };
      video.onerror = () => retry(ch);
      if (needsShaka(plan.plan)) {
        // A protected or DASH channel: Shaka, with the plan's keys (never anywhere but its configuration).
        const cfg = shakaConfigOf(plan.plan.drm, base);
        let shaka = null;
        if (cfg) { try { shaka = await loadShaka(doc, win); } catch (e) { shaka = null; } }
        if (left || mySeq !== seq) return;
        if (shaka) hls = attachShaka(shaka, video, url, { config: cfg, onFatal: () => retry(ch) });
        if (!hls) { spinner.style.display = 'none'; say(S.liveUnsupported); return; }
      } else {
        let Hls = null;
        const native = /^(maybe|probably)$/.test(String(video.canPlayType('application/vnd.apple.mpegurl')));
        // A browser's native HLS does not decode HEVC inside TS, hls.js does; the LG's own player decodes it.
        if (plan.plan.route === 'hls-proxy' && (!native || !isWebOs(win))) { try { Hls = await loadHls(doc, win); } catch (e) { Hls = null; } }
        if (left || mySeq !== seq) return;
        if (Hls && Hls.isSupported()) {
          hls = attachHls(Hls, video, url, { startPosition: -1, onFatal: () => retry(ch) });
        } else {
          video.src = url;
        }
      }
      autoplay(video, {
        // Sound refused without a fresh gesture: the channel plays muted and the next key or tap brings the sound back.
        onMuted: () => {
          if (left || mySeq !== seq) return;
          say(S.soundOff);
          const back = () => {
            doc.removeEventListener('keydown', back, true);
            doc.removeEventListener('pointerdown', back, true);
            if (left) return;
            video.muted = false;
            say('');
          };
          doc.addEventListener('keydown', back, true);
          doc.addEventListener('pointerdown', back, true);
        },
        onBlocked: () => { if (!left) { spinner.style.display = 'none'; say(S.pressToPlay); } },
      });
    }

    /** A cut stream is asked for again quietly (the TV reopens it); after three tries the channel is said not to respond. */
    function retry(ch) {
      if (left || current_ !== ch) return;
      if (retries >= 3) { spinner.style.display = 'none'; say(S.liveNoResponse); return; }
      retries++;
      win.setTimeout(() => { if (!left && current_ === ch) start(ch); }, 800 * retries);
    }

    /** The card follows every key at once; the phone is asked for the channel the person stopped on (the TV's zap settle). */
    async function zap(dir) {
      let r;
      try { r = await api.liveZap(entry, cursor.liveCode, dir); } catch (e) { say(errorText(e, S)); return; }
      if (left || !r) return;
      const ch = (r.channel && r.channel.liveCode ? Object.assign(byCode[r.channel.liveCode] || {}, withBase(r.channel, api.url(''))) : byCode[r.liveCode]);
      if (!ch || !ch.liveCode) return;
      byCode[ch.liveCode] = ch;
      cursor = ch;
      paintCard(ch);
      showCard();
      spinner.style.display = '';
      say('');
      if (zapTimer) win.clearTimeout(zapTimer);
      zapTimer = win.setTimeout(() => { zapTimer = null; retries = 0; start(ch); }, 400);
    }

    function closePanel() {
      panelOpen = '';
      panelItems = [];
      drawer.classList.remove('on');
      options.classList.remove('on');
      clear(drawer);
      clear(options);
      showCard();
    }

    /** The channel drawer: the list the person entered with, the one playing marked "EN VIVO"; OK changes channel. */
    function openDrawer() {
      closePanel();
      panelOpen = 'drawer';
      const rows = entry.map((code, i) => {
        const ch = byCode[code];
        const playing = code === current_.liveCode;
        const num = numberText(ch);
        return h('button', { type: 'button', class: 'lv-drow' + (playing ? ' on' : ''), 'data-key': 'lv:ch:' + code, onclick: () => { closePanel(); cursor = ch; paintCard(ch); showCard(); retries = 0; start(ch); } }, [
          h('span', { class: 'lv-dnum' }, num), h('span', { class: 'lv-dname' }, ch.name || ''), playing ? h('span', { class: 'lv-dlive' }, S.liveOnAir) : null,
        ]);
      });
      drawer.appendChild(h('p', { class: 'lv-dtitle' }, S.liveChannelsTitle));
      const list = h('div', { class: 'lv-dlist' }, rows);
      drawer.appendChild(list);
      drawer.appendChild(h('p', { class: 'lv-dhint' }, S.liveDrawerHint));
      drawer.classList.add('on');
      panelItems = rows;
      grid.setRows([rows]);
      const at = indexOfCode(entry, current_.liveCode);
      rows[at].focus();
      card.classList.remove('on');
    }

    /** The options sheet: the favorite toggle and the brightness stepper. */
    function openOptions() {
      closePanel();
      panelOpen = 'options';
      const ch = current_;
      const favBtn = h('button', { type: 'button', class: 'lv-obtn', 'data-key': 'lv:fav', onclick: () => toggleFav() }, ch.favorite ? S.liveRemoveFav : S.liveAddFav);
      const val = h('span', { class: 'lv-oval' }, dim === 0 ? S.dimNormal : (dim * 10) + ' %');
      const minus = h('button', { type: 'button', class: 'lv-obtn sm', 'data-key': 'lv:dim-', onclick: () => { dim = dimStep(dim, -1); apply(); } }, '\u2212');
      const plus = h('button', { type: 'button', class: 'lv-obtn sm', 'data-key': 'lv:dim+', onclick: () => { dim = dimStep(dim, 1); apply(); } }, '+');
      function apply() { veil.style.opacity = String(dim / DIM_MAX); val.textContent = dim === 0 ? S.dimNormal : (dim * 10) + ' %'; }
      async function toggleFav() {
        try { const r = await api.liveFavorite(ch.liveCode, !ch.favorite); ch.favorite = r && typeof r.favorite === 'boolean' ? r.favorite : !ch.favorite; } catch (e) { say(errorText(e, S)); return; }
        favBtn.textContent = ch.favorite ? S.liveRemoveFav : S.liveAddFav;
        paintCard(ch);
      }
      options.appendChild(h('p', { class: 'lv-otitle' }, S.liveOptions));
      options.appendChild(favBtn);
      options.appendChild(h('div', { class: 'lv-obright' }, [h('span', null, S.liveBrightness), minus, val, plus]));
      options.classList.add('on');
      panelItems = [favBtn, minus, plus];
      grid.setRows([[favBtn], [minus, plus]]);
      favBtn.focus();
    }

    function toggle() {
      if (!video.paused) { video.pause(); return; }
      if (playId) start(current_); // a paused live stream rejoins the live edge: ask the phone again
    }

    function onKey(action, ev) {
      if (left) return false;
      if (panelOpen === 'drawer') {
        const rows = panelItems;
        const i = rows.indexOf(doc.activeElement);
        if (action === 'up') { rows[Math.max(0, i - 1)].focus(); return true; }
        if (action === 'down') { rows[Math.min(rows.length - 1, i + 1)].focus(); return true; }
        if (action === 'right' || action === 'back') { closePanel(); return true; }
        if (action === 'enter') {
          // A short OK changes channel (on release); holding it adds or removes the favorite instead.
          if (!ev.repeat) { held = { at: Date.now(), done: false, row: rows[i] }; return true; }
          if (held && !held.done && Date.now() - held.at >= 600) {
            held.done = true;
            const ch = byCode[entry[i]];
            if (ch) api.liveFavorite(ch.liveCode, !ch.favorite).then((r) => { ch.favorite = r && typeof r.favorite === 'boolean' ? r.favorite : !ch.favorite; }, () => {});
          }
          return true;
        }
        return false;
      }
      if (panelOpen === 'options') {
        if (action === 'back' || action === 'left') { closePanel(); return true; }
        const a = doc.activeElement;
        if (action === 'down') { panelItems[1].focus(); return true; }
        if (action === 'up') { panelItems[0].focus(); return true; }
        if (action === 'right' && a === panelItems[1]) { panelItems[2].focus(); return true; }
        if (action === 'left' && a === panelItems[2]) { panelItems[1].focus(); return true; }
        return false;
      }
      switch (action) {
        case 'up': zap('prev'); return true;
        case 'down': zap('next'); return true;
        case 'left': openDrawer(); return true;
        case 'right': openOptions(); return true;
        case 'enter': showCard(); toggle(); return true;
        case 'playpause': toggle(); return true;
        case 'stop': leave(); return true;
        case 'back': leave(); return true;
        default: showCard(); return false;
      }
    }
  }

  // ------------------------------------------------------------------ a plugin's own screen (the phone runs the plugin; this paints its tree)

  // The web keeps the TV's look for now (owner, 2026-11-06): the phone is always asked for the TV's tree at the expanded size.
  const SCREEN_DEVICE = 'tv';
  const SCREEN_SIZE = { widthClass: 'expanded', heightClass: 'medium', orientation: 'landscape' };

  /**
   * Opens [plugin]'s screen: the phone opens a session for it and answers its first tree; then a long poll brings every new one. What the person
   * does goes back as an event naming a node and a kind. Back asks the session first (a plugin's own routes), and leaves when it has nothing to pop.
   */
  function openPluginScreen(plugin, origin, onNote) {
    const mine = generation;
    let sessionId = null;
    let rev = 0;
    let left = false;
    let busy = false;
    const asking = h('div', { class: 'pm-ask' }, []);
    const view = createScreenView({
      doc: doc, S: S,
      // A slide or a tab changed in place: the remote walks the buttons on screen now, not the ones that left.
      relayout: () => { if (current === screen) grid.setRows(screen.rows()); },
      // A plugin's title: the person's Home card style (as the phone draws a plugin's rails), its name under it; posters a size up.
      titleCard: (item, size, press, key) => {
        const style = homeLook.style === 'posters' ? 'posters' : 'cards';
        const m = titleCardOf(withBase(item, api.url('')), { homeCardStyle: style }, 'sk');
        const asked = size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium';
        const metrics = cardMetrics(m.wide ? 'cards' : 'posters', m.wide ? asked : POSTER_STEP_UP[asked], m.wide);
        const card = pressable({ class: 'tv-card', 'data-key': 'sk:' + key, style: { width: 'calc(' + metrics.w + ' * var(--dp))', height: 'calc(' + metrics.h + ' * var(--dp))' }, 'aria-label': m.title }, [art(m.art, m.wide, m.title)], press);
        return h('div', { class: 'sk-title-card', style: { width: 'calc(' + metrics.w + ' * var(--dp))' } }, [card, h('p', { class: 'sk-title-cap' }, m.title)]);
      },
      send: (ev) => sendEvent(ev),
      ask: (question) => new Promise((resolve) => {
        const yes = h('button', { type: 'button', class: 'sk-btn sk-btn-primary', 'data-key': 'ask:yes' }, S.pluginScreenConfirmYes);
        const no = h('button', { type: 'button', class: 'sk-btn sk-btn-secondary', 'data-key': 'ask:no' }, S.pluginScreenConfirmNo);
        const done = (v) => { if (asking.parentNode) asking.parentNode.removeChild(asking); current = screen; grid.setRows(screen.rows()); resolve(v); };
        yes.addEventListener('click', () => done(true));
        no.addEventListener('click', () => done(false));
        clear(asking);
        asking.appendChild(h('div', { class: 'pm-panel pm-confirm' }, [h('p', { class: 'pm-title' }, question), h('div', { class: 'sk-row pm-confirm-actions' }, [no, yes])]));
        el.appendChild(asking);
        current = { el: asking, noRail: true, rows: () => [[no, yes]], back: () => done(false) };
        grid.setRows(current.rows());
        no.focus();
      }),
    });
    const el = h('main', { class: 'screen plugin-screen' }, [view.el]);
    const screen = {
      el: el, noRail: true,
      rows: () => rowsByTop(view.rows()),
      back: () => { if (view.hasPopup()) { sendEvent({ kind: 'popupDismiss' }); return; } goBack(); },
      release: () => {},
    };
    show(screen);
    view.render({ state: 'loading' });
    open();

    function leave() {
      if (left) return;
      left = true;
      view.forgetTyping();
      view.destroy();
      if (sessionId) api.screenClose(sessionId).catch(() => {});
      if (current === screen) show(origin);
    }

    async function goBack() {
      if (!sessionId) { leave(); return; }
      let r = null;
      try { r = await api.screenEvent(sessionId, { kind: 'back' }); } catch (e) { r = null; }
      if (!r || r.handled === false) leave();
    }

    async function sendEvent(ev) {
      if (!sessionId || left) return;
      try { await api.screenEvent(sessionId, ev); } catch (e) { if (e && e.code === 'not_found') fail(); }
    }

    function fail() { if (!left) view.render({ state: 'failed', message: S.pluginScreenFailed }); }

    async function open() {
      let r;
      try { r = await api.screenOpen({ pluginId: plugin.id, device: SCREEN_DEVICE, size: SCREEN_SIZE }); } catch (e) {
        if (left || mine !== generation) return;
        if (e && e.code === 'unsupported_here') { leave(); if (onNote) onNote(S.pluginNoScreen); return; }
        view.render({ state: 'failed', message: errorText(e, S) });
        return;
      }
      if (left || mine !== generation) { if (r && r.sessionId) api.screenClose(r.sessionId).catch(() => {}); return; }
      sessionId = r.sessionId;
      view.setTheme(r.theme || null, appColors());
      el.style.background = view.el.style.background || '';
      paint(r);
      poll();
    }

    function paint(r) {
      if (!r) return;
      if (typeof r.rev === 'number') rev = r.rev;
      if (r.closed) { leave(); return; }
      if (r.ui) {
        view.render(withBase(r.ui, api.url('')));
        if (current === screen) grid.setRows(screen.rows());
        if (!el.contains(doc.activeElement) && current === screen) grid.focusFirst();
      }
      (Array.isArray(r.go) ? r.go : []).forEach(handleGo);
    }

    /** What the session asks the web to do; whatever the web cannot do says so. */
    function handleGo(go) {
      if (!go || typeof go !== 'object' || left) return;
      if (go.phoneOnly) { say(S.pluginScreenPhoneOnly); return; }
      if (go.type === 'close') { leave(); return; }
      if ((go.type === 'title' || go.type === 'play') && (go.card || go.ref)) { openTitle(withBase(go.card || { ref: go.ref, title: go.title || '', kind: go.kind }, api.url('')), screen); return; }
      if (go.type === 'search' && go.q) { openSources(go.q, screen); return; }
      if (go.type === 'browse' && go.pluginId && go.ref) { openBrowse(go.pluginId, go.ref, go.title || plugin.name || '', screen); return; }
      say(S.pluginSoon);
    }

    /** A short notice over the screen for what the web cannot do (said, never silent). */
    function say(text) {
      const note = h('div', { class: 'pm-note-toast' }, text);
      el.appendChild(note);
      win.setTimeout(() => { if (note.parentNode) note.parentNode.removeChild(note); }, 4000);
    }

    async function poll() {
      while (!left && mine === generation) {
        let r;
        try { r = await api.screenUi(sessionId, rev); } catch (e) {
          if (left) return;
          if (e && e.code === 'not_found') { fail(); return; }
          await new Promise((res) => win.setTimeout(res, 1500));
          continue;
        }
        if (left) return;
        if (r && r.changed !== false) paint(r);
        else if (r && typeof r.rev === 'number') rev = r.rev;
      }
    }
  }

  // ------------------------------------------------------------------ a plugin's catalog ("Ver más")

  /** The plugin's catalog behind a "Ver más": its title, a grid of the Home's own cards, "Cargar más" while it has more. A card opens its title. */
  function openBrowse(pluginId, ref, title, origin) {
    const mine = generation;
    const heading = h('h1', { class: 'browse-title' }, title || '');
    const gridEl = h('div', { class: 'grid browse-grid' });
    const note = h('p', { class: 'note' }, S.loading);
    const moreBtn = button(S.browseMore, () => load(), { 'data-key': 'browse:more' });
    moreBtn.style.display = 'none';
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'browse:back', class: 'btn' });
    const el = h('main', { class: 'screen browse' }, [h('div', { class: 'browse-head' }, [backBtn, heading]), note, gridEl, h('div', { class: 'actions' }, [moreBtn])]);
    let cards = [];
    let next = null;
    let loading = false;
    const screen = { el: el, noRail: true, rows: () => [[backBtn]].concat(rowsByTop(cards), moreBtn.style.display === 'none' ? [] : [[moreBtn]]), back: () => show(origin) };
    show(screen);
    load();

    async function load() {
      if (loading) return;
      loading = true;
      let r;
      try { r = withBase(await api.browse(pluginId, ref, title, next || undefined), api.url('')); } catch (e) {
        loading = false;
        if (mine !== generation || current !== screen) return;
        note.textContent = errorText(e, S);
        return;
      }
      loading = false;
      if (mine !== generation) return;
      if (r && r.title && !title) heading.textContent = r.title;
      const from = cards.length;
      ((r && r.cards) || []).forEach((c) => {
        // The person's Home style here too: every title of the catalog in one shape.
        const m = titleCardOf(c, { homeCardStyle: homeLook.style === 'posters' ? 'posters' : 'cards' }, 'browse');
        const metrics = cardMetrics(m.wide ? 'cards' : 'posters', m.wide ? 'medium' : 'large', m.wide);
        const el_ = pressable({ class: 'tv-card', 'data-key': 'browse:' + (c.ref || cards.length), style: { width: 'calc(' + metrics.w + ' * var(--dp))', height: 'calc(' + metrics.h + ' * var(--dp))' }, 'aria-label': m.title }, [art(m.art, m.wide, m.title)], () => openTitle(c, screen));
        cards.push(el_);
        // Its name under it, as in a plugin's screen.
        gridEl.appendChild(h('div', { class: 'sk-title-card', style: { width: 'calc(' + metrics.w + ' * var(--dp))' } }, [el_, h('p', { class: 'sk-title-cap' }, m.title)]));
      });
      next = r && r.next ? r.next : null;
      moreBtn.style.display = next ? '' : 'none';
      note.textContent = cards.length ? '' : S.browseEmpty;
      note.style.display = cards.length ? 'none' : '';
      if (current === screen) {
        grid.setRows(screen.rows());
        if (from === 0 && cards.length) grid.focus(cards[0]);
        else if (cards[from]) grid.focus(cards[from]);
      }
    }
  }

  // ------------------------------------------------------------------ Mi biblioteca (the TV's library, its Favoritos one of its sections)

  /** One title of a catalog grid, drawn as the Ver más grid draws it: the person's card style, its name (and a line) under it. */
  function gridTitle(card, key, meta, onPress) {
    const m = titleCardOf(card, { homeCardStyle: homeLook.style === 'posters' ? 'posters' : 'cards' }, 'grid');
    const metrics = cardMetrics(m.wide ? 'cards' : 'posters', m.wide ? 'medium' : 'large', m.wide);
    const el = pressable({ class: 'tv-card', 'data-key': key, style: { width: 'calc(' + metrics.w + ' * var(--dp))', height: 'calc(' + metrics.h + ' * var(--dp))' }, 'aria-label': m.title }, [art(m.art, m.wide, m.title)], onPress);
    const wrap = h('div', { class: 'sk-title-card', style: { width: 'calc(' + metrics.w + ' * var(--dp))' } }, [el, h('p', { class: 'sk-title-cap' }, m.title), meta ? h('p', { class: 'cat-meta' }, meta) : null]);
    return { el: el, wrap: wrap };
  }

  /**
   * The TV's "Mi biblioteca": its sections as tabs (Todo, Series, Películas, Vistos and Favoritos) over a grid of the saved titles.
   * A title opens its page (the phone gave each the ref it opens by); one with no page searches its name across the plugins.
   */
  function openLibrary(start) {
    const mine = generation;
    let tab = LIBRARY_SECTIONS.indexOf(start) >= 0 ? start : 'all';
    let groups = null;
    let favorites = null;
    let failed = null;
    let tabEls = [];
    let cards = [];
    const tabsEl = h('div', { class: 'src-tabs cat-tabs' });
    const status = h('p', { class: 'note' }, S.loading);
    const gridEl = h('div', { class: 'browse-grid' });
    const el = h('main', { class: 'screen browse catalog' }, [h('div', { class: 'browse-head' }, [h('h1', { class: 'browse-title' }, S.library)]), tabsEl, status, gridEl]);
    const screen = { el: el, section: 'library', rows: () => [tabEls].concat(rowsByTop(cards)), back: () => show(homeScreen) };
    show(screen);
    load();

    async function load() {
      // Both at once: the library and the hearts are two reads of the phone's own database.
      const base = api.url('');
      const lib = api.library().then((r) => { groups = (r && withBase(r, base).groups) || []; }, (e) => { groups = []; failed = e; });
      const fav = api.favorites().then((r) => { favorites = (r && withBase(r, base).items) || []; }, () => { favorites = []; });
      await lib;
      if (mine !== generation) return;
      if (failed && current === screen) { fail(failed, () => { failed = null; show(screen); load(); }, () => show(homeScreen)); return; }
      paint(true);
      await fav;
      if (mine === generation && current === screen) paint(false);
    }

    function choose(key) {
      tab = key;
      paint(false);
    }

    function paint(first) {
      const key = focusedKey();
      clear(tabsEl);
      tabEls = librarySectionTabs(groups, favorites, S).map((t) => {
        const b = button(t.label + (t.count !== null ? '  ' + t.count : ''), () => choose(t.key), { 'data-key': 'lib:tab:' + t.key, class: 'src-tab' + (t.key === tab ? ' on' : '') });
        tabsEl.appendChild(b);
        return b;
      });
      clear(gridEl);
      cards = [];
      if (tab === 'favorites') {
        (favorites || []).forEach((c, i) => {
          const g = gridTitle(c, 'fav:' + (c.ref || i), c.pluginName || '', () => openTitle(c, screen));
          cards.push(g.el);
          gridEl.appendChild(g.wrap);
        });
      } else {
        libraryGroupsOf(groups, tab).forEach((grp) => {
          const v = libraryCardOf(grp, tab, S);
          const g = gridTitle(v.card, v.key, v.meta, () => (v.ref ? openTitle(v.card, screen) : openSources(v.title, screen, askOf(v.card))));
          cards.push(g.el);
          gridEl.appendChild(g.wrap);
        });
      }
      const waiting = tab === 'favorites' && favorites === null;
      status.textContent = cards.length ? '' : waiting ? S.loading : !(groups || []).length && tab !== 'favorites' ? S.libraryEmpty
        : tab === 'favorites' ? S.favoritesEmpty : tab === 'watched' ? S.libraryWatchedEmpty : S.librarySectionEmpty;
      status.style.display = cards.length ? 'none' : '';
      if (current !== screen) return;
      grid.setRows(screen.rows());
      if (first) grid.focus(cards[0] || tabEls[LIBRARY_SECTIONS.indexOf(tab)] || tabEls[0]);
      else if (key) { const same = findKey(el, key); if (same) grid.focus(same); }
    }
  }

  // ------------------------------------------------------------------ Categorías (the TV's: "Tus plugins", each plugin's own categories, the rows by genre)

  /** A Categorías tile: a wide card with the list's picture (else its initials on the plugin's colour) and its name under it. */
  function catalogTile(t, onPress) {
    const m = cardMetrics('cards', 'small', true);
    const a = t.image ? { type: 'image', src: t.image } : { type: 'letter', letter: initialsOf(t.title) };
    const el = pressable({ class: 'tv-card', 'data-key': t.key, style: { width: 'calc(' + m.w + ' * var(--dp))', height: 'calc(' + m.h + ' * var(--dp))' }, 'aria-label': t.title }, [art(a, true, t.title)], onPress);
    if (t.color && !t.image) el.style.background = t.color;
    const wrap = h('div', { class: 'sk-title-card', style: { width: 'calc(' + m.w + ' * var(--dp))' } }, [el, h('p', { class: 'sk-title-cap' }, t.title)]);
    return { el: el, wrap: wrap };
  }

  /**
   * The TV's Categorías: a section per group of tiles, in its order. A tile opens its plugin's "Ver más" over that list; a "Tus plugins"
   * tile lists that plugin's own lists. While the plugins' first pass of categories runs, the phone is asked again now and then.
   */
  function openCategories() {
    const mine = generation;
    let sections = [];
    let tileRows = []; // per section, its tiles
    let polls = 0;
    let timer = null;
    const body = h('div', { class: 'cat-sections' });
    const status = h('p', { class: 'note' }, S.loading);
    const el = h('main', { class: 'screen browse catalog' }, [h('div', { class: 'browse-head' }, [h('h1', { class: 'browse-title' }, S.categories)]), status, body]);
    const screen = {
      el: el,
      section: 'categories',
      rows: () => tileRows.reduce((all, tiles) => all.concat(rowsByTop(tiles)), []),
      back: () => show(homeScreen),
      release: () => { if (timer) { win.clearTimeout(timer); timer = null; } },
    };
    show(screen);
    load(true);

    async function load(first) {
      let r;
      try { r = withBase(await api.categories(), api.url('')); } catch (e) {
        if (mine === generation && current === screen && first) fail(e, () => { show(screen); load(true); }, () => show(homeScreen));
        return;
      }
      if (mine !== generation) return;
      sections = categorySectionsOf(r);
      paint(first, r && r.settled === false);
      if (r && r.settled === false && polls < POLL_MAX && current === screen) {
        polls++;
        timer = win.setTimeout(() => { timer = null; if (mine === generation && current === screen) load(false); }, POLL_MS);
      }
    }

    function paint(first, pending) {
      const key = focusedKey();
      clear(body);
      tileRows = sections.map((s) => {
        const tiles = s.tiles.map((t) => catalogTile(t, () => (t.shelf ? openPluginCatalogs(t, sections, screen) : openBrowse(t.pluginId, t.ref, t.title, screen))));
        body.appendChild(h('section', { class: 'cat-section' }, [h('h3', { class: 'row-title' }, s.title), h('div', { class: 'browse-grid' }, tiles.map((x) => x.wrap))]));
        return tiles.map((x) => x.el);
      });
      status.textContent = sections.length ? '' : pending ? S.stillLoading : S.categoriesEmpty;
      status.style.display = sections.length ? 'none' : '';
      if (current !== screen) return;
      grid.setRows(screen.rows());
      const same = key ? findKey(el, key) : null;
      if (same) grid.focus(same);
      else if ((first || !el.contains(doc.activeElement)) && tileRows.length) grid.focus(tileRows[0][0]);
    }
  }

  /** A "Tus plugins" tile: that plugin's own lists (the TV opens its page with all its catalogs), each opening its "Ver más". */
  function openPluginCatalogs(shelf, sections, origin) {
    const tiles = pluginCatalogsOf(sections, shelf.pluginId).map((t) => catalogTile(t, () => openBrowse(t.pluginId, t.ref, t.title, screen)));
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'catplugin:back' });
    const el = h('main', { class: 'screen browse' }, [
      h('div', { class: 'browse-head' }, [backBtn, h('h1', { class: 'browse-title' }, shelf.title)]),
      tiles.length ? null : h('p', { class: 'note' }, S.categoryNoTiles),
      h('div', { class: 'browse-grid' }, tiles.map((x) => x.wrap)),
    ]);
    const els = tiles.map((x) => x.el);
    const screen = { el: el, noRail: true, rows: () => [[backBtn]].concat(rowsByTop(els)), back: () => show(origin) };
    show(screen);
    if (els.length) grid.focus(els[0]);
  }

  // ------------------------------------------------------------------ Stremio collections (the TV's collection browser, read-only)

  /** Whether the phone keeps any Stremio collection for this profile: the menu's entry follows it. */
  async function refreshCollections() {
    const mine = generation;
    let r = null;
    try { r = await api.stremioCollections(); } catch (e) { r = null; }
    if (mine !== generation) return;
    hasCollections = !!(r && Array.isArray(r.collections) && r.collections.length);
    updateRail();
  }

  /**
   * The TV's collection browser: the collections (when there are several) and their lists as tabs, the list's addons as cards with their
   * logo, name, state and description. Installing or configuring one stays on the phone, where the person reviews what it asks for.
   */
  function openCollections() {
    const mine = generation;
    let collections = [];
    let at = 0;
    let list = null; // {type, id, name}
    let addons = [];
    let tabEls = [];
    let listEls = [];
    let cardEls = [];
    let seq = 0;
    const tabsEl = h('div', { class: 'src-tabs cat-tabs' });
    const listsEl = h('div', { class: 'chips coll-lists' });
    const status = h('p', { class: 'note' }, S.loading);
    const notice = h('p', { class: 'notice coll-notice' }, '');
    notice.style.display = 'none';
    const gridEl = h('div', { class: 'coll-grid' });
    const el = h('main', { class: 'screen browse catalog' }, [h('div', { class: 'browse-head' }, [h('h1', { class: 'browse-title' }, S.collections)]), tabsEl, listsEl, notice, status, gridEl]);
    const screen = {
      el: el,
      section: 'collections',
      rows: () => [tabEls, listEls].filter((r) => r.length).concat(rowsByTop(cardEls)),
      back: () => show(homeScreen),
    };
    show(screen);
    start();

    async function start() {
      let r;
      try { r = await api.stremioCollections(); } catch (e) {
        if (mine === generation && current === screen) fail(e, () => { show(screen); start(); }, () => show(homeScreen));
        return;
      }
      if (mine !== generation) return;
      collections = (r && r.collections) || [];
      if (!collections.length) { status.textContent = S.collectionsEmpty; paintTabs(); return; }
      pick(0, null);
    }

    function pick(index, ref) {
      at = index;
      const c = collections[at];
      list = ref || (c.lists && c.lists[0]) || null;
      paintTabs();
      load();
    }

    function paintTabs() {
      const key = focusedKey();
      clear(tabsEl);
      clear(listsEl);
      tabEls = collections.length > 1 ? collections.map((c, i) => {
        const b = button(c.name, () => pick(i, null), { 'data-key': 'coll:c:' + i, class: 'src-tab' + (i === at ? ' on' : '') });
        tabsEl.appendChild(b);
        return b;
      }) : [];
      tabsEl.style.display = tabEls.length ? '' : 'none';
      const c = collections[at];
      const lists = c && Array.isArray(c.lists) ? c.lists : [];
      listEls = lists.length > 1 ? lists.map((l) => {
        const on = !!list && l.type === list.type && l.id === list.id;
        const b = button(l.name, () => pick(at, l), { 'data-key': 'coll:l:' + l.type + '/' + l.id, class: 'btn chip' + (on ? ' on' : '') });
        listsEl.appendChild(b);
        return b;
      }) : [];
      if (lists.length === 1) listsEl.appendChild(h('h3', { class: 'row-title' }, lists[0].name));
      if (current !== screen) return;
      grid.setRows(screen.rows());
      const same = key ? findKey(el, key) : null;
      if (same) grid.focus(same);
    }

    async function load() {
      const my = ++seq;
      const c = collections[at];
      addons = [];
      paintCards();
      status.textContent = S.loading;
      let r;
      try { r = withBase(await api.stremioCollection(c.id, list ? list.type : undefined, list ? list.id : undefined), api.url('')); } catch (e) {
        if (my !== seq || mine !== generation) return;
        // The phone's own words for a list it could not read (never its address); any other failure as the app words it.
        status.textContent = e && e.code === 'plugin_error' && e.message ? e.message : errorText(e, S);
        return;
      }
      if (my !== seq || mine !== generation) return;
      addons = (r && r.addons) || [];
      status.textContent = addons.length ? fmt(S.collectionAddons, { n: addons.length }) : S.collectionEmpty;
      paintCards();
      if (current === screen && !el.contains(doc.activeElement)) { const first = cardEls[0] || listEls[0] || tabEls[0]; if (first) grid.focus(first); }
    }

    function paintCards() {
      const key = focusedKey();
      clear(gridEl);
      notice.style.display = 'none';
      cardEls = addons.map((a) => {
        const v = collectionCardOf(a, S);
        const box = h('span', { class: 'pm-icon coll-logo' }, []);
        if (v.image) box.appendChild(h('img', { src: sized(v.image, 96), alt: '', referrerpolicy: 'no-referrer', onerror: () => { clear(box).appendChild(h('span', { class: 'pm-init' }, initialsOf(v.title))); } }));
        else box.appendChild(h('span', { class: 'pm-init' }, initialsOf(v.title)));
        const card = pressable({ class: 'coll-card', 'data-key': v.key, 'aria-label': v.title }, [
          box,
          h('div', { class: 'coll-text' }, [
            h('p', { class: 'coll-name' }, v.title),
            v.status ? h('p', { class: 'coll-status' + (v.installed ? ' on' : '') }, v.status) : null,
            v.description ? h('p', { class: 'coll-desc' }, v.description) : null,
          ]),
        ], () => { notice.textContent = v.installed ? S.collectionInstalled : S.collectionInstallOnPhone; notice.style.display = ''; });
        gridEl.appendChild(card);
        return card;
      });
      if (current !== screen) return;
      grid.setRows(screen.rows());
      const same = key ? findKey(el, key) : null;
      if (same) grid.focus(same);
    }
  }

  // ------------------------------------------------------------------ the plugins modal (the TV's "Mis plugins": a search field and a grid of tiles)

  /**
   * The red Apps button's modal over the Home: a search field and a tile per plugin (its icon, or its initial on its colour). Settings
   * and adding plugins have no place here: they stay on the phone. A plugin's own screen comes next: for now its tile says so.
   */
  function openPluginsModal() {
    const prev = current;
    const before = doc.activeElement;
    let plugins = [];
    let tiles = [];
    const input = h('input', { type: 'text', class: 'pm-input', placeholder: S.pluginsSearch, 'aria-label': S.pluginsSearch, autocomplete: 'off', maxlength: '60', 'data-key': 'pm:search' });
    const note = h('p', { class: 'pm-note' }, '');
    const gridEl = h('div', { class: 'pm-grid' });
    const panel = h('div', { class: 'pm-panel', role: 'dialog', 'aria-label': S.pluginsTitle }, [h('h2', { class: 'pm-title' }, S.pluginsTitle), input, note, gridEl]);
    const backdrop = h('div', { class: 'pm-back' }, [panel]);
    const modal = { el: backdrop, noRail: true, rows: () => [[input]].concat(rowsByTop(tiles)), back: close };
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });
    input.addEventListener('input', paint);

    function tileOf(label, box, key, onPress) {
      return h('button', { type: 'button', class: 'pm-tile', 'data-key': key, onclick: onPress }, [box, h('span', { class: 'pm-name' }, label)]);
    }
    function iconBox(p) {
      const box = h('span', { class: 'pm-icon' }, []);
      if (p.color) box.style.background = p.color;
      if (p.icon) box.appendChild(h('img', { src: sized(p.icon, 128), alt: '', referrerpolicy: 'no-referrer' }));
      else box.appendChild(h('span', { class: 'pm-init' }, initialsOf(p.name)));
      return box;
    }
    function paint() {
      clear(gridEl);
      const shownList = pluginsMatching(plugins, input.value);
      tiles = [];
      shownList.forEach((p) => tiles.push(tileOf(p.name, iconBox(p), 'pm:' + p.id, () => { if (!p.hasScreens) { note.textContent = S.pluginNoScreen; return; } close(); openPluginScreen(p, current, (t) => { note.textContent = t; }); })));
      tiles.forEach((t) => gridEl.appendChild(t));
      note.textContent = !shownList.length && foldName(input.value) ? S.pluginsNoMatch : '';
      if (current === modal) grid.setRows(modal.rows());
    }
    function close() {
      if (current !== modal) return;
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      current = prev;
      grid.setRows(prev.rows());
      if (before && grid.position(before)) grid.focus(before);
      else if (before && before.focus && prev.el.contains(before)) before.focus();
      else grid.focusFirst();
    }

    (async () => {
      try { const r = withBase(await api.plugins(), api.url('')); plugins = (r && r.plugins) || []; } catch (e) { plugins = []; }
      if (current !== modal) return;
      paint();
      if (tiles.length) tiles[0].focus();
    })();
    (shell ? shell.el : mount).appendChild(backdrop);
    current = modal;
    paint();
    grid.setRows(modal.rows());
    if (tiles.length) tiles[0].focus();
  }

  // ------------------------------------------------------------------ adult content lock (the phone owns the code and the lock)

  async function refreshAdults() {
    const mine = generation;
    try {
      const state = await api.adults();
      if (mine !== generation) return;
      adultsState = state;
      if (homeScreen) homeScreen.paintAdults();
    } catch (e) { /* no lock button: the phone did not answer */ }
  }

  /** After the lock changed, what the phone shows changed too: ask again for Home and forget the old search. */
  function lockChanged(state) {
    adultsState = state;
    searchScreen = createSearch();
    liveScreen = createLive();
    homeScreen.paintAdults();
    show(homeScreen);
    homeScreen.load(true);
  }

  function openAdults() {
    const v = adultsView(adultsState);
    if (!v.visible) return;
    if (v.unlocked) {
      api.adultsLock().then(() => lockChanged(Object.assign({}, adultsState, { unlocked: false })), (e) => fail(e, () => show(homeScreen), () => show(homeScreen)));
      return;
    }
    openAdultsCode(v.canOpen ? '' : S.errUnlockNotAllowed);
  }

  /** The number pad: the remote's arrows move over the keys, Enter presses one, the TV's number keys type; the phone checks the code. */
  function openAdultsCode(notice) {
    const mine = generation;
    let code = '';
    let busy = false;
    const shown = h('p', { class: 'code-shown', 'aria-live': 'polite' }, '');
    const message = h('p', { class: 'notice' }, notice || '');
    const paint = () => { shown.textContent = '\u2022 '.repeat(code.length).trim() || '\u00a0'; };
    const press = (key) => { if (busy) return; code = keypadNext(code, key); message.textContent = ''; paint(); };
    const keyBtn = (label, key, extra) => button(label, () => press(key), Object.assign({ 'data-key': 'pad:' + key, class: 'btn pad-key' }, extra || {}));
    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => keyBtn(d, d));
    const delBtn = button(S.adultsDelete, () => press('back'), { 'data-key': 'pad:back', class: 'btn pad-key text' });
    const zeroBtn = keyBtn('0', '0');
    const okBtn = button(S.adultsOk, () => submit(), { 'data-key': 'pad:ok', class: 'btn pad-key text primary' });
    const cancelBtn = button(S.adultsCancel, () => show(homeScreen), { 'data-key': 'pad:cancel' });
    const rowsOfKeys = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), [delBtn, zeroBtn, okBtn], [cancelBtn]];
    const el = h('main', { class: 'screen adults-code' }, [
      h('h2', null, S.adultsCodeTitle), shown, message,
      h('div', { class: 'pad' }, [].concat.apply([], rowsOfKeys.slice(0, 4))), h('div', { class: 'actions' }, [cancelBtn]),
    ]);
    const screen = {
      el: el,
      noRail: true,
      rows: () => rowsOfKeys,
      back: () => show(homeScreen),
      onKey: (action, ev) => {
        const d = digitOf(ev);
        if (d === null) return false;
        press(d);
        return true;
      },
    };
    paint();
    show(screen);

    async function submit() {
      if (busy || !code) return;
      busy = true;
      const typed = code;
      try {
        await api.adultsUnlock(typed);
      } catch (e) {
        busy = false;
        if (mine !== generation) return;
        code = '';
        paint();
        if (e && e.code === 'locked_out') message.textContent = fmt(S.errLockedOut, { n: lockedOutMinutes(e.lockedOutMs) });
        else if (e && (e.code === 'wrong_code' || e.code === 'unlock_not_allowed' || e.code === 'no_code')) message.textContent = errorText(e, S);
        else fail(e, () => show(screen), () => show(homeScreen));
        return;
      }
      busy = false;
      if (mine !== generation) return;
      lockChanged(Object.assign({}, adultsState, { unlocked: true }));
    }
  }

  // ------------------------------------------------------------------ device

  const deviceName = (d) => ({ tv: S.deviceTv, desktop: S.deviceDesktop, phone: S.devicePhone })[d];

  /** Which kind of device this page is drawn for. Only this browser remembers it; the phone's app is not touched. */
  function openDevice() {
    const choices = ['auto'].concat(DEVICES);
    const label = (c) => (c === 'auto' ? fmt(S.deviceAuto, { name: deviceName(detectedDevice) }) : deviceName(c));
    const buttons = choices.map((c) => button(label(c), () => pick(c), { 'data-key': 'device:' + c, class: 'btn' + (c === devicePref ? ' primary' : ''), 'aria-pressed': c === devicePref ? 'true' : 'false' }));
    const backBtn = button(S.deviceBack, () => show(homeScreen), { 'data-key': 'device:back' });
    const el = h('main', { class: 'screen device' }, [
      h('h2', null, S.deviceTitle),
      h('p', null, fmt(S.deviceDetected, { name: deviceName(detectedDevice) })),
      h('div', { class: 'actions' }, buttons),
      h('p', { class: 'note' }, S.deviceNote),
      h('div', { class: 'actions' }, [backBtn]),
    ]);
    const screen = { el: el, section: 'device', rows: () => buttons.map((b) => [b]).concat([[backBtn]]), back: () => show(homeScreen) };
    show(screen);

    function pick(choice) {
      devicePref = choice;
      saveDevicePref(localStorageOf(win), choice);
      updateRail();
      openDevice();
    }
  }

  // ------------------------------------------------------------------ sources of a title (the TV's search screen for a Home card)

  /** Asks the phone for [title]'s sources (the TV's search across every plugin) and lists them with a tab per plugin; a result opens the title's page. */
  function openSources(title, origin, ask) {
    const mine = generation;
    const withIds = ask && ask.tmdbId && ask.type ? { type: ask.type, tmdbId: ask.tmdbId } : ask && ask.type ? { type: ask.type } : {};
    let all = [];
    let tabs = [];
    let tab = '';
    let next = null;
    let failed = false;
    let cardEls = [];
    let tabEls = [];
    let moreBtn = null;
    const status = h('p', { class: 'note' }, S.loading);
    const tabsEl = h('div', { class: 'src-tabs' });
    const grid2 = h('div', { class: 'grid src-grid' });
    const moreWrap = h('div', { class: 'more' });
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'sources:back' });
    const el = h('main', { class: 'screen sources' }, [h('h2', null, title), tabsEl, status, grid2, moreWrap, h('div', { class: 'actions' }, [backBtn])]);
    const screen = { el: el, section: 'home', rows: () => [tabEls.length ? tabEls : [backBtn]].concat(rowsByTop(cardEls), moreBtn ? [[moreBtn]] : [], [[backBtn]]), back: () => show(origin) };
    show(screen);

    function paint() {
      clear(tabsEl);
      clear(grid2);
      clear(moreWrap);
      tabEls = [];
      cardEls = [];
      tabs.forEach((t) => {
        const pid = t.pluginId || '';
        const b = button(t.name + '  ' + t.count, () => { tab = pid; paint(); repaint('sources:tab:' + t.key); }, { 'data-key': 'sources:tab:' + t.key, class: 'src-tab' + (pid === tab ? ' on' : '') });
        tabEls.push(b);
        tabsEl.appendChild(b);
      });
      sourceCardsOf(all, tab).forEach((item, i) => {
        const c = Object.assign(cardOf(item), { meta: item.pluginName || '', raw: item });
        const card = cardButton(c, 'source:' + c.ref + ':' + i, () => openTitle(c, screen), false);
        cardEls.push(card);
        grid2.appendChild(card);
      });
      status.textContent = all.length ? '' : (failed ? S.someFailed : fmt(S.noResults, { q: title }));
      moreBtn = next ? button(S.moreResults, () => {
        if (moreBtn.disabled) return;
        moreBtn.disabled = true; // one page at a time: a second press would ask for the same cursor
        load(next);
      }, { 'data-key': 'more' }) : null;
      if (moreBtn) moreWrap.appendChild(moreBtn);
    }

    async function load(cursor) {
      let answer;
      try {
        answer = withBase(await api.sources(title, withIds, cursor), api.url(''));
      } catch (e) {
        if (mine !== generation || current !== screen) return;
        fail(e, () => { show(screen); load(cursor); }, () => show(origin));
        return;
      }
      if (mine !== generation) return;
      const first = !cursor;
      const from = all.length;
      all = all.concat(Array.isArray(answer && answer.sources) ? answer.sources : []);
      if (first && Array.isArray(answer && answer.tabs)) tabs = answer.tabs;
      next = answer && typeof answer.next === 'string' && answer.next ? answer.next : null;
      failed = !!(answer && answer.failures && Object.keys(answer.failures).length);
      const key = focusedKey();
      paint();
      if (current === screen) {
        repaint(key);
        if (first && cardEls.length) grid.focus(cardEls[0]);
        else if (!first && cardEls.length > from) grid.focus(cardEls[from]);
      }
    }

    load(null);
  }

  // ------------------------------------------------------------------ search

  function openSearch() {
    show(searchScreen);
  }

  /** The menu's Search, as the TV has it: what is typed is searched in every source (the sources screen with a tab per plugin). */
  function createSearch() {
    const input = h('input', { type: 'search', class: 'search-input', placeholder: S.searchPlaceholder, 'aria-label': S.searchLabel, autocomplete: 'off', enterkeyhint: 'search', maxlength: '200' });
    const go = h('button', { type: 'submit', class: 'btn primary' }, S.search);
    const run = (text) => {
      const q = String(text || '').trim();
      if (q) openSources(q, screen, null);
    };
    const form = h('form', { class: 'search-form', role: 'search', onsubmit: (ev) => { ev.preventDefault(); run(input.value); } }, [input, go]);
    const screen = {
      el: h('main', { class: 'screen search' }, [form, h('p', { class: 'note' }, S.searchHint)]),
      section: 'search',
      rows: () => [[input, go]],
      back: () => show(homeScreen),
    };
    return screen;
  }

  // ------------------------------------------------------------------ title page

  function infoBlock(c, extra, phoneOnlyNote) {
    return h('div', { class: 'title-head' }, [
      art(c.art, c.art.type === 'backdrop', c.title),
      h('div', { class: 'title-info' }, [
        h('h1', null, c.title),
        c.meta ? h('p', { class: 'card-meta' }, c.meta) : null,
      ].concat(extra || [], [
        c.overview ? h('p', { class: 'overview' }, c.overview) : null,
        phoneOnlyNote ? h('p', { class: 'notice play-note' }, S.playOnPhone) : null,
      ])),
    ]);
  }

  /** A continue-watching item: it plays (the phone resumes where it stopped); one without a ref only shows what it is. */
  function openContinue(c) {
    const origin = current;
    if (c.ref) { openPlayer({ ref: c.ref, seriesRef: c.seriesRef, title: c.title }, origin); return; }
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'title:back' });
    const extra = [c.episodeTitle ? h('p', { class: 'episode-title' }, c.episodeTitle) : null];
    const el = h('main', { class: 'screen title' }, [h('header', { class: 'bar' }, [backBtn]), infoBlock(c, extra, true)]);
    show({ el: el, rows: () => [[backBtn]], back: () => show(origin) });
  }

  /** The title page as the TV draws it: the backdrop full screen, what it is, its TMDB logo (or name), facts, synopsis, credits and the play button; a series lists its seasons and episodes below. */
  function openTitle(c, origin) {
    const mine = generation;
    const raw = c.raw || c;
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'title:back', class: 'btn title-back' });
    backBtn.addEventListener('focus', () => { if (typeof showSeries === 'function') showSeries(); });
    const bg = h('img', { class: 'title-bg-img', alt: '', referrerpolicy: 'no-referrer' });
    const kicker = h('p', { class: 'title-kicker' }, kickerOf(raw, S));
    const logo = h('img', { class: 'title-logo', alt: '' });
    const name = h('h1', { class: 'title-name' }, c.title);
    const facts = h('p', { class: 'title-facts' }, factsOf(raw, null));
    const overview = h('p', { class: 'title-overview' }, c.overview || '');
    const credits = h('p', { class: 'title-credits' }, '');
    const actions = h('div', { class: 'title-actions' });
    const listWrap = h('div', { class: 'episodes' }, h('p', { class: 'note' }, S.loading));
    // What a favorite or a list item is saved from: the title as the phone listed it.
    const markCard = () => ({ ref: c.ref, title: c.title, poster: raw.poster, backdrop: raw.backdrop, overview: raw.overview || c.overview, year: raw.year || c.year, tmdbId: raw.tmdbId, imdbId: raw.imdbId });
    let isFavorite = false;
    const iconBtn = (key, label, icon, onPress) => h('button', { type: 'button', class: 'btn round', 'data-key': key, 'aria-label': label, onclick: onPress }, [svgIcon(doc, icon, 28)]);
    const heartBtn = c.ref ? iconBtn('title:favorite', S.favoriteLabel, 'heart', () => toggleHeart()) : null;
    const listBtn = c.ref ? iconBtn('title:lists', S.addToList, 'playlist_add', () => openLists(markCard(), screen)) : null;
    const hero = h('section', { class: 'title-hero' }, [
      h('div', { class: 'title-bg' }, [bg]),
      h('div', { class: 'title-shade' }),
      backBtn,
      h('div', { class: 'title-body' }, [kicker, logo, name, facts, overview, credits, actions]),
    ]);
    const el = h('main', { class: 'screen title tv-title' }, [hero, h('div', { class: 'title-more' }, [listWrap])]);
    const setBackdrop = (raw) => { const src = sized(raw); if (src && bg.getAttribute('src') !== src) bg.src = src; };
    setBackdrop(raw.backdrop || raw.poster || (c.art && c.art.src));
    logo.style.display = 'none';
    let seasonBtns = [];
    let episodeBtns = [];
    let playBtn = null;
    let listingRef = c.ref; // the ref of the list on screen: a season's own ref once the person picks one, which is what the phone wants as seriesRef
    let calls = 0;
    const screen = {
      el: el,
      noRail: true,
      rows: () => [[backBtn]].concat([[playBtn, heartBtn, listBtn].filter((b) => b)], [seasonBtns], [episodeBtns]),
      back: () => show(origin),
    };
    let currentEp = null;
    let episodeList = []; // the episodes of the list on screen, in order (the player's Next)
    let logoOk = false; // the TMDB logo has loaded
    let seriesArt = raw.backdrop || raw.poster || (c.art && c.art.src) || '';
    show(screen);
    load(c.ref, true);
    askInfo();
    if (heartBtn) {
      [heartBtn, listBtn].forEach((b) => b.addEventListener('focus', () => showSeries()));
      api.favorite(c.ref).then((r) => { if (mine === generation) paintHeart(!!(r && r.favorite)); }, () => { /* no heart state: the button still works */ });
    }

    function paintHeart(on) {
      isFavorite = on;
      heartBtn.replaceChild(svgIcon(doc, on ? 'heart_filled' : 'heart', 28), heartBtn.firstChild);
      heartBtn.classList.toggle('on', on);
    }

    async function toggleHeart() {
      const want = !isFavorite;
      paintHeart(want);
      try {
        const r = await api.setFavorite(markCard(), want);
        if (mine === generation && r && typeof r.favorite === 'boolean') paintHeart(r.favorite);
      } catch (e) {
        if (mine === generation) paintHeart(!want);
        if (mine === generation && current === screen) fail(e, () => show(screen), () => show(screen));
      }
    }

    /** What TMDB adds (logo, age rating, credits), as on the TV's page; the page is complete without it. */
    async function askInfo() {
      const ask = askOf(raw);
      if (!ask) return;
      let info = null;
      try { info = withBase(await api.heroInfo(ask, false), api.url('')); } catch (e) { info = null; }
      if (mine !== generation || current !== screen || !(info && info.found)) return;
      if (!el.classList.contains('series')) {
        facts.textContent = factsOf(raw, info);
        credits.textContent = creditsOf(info, S);
        if (!c.overview && info.overview) overview.textContent = info.overview;
      }
      if (info.logo) {
        logo.style.visibility = 'hidden';
        logo.onload = () => {
          logoOk = true;
          logo.style.visibility = '';
          if (!el.classList.contains('ep-mode')) { logo.style.display = ''; name.style.display = 'none'; }
        };
        logo.src = info.logo;
      }
    }

    async function load(ref, first) {
      const call = ++calls;
      let t;
      try {
        t = await api.title(ref);
      } catch (e) {
        if (mine !== generation || call !== calls || current !== screen) return;
        fail(e, () => { show(screen); load(ref, first); }, () => show(origin));
        return;
      }
      if (mine !== generation || call !== calls) return;
      listingRef = ref;
      const key = focusedKey();
      if (first && t && t.series) {
        const sr = t.series;
        if (sr.overview && !overview.textContent) overview.textContent = sr.overview;
        seriesArt = raw.backdrop || sr.backdrop || sr.poster || seriesArt;
        setBackdrop(seriesArt);
        if (!facts.textContent) {
          const fl = [];
          if (Array.isArray(sr.genres) && sr.genres.length) fl.push(sr.genres.join(', '));
          if (sr.runtimeMinutes) fl.push(fmt(S.minutes, { n: sr.runtimeMinutes }));
          facts.textContent = fl.join(' \u00b7 ');
        }
      }
      renderEpisodes(t || {}, first);
      if (current === screen) {
        repaint(key);
        // As on the TV, the remote starts on Reproducir.
        if (first && playBtn) grid.focus(playBtn);
      }
    }

    function playEpisode(ep) {
      const at = episodeList.indexOf(ep);
      const nextEp = at >= 0 ? episodeList[at + 1] : null;
      openPlayer({ ref: ep.ref, seriesRef: listingRef, title: (c.title ? c.title + ' \u00b7 ' : '') + (ep.title || episodeLabel(ep, S)), heading: fmt(S.episodeOnly, { e: ep.number }) + ' \u00b7 ' + (ep.title || ''), ask: askOf(raw), seriesTitle: c.title, art: c.art, next: nextEp ? () => playEpisode(nextEp) : null }, screen);
    }

    /** The series' own header (the TV's first look at a series): what it is and how many episodes, its logo, Reproducir for the episode on offer, the seasons and the episodes. */
    function showSeries() {
      if (!el.classList.contains('series')) return;
      el.classList.remove('ep-mode');
      kicker.textContent = [S.kindSeries, episodeBtns.length ? fmt(S.episodesN, { n: episodeBtns.length }) : '', raw.pluginName].filter((v) => v).join(' \u00b7 ');
      logo.style.display = logoOk ? '' : 'none';
      name.style.display = logoOk ? 'none' : '';
      name.textContent = c.title;
      facts.textContent = '';
      credits.textContent = '';
      overview.textContent = '';
      setBackdrop(seriesArt);
    }

    /** The page follows the focused episode, as the TV's does: its still behind, its title the big line, its number and synopsis under it. */
    function showEpisode(ep) {
      currentEp = ep;
      el.classList.add('ep-mode');
      kicker.textContent = c.title;
      logo.style.display = 'none';
      name.style.display = '';
      name.textContent = ep.title || episodeLabel(ep, S);
      const f = [episodeLabel(ep, S)];
      if (ep.runtimeMinutes) f.push(fmt(S.minutes, { n: ep.runtimeMinutes }));
      facts.textContent = f.join(' \u00b7 ');
      credits.textContent = '';
      overview.textContent = ep.overview || raw.overview || c.overview || '';
      setBackdrop(ep.still && /^https?:\/\//i.test(ep.still) ? ep.still : seriesArt);
      if (playBtn && currentEp) playBtn.textContent = fmt(S.playEpisodeN, { n: currentEp.number !== undefined ? currentEp.number : '' });
    }

    function playEpisode(ep) {
      openPlayer({ ref: ep.ref, seriesRef: listingRef, title: (c.title ? c.title + ' \u00b7 ' : '') + (ep.title || episodeLabel(ep, S)), seriesTitle: c.title, art: c.art }, screen);
    }

    function episodeCard(ep) {
      const when = [dateText(ep.airDate, lang)];
      if (ep.runtimeMinutes) when.push(fmt(S.minutes, { n: ep.runtimeMinutes }));
      const kids = [
        ep.still && /^https?:\/\//i.test(ep.still) ? h('img', { class: 'ep-still', src: sized(ep.still, 360), alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'ep-still' }, ''),
        h('span', { class: 'ep-label' }, episodeLabel(ep, S)),
        ep.title ? h('span', { class: 'ep-title' }, ep.title) : null,
        h('span', { class: 'ep-when' }, when.filter((v) => v).join(' \u00b7 ')),
      ];
      const card = pressable({ class: 'ep-card', 'data-key': 'episode:' + ep.ref, 'aria-label': ep.title || episodeLabel(ep, S) }, kids, () => playEpisode(ep));
      card.addEventListener('focus', () => showEpisode(ep));
      return card;
    }

    function renderEpisodes(t, first) {
      const seasons = Array.isArray(t.seasons) ? t.seasons : [];
      const episodes = Array.isArray(t.episodes) ? t.episodes : [];
      clear(listWrap);
      if (first) {
        seasonBtns = seasons.filter((sr) => sr && sr.ref).map((sr) => {
          const b = button(sr.title || fmt(S.seasonN, { n: sr.number }), () => { markSeason(b); load(sr.ref, false); }, { 'data-key': 'season:' + sr.number, class: 'btn chip' + (sr.current ? ' on' : '') });
          return b;
        });
        const old = el.querySelector('.seasons');
        if (old) old.parentNode.removeChild(old);
        if (seasonBtns.length > 1) {
          el.querySelector('.title-more').insertBefore(h('section', { class: 'seasons' }, [h('h3', { class: 'row-title' }, S.seasonHeading), h('div', { class: 'chips' }, seasonBtns)]), listWrap);
          seasonBtns.forEach((b) => b.addEventListener('focus', showSeries));
        } else seasonBtns = [];
        el.classList.toggle('seasons-on', seasonBtns.length > 1);
      }
      const isSeries = episodes.length > 0 || seasons.length > 0;
      el.classList.toggle('series', isSeries);
      episodeList = episodes;
      episodeBtns = episodes.map(episodeCard);
      if (episodeBtns.length) {
        listWrap.appendChild(h('h3', { class: 'row-title' }, S.episodes));
        listWrap.appendChild(h('div', { class: 'ep-row' }, episodeBtns));
        currentEp = episodes[0];
      } else if (seasons.length) {
        listWrap.appendChild(h('p', { class: 'note' }, S.noEpisodes));
      }
      // A series plays the episode on screen; a title with no episodes (a movie) plays from its own card.
      if (episodeBtns.length) {
        playBtn = button(fmt(S.playEpisodeN, { n: episodes[0].number !== undefined ? episodes[0].number : 1 }), () => playEpisode(currentEp || episodes[0]), { class: 'btn primary', 'data-key': 'title:play' });
        playBtn.addEventListener('focus', showSeries);
      }
      else playBtn = !seasons.length ? button(S.play, () => openPlayer({ ref: c.ref, title: c.title, heading: c.title, ask: askOf(raw), seriesTitle: c.title, art: c.art }, screen), { class: 'btn primary', 'data-key': 'title:play' }) : null;
      clear(actions);
      [playBtn, heartBtn, listBtn].forEach((b) => { if (b) actions.appendChild(b); });
      if (!episodeBtns.length && !seasons.length) clear(listWrap);
      if (episodeBtns.length) showSeries();
    }

    function markSeason(b) {
      seasonBtns.forEach((x) => x.classList.toggle('on', x === b));
    }
  }

  // ------------------------------------------------------------------ add to a list (the title page's list button)

  /** The profile's lists with a mark on those holding the title: pressing one adds or removes it; a new list can be made with the title in it. */
  function openLists(card, origin) {
    const mine = generation;
    let lists = [];
    let rowBtns = [];
    const status = h('p', { class: 'note' }, S.loading);
    const listsEl = h('div', { class: 'lists-pick' });
    const input = h('input', { type: 'text', class: 'search-input', placeholder: S.listNamePlaceholder, 'aria-label': S.listNamePlaceholder, autocomplete: 'off', maxlength: '100' });
    const createBtn = h('button', { type: 'submit', class: 'btn primary' }, S.createList);
    const form = h('form', { class: 'search-form', onsubmit: (ev) => { ev.preventDefault(); create(); } }, [input, createBtn]);
    const backBtn = button(S.back, () => show(origin), { 'data-key': 'lists:back' });
    const screen = {
      el: h('main', { class: 'screen lists' }, [h('h2', null, S.addToList), h('h3', { class: 'row-title' }, card.title || ''), status, listsEl, h('h3', { class: 'row-title' }, S.newList), form, h('div', { class: 'actions' }, [backBtn])]),
      noRail: true,
      rows: () => rowBtns.map((b) => [b]).concat([[input, createBtn], [backBtn]]),
      back: () => show(origin),
    };
    show(screen);
    refresh(true);

    function paint() {
      clear(listsEl);
      rowBtns = lists.map((l) => {
        const b = h('button', { type: 'button', class: 'btn list-row' + (l.contains ? ' on' : ''), 'data-key': 'list:' + l.id, 'aria-pressed': l.contains ? 'true' : 'false', onclick: () => toggle(l) }, [
          h('span', { class: 'list-check' }, l.contains ? '\u2713' : ''),
          h('span', { class: 'list-name' }, l.name),
          h('span', { class: 'list-count' }, fmt(S.itemsCount, { n: l.count })),
        ]);
        listsEl.appendChild(b);
        return b;
      });
      status.textContent = lists.length ? '' : S.noLists;
    }

    async function refresh(first) {
      let r;
      try { r = await api.lists(card.ref); } catch (e) { if (mine === generation && current === screen) fail(e, () => { show(screen); refresh(first); }, () => show(origin)); return; }
      if (mine !== generation) return;
      lists = Array.isArray(r && r.lists) ? r.lists : [];
      const key = focusedKey();
      paint();
      if (current === screen) { repaint(key); if (first && rowBtns.length) grid.focus(rowBtns[0]); else if (first) grid.focus(input); }
    }

    async function apply(call) {
      let updated;
      try { updated = await call(); } catch (e) { if (mine === generation && current === screen) fail(e, () => show(screen), () => show(origin)); return; }
      if (mine !== generation) return;
      if (updated && updated.id) {
        const at = lists.findIndex((l) => l.id === updated.id);
        if (at >= 0) lists[at] = updated; else lists.unshift(updated);
      }
      const key = focusedKey();
      paint();
      if (current === screen) repaint(key);
    }

    function toggle(l) { return apply(() => (l.contains ? api.listRemove(l.id, card.ref) : api.listAdd(l.id, card))); }

    function create() {
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      return apply(() => api.listCreate(name, card));
    }
  }

  // ------------------------------------------------------------------ player

  /**
   * Plays one title through the phone: POST /play answers a plan (a capability URL on the phone), the <video> plays it from where the phone says
   * the person stopped, progress goes back every 10 s and when the person pauses, seeks or leaves, and the phone saves it like its own player.
   */
  /** What the phone saves the card from: the series ref (an episode), the title and its picture. */
  function playExtra(info) {
    const extra = {};
    if (info.seriesRef) extra.seriesRef = info.seriesRef;
    if (info.copy !== undefined && info.copy !== null) extra.copy = info.copy;
    if (info.audio !== undefined && info.audio !== null) extra.audio = info.audio;
    if (info.resumeMs > 0) extra.resumeMs = info.resumeMs;
    if (info.seriesTitle || info.title) extra.title = info.seriesTitle || info.title;
    if (info.art && info.art.type === 'poster') extra.poster = info.art.src;
    if (info.art && info.art.type === 'backdrop') extra.backdrop = info.art.src;
    return extra;
  }

  function openPlayer(info, origin) {
    const mine = generation;
    const video = h('video', { class: 'video', playsinline: true });
    // Still inside the press that opened the player: lets this video start with sound once the phone answers, seconds from now.
    primePlay(video);
    const status = h('p', { class: 'player-status' }, S.playPreparing);
    const spinner = h('div', { class: 'pl-spinner', 'aria-hidden': 'true' });
    const backBtn = button(S.back, () => leave(), { 'data-key': 'player:back', class: 'btn player-back' });
    const round = (key, label, icon, onPress) => h('button', { type: 'button', class: 'pl-btn', 'data-key': key, 'aria-label': label, onclick: onPress }, [svgIcon(doc, icon, 28)]);
    const back10 = round('player:back10', S.back10, 'replay_10', () => seekBy(-10));
    const playBtn = round('player:play', S.playPause, 'play', () => toggle());
    const fwd10 = round('player:fwd10', S.forward10, 'forward_10', () => seekBy(10));
    const nextBtn = info.next ? round('player:next', S.nextEpisode, 'skip_next', () => goNext()) : null;
    const subsBtn = round('player:subs', S.subtitles, 'cc', () => togglePanel());
    subsBtn.style.display = 'none'; // shown once a subtitle file is ready
    const copiesBtn = round('player:copies', S.serverQuality, 'high_quality', () => openCopies());
    copiesBtn.style.display = 'none'; // shown when the title has two or more copies (servers and qualities)
    const langBtn = round('player:lang', S.audioLanguage, 'language', () => openAudio());
    langBtn.style.display = 'none'; // shown when the stream offers more than one audio language
    const dimBtn = round('player:dim', S.dimPanel, 'moon', () => openDim());
    const zoomBtn = round('player:zoom', S.zoomPanel, 'zoom_in', () => openZoom());
    const veil = h('div', { class: 'pl-veil' });
    const hud = h('p', { class: 'pl-hud' }, '');
    const seekEl = h('div', { class: 'pl-seek', role: 'slider', tabindex: '0', 'aria-label': S.seekBar, 'data-key': 'player:seek' }, [h('span', { class: 'pl-fill' }), h('span', { class: 'pl-thumb' })]);
    const clockNow = h('span', { class: 'pl-time' }, '0:00');
    const clockEnd = h('span', { class: 'pl-time' }, '');
    const logo = h('img', { class: 'player-logo', alt: '' });
    logo.style.display = 'none';
    const heading = h('p', { class: 'player-title' }, info.heading || info.title || '');
    const buttonRow = [back10, playBtn, fwd10].concat(nextBtn ? [nextBtn] : [], [h('span', { class: 'pl-sep' }), subsBtn, copiesBtn, langBtn, dimBtn, zoomBtn]);
    const el = h('main', { class: 'screen player' }, [
      video,
      veil,
      hud,
      h('div', { class: 'pl-top' }, [backBtn, logo, heading]),
      h('div', { class: 'pl-bottom' }, [h('div', { class: 'pl-seekrow' }, [clockNow, seekEl, clockEnd]), h('div', { class: 'pl-buttons' }, buttonRow)]),
      spinner,
      status,
    ]);
    const focusables = () => [back10, playBtn, fwd10].concat(nextBtn ? [nextBtn] : [], subsBtn.style.display === 'none' ? [] : [subsBtn], copiesBtn.style.display === 'none' ? [] : [copiesBtn], langBtn.style.display === 'none' ? [] : [langBtn], [dimBtn, zoomBtn]);
    const subTracks = []; // the text tracks made from the phone's subtitle files, in order
    const subCues = []; // each track's cues as read (title time moved by the remux offset), before the person's sync
    let subLabels = [];
    let subIndex = -1; // -1 is off
    let subDelay = 0; // seconds, the person's sync
    let subSize = 100; // percent
    let panel = null; // the open subtitle panel: { el, rows }
    let mini = null; // the open night mode, zoom or language panel: { el, items, btn }
    let dim = 0;
    let planCopies = []; // the title's copies as the phone listed them (servers and qualities): [{id, label, current}]
    let planAudio = []; // the audio tracks of a converted video: [{id, label, lang, current}]
    let zoom = 1;
    let fit = 'contain';
    let hudTimer = null;
    let reporter = null;
    let left = false;
    let hls = null; // hls.js, for a remux in a desktop browser
    let offsetMs = 0; // a remuxed video's clock starts before the title's 0:00 (plan.offsetMs)
    let titleDurationMs = 0; // the phone knows the title's length; a growing remux only knows what it has converted so far
    const dur = () => (titleDurationMs > 0 ? titleDurationMs : isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 + offsetMs : 0);
    const posMs = () => titleMs(video.currentTime, offsetMs);
    const screen = {
      el: el,
      noRail: true,
      rows: () => (panel ? panel.rows : mini ? [mini.items] : [[seekEl], focusables()]),
      back: () => { if (panel) closePanel(); else leave(); },
      onKey: onKey,
    };
    show(screen);
    // The overlay, as on the TV: hidden when playback opens; any key or a moving mouse brings it; it hides itself after 4.5 s while playing and stays while paused.
    let uiTimer = null;
    const HIDE_MS = 4500;
    const shown = () => el.classList.contains('ui-on');
    /** Subtitles sit low; while the overlay is up they rise above its bar (line is a percent of the picture, its bottom edge), and drop again when it hides. */
    const subLine = () => (shown() ? 66 : 92);
    function newCue(c) {
      const cue = new win.VTTCue(c.start, c.end, c.text);
      try { cue.snapToLines = false; cue.lineAlign = 'end'; cue.line = subLine(); } catch (e) { /* the browser keeps its own place */ }
      return cue;
    }
    function placeSubs() {
      subTracks.forEach((t) => { Array.prototype.slice.call(t.cues || []).forEach((cue) => { try { cue.line = subLine(); } catch (e) { /* skipped */ } }); });
    }
    function showUi() {
      el.classList.add('ui-on');
      placeSubs();
      if (uiTimer) win.clearTimeout(uiTimer);
      uiTimer = null;
      if (!video.paused && !panel && !mini) uiTimer = win.setTimeout(hideUi, HIDE_MS);
    }
    function hideUi() {
      if (uiTimer) { win.clearTimeout(uiTimer); uiTimer = null; }
      if (hudTimer) { win.clearTimeout(hudTimer); hudTimer = null; }
      if (panel || mini || video.paused) return;
      el.classList.remove('ui-on');
      placeSubs();
      if (doc.activeElement && doc.activeElement.blur && el.contains(doc.activeElement)) doc.activeElement.blur();
    }
    el.addEventListener('mousemove', showUi);
    el.addEventListener('click', (ev) => { if (ev.target === video) { if (shown()) hideUi(); else showUi(); } });
    seekEl.addEventListener('click', (ev) => {
      const r = seekEl.getBoundingClientRect();
      const d = dur();
      if (r.width > 0 && d > 0) video.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (d - offsetMs) / 1000;
      showUi();
    });
    function seekBy(d) { video.currentTime = seekTarget(video.currentTime, video.duration, d); showUi(); }
    function say(text) {
      hud.textContent = text;
      hud.classList.add('on');
      if (hudTimer) win.clearTimeout(hudTimer);
      hudTimer = win.setTimeout(() => hud.classList.remove('on'), 1400);
    }
    function closeMini(back) {
      if (!mini) return;
      const btn = mini.btn;
      if (mini.el.parentNode) mini.el.parentNode.removeChild(mini.el);
      mini = null;
      if (back && current === screen) { grid.setRows(screen.rows()); grid.focus(btn); }
      showUi();
    }
    /** A small panel above the buttons, as the TV opens its night mode and zoom panels; it holds the overlay up and Back closes it. */
    function openMini(btn, buttons) {
      if (mini && mini.btn === btn) { closeMini(true); return; }
      closeMini(false);
      const node = h('div', { class: 'pl-mini' }, buttons);
      el.querySelector('.pl-bottom').appendChild(node);
      mini = { el: node, items: buttons, btn: btn };
      if (uiTimer) { win.clearTimeout(uiTimer); uiTimer = null; }
      grid.setRows(screen.rows());
      grid.focus(buttons[Math.min(1, buttons.length - 1)]);
    }
    const miniBtn = (label, desc, key, onPress) => h('button', { type: 'button', class: 'pl-mini-btn', 'data-key': key, 'aria-label': desc, onclick: onPress }, label);
    function applyDim() { veil.style.opacity = String(dim / DIM_MAX); dimBtn.classList.toggle('lit', dim > 0); say(dim === 0 ? S.dimNormal : fmt(S.dimLevel, { n: dim * (100 / DIM_MAX) })); }
    function openDim() {
      openMini(dimBtn, [
        miniBtn('\u2212', S.dimDown, 'dim:down', () => { dim = dimStep(dim, -1); applyDim(); }),
        miniBtn(S.dimNormal, S.dimNormal, 'dim:normal', () => { dim = 0; applyDim(); }),
        miniBtn('+', S.dimUp, 'dim:up', () => { dim = dimStep(dim, 1); applyDim(); }),
      ]);
    }
    function applyZoom() {
      video.style.objectFit = fit;
      video.style.transform = zoom === 1 ? '' : 'scale(' + zoom + ')';
      zoomBtn.classList.toggle('lit', zoom !== 1 || fit !== 'contain');
      say(fit === 'fill' ? S.zoomStretch : fmt(S.zoomLevel, { n: Math.round(zoom * 100) }));
    }
    function openZoom() {
      openMini(zoomBtn, [
        miniBtn('\u2212', S.zoomOut, 'zoom:out', () => { zoom = zoomStep(zoom, -1); applyZoom(); }),
        miniBtn(S.zoomAuto, S.zoomAuto, 'zoom:auto', () => { fit = 'contain'; zoom = 1; applyZoom(); }),
        miniBtn('+', S.zoomIn, 'zoom:in', () => { zoom = zoomStep(zoom, 1); applyZoom(); }),
        miniBtn(S.zoomStretch, S.zoomStretch, 'zoom:stretch', () => { fit = 'fill'; zoom = 1; applyZoom(); }),
        miniBtn(S.zoomReset, S.zoomReset, 'zoom:reset', () => { fit = 'contain'; zoom = 1; applyZoom(); }),
      ]);
    }
    /** Plays the same title with another copy or audio track, from where it is. The video on screen keeps going until the phone has the new one ready; if the phone cannot, it says so and nothing changes. */
    let switching = false;
    async function switchTo(choice) {
      if (switching || left) return;
      switching = true;
      say(S.switching);
      const resume = Math.max(0, Math.round(posMs()));
      const extra = Object.assign(playExtra(info), choice, { resumeMs: resume });
      if (choice.copy !== undefined) delete extra.audio; // another copy has its own tracks
      let plan;
      try {
        plan = await api.play(info.ref, clientOf(video, win, await probeEme(win)), extra);
      } catch (e) {
        switching = false;
        if (!left && mine === generation) { say(errorText(e, S)); showUi(); }
        return;
      }
      switching = false;
      if (left || mine !== generation) { if (plan && plan.playId) api.end(plan.playId, { positionMs: 0, durationMs: 0, watched: false }).catch(() => {}); return; }
      const next = Object.assign({}, info, choice, { resumeMs: resume, preplan: plan });
      if (choice.copy !== undefined) delete next.audio;
      teardown(false);
      openPlayer(next, origin);
    }
    function remuxInstead() {
      if (left || mine !== generation) return;
      const resume = Math.max(0, Math.round(posMs()));
      teardown(false);
      openPlayer(Object.assign({}, info, { noTs: true, resumeMs: resume, preplan: null }), origin);
    }
    function openCopies() {
      if (planCopies.length < 2) return;
      const items = planCopies.map((c, i) => miniBtn((c.current ? '\u2713 ' : '') + c.label, c.label, 'copy:' + i, () => { closeMini(false); if (!c.current) switchTo({ copy: c.id }); }));
      openMini(copiesBtn, items);
    }
    /** The audio languages: the converted video's tracks (the phone lists them), else those of an HLS the browser reads itself; the one playing is ticked. */
    function openAudio() {
      // The audio streams muxed in a TS that hls.js plays itself (Kino's patched build lists them and switches without asking the phone).
      if (hls && hls.tsAudioTracks && hls.tsAudioTracks.length > 1) {
        let names = null;
        try { names = new win.Intl.DisplayNames([doc.documentElement.lang || lang], { type: 'language' }); } catch (e) { names = null; }
        const tracks = hls.tsAudioTracks.map((t, i) => ({ pid: t.pid, label: tsAudioLabelOf(t, i, names, S.audioN) }));
        const items = tracks.map((t, i) => miniBtn((t.pid === hls.tsAudioPid ? '\u2713 ' : '') + t.label, t.label, 'audio:' + i, () => { hls.tsAudioPid = t.pid; closeMini(true); }));
        openMini(langBtn, items);
        return;
      }
      // Another hls.js playlist with several audio renditions (a multi-audio HLS).
      if (hls && hls.audioTracks && hls.audioTracks.length > 1) {
        const items = hls.audioTracks.map((t, i) => miniBtn((i === hls.audioTrack ? '✓ ' : '') + (t.name || t.lang || String(i + 1)), t.name || t.lang || '', 'audio:' + i, () => { hls.audioTrack = i; closeMini(true); }));
        openMini(langBtn, items);
        return;
      }
      // The phone's list (a converted video, or a TS the player cannot switch itself, as on the LG): picking one asks the phone for that track.
      if (planAudio.length > 1) {
        const items = planAudio.map((t, i) => miniBtn((t.current ? '\u2713 ' : '') + t.label, t.label, 'audio:' + i, () => { closeMini(false); if (!t.current) switchTo({ audio: t.id }); }));
        openMini(langBtn, items);
        return;
      }
    }
    function offerAudio() {
      const some = planAudio.length > 1 || (hls && hls.audioTracks && hls.audioTracks.length > 1) || (hls && hls.tsAudioTracks && hls.tsAudioTracks.length > 1);
      if (some) langBtn.style.display = '';
      if (planCopies.length > 1) copiesBtn.style.display = '';
      if (current === screen && !mini && !panel) grid.setRows(screen.rows());
    }
    function goNext() { const go = info.next; teardown(false); if (go) go(); }
    function paintBar() {
      const d = dur();
      const p = progressOf(posMs(), d);
      seekEl.firstChild.style.width = (p * 100) + '%';
      seekEl.lastChild.style.left = (p * 100) + '%';
      clockNow.textContent = clockOf(posMs() / 1000);
      clockEnd.textContent = d > 0 ? clockOf(d / 1000) : '';
      seekEl.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    }
    function paintPlay() {
      playBtn.replaceChild(svgIcon(doc, video.paused ? 'play' : 'pause', 28), playBtn.firstChild);
      if (video.paused) showUi(); else showUi();
    }
    video.addEventListener('timeupdate', paintBar);
    video.addEventListener('durationchange', paintBar);
    video.addEventListener('play', paintPlay);
    video.addEventListener('pause', paintPlay);
    // The ring shows from the press until the first frames play, and again whenever the video waits for more.
    const spin = (on) => { spinner.style.display = on ? '' : 'none'; };
    video.addEventListener('playing', () => spin(false));
    video.addEventListener('waiting', () => { if (!video.paused) spin(true); });
    video.addEventListener('pause', () => spin(false));
    video.addEventListener('error', () => spin(false));
    // Started muted because the browser refused sound without a fresh gesture: the next key, click or tap brings the sound back.
    let soundBack = null;
    const startPlayback = () => autoplay(video, {
      onMuted: () => {
        if (left) return;
        status.textContent = S.soundOff;
        status.style.display = '';
        soundBack = () => {
          if (left) return;
          video.muted = false;
          if (status.textContent === S.soundOff) status.style.display = 'none';
          doc.removeEventListener('keydown', soundBack, true);
          doc.removeEventListener('pointerdown', soundBack, true);
          soundBack = null;
        };
        doc.addEventListener('keydown', soundBack, true);
        doc.addEventListener('pointerdown', soundBack, true);
      },
      onBlocked: () => { if (!left) { spin(false); status.textContent = S.pressToPlay; status.style.display = ''; } },
    });
    // The logo of the title, when TMDB has one (the same answer the title page used): the heading stays under it.
    if (info.ask) {
      api.heroInfo(info.ask, false).then((r) => {
        if (left || mine !== generation || !(r && r.found && r.logo)) return;
        logo.onload = () => { logo.style.display = ''; };
        logo.src = r.logo.indexOf('/__kino/') === 0 ? api.url(r.logo) : r.logo;
      }, () => {});
    }
    start();

    function teardown(watched) {
      if (left) return;
      left = true;
      if (soundBack) { doc.removeEventListener('keydown', soundBack, true); doc.removeEventListener('pointerdown', soundBack, true); soundBack = null; }
      if (uiTimer) { win.clearTimeout(uiTimer); uiTimer = null; }
      if (reporter) reporter.finish(posMs(), dur(), watched);
      if (hls) { try { hls.destroy(); } catch (e) { /* leaving anyway */ } hls = null; }
      try { video.pause(); video.removeAttribute('src'); while (video.firstChild) video.removeChild(video.firstChild); video.load(); } catch (e) { /* leaving anyway */ }
    }

    function leave() {
      teardown(false);
      if (current === screen) show(origin);
    }

    /** Pause or play. A browser blocks autoplay without a recent gesture (a slow /play outlives it): Enter or a click is that gesture. */
    function toggle() {
      if (!video.paused) { video.pause(); return; }
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    }

    function onKey(action, ev) {
      if (left) return false;
      if (panel) { if (action === 'subtitles') { closePanel(); return true; } return false; }
      if (mini) { if (action === 'back' || action === 'stop') { closeMini(true); return true; } return false; }
      const seek = (d) => { video.currentTime = seekTarget(video.currentTime, video.duration, d); };
      // Hidden: a key brings the overlay (the TV's rule), and the media keys act at once.
      if (!shown()) {
        switch (action) {
          case 'playpause': toggle(); return true;
          case 'play': if (video.paused) toggle(); return true;
          case 'pause': if (!video.paused) toggle(); return true;
          case 'rew': seek(-30); showUi(); return true;
          case 'ff': seek(30); showUi(); return true;
          case 'stop': leave(); return true;
          case 'back': leave(); return true;
          case 'subtitles': cycleSubtitles(); showUi(); return true;
          case 'enter': if (video.paused) toggle(); showUi(); return true; // a browser that blocked autoplay: Enter is the gesture
          default: showUi(); if (!doc.activeElement || !el.contains(doc.activeElement)) grid.focus(seekEl); return true;
        }
      }
      showUi();
      const onSeek = ev.target === seekEl;
      const onBack = ev.target === backBtn;
      switch (action) {
        case 'enter': if (onSeek) { toggle(); return true; } return false;
        case 'playpause': toggle(); return true;
        case 'play': if (video.paused) toggle(); return true;
        case 'pause': if (!video.paused) toggle(); return true;
        case 'left': if (onSeek) { seek(-10); return true; } return onBack;
        case 'right': if (onSeek) { seek(10); return true; } return onBack;
        case 'rew': seek(-30); return true;
        case 'ff': seek(30); return true;
        case 'stop': leave(); return true;
        case 'subtitles': cycleSubtitles(); return true;
        case 'back': if (!video.paused) { hideUi(); return true; } return false;
        default: return false;
      }
    }

    /** The label on the bar's button: the track shown, or "off". */
    function paintSubtitles() {
      subTracks.forEach((t, i) => { t.mode = i === subIndex ? 'showing' : 'disabled'; });
      subsBtn.setAttribute('aria-label', S.subtitles + ': ' + (subIndex >= 0 ? subLabels[subIndex] : S.subtitlesOff));
    }

    function cycleSubtitles() {
      if (!subTracks.length) return;
      subIndex = nextSubtitle(subTracks.length, subIndex);
      paintSubtitles();
    }

    /** The cues of every track again, from the ones as read, moved by the person's sync (a track's cues can only be removed while it is not disabled). */
    function applyCues() {
      subTracks.forEach((t) => { t.mode = 'hidden'; });
      subTracks.forEach((t, i) => {
        Array.prototype.slice.call(t.cues || []).forEach((c) => { try { t.removeCue(c); } catch (e) { /* already gone */ } });
        shiftCues(subCues[i], subDelay).forEach((c) => { try { t.addCue(newCue(c)); } catch (e) { /* a bad cue is skipped */ } });
      });
      paintSubtitles();
    }

    function applySize() {
      SUB_SIZES.forEach((p) => el.classList.remove('sub-' + p));
      el.classList.add('sub-' + subSize);
    }

    function closePanel() {
      if (!panel) return;
      if (panel.el.parentNode) panel.el.parentNode.removeChild(panel.el);
      panel = null;
      if (current === screen) { grid.setRows(screen.rows()); grid.focus(subsBtn); }
    }

    function togglePanel() {
      if (panel) { closePanel(); return; }
      if (!subTracks.length) return;
      const chips = [button(S.subtitlesOff, () => { subIndex = -1; paintSubtitles(); refreshPanel(); }, { 'data-key': 'sub:off' })]
        .concat(subLabels.map((l, i) => button(l, () => { subIndex = i; paintSubtitles(); refreshPanel(); }, { 'data-key': 'sub:' + i })));
      const syncVal = h('span', { class: 'val' }, '');
      const sizeVal = h('span', { class: 'val' }, '');
      const syncMinus = button('\u2212', () => { subDelay = syncNext(subDelay, -1); applyCues(); refreshPanel(); }, { 'data-key': 'sub:sync-', class: 'btn step-btn' });
      const syncPlus = button('+', () => { subDelay = syncNext(subDelay, 1); applyCues(); refreshPanel(); }, { 'data-key': 'sub:sync+', class: 'btn step-btn' });
      const sizeMinus = button('\u2212', () => { subSize = sizeNext(subSize, -1); applySize(); refreshPanel(); }, { 'data-key': 'sub:size-', class: 'btn step-btn' });
      const sizePlus = button('+', () => { subSize = sizeNext(subSize, 1); applySize(); refreshPanel(); }, { 'data-key': 'sub:size+', class: 'btn step-btn' });
      const closeBtn = button(S.subtitlesClose, () => closePanel(), { 'data-key': 'sub:close' });
      const node = h('div', { class: 'subs-panel' }, [
        h('h3', null, S.subtitles),
        h('div', { class: 'chips' }, chips),
        h('div', { class: 'step' }, [h('span', { class: 'step-label' }, S.subtitlesSync), syncMinus, syncVal, syncPlus]),
        h('div', { class: 'step' }, [h('span', { class: 'step-label' }, S.subtitlesSize), sizeMinus, sizeVal, sizePlus]),
        closeBtn,
      ]);
      function refreshPanel() {
        chips.forEach((c, i) => c.classList.toggle('on', i === subIndex + 1));
        syncVal.textContent = fmt(S.secondsShort, { n: (subDelay > 0 ? '+' : '') + subDelay });
        sizeVal.textContent = subSize + ' %';
      }
      refreshPanel();
      el.appendChild(node);
      panel = { el: node, rows: [chips, [syncMinus, syncPlus], [sizeMinus, sizePlus], [closeBtn]] };
      grid.setRows(panel.rows);
      grid.focus(chips[subIndex + 1]);
    }

    /** Reads each subtitle file from the phone and turns it into cues of a text track (SRT or WebVTT, moved by the remux's offset). Playback never waits for it. */
    async function loadSubtitles(list, origin) {
      const wanted = list.slice(0, 6);
      const loaded = [];
      for (let i = 0; i < wanted.length; i++) {
        try {
          const res = await win.fetch(mediaUrlFor(wanted[i].url, origin), { credentials: 'omit' });
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          let text;
          try { text = new win.TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new win.TextDecoder('windows-1252').decode(buf); }
          const cues = parseSubtitles(text, -offsetMs);
          if (cues.length) loaded.push({ lang: wanted[i].lang, cues: cues });
        } catch (e) { /* this file is skipped */ }
        if (left || mine !== generation) return;
      }
      if (!loaded.length) return;
      subLabels = subtitleLabels(loaded);
      loaded.forEach((l, i) => {
        const track = video.addTextTrack('subtitles', subLabels[i], l.lang);
        l.cues.forEach((c) => { try { track.addCue(newCue(c)); } catch (e) { /* a bad cue is skipped */ } });
        track.mode = 'disabled';
        subTracks.push(track);
        subCues.push(l.cues);
      });
      subIndex = defaultSubtitle(loaded, langOf(win.navigator.language) === 'en' ? 'en' : 'es');
      subsBtn.style.display = '';
      paintSubtitles();
      if (current === screen) grid.setRows(screen.rows());
    }

    function failed(err) {
      if (left || mine !== generation) return;
      // The video did not play but the title has other copies: stay here, say it and open the list instead of leaving the player.
      if (!err && planCopies.length > 1) {
        if (reporter) reporter.finish(posMs(), dur(), false);
        reporter = null;
        if (hls) { try { hls.destroy(); } catch (e) { /* stopping anyway */ } hls = null; }
        try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* stopping anyway */ }
        status.textContent = S.copyFailed;
        status.style.display = '';
        showUi();
        if (!mini) openCopies();
        return;
      }
      teardown(false);
      if (err) { fail(err, () => openPlayer(info, origin), () => show(origin)); return; }
      show(messageScreen(S.playFailed, null, null, [button(S.retry, () => openPlayer(info, origin)), button(S.back, () => show(origin))], () => show(origin)));
    }

    async function start() {
      let plan;
      try {
        const pre = info.preplan;
        info.preplan = null; // used once: a retry asks the phone again
        const client = clientOf(video, win, await probeEme(win));
        if (info.noTs) client.tsHevc = false; // hls.js could not read the TS: ask for the phone's remux
        plan = pre || await api.play(info.ref, client, playExtra(info));
      } catch (e) {
        failed(e);
        return;
      }
      if (left || mine !== generation) {
        if (plan && plan.playId) api.end(plan.playId, { positionMs: 0, durationMs: 0, watched: false }).catch(() => {});
        return;
      }
      const origin = hostedBase || win.location.origin; // where this page reached the phone: media goes the same way
      const url = plan && plan.plan && typeof plan.plan.url === 'string' ? mediaUrlFor(plan.plan.url, origin) : '';
      if (!plan || !plan.playId || !/^https?:\/\//i.test(url)) { failed(null); return; }
      const playId = plan.playId;
      planCopies = Array.isArray(plan.copies) ? plan.copies : [];
      planAudio = Array.isArray(plan.audioTracks) ? plan.audioTracks : [];
      offerAudio();
      offsetMs = Number(plan.plan.offsetMs) > 0 ? Number(plan.plan.offsetMs) : 0;
      titleDurationMs = Number(plan.durationMs) > 0 ? Number(plan.durationMs) : 0;
      reporter = createReporter({ send: (kind, payload) => (kind === 'end' ? api.end(playId, payload) : api.progress(playId, payload.positionMs, payload.durationMs)) });
      loadSubtitles(subtitleTracks(plan.subtitles), origin);
      // Start where the person stopped. A browser's native HLS may ignore a seek made as soon as the metadata is there (measured on Chrome 156:
      // the remux played from its first segment), so the seek is asked again on the first frames that can play, until the clock is there.
      let startAtSeconds = -1;
      const seekToStart = () => {
        if (startAtSeconds < 0) startAtSeconds = startInVideo(plan.resumeMs, offsetMs, video.duration);
        if (startAtSeconds > 0 && Math.abs(video.currentTime - startAtSeconds) > 2 && video.currentTime < startAtSeconds) {
          try { video.currentTime = startAtSeconds; } catch (e) { /* plays from where it is */ }
        }
      };
      video.addEventListener('loadedmetadata', seekToStart);
      video.addEventListener('canplay', seekToStart);
      video.addEventListener('playing', seekToStart);
      video.addEventListener('playing', () => { status.style.display = 'none'; });
      video.addEventListener('waiting', () => { status.textContent = S.playPreparing; status.style.display = ''; });
      video.addEventListener('timeupdate', () => { if (reporter) reporter.tick(posMs(), dur()); });
      video.addEventListener('pause', () => { if (reporter && !video.ended && !left) reporter.now(posMs(), dur()); });
      video.addEventListener('seeked', () => { if (reporter && !left) reporter.now(posMs(), dur()); });
      video.addEventListener('ended', () => {
        if (left) return;
        if (reporter) reporter.finish(dur(), dur(), true);
        teardown(true);
        if (current === screen) show(origin);
      });
      // The phone may offer a safer second route (plan.fallback): try it once before giving up.
      let fallback = plan.fallback && typeof plan.fallback.url === 'string' && /^https?:\/\//i.test(plan.fallback.url) ? mediaUrlFor(plan.fallback.url, origin) : '';
      video.addEventListener('error', () => {
        if (left) return;
        if (fallback) { const next = fallback; fallback = ''; video.src = next; const q = video.play(); if (q && q.catch) q.catch(() => {}); return; }
        failed(null);
      });
      video.addEventListener('click', toggle);
      // A protected title or a DASH one: Shaka, with the plan's keys or license address (never anywhere but its configuration).
      if (needsShaka(plan.plan)) {
        const cfg = shakaConfigOf(plan.plan.drm, origin);
        let shaka = null;
        if (cfg) { try { shaka = await loadShaka(doc, win); } catch (e) { shaka = null; } }
        if (left || mine !== generation) return;
        const begin = startInVideo(plan.resumeMs, offsetMs, NaN);
        if (shaka) hls = attachShaka(shaka, video, url, { config: cfg, startTime: begin, onFatal: () => failed(null) });
        if (!hls) { failed(null); return; }
        startPlayback();
        return;
      }
      // A remux is a growing playlist: the browser's own HLS plays it as a live stream (no seeking, no resume), hls.js plays it properly.
      let Hls = null;
      // An HLS the phone relays with its headers (hls-proxy) is plain VOD HLS: hls.js in a browser that has no HLS of its own, the platform player where there is one.
      const viaHls = plan.plan.route === 'remux' || (plan.plan.route === 'ts-playlist' && !isWebOs(win)) || (plan.plan.route === 'hls-proxy' && !/^(maybe|probably)$/.test(String(video.canPlayType('application/vnd.apple.mpegurl'))));
      if (viaHls) {
        try { Hls = await loadHls(doc, win); } catch (e) { Hls = null; }
        if (left || mine !== generation) return;
      }
      if (Hls && Hls.isSupported()) {
        const start = startInVideo(plan.resumeMs, offsetMs, NaN);
        // A TS playlist read by hls.js that fails (a codec it cannot convert): the same title again, asking the phone for the remux.
        const tsViaHls = plan.plan.route === 'ts-playlist' && !info.noTs;
        hls = attachHls(Hls, video, url, { startPosition: start > 0 ? start : -1, onFatal: () => (tsViaHls ? remuxInstead() : failed(null)) });
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, offerAudio);
        if (Hls.Events.TS_AUDIO_TRACKS_UPDATED) hls.on(Hls.Events.TS_AUDIO_TRACKS_UPDATED, offerAudio);
        hls.on(Hls.Events.MANIFEST_PARSED, offerAudio);
      } else {
        video.src = url;
      }
      // Starts on its own: with sound when the press that opened the player still counts, muted (and a key brings the sound) when not.
      startPlayback();
    }
  }

  // ------------------------------------------------------------------ the remote

  doc.addEventListener('keydown', (ev) => {
    const action = actionOf(ev);
    if (!current) return;
    if (railOpen) {
      if (action === 'right' || action === 'back') { ev.preventDefault(); closeRail(true); return; }
      if (action === 'left') { ev.preventDefault(); return; }
    } else if (current.onKey && current.onKey(action, ev)) { ev.preventDefault(); return; }
    if (!action) return;
    if (action === 'back') {
      ev.preventDefault();
      current.back();
      return;
    }
    if (action === 'enter') return; // buttons and the search form handle Enter natively
    const typing = ev.target && ev.target.tagName === 'INPUT';
    if (typing && (action === 'left' || action === 'right')) return; // arrows move the caret
    if (action === 'left' && !railOpen && rail) {
      const pos = grid.position(doc.activeElement);
      if (pos && pos.c === 0) { ev.preventDefault(); openRail(); return; } // Left at the edge reaches the menu, like the TV
    }
    if (grid.move(action, doc.activeElement)) ev.preventDefault();
  });

  win.addEventListener('resize', () => { if (current) repaint(); });

  // ------------------------------------------------------------------ is the phone still there

  let healthTimer = null;
  let health = { misses: 0, lost: null };

  /**
   * Asks the phone every HEALTH_EVERY_MS whether it still answers this code. A refused code goes back to the pairing screen at once
   * (the code is forgotten); silence does after a few misses, keeps the code and keeps asking: a phone that comes back with the same
   * code (the proxy resumes so) brings the page back by itself.
   */
  function watchPhone() {
    if (healthTimer) win.clearTimeout(healthTimer);
    healthTimer = win.setTimeout(async () => {
      healthTimer = null;
      const outcome = await probe((u, i) => win.fetch(u, i), hostedBase, token, HEALTH_TIMEOUT_MS, (f, ms) => win.setTimeout(f, ms));
      const wasLost = health.lost;
      health = nextHealth(health, outcome);
      if (outcome === 'ok' && wasLost === 'down') { boot(); return; }
      if (health.lost === 'unauthorized') { forgetToken(); token = null; showPair(S.phoneRefused); return; }
      if (health.lost === 'down' && wasLost !== 'down') showPair(S.phoneLost);
      watchPhone();
    }, HEALTH_EVERY_MS);
  }

  // ------------------------------------------------------------------ start

  async function boot() {
    if (!token) token = takeToken({ location: win.location, history: win.history, storage: storage });
    if (!token) { showPair(); return; } // nothing to ask the phone with: no API call at all
    // Safari, an iPad, Firefox: an https page cannot reach a phone that answers on plain http. The phone's own page can: go there at once.
    const instead = phonePageInstead(win.location.href, hostedBase, token, win.navigator);
    if (instead) { win.location.replace(instead); return; }
    api = createApi({ base: hostedBase, token: token, fetchImpl: win.fetch ? (u, i) => win.fetch(u, i) : null });
    showLoading();
    try {
      const session = await api.session();
      S = strings(session && session.language);
      doc.documentElement.lang = langOf(session && session.language);
      doc.title = S.appName;
    } catch (e) {
      fail(e, boot);
      return;
    }
    health = { misses: 0, lost: null };
    watchPhone();
    showProfiles();
  }

  boot();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startApp(window));
  else startApp(window);
}
