// D-pad navigation over rows of focusable elements (the approach of the webOS spike's focus-grid.js). A screen hands
// over its rows (HTMLElement[][]); arrows move between them, remembering the column when moving up or down.

export class FocusGrid {
  constructor() {
    this.rows = [];
    this.col = 0;
  }

  setRows(rows) {
    this.rows = rows.filter((r) => r && r.length > 0);
    this.col = 0;
  }

  position(el) {
    for (let r = 0; r < this.rows.length; r++) {
      const c = this.rows[r].indexOf(el);
      if (c >= 0) return { r: r, c: c };
    }
    return null;
  }

  focus(el) {
    el.focus();
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  focusFirst() {
    if (this.rows.length) this.focus(this.rows[0][0]);
  }

  /** @returns {boolean} true when the key moved focus (the caller then stops the key) */
  move(action, active) {
    const pos = this.position(active);
    if (!pos) { this.focusFirst(); return this.rows.length > 0; }
    let r = pos.r;
    let c = pos.c;
    if (action === 'left') c = Math.max(0, c - 1);
    else if (action === 'right') c = Math.min(this.rows[r].length - 1, c + 1);
    else if (action === 'up' || action === 'down') {
      r = Math.max(0, Math.min(this.rows.length - 1, r + (action === 'up' ? -1 : 1)));
      if (r !== pos.r) c = Math.min(this.rows[r].length - 1, this.col);
    } else return false;
    if (action === 'left' || action === 'right') this.col = c;
    this.focus(this.rows[r][c]);
    return true;
  }
}

/** Cards that wrap in a grid (search results) -> the visual rows the remote moves through, by their top edge. */
export function rowsByTop(elements) {
  const rows = [];
  let top = null;
  elements.forEach((el) => {
    if (top === null || Math.abs(el.offsetTop - top) > 8) { rows.push([]); top = el.offsetTop; }
    rows[rows.length - 1].push(el);
  });
  return rows;
}
