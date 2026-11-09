// The app theme in the web: the phone sends Kino's resolved theme tokens (KinoTokens: the active theme with the person's adjustments, for a TV)
// and this turns them into the page's CSS variables, so the web paints with the same colours, corners and background as the app.

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** An `#RRGGBB` or `#AARRGGBB` colour (the phone's form) as CSS; null when it is not one. */
export function cssColor(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex)) return null;
  if (hex.length === 7) return hex.toLowerCase();
  const a = parseInt(hex.slice(1, 3), 16) / 255;
  const r = parseInt(hex.slice(3, 5), 16);
  const g = parseInt(hex.slice(5, 7), 16);
  const b = parseInt(hex.slice(7, 9), 16);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + Math.round(a * 1000) / 1000 + ')';
}

/** The `r, g, b` of an opaque colour, for the page's see-through shades of it (`rgba(var(--bg-rgb), 0.55)`); null when not a colour. */
export function rgbOf(hex) {
  if (typeof hex !== 'string' || !HEX.test(hex)) return null;
  const h = hex.length === 9 ? '#' + hex.slice(3) : hex;
  return parseInt(h.slice(1, 3), 16) + ', ' + parseInt(h.slice(3, 5), 16) + ', ' + parseInt(h.slice(5, 7), 16);
}

/** [a] mixed toward [b] by [t] (0..1), both opaque colours, as `#rrggbb`; null when either is not a colour. */
export function mixColor(a, b, t) {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return null;
  const p = x.split(', ').map(Number);
  const q = y.split(', ').map(Number);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** A background as CSS: a colour, or a linear gradient at the theme's angle (the app's 0 is upwards, as CSS's). */
export function backgroundCss(bg) {
  if (!bg || typeof bg !== 'object') return null;
  if (bg.type === 'gradient' && Array.isArray(bg.colors)) {
    const stops = bg.colors.map(cssColor).filter(Boolean);
    if (stops.length < 2) return stops[0] || null;
    const angle = typeof bg.angle === 'number' ? bg.angle : 180;
    return 'linear-gradient(' + angle + 'deg, ' + stops.join(', ') + ')';
  }
  return cssColor(bg.color);
}

/** The first colour of a background (what solid surfaces under the page take: the rail's fade, the scrims). */
export function backgroundBase(bg) {
  if (!bg || typeof bg !== 'object') return null;
  if (bg.type === 'gradient' && Array.isArray(bg.colors)) return bg.colors.find((c) => HEX.test(c)) || null;
  return HEX.test(bg.color || '') ? bg.color : null;
}

/**
 * The page's CSS variables for a theme answer, `{name: value}`. A value the theme does not give keeps the page's own default (the variable is
 * left out, so the stylesheet's `:root` value stands). Radii are in dp.
 */
export function themeVars(theme) {
  const out = {};
  const t = theme && typeof theme === 'object' ? theme : {};
  const c = t.colors && typeof t.colors === 'object' ? t.colors : {};
  const put = (name, value) => { if (value != null && value !== '') out[name] = value; };
  put('--accent', cssColor(c.accent));
  put('--accent-text', cssColor(c.accentText));
  put('--on-accent', cssColor(c.onAccent));
  put('--surface', cssColor(c.surface));
  put('--surface-2', cssColor(c.surfaceHigh));
  put('--text', cssColor(c.textPrimary));
  put('--muted', cssColor(c.textSecondary));
  put('--line', cssColor(c.border || c.outline));
  put('--ring', cssColor(c.focus));
  put('--on-ring', cssColor(c.onFocus));
  put('--rail-panel', cssColor(c.railPanel));
  put('--favorite', cssColor(c.favorite));
  const base = backgroundBase(t.background);
  put('--bg', cssColor(base));
  put('--bg-rgb', rgbOf(base));
  put('--bg-fill', backgroundCss(t.background));
  // see-through shades on the page (hover, zebra rows, faint lines) are the text colour, so they show on a light page too
  put('--tint-rgb', rgbOf(c.textPrimary));
  // the soft accent (notices, empty posters, a plugin's primary container): the accent faded into the page
  put('--accent-soft', mixColor(base, c.accent, 0.22));
  const r = t.radii && typeof t.radii === 'object' ? t.radii : {};
  if (typeof r.card === 'number') put('--r-card', 'calc(' + r.card + ' * var(--dp))');
  if (typeof r.button === 'number') put('--r-button', 'calc(' + r.button + ' * var(--dp))');
  if (typeof r.dialog === 'number') put('--r-dialog', 'calc(' + r.dialog + ' * var(--dp))');
  if (typeof r.chip === 'number') put('--r-chip', 'calc(' + r.chip + ' * var(--dp))');
  if (typeof r.input === 'number') put('--r-input', 'calc(' + r.input + ' * var(--dp))');
  const b = t.borders && typeof t.borders === 'object' ? t.borders : {};
  if (typeof b.card === 'number' && b.card > 0) put('--b-card', 'calc(' + b.card + ' * var(--dp))');
  if (typeof b.dialog === 'number' && b.dialog > 0) put('--b-dialog', 'calc(' + b.dialog + ' * var(--dp))');
  const e = t.effects && typeof t.effects === 'object' ? t.effects : {};
  if (typeof e.focusZoom === 'number' && e.focusZoom >= 1 && e.focusZoom <= 1.3) put('--focus-zoom', String(e.focusZoom));
  // A light page draws Kino's logo in ink (the app's dark ink logo): the theme's text colour.
  if (t.lightPage) put('--logo-ink', cssColor(c.textPrimary) || '#000000');
  // ...and puts channel logos (mostly white artwork) on a plate of that ink, as the TV app does
  const ink = rgbOf(c.textPrimary);
  if (t.lightPage) put('--logo-plate', ink ? 'rgba(' + ink + ', 0.85)' : 'rgba(0, 0, 0, 0.85)');
  return out;
}

/** Every variable [themeVars] may set: the page clears them all before painting a theme, so a previous theme leaves nothing behind. */
export const THEME_VARS = ['--accent', '--accent-text', '--on-accent', '--surface', '--surface-2', '--text', '--muted', '--line', '--ring', '--on-ring', '--rail-panel', '--favorite', '--bg', '--bg-rgb', '--bg-fill', '--tint-rgb', '--accent-soft', '--r-card', '--r-button', '--r-dialog', '--r-chip', '--r-input', '--b-card', '--b-dialog', '--focus-zoom', '--logo-ink', '--logo-plate'];

/**
 * A theme's logo shape (`{width, height, paths:[{d, fill}]}`) as an SVG data address for an <img>; null when it has none or a path is not plain
 * path data (the phone already checked it; this refuses anything that could carry markup).
 */
export function logoDataUrl(shape) {
  if (!shape || !Array.isArray(shape.paths) || !shape.paths.length) return null;
  const w = Number(shape.width);
  const hgt = Number(shape.height);
  if (!(w > 0 && w <= 1000 && hgt > 0 && hgt <= 1000)) return null;
  const parts = [];
  for (const p of shape.paths) {
    if (!p || typeof p.d !== 'string' || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/.test(p.d)) return null;
    const fill = cssColor(p.fill);
    if (!fill) return null;
    parts.push('<path d="' + p.d + '" fill="' + fill + '"/>');
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + hgt + '">' + parts.join('') + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Kino's own wordmark (logo.svg) drawn in [ink] instead of white, for a light page: the strokes and the i's dot in ink, the red dot as always.
 * Null when [ink] is not a colour.
 */
export function inkWordmarkUrl(ink) {
  const c = cssColor(ink);
  if (!c) return null;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="92 64 912 318" width="912" height="318">'
    + '<g fill="none" stroke="' + c + '" stroke-linecap="round" stroke-linejoin="round" stroke-width="42">'
    + '<path d="M147 133 V324"/><path d="M267 170 L199 250 L270 324 M152 250 H199"/><path d="M343 185 V324"/><path d="M422 324 V185"/>'
    + '<path d="M422 255 C422 210 452 182 490 182 C524 182 544 206 544 242 V324"/><path d="M544 250 V324"/>'
    + '<circle cx="687" cy="252" r="80" stroke-width="35"/></g>'
    + '<circle cx="343" cy="123" r="25" fill="' + c + '"/><circle cx="687" cy="252.5" r="30.5" fill="#e53224"/>'
    + '<g fill="none" stroke="' + c + '" stroke-linecap="round" stroke-linejoin="round" stroke-width="26"><path d="M791 97 H862 M826 97 V182"/><path d="M896 97 L933 182 L971 97"/></g>'
    + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function luminance(hex) {
  const v = rgbOf(hex);
  if (!v) return null;
  const c = v.split(', ').map((x) => { const f = Number(x) / 255; return f <= 0.03928 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** The WCAG contrast of two opaque colours (1..21); 1 when either is not a colour. */
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  if (x == null || y == null) return 1;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Readable on [bg] (the app's pluginColorScheme rule): [text] when it reads at 4.5:1, else the plugin's highlight, else white or black. */
export function readableOn(bg, text, highlight) {
  if (contrast(text, bg) >= 4.5) return text.toLowerCase();
  if (highlight && contrast(highlight, bg) >= 4.5) return highlight.toLowerCase();
  return contrast('#ffffff', bg) >= 4.5 ? '#ffffff' : '#000000';
}

/**
 * The page's text roles on a plugin's own palette, `{name: value}` for its screen: a plugin's dark background under a light app
 * theme would otherwise keep the theme's dark ink on it (titles, tabs, the close button, the focus ring invisible). Text that already
 * reads keeps the app's colour. Empty when the palette brings no background or surface of its own.
 */
export function pluginTextVars(palette, app) {
  const p = palette && typeof palette === 'object' ? palette : {};
  const a = app && typeof app === 'object' ? app : {};
  const hex6 = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
  const bg = hex6(p.background) || hex6(p.surface);
  if (!bg) return {};
  const surface = hex6(p.surface) || bg;
  const hl = hex6(p.highlight);
  const text = readableOn(surface, hex6(a.text) || '#f5f5f5', hl);
  return {
    '--text': text,
    '--muted': readableOn(surface, hex6(a.muted) || '#b3b3b3', hl),
    '--tint-rgb': rgbOf(text),
    '--ring': readableOn(bg, hex6(a.ring) || '#ffffff', hl),
    '--on-ring': contrast('#000000', readableOn(bg, hex6(a.ring) || '#ffffff', hl)) >= 4.5 ? '#000000' : '#ffffff',
  };
}

/** Every variable [pluginTextVars] may set, cleared before another palette is painted. */
export const PLUGIN_TEXT_VARS = ['--text', '--muted', '--tint-rgb', '--ring', '--on-ring'];
