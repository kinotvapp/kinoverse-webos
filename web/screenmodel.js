// The pure half of the plugin-screen renderer: how a node's style tokens (the SDK's scales) become CSS, and what each input holds.
// The phone sends the tree already resolved for this device and size (Kino's `ScreenUi.Showing`); nothing here decides what to draw, only how.

/** A length in the page's dp unit (the TV's scale), so a plugin's spacing and sizes follow the screen like Kino's own. */
export function dp(n) {
  return 'calc(' + Number(n) + ' * var(--dp))';
}

const SPACING = [0, 4, 8, 12, 16, 24, 32, 48];
const SIZES = [16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640];

/** A spacing token (the SDK's scale); anything off it is 0, as the app draws it. */
export function spacing(n) {
  return SPACING.indexOf(n) >= 0 ? n : 0;
}

/** A size token (the SDK's scale); null when off it. */
export function sizeOf(n) {
  return SIZES.indexOf(n) >= 0 ? n : null;
}

/** The corner radius of a radius token, in dp; 9999 for `full` (a pill or a circle). */
export function radiusDp(token) {
  switch (token) {
    case 'none': return 0;
    case 'small': return 4;
    case 'medium': return 8;
    case 'large': return 16;
    case 'full': return 9999;
    default: return null;
  }
}

/** The CSS variable of a colour role (defined in styles.css under `.sk`); '' for anything that is not a role. */
export function roleVar(role) {
  return ['primary', 'secondary', 'surface', 'muted', 'warning', 'error', 'onPrimary', 'primaryContainer', 'surfaceVariant'].indexOf(role) >= 0 ? 'var(--sk-' + role + ')' : '';
}

/** The content colour on a container painted with [role] (the app's own pairs). */
export function onRoleVar(role) {
  switch (role) {
    case 'primary': case 'secondary': case 'error': return 'var(--sk-onPrimary)';
    case 'warning': return '#000';
    case 'onPrimary': return 'var(--sk-primary)';
    case 'muted': return 'var(--sk-surface)';
    default: return 'var(--sk-onSurface)';
  }
}

/** Padding or margin as four sides in dp: a number for every side, or `{x, y, top, end, bottom, start}`; null when none is set. */
export function edgesOf(value) {
  if (value == null) return null;
  if (typeof value === 'number') { const n = spacing(value); return { top: n, end: n, bottom: n, start: n }; }
  if (typeof value !== 'object') return null;
  const x = value.x != null ? spacing(value.x) : null;
  const y = value.y != null ? spacing(value.y) : null;
  return {
    top: spacing(value.top != null ? value.top : (y != null ? y : 0)),
    end: spacing(value.end != null ? value.end : (x != null ? x : 0)),
    bottom: spacing(value.bottom != null ? value.bottom : (y != null ? y : 0)),
    start: spacing(value.start != null ? value.start : (x != null ? x : 0)),
  };
}

function edgesCss(e) {
  return dp(e.top) + ' ' + dp(e.end) + ' ' + dp(e.bottom) + ' ' + dp(e.start);
}

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', spaceBetween: 'space-between', spaceAround: 'space-around' };

/** The flex cross-axis value of an `align`; undefined when not set. */
export function alignCss(a) {
  return ALIGN[a];
}

/** The flex main-axis value of a `justify`; undefined when not set. */
export function justifyCss(j) {
  return JUSTIFY[j];
}

/**
 * The CSS every node's own style fields ask for, as `{property: value}`. [kind] is what the node draws: `box` (a container: `color` is its
 * fill), `text` (text and icons: `color` is the ink). A value the scales do not allow is left out.
 */
export function styleCss(node, kind) {
  const css = {};
  const pad = edgesOf(node.padding);
  if (pad) css.padding = edgesCss(pad);
  const mar = edgesOf(node.margin);
  if (mar) css.margin = edgesCss(mar);
  if (node.gap != null && SPACING.indexOf(node.gap) >= 0) css.gap = dp(node.gap);
  if (node.w != null && sizeOf(node.w) != null) { css.width = dp(node.w); css.flex = '0 0 auto'; }
  if (node.h != null && sizeOf(node.h) != null) css.height = dp(node.h);
  if (node.minH != null && sizeOf(node.minH) != null) css.minHeight = dp(node.minH);
  if (node.fill) css.alignSelf = 'stretch';
  if (node.weight != null && node.weight > 0) { css.flex = node.weight + ' 1 0'; css.minWidth = '0'; }
  if (node.maxWidthFraction != null) { css.maxWidth = Math.round(node.maxWidthFraction * 100) + '%'; if (node.fill) css.width = css.maxWidth; }
  if (node.alignSelf && ALIGN[node.alignSelf]) css.alignSelf = ALIGN[node.alignSelf];
  if (node.textAlign) css.textAlign = node.textAlign === 'start' ? 'left' : node.textAlign === 'end' ? 'right' : node.textAlign;
  if (typeof node.radius === 'string' && radiusDp(node.radius) != null) css.borderRadius = radiusDp(node.radius) === 9999 ? '9999px' : dp(radiusDp(node.radius));
  if (node.corners && typeof node.corners === 'object') {
    const c = (t) => (radiusDp(t) == null ? '0' : radiusDp(t) === 9999 ? '50%' : dp(radiusDp(t)));
    css.borderRadius = [c(node.corners.topStart), c(node.corners.topEnd), c(node.corners.bottomEnd), c(node.corners.bottomStart)].join(' ');
  }
  const color = roleVar(node.color);
  if (color) {
    if (kind === 'text') css.color = color;
    else { css.background = color; css.color = onRoleVar(node.color); }
  }
  if (node.border && typeof node.border === 'object' && node.border.width) {
    css.border = dp(node.border.width) + ' solid ' + (roleVar(node.border.color) || 'var(--sk-outline)');
  }
  return css;
}

// The kit's own type scale (the SDK documents it: headings are bold already), grown by the TV's 1.25 step. Sizes and line heights in dp.
const TEXT = {
  hero: { size: 90, line: 90, weight: 700 },
  h1: { size: 40, line: 50, weight: 700 },
  h2: { size: 35, line: 45, weight: 700 },
  h3: { size: 27.5, line: 35, weight: 700 },
  h4: { size: 20, line: 30, weight: 600 },
  h5: { size: 17.5, line: 25, weight: 600 },
  p: { size: 17.5, line: 25, weight: 400 },
  caption: { size: 15, line: 20, weight: 400 },
  label: { size: 17.5, line: 25, weight: 600 },
};
const TEXT_ALIASES = { display: 'h1', title: 'h3', subtitle: 'h4', body: 'p' };

/** The text style token a node names (the scale's names and the earlier aliases); `p` for anything else. */
export function textVariant(name) {
  const key = TEXT[name] ? name : TEXT_ALIASES[name] || 'p';
  return key;
}

/** `{fontSize, lineHeight, fontWeight}` of a text style token, `bold` making any style bold. */
export function textCss(name, bold) {
  const t = TEXT[textVariant(name)];
  return { fontSize: dp(t.size), lineHeight: dp(t.line), fontWeight: String(bold ? 700 : t.weight) };
}

/** The value an input node starts with: its own `value`, with the type each widget keeps (text, boolean, number, list for chips). */
export function inputValue(node) {
  const v = node.value;
  switch (node.type) {
    case 'toggle': case 'checkbox': return v === true;
    case 'slider': case 'stepper': {
      const min = typeof node.min === 'number' ? node.min : 0;
      const n = typeof v === 'number' ? v : min;
      return Math.max(min, typeof node.max === 'number' ? Math.min(node.max, n) : n);
    }
    case 'chips': return node.multiple ? (Array.isArray(v) ? v.slice() : []) : (typeof v === 'string' ? v : '');
    case 'dropdown': case 'radioGroup': case 'tabs': return typeof v === 'string' ? v : '';
    default: return typeof v === 'string' ? v : '';
  }
}

/** The input element type of a text field's `kind`. */
export function inputType(kind, secret) {
  if (secret) return 'password';
  switch (kind) {
    case 'number': return 'number';
    case 'email': return 'email';
    case 'url': return 'url';
    case 'search': return 'search';
    default: return 'text';
  }
}

/** The twelve-column layout of a `row` with `wrap`: a child's width as a percent of the line for its `span` (1..12); 0 when it has none. */
export function spanPercent(node) {
  const span = node && node.span ? Math.max(1, Math.min(12, node.span)) : 0;
  return span ? (span / 12) * 100 : 0;
}

/** A child's `offset` (0..11 columns) as a percent of the line. */
export function offsetPercent(node) {
  const off = node && node.offset ? Math.max(0, Math.min(11, node.offset)) : 0;
  return (off / 12) * 100;
}

/**
 * The lines a wrapping row lays its children in: each child takes `offset + span` columns of the twelve (a child with no span takes all twelve),
 * and one that does not fit what is left of a line starts the next one. Returns the index lists of each line.
 */
/**
 * Whether a wrapping row lays out on twelve columns: some child names a `span` or an `offset`. Without one it is a flow (as the
 * phone's FlowRow): children keep their own width and move to the next line when the row is full (a grid of channel circles).
 */
export function usesColumns(children) {
  return (Array.isArray(children) ? children : []).some((c) => c && ((typeof c.span === 'number' && c.span > 0) || (typeof c.offset === 'number' && c.offset > 0)));
}

export function columnLines(children) {
  const lines = [];
  let line = [];
  let used = 0;
  (Array.isArray(children) ? children : []).forEach((c, i) => {
    const span = c && c.span ? Math.max(1, Math.min(12, c.span)) : 12;
    const need = Math.min(12, span + (c && c.offset ? Math.max(0, Math.min(11, c.offset)) : 0));
    if (line.length && used + need > 12) { lines.push(line); line = []; used = 0; }
    line.push(i);
    used += need;
  });
  if (line.length) lines.push(line);
  return lines;
}

/**
 * The window's size classes the way the app sends them to a plugin screen (Android's window size classes, on dp): width compact below 600,
 * medium below 840, else expanded; height compact below 480, medium below 900; orientation from the sides.
 */
export function windowSize(widthDp, heightDp) {
  const w = Number(widthDp) || 0;
  const hh = Number(heightDp) || 0;
  return {
    widthClass: w < 600 ? 'compact' : w < 840 ? 'medium' : 'expanded',
    heightClass: hh < 480 ? 'compact' : hh < 900 ? 'medium' : 'expanded',
    orientation: w >= hh ? 'landscape' : 'portrait',
  };
}

/** The leaf kinds the renderer draws today; anything else is drawn as nothing and counted, so a missing widget is visible in a test. */
export const PHASE1 = ['col', 'row', 'box', 'card', 'scroll', 'grid', 'spacer', 'divider', 'text', 'image', 'icon', 'badge', 'progress', 'loading',
  'button', 'textInput', 'textArea', 'toggle', 'checkbox', 'dropdown', 'radioGroup', 'slider', 'chips', 'tabs', 'emptyState', 'errorState', 'banner', 'list', 'form',
  'scaffold', 'appBar', 'pageView', 'heroCard', 'titleCard', 'titleRail', 'titleGrid', 'avatar', 'listTile', 'navigationBar', 'fab', 'pages',
  'accordion', 'skeleton', 'stepper', 'table', 'steps', 'qr', 'settings'];

/** The types in [root] this renderer does not draw yet, each once, in the order met. */
export function unsupportedTypes(root) {
  const seen = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (typeof n.type === 'string' && PHASE1.indexOf(n.type) < 0 && seen.indexOf(n.type) < 0) seen.push(n.type);
    ['children', 'items', 'buttons'].forEach((k) => { if (Array.isArray(n[k])) n[k].forEach(walk); });
    if (n.empty) walk(n.empty);
    if (n.fallback) walk(n.fallback);
  })(root);
  return seen;
}

/** A stepper's next value: one step up or down, kept in [min, max] and rounded to its decimals (a float step never drifts). */
export function stepperNext(node, value, dir) {
  const step = typeof node.step === 'number' && node.step > 0 ? node.step : 1;
  const dec = typeof node.decimals === 'number' ? Math.max(0, Math.min(6, node.decimals)) : 0;
  let v = (typeof value === 'number' ? value : 0) + (dir < 0 ? -step : step);
  if (typeof node.min === 'number') v = Math.max(node.min, v);
  if (typeof node.max === 'number') v = Math.min(node.max, v);
  const f = Math.pow(10, dec);
  return Math.round(v * f) / f;
}

/** A stepper's value as text with its decimals (the phone's canonical text when it sent one for this value). */
export function stepperText(node, value) {
  const dec = typeof node.decimals === 'number' ? Math.max(0, Math.min(6, node.decimals)) : 0;
  return typeof value === 'number' ? value.toFixed(dec) : '';
}

/** The open items of an accordion: those marked open; one at a time unless `multiple` (the first open one wins). */
export function accordionOpen(node) {
  const items = Array.isArray(node && node.items) ? node.items : [];
  const open = items.filter((it) => it && it.open).map((it) => it.key);
  return node && node.multiple ? open : open.slice(0, 1);
}

/** A frame's identity for "nothing changed": its JSON, or null when it cannot be told (loading, failed: it always paints then). */
export function frameKey(ui) {
  if (!ui || ui.state === 'loading' || ui.state === 'failed') return null;
  try { return JSON.stringify(ui); } catch (e) { return null; }
}

/** A box's kind and its node key (a plugin's tab names its page's list apart: another tab's list starts at the top). */
function boxId(el) { return String(el.className) + '|' + ((el.getAttribute && el.getAttribute('data-key')) || ''); }

/** Where each scrolled box under [top] is: its path of child positions, the classes along it and its offsets (a rebuild keeps them). */
export function scrollOffsets(top) {
  const out = [];
  (function walk(node, path, classes) {
    const kids = (node && node.children) || [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      const p = path.concat(i);
      const cls = classes.concat(boxId(c));
      if (c.scrollTop || c.scrollLeft) out.push({ path: p, cls: cls, top: c.scrollTop, left: c.scrollLeft });
      walk(c, p, cls);
    }
  })(top, [], []);
  return out;
}

/** Puts each box saved by [scrollOffsets] back where it was, when the same kind of box stands at the same place. */
export function restoreScroll(top, saved) {
  saved.forEach((s) => {
    let el = top;
    for (let i = 0; i < s.path.length && el; i++) {
      el = ((el && el.children) || [])[s.path[i]];
      if (el && boxId(el) !== s.cls[i]) el = null; // a different box on the way: the list is not the same one
    }
    if (!el) return;
    el.scrollTop = s.top;
    el.scrollLeft = s.left;
  });
}
