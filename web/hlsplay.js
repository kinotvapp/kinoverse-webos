// hls.js 1.7.4 (the FULL build, Apache-2.0, hls.LICENSE.txt; the light build refuses HEVC in MPEG-TS, see docs/analysis/2026-11-06-hlsjs-hevc-in-mpegts.md) plays in a desktop browser what the phone's remux makes and the TS playlists the LG plays natively. The browser's own HLS treats a growing
// (EVENT) playlist as a live stream: no seekable range, so neither the resume nor the arrow keys work. hls.js plays it through Media Source
// Extensions and honours a start position. It is a classic script loaded only when a remux is played, never on a TV, whose own player is the route.
let loading = null;

/** Loads hls.min.js once; resolves to the Hls class, rejects if the file does not load. */
export function loadHls(doc, win) {
  if (win.Hls) return Promise.resolve(win.Hls);
  if (!loading) {
    loading = new Promise(function (resolve, reject) {
      const s = doc.createElement('script');
      s.src = 'hls.min.js';
      s.onload = function () { resolve(win.Hls); };
      s.onerror = function () { loading = null; reject(new Error('hls.js did not load')); };
      doc.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * Attaches an hls.js instance to [video] for [url]. `startPosition` (seconds, -1 for the default) is where it starts; `onFatal(details)` is called
 * once when it gives up. No Web Worker: the page's policy (script-src 'self') does not allow the blob: worker, and fMP4 needs no transmux.
 * Returns the instance; destroy() it when playback stops.
 */
export function attachHls(Hls, video, url, options) {
  const o = options || {};
  const hls = new Hls({ startPosition: typeof o.startPosition === 'number' ? o.startPosition : -1, maxBufferLength: 60, enableWorker: false });
  let reported = false;
  hls.on(Hls.Events.ERROR, function (ev, data) {
    if (data && data.fatal && !reported) {
      reported = true;
      if (o.onFatal) o.onFatal(data.details || data.type || 'error');
    }
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return hls;
}
