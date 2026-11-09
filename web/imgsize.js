// The width a picture is asked at: the phone's image addresses take `&w=<px>` and fetch TMDB pictures at the smallest size that covers
// it (a poster card never pulls an `original` of several MB). Anything else (a data address, another host) is left as it is.

const PHONE_IMAGE = '/__kino/media/i-';

/** Widths a picture is asked at, in steps, so the same picture in near-equal boxes keeps one address (and one cache entry). */
const STEPS = [92, 154, 185, 342, 500, 780, 1280, 1920];

/** [src] asking for at least [cssPx] CSS pixels at [dpr] device pixels each; unchanged when it is not a phone image address. */
export function sizedSrc(src, cssPx, dpr) {
  if (typeof src !== 'string' || src.indexOf(PHONE_IMAGE) < 0 || /[?&]w=/.test(src)) return src;
  const px = Math.round((cssPx > 0 ? cssPx : 0) * (dpr > 0 ? dpr : 1));
  if (!px) return src;
  let step = STEPS[STEPS.length - 1];
  for (let i = 0; i < STEPS.length; i++) { if (STEPS[i] >= px) { step = STEPS[i]; break; } }
  return src + (src.indexOf('?') >= 0 ? '&' : '?') + 'w=' + step;
}
