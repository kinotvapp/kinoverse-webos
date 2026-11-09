// The installed LG app is a shell: this page stays a local file (a secure page that can play protected channels and talk to the phone
// over the home network), but the program itself comes from kinoverse.app every time the app opens, so an update reaches every TV
// without reinstalling. When kinoverse.app does not answer (no internet, a slow start), the copy inside the app is used instead.
// Plain ES5: webOS 6's Chromium 79 runs it before anything else.
(function () {
  var REMOTE = 'https://kinoverse.app/tv/webos/';
  var WAIT_MS = 8000;
  var local = /(^|[?&])local=1(&|$)/.test(location.search.slice(1));
  var head = document.head || document.getElementsByTagName('head')[0];

  function add(tag, attrs) {
    var e = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    head.appendChild(e);
    return e;
  }

  // The same page again with the copy inside the app (the phone's address and code, when there, are kept).
  function useLocalCopy() {
    if (local) return;
    local = true;
    var q = location.search ? location.search + '&local=1' : '?local=1';
    // An absolute address: a relative one would resolve against the <base> above, on kinoverse.app.
    var here = location.href.split('#')[0].split('?')[0];
    location.replace(here + q + location.hash);
  }

  // Every relative address of the program (its styles, fonts, logo, players) resolves against kinoverse.app from here on.
  if (!local) add('base', { href: REMOTE });
  add('link', { rel: 'stylesheet', href: 'styles.css' });

  var s = document.createElement('script');
  s.src = 'app.js';
  if (!local) {
    var timer = setTimeout(useLocalCopy, WAIT_MS);
    s.onload = function () { clearTimeout(timer); };
    s.onerror = function () { clearTimeout(timer); useLocalCopy(); };
  }
  head.appendChild(s);
})();
