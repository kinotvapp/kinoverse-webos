// The plugin-screen renderer: draws the node tree the phone sends (the SDK's `ScreenNode`, already resolved for this device and size) as HTML,
// and sends back what the person does as events that NAME a node and a kind: the phone looks up the node's own action, the web never holds one.
// The web keeps the TV's look for now (owner, 2026-11-06). Chromium 79 (the LG): no flex `gap`, no `aspect-ratio`, no optional chaining.
import { PLUGIN_TEXT_VARS, pluginTextVars } from './theme.js';
import { h, clear } from './dom.js';
import { sizedSrc } from './imgsize.js';
import { svgIcon } from './icons.js';
import { accordionOpen, alignCss, frameKey, restoreScroll, scrollOffsets, columnLines, usesColumns, dp, inputType, inputValue, justifyCss, offsetPercent, onRoleVar, roleVar, spanPercent, stepperNext, stepperText, styleCss, textCss, unsupportedTypes } from './screenmodel.js';

/** The Material name an SDK icon name draws as (a few differ from the icon set's own keys). */
const ICON_ALIAS = { subtitles: 'cc', heart: 'heart_filled', tv: 'tv' };

/**
 * [opts]: `doc`, `S` (the page's texts), `send(event)` (to the phone), `ask(text)` -> Promise<boolean> (the question a button's `confirm` puts).
 * Returns `{el, render(ui), rows(), focusedKey(), destroy()}`: `el` is the screen's content; `render` paints each frame the phone sends.
 */
export function createScreenView(opts) {
  const doc = opts.doc;
  const S = opts.S;
  const send = opts.send;
  const ask = opts.ask || (() => Promise.resolve(true));
  // What changed on screen without a new frame (a page view's slide, a tab picked ahead of the plugin): the page re-reads its rows.
  const relayout = opts.relayout || (() => {});
  const titleCardHook = opts.titleCard || null; // (item, size, press) -> the Home's own card, so a plugin's titles look like Kino's
  const pageOf = {}; // the page each pageView shows, kept across the frames the phone sends
  const root = h('div', { class: 'sk' }, []);
  const toastEl = h('div', { class: 'sk-toast' }, []);
  const el = h('div', { class: 'sk-screen' }, [root, toastEl]);
  let toastTimer = null;
  let lastToast = 0;
  let timers = [];
  let lastFocusId = 0;
  let unsupported = [];
  const localText = {}; // what the person typed in a field, until the phone's own value catches up (a secret field's value never comes back)

  // Everything the remote can land on: controls, tappable nodes and the Home's own title cards (a focusable div with role button).
  const FOCUSABLE = 'button, input, select, textarea, [data-sk-tap], [role="button"][tabindex="0"]';

  function track(t) { timers.push(t); return t; }
  function dropTimers() { timers.forEach((t) => { if (t && t.interval) win().clearInterval(t.interval); else win().clearTimeout(t); }); timers = []; }
  function win() { return doc.defaultView || window; }

  /** Applies the node's own style fields to [target]; flex containers take their `gap` as a margin rule (no flex gap on the LG's Chromium). */
  function styled(target, node, kind) {
    const css = styleCss(node, kind);
    Object.keys(css).forEach((k) => {
      if (k === 'gap') target.style.setProperty('--sk-gap', css[k]);
      else target.style[k] = css[k];
    });
    return target;
  }

  function kids(node) { return Array.isArray(node.children) ? node.children.map(build).filter(Boolean) : []; }

  function tappable(target, node) {
    if (!node.tappable || node.enabled === false) return target;
    target.setAttribute('tabindex', '0');
    target.setAttribute('role', 'button');
    target.setAttribute('data-sk-tap', '');
    target.classList.add('sk-tap');
    target.addEventListener('click', (ev) => { ev.stopPropagation(); send({ kind: 'tap', key: node.key }); });
    target.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === target) { ev.preventDefault(); send({ kind: 'tap', key: node.key }); } });
    return target;
  }

  function withKey(target, node) {
    if (node.key) target.setAttribute('data-key', 'sk:' + node.key);
    if (node.enabled === false) target.classList.add('sk-disabled');
    return target;
  }

  function flexBox(cls, node, children) {
    const box = h('div', { class: cls }, children);
    styled(box, node, 'box');
    if (node.justify && justifyCss(node.justify)) box.style.justifyContent = justifyCss(node.justify);
    // The app's own rule: children sit at the start of the cross axis (stretch draws as start); centre and end move them.
    box.style.alignItems = node.align === 'center' ? 'center' : node.align === 'end' ? 'flex-end' : 'flex-start';
    // Text in a centred column centres its own lines too (a name that wraps stays under its picture), unless the text says otherwise.
    if (node.align === 'center') box.classList.add('sk-center');
    return tappable(withKey(box, node), node);
  }

  function iconEl(name, size) {
    const key = ICON_ALIAS[name] || name;
    const wrap = h('span', { class: 'sk-icon' }, [svgIcon(doc, key, size || 30)]);
    return wrap;
  }

  function button(node) {
    const variant = node.variant || 'primary';
    const kidsList = [];
    if (node.icon) kidsList.push(iconEl(node.icon, 26));
    if (variant !== 'icon' && node.label) kidsList.push(h('span', { class: 'sk-btn-label' }, node.label));
    const b = h('button', { type: 'button', class: 'sk-btn sk-btn-' + variant, 'data-key': 'sk:' + node.key, 'aria-label': node.label || node.icon || '' }, kidsList);
    if (node.enabled === false) b.disabled = true;
    styled(b, node, 'box');
    // A style colour paints the button's fill only for the filled variants; a text or icon button takes it as ink.
    if (node.color && (variant === 'text' || variant === 'icon')) { b.style.background = ''; b.style.color = roleVar(node.color); }
    b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (node.confirm) { const ok = await ask(node.confirm); if (!ok) return; }
      if (node.submit) send({ kind: 'submit', formKey: typeof node.submit === 'string' ? node.submit : node.formKey });
      else send({ kind: 'tap', key: node.key });
    });
    return b;
  }

  function field(node, control, extra) {
    const wrap = h('div', { class: 'sk-field' }, []);
    if (node.label) wrap.appendChild(h('label', { class: 'sk-label' }, node.label));
    wrap.appendChild(control);
    if (extra) wrap.appendChild(extra);
    if (node.error) wrap.appendChild(h('p', { class: 'sk-error' }, node.error));
    else if (node.hint) wrap.appendChild(h('p', { class: 'sk-hint' }, node.hint));
    return styled(wrap, node, 'box');
  }

  /** A text field sends each change after a short rest (the session keeps the value for forms) and commits on leaving the field or Enter. */
  function textField(node, multiline) {
    let value = inputValue(node);
    if (localText[node.key] !== undefined) { if (!node.secret && value === localText[node.key]) delete localText[node.key]; else value = localText[node.key]; }
    const control = multiline
      ? h('textarea', { class: 'sk-input', rows: '4', 'data-key': 'sk:' + node.key, placeholder: node.hint || '', maxlength: node.maxLength || false }, [])
      : h('input', { class: 'sk-input', type: inputType(node.kind, node.secret), 'data-key': 'sk:' + node.key, placeholder: node.hint || '', maxlength: node.maxLength || false, autocomplete: 'off' }, []);
    control.value = value;
    if (node.enabled === false) control.disabled = true;
    let t = null;
    const win_ = win();
    control.addEventListener('input', () => {
      localText[node.key] = control.value;
      if (t) win_.clearTimeout(t);
      t = track(win_.setTimeout(() => { t = null; send({ kind: 'change', key: node.key, value: control.value }); }, 250));
    });
    control.addEventListener('blur', () => { if (t) { win_.clearTimeout(t); t = null; } if (!node.secret) delete localText[node.key]; send({ kind: 'commit', key: node.key, value: control.value }); });
    control.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !multiline) { if (t) { win_.clearTimeout(t); t = null; } send({ kind: 'commit', key: node.key, value: control.value }); if (node.submittable !== false) send({ kind: 'fieldSubmit', key: node.key, value: control.value }); }
    });
    let trailing = null;
    if (!multiline && node.trailingIcon) {
      trailing = h('button', { type: 'button', class: 'sk-trailing', 'aria-label': node.trailingLabel || node.trailingIcon, 'data-key': 'sk:' + node.key + ':trailing' }, [iconEl(node.trailingIcon, 26)]);
      trailing.addEventListener('click', () => send({ kind: 'trailing', key: node.key, value: control.value }));
    }
    const row = trailing ? h('div', { class: 'sk-input-row' }, [control, trailing]) : control;
    return field(node, row);
  }

  function toggleLike(node, checkbox) {
    const on = inputValue(node);
    const box = h('button', { type: 'button', role: checkbox ? 'checkbox' : 'switch', 'aria-checked': String(on), class: 'sk-switch' + (checkbox ? ' sk-check' : '') + (on ? ' on' : ''), 'data-key': 'sk:' + node.key }, [h('span', { class: 'sk-knob' }, [])]);
    if (node.enabled === false) box.disabled = true;
    box.addEventListener('click', () => send({ kind: 'change', key: node.key, value: !on }));
    const row = h('div', { class: 'sk-toggle' }, [h('span', { class: 'sk-toggle-text' }, [h('span', { class: 'sk-label' }, node.label || ''), node.hint ? h('span', { class: 'sk-hint' }, node.hint) : null]), box]);
    return styled(row, node, 'box');
  }

  function optionsOf(node) { return Array.isArray(node.options) ? node.options : []; }

  function dropdown(node) {
    const sel = h('select', { class: 'sk-input sk-select', 'data-key': 'sk:' + node.key }, optionsOf(node).map((o) => h('option', { value: o.value }, o.label)));
    sel.value = inputValue(node);
    if (node.enabled === false) sel.disabled = true;
    sel.addEventListener('change', () => send({ kind: 'change', key: node.key, value: sel.value }));
    return field(node, sel);
  }

  function radioGroup(node) {
    const current = inputValue(node);
    const group = h('div', { class: 'sk-radios', role: 'radiogroup' }, optionsOf(node).map((o, i) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === current), class: 'sk-radio' + (o.value === current ? ' on' : ''), 'data-key': 'sk:' + node.key + ':' + i }, [h('span', { class: 'sk-dot' }, []), h('span', { class: 'sk-radio-label' }, o.label)]);
      b.addEventListener('click', () => send({ kind: 'change', key: node.key, value: o.value }));
      return b;
    }));
    return field(node, group);
  }

  function slider(node) {
    const min = typeof node.min === 'number' ? node.min : 0;
    const max = typeof node.max === 'number' ? node.max : 100;
    const input = h('input', { type: 'range', class: 'sk-range', min: min, max: max, step: node.step || 1, 'data-key': 'sk:' + node.key }, []);
    input.value = inputValue(node);
    const out = h('span', { class: 'sk-range-value' }, String(input.value));
    if (node.enabled === false) input.disabled = true;
    let t = null;
    input.addEventListener('input', () => { out.textContent = input.value; if (t) win().clearTimeout(t); t = track(win().setTimeout(() => { t = null; send({ kind: 'change', key: node.key, value: Number(input.value) }); }, 200)); });
    return field(node, h('div', { class: 'sk-range-row' }, [input, out]));
  }

  function chips(node) {
    const cur = inputValue(node);
    const picked = (v) => (node.multiple ? cur.indexOf(v) >= 0 : cur === v);
    const row = h('div', { class: 'sk-chips' }, optionsOf(node).map((o, i) => {
      const b = h('button', { type: 'button', class: 'sk-chip' + (picked(o.value) ? ' on' : ''), 'aria-pressed': String(picked(o.value)), 'data-key': 'sk:' + node.key + ':' + i }, o.label);
      b.addEventListener('click', () => {
        let v;
        if (node.multiple) v = picked(o.value) ? cur.filter((x) => x !== o.value) : cur.concat([o.value]);
        else v = picked(o.value) ? '' : o.value;
        send({ kind: 'change', key: node.key, value: v });
      });
      return b;
    }));
    return field(node, row);
  }

  function tabs(node) {
    const list = Array.isArray(node.tabs) ? node.tabs : [];
    const cur = typeof node.value === 'string' && node.value ? node.value : (list[0] && list[0].value);
    const bar = h('div', { class: 'sk-tabs', role: 'tablist' }, list.map((t, i) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'sk-tab' + (t.value === cur ? ' on' : ''), 'aria-selected': String(t.value === cur), 'data-key': 'sk:' + node.key + ':' + i }, t.label);
      b.addEventListener('click', () => {
        if (t.value === cur) return;
        // Marked at once (the phone does so too); the plugin's next frame confirms it with the tab's content.
        Array.prototype.forEach.call(bar.children, (x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
        bar.classList.add('sk-tabs-busy');
        send({ kind: 'change', key: node.key, value: t.value });
      });
      return b;
    }));
    return styled(bar, node, 'box');
  }

  function stateBlock(node, error) {
    const body = [];
    if (node.icon) body.push(iconEl(node.icon, 48));
    body.push(h('p', { class: 'sk-state-title' }, node.title || ''));
    if (node.text) body.push(h('p', { class: 'sk-state-text' }, node.text));
    const box = h('div', { class: 'sk-state' + (error ? ' sk-state-error' : '') }, body);
    return styled(box, node, 'box');
  }

  function banner(node) {
    const role = node.role || 'info';
    const body = [h('div', { class: 'sk-banner-body' }, [node.title ? h('p', { class: 'sk-banner-title' }, node.title) : null, h('p', { class: 'sk-banner-text' }, node.text || '')])];
    if (node.action && node.action.label) {
      const a = h('button', { type: 'button', class: 'sk-btn sk-btn-text', 'data-key': 'sk:' + node.key + ':action' }, node.action.label);
      a.addEventListener('click', () => send({ kind: 'bannerAction', key: node.key }));
      body.push(a);
    }
    if (node.dismissible) {
      const x = h('button', { type: 'button', class: 'sk-btn sk-btn-icon', 'aria-label': S.close || 'x', 'data-key': 'sk:' + node.key + ':dismiss' }, [iconEl('close', 24)]);
      x.addEventListener('click', () => send({ kind: 'dismissBanner', key: node.key }));
      body.push(x);
    }
    return styled(h('div', { class: 'sk-banner sk-banner-' + role, role: role === 'error' ? 'alert' : 'status' }, body), node, 'box');
  }

  function list(node) {
    const items = Array.isArray(node.items) ? node.items.map(build).filter(Boolean) : [];
    const cols = node.columns && node.columns > 1 ? node.columns : 1;
    const box = h('div', { class: cols > 1 ? 'sk-grid' : 'sk-col sk-list' }, items.length ? items : (node.empty ? [build(node.empty)] : []));
    if (cols > 1) box.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    if (node.loadingMore) box.appendChild(h('p', { class: 'sk-loading-more' }, S.loading || '...'));
    if (node.onEndReached && !node.done && !node.loadingMore) {
      const sentinel = h('div', { class: 'sk-sentinel' }, []);
      box.appendChild(sentinel);
      if (win().IntersectionObserver) {
        const io = new win().IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); send({ kind: 'endReached', key: node.key }); } });
        io.observe(sentinel);
      }
    }
    return styled(withKey(box, node), node, 'box');
  }

  function image(node) {
    const wrap = h('div', { class: 'sk-image' }, []);
    const ratios = { '16:9': 56.25, '2:3': 150, '1:1': 100, banner: 25 };
    if (node.aspect && ratios[node.aspect]) { wrap.classList.add('sk-ratio'); wrap.style.paddingTop = ratios[node.aspect] + '%'; }
    const fail = () => { clear(wrap); if (node.fallback) { const f = build(node.fallback); if (f) wrap.appendChild(f); } };
    if (node.url) {
      const img = h('img', { src: node.url, alt: node.alt || '', referrerpolicy: 'no-referrer' }, []);
      img.addEventListener('error', fail);
      wrap.appendChild(img);
    } else fail();
    return tappable(styled(wrap, node, 'box'), node);
  }

  function text(node) {
    const p = h('p', { class: 'sk-text' }, node.text || '');
    const css = textCss(node.style, node.bold);
    Object.keys(css).forEach((k) => { p.style[k] = css[k]; });
    if (node.maxLines) { p.style.display = '-webkit-box'; p.style.webkitLineClamp = String(node.maxLines); p.style.webkitBoxOrient = 'vertical'; p.style.overflow = 'hidden'; }
    styled(p, node, 'text');
    if (node.align && !node.textAlign) p.style.textAlign = node.align === 'start' ? 'left' : node.align === 'end' ? 'right' : node.align === 'center' ? 'center' : 'justify';
    return tappable(withKey(p, node), node);
  }

  function row(node) {
    const children = Array.isArray(node.children) ? node.children : [];
    if (!node.wrap) return flexBox('sk-row', node, kids(node));
    // No spans: a flow, children at their own width, the next line when the row is full (as the phone's FlowRow).
    if (!usesColumns(children)) return flexBox('sk-row sk-flow', node, kids(node));
    // The twelve-column layout: each child's span and offset place it, a child that does not fit starts the next line.
    const lines = columnLines(children).map((idxs) => {
      const cells = idxs.map((i) => {
        const c = children[i];
        const built = build(c);
        if (!built) return null;
        const cell = h('div', { class: 'sk-cell' }, [built]);
        const pct = spanPercent(c) || 100;
        cell.style.width = pct + '%';
        cell.style.flex = '0 0 ' + pct + '%';
        if (c.offset) cell.style.marginLeft = offsetPercent(c) + '%';
        return cell;
      }).filter(Boolean);
      const line = h('div', { class: 'sk-line' }, cells);
      if (node.align && alignCss(node.align) && node.align !== 'stretch') line.style.alignItems = alignCss(node.align);
      return line;
    });
    const box = h('div', { class: 'sk-col sk-columns' }, lines);
    styled(box, node, 'box');
    return tappable(withKey(box, node), node);
  }

  function card(node) {
    const variant = node.variant || 'plain';
    const box = h('div', { class: 'sk-card sk-card-' + variant + (node.flush ? ' sk-flush' : '') }, kids(node));
    styled(box, node, 'box');
    return tappable(withKey(box, node), node);
  }


  /** A title as the phone's Home card JSON: drawn with the app's own card (same shapes, same sizes), pressing it is a tap the phone answers with a `go`. */
  function titleCard(item, size, key, onPress) {
    const press = onPress || (() => send({ kind: 'tap', key: key }));
    if (titleCardHook && item) return titleCardHook(item, size || 'medium', press, key);
    const b = h('button', { type: 'button', class: 'sk-title-fallback', 'data-key': 'sk:' + key }, (item && item.title) || '');
    b.addEventListener('click', press);
    return b;
  }

  function titleRail(node) {
    const items = Array.isArray(node.items) ? node.items : [];
    const rowKids = items.map((it, i) => titleCard(it, node.size, node.key + ':' + i, () => send({ kind: 'tap', key: node.key, item: i })));
    const head = [h('p', { class: 'sk-rail-title' }, node.title || '')];
    if (node.more) {
      const more = h('button', { type: 'button', class: 'sk-btn sk-btn-text', 'data-key': 'sk:' + node.key + ':more' }, S.seeMore || '>');
      more.addEventListener('click', () => send({ kind: 'more', key: node.key }));
      head.push(more);
    }
    const railRow = h('div', { class: 'sk-rail-row' }, rowKids);
    endMark(railRow, node, true);
    const rail = h('div', { class: 'sk-rail' }, [h('div', { class: 'sk-rail-head' }, head), railRow]);
    return styled(withKey(rail, node), node, 'box');
  }

  function titleGrid(node) {
    const items = Array.isArray(node.items) ? node.items : [];
    const g = h('div', { class: 'sk-grid sk-title-grid' }, items.map((it, i) => titleCard(it, node.size, node.key + ':' + i, () => send({ kind: 'tap', key: node.key, item: i }))));
    g.style.gridTemplateColumns = 'repeat(' + (node.columns || 3) + ', 1fr)';
    endMark(g, node, false);
    return styled(withKey(g, node), node, 'box');
  }

  function heroCard(node) {
    const buttons = (Array.isArray(node.buttons) ? node.buttons : (Array.isArray(node.children) ? node.children : [])).map(build).filter(Boolean);
    const body = [h('div', { class: 'sk-hero-copy' }, [node.logo ? h('img', { class: 'sk-hero-logo', src: sizedSrc(node.logo, 500, (win() && win().devicePixelRatio) || 1), alt: node.title || '', referrerpolicy: 'no-referrer' }) : (node.title ? h('p', { class: 'sk-hero-title' }, node.title) : null), node.text ? h('p', { class: 'sk-hero-text' }, node.text) : null, buttons.length ? h('div', { class: 'sk-hero-actions' }, buttons) : null])];
    const hero = h('div', { class: 'sk-hero' }, [node.image ? h('img', { class: 'sk-hero-img', src: sizedSrc(node.image, (win() && win().innerWidth) || 1920, (win() && win().devicePixelRatio) || 1), alt: '', referrerpolicy: 'no-referrer' }) : null, h('div', { class: 'sk-hero-shade' }, []), body[0]]);
    return styled(withKey(hero, node), node, 'box');
  }

  /** The pages of a pageView, one at a time with its dots; the person's left and right arrows move through them while a page's own buttons keep the focus. */
  function pageView(node) {
    const pages = Array.isArray(node.children) ? node.children : [];
    if (!pages.length) return null;
    let idx = pageOf[node.key] != null ? pageOf[node.key] : (typeof node.page === 'number' ? node.page : 0);
    idx = Math.max(0, Math.min(pages.length - 1, idx));
    const built = pages.map(build);
    const view = h('div', { class: 'sk-pages' }, []);
    const dots = h('div', { class: 'sk-dots' }, pages.map((_, i) => h('button', { type: 'button', class: 'sk-dot-btn' + (i === idx ? ' on' : ''), 'aria-label': String(i + 1), 'data-key': 'sk:' + node.key + ':dot' + i }, [])));
    function go(i) {
      idx = (i + pages.length) % pages.length;
      pageOf[node.key] = idx;
      clear(view);
      if (built[idx]) view.appendChild(built[idx]);
      Array.prototype.forEach.call(dots.children, (d, k) => d.classList.toggle('on', k === idx));
      if (node.onPageChanged) send({ kind: 'change', key: node.key, value: idx });
      relayout();
    }
    Array.prototype.forEach.call(dots.children, (d, k) => d.addEventListener('click', () => go(k)));
    if (built[idx]) view.appendChild(built[idx]);
    const wrap = h('div', { class: 'sk-pageview' }, [view, pages.length > 1 ? dots : null]);
    wrap.addEventListener('keydown', (ev) => {
      if (pages.length < 2 || (ev.target && ev.target.tagName === 'INPUT')) return;
      if (ev.key === 'ArrowLeft' && ev.target && ev.target.className && String(ev.target.className).indexOf('sk-dot-btn') >= 0) { ev.preventDefault(); ev.stopPropagation(); go(idx - 1); }
      if (ev.key === 'ArrowRight' && ev.target && ev.target.className && String(ev.target.className).indexOf('sk-dot-btn') >= 0) { ev.preventDefault(); ev.stopPropagation(); go(idx + 1); }
    });
    if (pages.length > 1 && node.autoPlayMs > 0) {
      const timer = win().setInterval(() => { if (!wrap.contains(doc.activeElement) || String(doc.activeElement.className).indexOf('sk-dot-btn') >= 0) go(idx + 1); }, Math.max(2000, node.autoPlayMs));
      timers.push({ interval: timer });
    }
    return styled(withKey(wrap, node), node, 'box');
  }

  function scaffold(node) {
    const box = h('div', { class: 'sk-scaffold' }, kids(node));
    return styled(box, node, 'box');
  }

  /** The screen's top bar: its children left to right, the first action after the title pushed to the end. */
  function appBar(node) {
    const children = Array.isArray(node.children) ? node.children : [];
    const built = children.map(build);
    const bar = h('div', { class: 'sk-appbar' }, []);
    if (node.title && !node.titleNode) { const t = h('p', { class: 'sk-appbar-title' }, node.title); built.splice(children.length ? 1 : 0, 0, t); children.splice(children.length ? 1 : 0, 0, { type: 'text' }); }
    let pushed = false;
    built.forEach((b, i) => {
      if (!b) return;
      const c = children[i];
      if (!pushed && i > 0 && c.type === 'button' && children.slice(0, i).some((x) => x.type !== 'button')) { b.style.marginLeft = 'auto'; pushed = true; }
      bar.appendChild(b);
    });
    return styled(bar, node, 'box');
  }

  function avatar(node) {
    const size = typeof node.radius === 'number' && node.radius > 0 ? node.radius * 2 : (typeof node.size === 'number' ? node.size : 48);
    const a = h('div', { class: 'sk-avatar' }, []);
    a.style.width = dp(size);
    a.style.height = dp(size);
    if (node.image) a.appendChild(h('img', { src: node.image, alt: node.alt || '', referrerpolicy: 'no-referrer' }));
    else if (node.icon) a.appendChild(iconEl(node.icon, Math.round(size / 2)));
    else a.appendChild(h('span', null, String(node.text || '?').slice(0, 2).toUpperCase()));
    if (node.backgroundColor && roleVar(node.backgroundColor)) { a.style.background = roleVar(node.backgroundColor); a.style.color = onRoleVar(node.backgroundColor); }
    return tappable(styled(withKey(a, node), node, 'box'), node);
  }

  /** A row of a list: a title and a subtitle between its leading and trailing nodes. */
  function listTile(node) {
    const lead = node.leading ? build(node.leading) : null;
    const trail = node.trailing ? build(node.trailing) : null;
    const mid = h('div', { class: 'sk-tile-text' }, [h('p', { class: 'sk-tile-title' }, node.title || ''), node.subtitle ? h('p', { class: 'sk-tile-sub' }, node.subtitle) : null]);
    const row = h('div', { class: 'sk-tile' + (node.dense ? ' dense' : '') }, [lead, mid, trail]);
    return tappable(styled(withKey(row, node), node, 'box'), node);
  }

  /** The bottom navigation: one button per item; the chosen one is a `change`. */
  function navigationBar(node) {
    const items = Array.isArray(node.items) ? node.items : [];
    const bar = h('div', { class: 'sk-navbar', role: 'tablist' }, items.map((it) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'sk-nav' + (it.key === node.value ? ' on' : ''), 'aria-selected': String(it.key === node.value), 'data-key': 'sk:' + node.key + ':' + it.key }, [it.icon ? iconEl(it.icon, 26) : null, h('span', null, it.label || '')]);
      b.addEventListener('click', () => { if (it.key !== node.value) send({ kind: 'change', key: node.key, value: it.key }); });
      return b;
    }));
    return styled(bar, node, 'box');
  }

  /** A floating action: a round button at the bottom end of the screen. */
  function fab(node) {
    const b = h('button', { type: 'button', class: 'sk-fab', 'data-key': 'sk:' + node.key, 'aria-label': node.label || node.icon || '' }, [node.icon ? iconEl(node.icon, 28) : null, node.label ? h('span', null, node.label) : null]);
    b.addEventListener('click', () => send({ kind: 'tap', key: node.key }));
    return b;
  }

  /**
   * Load more at the end of a list, a rail or a grid: a mark after its last item; when it comes into view (the remote or the scroll reached it) the
   * phone is told once. The phone answers with the longer list, or with `done`.
   */
  function endMark(container, node, horizontal) {
    if (!node.onEndReached || node.done || node.loadingMore) {
      if (node.loadingMore) container.appendChild(h('span', { class: 'sk-more-spin' }, [h('span', { class: 'sk-spin' }, [])]));
      return;
    }
    const mark = h('span', { class: horizontal ? 'sk-sentinel sk-sentinel-h' : 'sk-sentinel' }, []);
    container.appendChild(mark);
    const W_ = win();
    if (!W_.IntersectionObserver) return;
    const io = new W_.IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); send({ kind: 'endReached', key: node.key }); }
    }, { rootMargin: horizontal ? '0px 600px 0px 0px' : '0px 0px 600px 0px' });
    io.observe(mark);
  }

  /** An accordion: each item a header the person opens and closes (the phone keeps which are open). */
  function accordion(node) {
    const open = accordionOpen(node);
    const items = (Array.isArray(node.items) ? node.items : []).map((it) => {
      const isOpen = open.indexOf(it.key) >= 0;
      const head = h('button', { type: 'button', class: 'sk-acc-head' + (isOpen ? ' on' : ''), 'aria-expanded': String(isOpen), 'data-key': 'sk:' + node.key + ':' + it.key }, [h('span', { class: 'sk-acc-title' }, it.title || ''), iconEl(isOpen ? 'expand_less' : 'expand_more', 26)]);
      head.addEventListener('click', () => send({ kind: 'accordion', key: node.key, item: it.key }));
      const body = isOpen ? h('div', { class: 'sk-acc-body' }, (Array.isArray(it.children) ? it.children : []).map(build).filter(Boolean)) : null;
      return h('div', { class: 'sk-acc-item' }, [head, body]);
    });
    return styled(withKey(h('div', { class: 'sk-accordion' }, items), node), node, 'box');
  }

  /** A loading placeholder: lines, a block, a circle or a card, softly pulsing. */
  function skeleton(node) {
    const shape = node.shape || 'line';
    const lines = shape === 'line' ? Math.max(1, Math.min(8, node.lines || 1)) : 1;
    const kids = [];
    for (let i = 0; i < lines; i++) kids.push(h('span', { class: 'sk-skel sk-skel-' + shape + (shape === 'line' && i === lines - 1 && lines > 1 ? ' last' : '') }, []));
    return styled(h('div', { class: 'sk-skeleton' }, kids), node, 'box');
  }

  /** A number with − and + (the remote's left and right on the value move it too). */
  function stepper(node) {
    const value = typeof node.value === 'number' ? node.value : (typeof node.min === 'number' ? node.min : 0);
    const minus = h('button', { type: 'button', class: 'sk-step-btn', 'aria-label': '-', 'data-key': 'sk:' + node.key + ':minus' }, [iconEl('remove', 24)]);
    const plus = h('button', { type: 'button', class: 'sk-step-btn', 'aria-label': '+', 'data-key': 'sk:' + node.key + ':plus' }, [iconEl('add', 24)]);
    const text = h('span', { class: 'sk-step-value' }, node.text || stepperText(node, value));
    if (node.enabled === false) { minus.disabled = true; plus.disabled = true; }
    if (typeof node.min === 'number' && value <= node.min) minus.disabled = true;
    if (typeof node.max === 'number' && value >= node.max) plus.disabled = true;
    minus.addEventListener('click', () => send({ kind: 'change', key: node.key, value: stepperNext(node, value, -1) }));
    plus.addEventListener('click', () => send({ kind: 'change', key: node.key, value: stepperNext(node, value, 1) }));
    return field(node, h('div', { class: 'sk-stepper' }, [minus, text, plus]));
  }

  /** A table: its columns by weight, an optional header row, zebra rows; a cell holds text or nodes. */
  function table(node) {
    const cols = Array.isArray(node.columns) && node.columns.length ? node.columns : null;
    const rows = Array.isArray(node.rows) ? node.rows : (Array.isArray(node.children) ? node.children.map((tr) => ({ key: tr.key, hidden: tr.hidden, cells: tr.children || [] })) : []);
    const widest = rows.reduce((m, r) => Math.max(m, (r.cells || []).length), 0);
    const template = cols ? cols.map((c) => (c.weight || 1) + 'fr').join(' ') : 'repeat(' + Math.max(1, widest) + ', 1fr)';
    const out = h('div', { class: 'sk-table' + (node.zebra ? ' zebra' : '') }, []);
    rows.forEach((r, ri) => {
      if (!r || r.hidden) return;
      const tr = h('div', { class: 'sk-tr' + (node.header && ri === 0 ? ' head' : '') }, []);
      tr.style.gridTemplateColumns = template;
      (r.cells || []).forEach((c) => {
        const kidsList = Array.isArray(c.children) && c.children.length ? c.children.map(build).filter(Boolean) : [String(c.text || '')];
        const td = h('div', { class: 'sk-td' }, kidsList);
        if (c.colSpan > 1) td.style.gridColumn = 'span ' + c.colSpan;
        if (c.align) td.style.textAlign = c.align === 'start' ? 'left' : c.align === 'end' ? 'right' : 'center';
        tr.appendChild(td);
      });
      out.appendChild(tr);
    });
    return styled(withKey(out, node), node, 'box');
  }

  /** Steps: done, current and pending; the current one shows its own nodes; with `stepTap` a done step can be pressed to go back to it. */
  function steps(node) {
    const items = Array.isArray(node.items) ? node.items : [];
    const list_ = h('div', { class: 'sk-steps' }, items.map((it, i) => {
      const state = it.state === 'done' || it.state === 'current' ? it.state : 'pending';
      const mark = h('span', { class: 'sk-step-mark' }, state === 'done' ? [iconEl('check', 20)] : String(i + 1));
      const textBox = h('div', { class: 'sk-step-text' }, [h('p', { class: 'sk-step-title' }, it.title || ''), it.summary ? h('p', { class: 'sk-hint' }, it.summary) : null]);
      const body = state === 'current' && Array.isArray(it.children) && it.children.length ? h('div', { class: 'sk-step-body' }, it.children.map(build).filter(Boolean)) : null;
      let head = h('div', { class: 'sk-step-head' }, [mark, textBox]);
      if (state === 'done' && node.stepTap) {
        head = h('button', { type: 'button', class: 'sk-step-head sk-step-press', 'data-key': 'sk:' + node.key + ':' + it.key }, [mark, textBox]);
        head.addEventListener('click', () => send({ kind: 'step', key: node.key, item: it.key }));
      }
      return h('div', { class: 'sk-step sk-step-' + state }, [head, body]);
    }));
    return styled(withKey(list_, node), node, 'box');
  }

  /** A scroll; when the plugin listens (`onScroll`) its settled position, 0 at the start to 1 at the end, goes to the phone once it stops. */
  function scrollNode(node) {
    const horizontal = node.direction === 'horizontal';
    const sc = flexBox('sk-scroll' + (horizontal ? ' sk-hscroll' : ''), node, kids(node));
    if (node.onScroll) {
      let t = null;
      sc.addEventListener('scroll', () => {
        if (t) win().clearTimeout(t);
        t = win().setTimeout(() => {
          t = null;
          const max = horizontal ? sc.scrollWidth - sc.clientWidth : sc.scrollHeight - sc.clientHeight;
          const at = max > 0 ? (horizontal ? sc.scrollLeft : sc.scrollTop) / max : 0;
          send({ kind: 'scroll', key: node.key, value: Math.max(0, Math.min(1, Math.round(at * 100) / 100)) });
        }, 300);
      });
    }
    return sc;
  }

  /** A QR code: drawn by the phone as a picture when it can send one; otherwise its label and where to find it. */
  function qr(node) {
    const kidsList = [];
    if (node.image) kidsList.push(h('img', { class: 'sk-qr-img', src: node.image, alt: node.label || '' }));
    else kidsList.push(h('div', { class: 'sk-qr-missing' }, [iconEl('info', 40), h('p', { class: 'sk-hint' }, S.pluginQrOnPhone)]));
    if (node.label) kidsList.push(h('p', { class: 'sk-qr-label' }, node.label));
    return styled(withKey(h('div', { class: 'sk-qr' }, kidsList), node), node, 'box');
  }

  function build(node) {
    if (!node || typeof node !== 'object' || node.hidden) return null;
    switch (node.type) {
      case 'col': return flexBox('sk-col', node, kids(node));
      case 'row': return row(node);
      case 'box': { const b = flexBox('sk-box', node, kids(node)); return b; }
      case 'card': return card(node);
      case 'scroll': return scrollNode(node);
      case 'grid': { const g = h('div', { class: 'sk-grid' }, kids(node)); g.style.gridTemplateColumns = 'repeat(' + (node.columns || 2) + ', 1fr)'; return tappable(withKey(styled(g, node, 'box'), node), node); }
      case 'spacer': { const s = h('div', { class: 'sk-spacer' }, []); return styled(s, node, 'box'); }
      case 'divider': return styled(h('div', { class: 'sk-divider' }, []), node, 'box');
      case 'text': return text(node);
      case 'image': return image(node);
      case 'icon': { const i = iconEl(node.name, 30); styled(i, node, 'text'); return i; }
      case 'badge': return styled(h('span', { class: 'sk-badge' }, node.text || ''), node, 'box');
      case 'progress': {
        const bar = h('div', { class: 'sk-progress' + (typeof node.value === 'number' ? '' : ' sk-indeterminate') }, [h('span', { class: 'sk-bar' }, [])]);
        if (typeof node.value === 'number') bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, node.value)) * 100) + '%';
        return styled(h('div', { class: 'sk-progress-wrap' }, [bar, node.label ? h('p', { class: 'sk-hint' }, node.label) : null]), node, 'box');
      }
      case 'loading': return styled(h('div', { class: 'sk-loading' }, [h('span', { class: 'sk-spin' }, []), h('span', null, node.text || S.loading || '')]), node, 'box');
      case 'button': return button(node);
      case 'textInput': return textField(node, false);
      case 'textArea': return textField(node, true);
      case 'toggle': return toggleLike(node, false);
      case 'checkbox': return toggleLike(node, true);
      case 'dropdown': return dropdown(node);
      case 'radioGroup': return radioGroup(node);
      case 'slider': return slider(node);
      case 'chips': return chips(node);
      case 'tabs': return tabs(node);
      case 'emptyState': return stateBlock(node, false);
      case 'errorState': return stateBlock(node, true);
      case 'banner': return banner(node);
      case 'list': return list(node);
      case 'scaffold': return scaffold(node);
      case 'appBar': return appBar(node);
      case 'pageView': return pageView(node);
      case 'heroCard': return heroCard(node);
      case 'titleCard': return titleCard(node.item, node.size, node.key, null);
      case 'titleRail': return titleRail(node);
      case 'titleGrid': return titleGrid(node);
      case 'avatar': return avatar(node);
      case 'listTile': return listTile(node);
      case 'navigationBar': return navigationBar(node);
      case 'fab': return fab(node);
      case 'pages': return pageView(node);
      case 'accordion': return accordion(node);
      case 'skeleton': return skeleton(node);
      case 'stepper': return stepper(node);
      case 'table': return table(node);
      case 'steps': return steps(node);
      case 'qr': return qr(node);
      case 'settings': return banner({ key: node.key, role: 'info', text: S.pluginSettingsOnPhone });
      case 'form': return flexBox('sk-col sk-form', node, kids(Object.assign({}, node, { children: tagSubmit(node) })));
      default: return Array.isArray(node.children) && node.children.length ? flexBox('sk-col', node, kids(node)) : null;
    }
  }

  /** A form's own submit buttons know which form they belong to. */
  function tagSubmit(form) {
    function tag(n) {
      if (!n || typeof n !== 'object') return n;
      const copy = Object.assign({}, n);
      if (copy.type === 'button' && copy.submit) copy.formKey = form.key;
      if (Array.isArray(copy.children)) copy.children = copy.children.map(tag);
      return copy;
    }
    return (Array.isArray(form.children) ? form.children : []).map(tag);
  }

  function showToast(t) {
    clear(toastEl);
    if (!t || !t.text) { toastEl.classList.remove('on'); return; }
    toastEl.appendChild(h('span', null, t.text));
    if (t.action && t.action.label) {
      const b = h('button', { type: 'button', class: 'sk-btn sk-btn-text', 'data-key': 'sk:toast' }, t.action.label);
      b.addEventListener('click', () => send({ kind: 'toast', id: t.id }));
      toastEl.appendChild(b);
    }
    toastEl.classList.add('on');
    if (toastTimer) win().clearTimeout(toastTimer);
    toastTimer = win().setTimeout(() => toastEl.classList.remove('on'), 4000);
  }

  /** The one pop-up the session has open (an answer's dialog or sheet, or a declared popup opened by key): its body, its buttons or its menu items. */
  function popupEl(pop) {
    const body = [];
    if (pop.title) body.push(h('p', { class: 'sk-popup-title' }, pop.title));
    (Array.isArray(pop.children) ? pop.children : []).forEach((c) => { const b = build(c); if (b) body.push(b); });
    if (pop.kind === 'menu') {
      (Array.isArray(pop.items) ? pop.items : []).forEach((it) => {
        const b = h('button', { type: 'button', class: 'sk-menu-item', 'data-key': 'sk:menu:' + it.index }, [it.icon ? iconEl(it.icon, 26) : null, h('span', null, it.label)]);
        b.addEventListener('click', () => send({ kind: 'menuItem', index: it.index }));
        body.push(b);
      });
    }
    const buttons = Array.isArray(pop.buttons) ? pop.buttons : [];
    if (buttons.length) {
      body.push(h('div', { class: 'sk-popup-actions' }, buttons.map((bt) => {
        const b = h('button', { type: 'button', class: 'sk-btn sk-btn-' + (bt.variant || 'text'), 'data-key': 'sk:popup:' + bt.index }, bt.label);
        b.addEventListener('click', () => send({ kind: 'popupButton', index: bt.index }));
        return b;
      })));
    }
    const panel = h('div', { class: 'sk-popup sk-popup-' + (pop.kind || 'dialog') }, body);
    const back = h('div', { class: 'sk-popup-back' }, [panel]);
    back.addEventListener('click', (ev) => { if (ev.target === back) send({ kind: 'popupDismiss' }); });
    return back;
  }

  let lastFrame = null;

  function focusableEls() {
    return Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)).filter((e) => !e.disabled && e.offsetParent !== null);
  }

  return {
    el: el,
    /** Paints a frame: the tree after Kino resolved it. Focus goes back to the same node (and the caret to its place) after the repaint. */
    render: function (ui) {
      // The same frame again paints nothing: a rebuild would reset its lists and reload its pictures for no change.
      const frame = frameKey(ui);
      if (frame !== null && frame === lastFrame) return;
      lastFrame = frame;
      const scrolled = scrollOffsets(root);
      const active = doc.activeElement;
      const key = active && root.contains(active) ? active.getAttribute('data-key') : null;
      let sel = null;
      if (key && active && typeof active.selectionStart === 'number') sel = { a: active.selectionStart, b: active.selectionEnd };
      dropTimers();
      clear(root);
      if (!ui || ui.state === 'loading' || !ui.root) {
        root.appendChild(h('p', { class: 'sk-loading' }, [h('span', { class: 'sk-spin' }, []), h('span', null, S.loading || '')]));
        return;
      }
      if (ui.state === 'failed') {
        root.appendChild(stateBlock({ title: (ui.message || S.pluginScreenFailed || ''), icon: 'error' }, true));
        if (ui.failure) {
          const retry = h('button', { type: 'button', class: 'sk-btn sk-btn-primary', 'data-key': 'sk:retry' }, S.retry || 'OK');
          retry.addEventListener('click', () => send({ kind: 'retry' }));
          root.appendChild(retry);
        }
        return;
      }
      unsupported = unsupportedTypes(ui.root);
      const tree = build(ui.root);
      if (tree) root.appendChild(tree);
      if (ui.popup) root.appendChild(popupEl(ui.popup));
      if (ui.toast && ui.toast.id !== lastToast) { lastToast = ui.toast.id; showToast(ui.toast); }
      restoreScroll(root, scrolled); // each list where the person left it, before the focus below scrolls to its node
      const want = (ui.focus && ui.focus.id !== lastFocusId) ? 'sk:' + ui.focus.key : key;
      if (ui.focus) lastFocusId = ui.focus.id;
      if (want) {
        const target = root.querySelector('[data-key="' + String(want).replace(/"/g, '\\"') + '"]');
        if (target && target.focus) { target.focus(); if (sel && typeof target.setSelectionRange === 'function' && want === key) { try { target.setSelectionRange(sel.a, sel.b); } catch (e) { /* not a text field */ } } }
      }
    },
    rows: function () {
      const pop = root.querySelector('.sk-popup');
      if (pop) return Array.prototype.slice.call(pop.querySelectorAll(FOCUSABLE)).filter((e) => !e.disabled);
      return focusableEls();
    },
    hasPopup: function () { return !!root.querySelector('.sk-popup'); },
    /** The plugin's palette (its accent and surfaces, as the app tints its screen); null keeps Kino's. */
    setTheme: function (theme, app) {
      const t = theme && typeof theme === 'object' ? theme : {};
      const text = pluginTextVars(t, app);
      if (el.style && el.style.removeProperty) {
        PLUGIN_TEXT_VARS.forEach((name) => el.style.removeProperty(name));
        Object.keys(text).forEach((name) => el.style.setProperty(name, text[name]));
      }
      const set = (role, v) => { if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) root.style.setProperty('--sk-' + role, v); else root.style.removeProperty('--sk-' + role); };
      set('primary', t.primary);
      set('onPrimary', t.onPrimary);
      set('surface', t.surface);
      // A plugin's own surface also fills its circles and chips (Kino's would show its light page on a dark plugin).
      set('surfaceVariant', t.surface);
      set('primaryContainer', t.highlight);
      if (typeof t.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.background)) el.style.background = t.background; else el.style.background = '';
    },
    forgetTyping: function () { Object.keys(localText).forEach((k) => { delete localText[k]; }); },
    unsupported: function () { return unsupported.slice(); },
    destroy: function () { dropTimers(); if (toastTimer) win().clearTimeout(toastTimer); },
  };
}
