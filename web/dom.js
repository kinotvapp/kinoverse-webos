// A tiny element builder (from the webOS spike's dom.js). Text always goes in as text nodes, never as HTML: what the
// phone sends comes from plugins and is data. `on*` props become addEventListener calls, never inline handler attributes.
export function h(tag, props, children) {
  const el = document.createElement(tag);
  const p = props || {};
  Object.keys(p).forEach((k) => {
    const v = p[k];
    if (k === 'class') el.className = v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && v && typeof v === 'object') Object.keys(v).forEach((s) => el.style.setProperty(s, v[s]));
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  });
  [].concat(children === undefined ? [] : children).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  });
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
