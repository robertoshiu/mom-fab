// components/table.js — pure factory: Table(props) -> { el, update, destroy }
// Reuses .table theme classes. Fixed row height 36px (M6 — no variable rows).
// virtual=true: only the visible window of rows is in the DOM (1000 rows render
// well under 50 <tr>). sortable + filterable supported. No classes (F4).
import { t } from '../i18n/index.js';

// columns: [{ key, label?, labelI18nKey?, sortable?, render?(value,row), num? }]
// rows: array of row objects.
// opts: { sortable, filterable, virtual, rowHeight=36, onRowClick, ariaLabel }
export function Table({
  columns = [],
  rows = [],
  sortable = false,
  filterable = false,
  virtual = false,
  rowHeight = 36,
  onRowClick,
  ariaLabel = '',
} = {}) {
  const root = document.createElement('div');
  root.className = 'vtable';

  // --- state ---
  let allRows = rows.slice();
  let viewRows = allRows;
  let sortKey = null;
  let sortDir = 1; // 1 asc, -1 desc
  let filterText = '';

  // --- toolbar (filter) ---
  let filterInput = null;
  if (filterable) {
    const toolbar = document.createElement('div');
    toolbar.className = 'vtable-toolbar';
    filterInput = document.createElement('input');
    filterInput.type = 'search';
    filterInput.className = 'vtable-filter';
    filterInput.setAttribute('data-i18n-placeholder', 'states.partial');
    filterInput.placeholder = '';
    filterInput.addEventListener('input', () => {
      filterText = filterInput.value.trim().toLowerCase();
      recompute();
      renderBody();
    });
    toolbar.appendChild(filterInput);
    root.appendChild(toolbar);
  }

  // --- table skeleton ---
  const scroll = document.createElement('div');
  scroll.className = 'vtable-scroll scroll-y';
  const table = document.createElement('table');
  table.className = 'table';
  if (ariaLabel) table.setAttribute('aria-label', ariaLabel);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((col) => {
    const th = document.createElement('th');
    if (col.labelI18nKey) {
      th.setAttribute('data-i18n', col.labelI18nKey);
      th.textContent = t(col.labelI18nKey);
    } else {
      th.textContent = col.label != null ? col.label : col.key;
    }
    const colSortable = sortable && col.sortable !== false;
    if (colSortable) {
      th.setAttribute('data-sortable', '1');
      th.addEventListener('click', () => toggleSort(col.key));
      const caret = document.createElement('span');
      caret.className = 'sort-caret';
      caret.dataset.col = col.key;
      caret.textContent = '';
      th.appendChild(caret);
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  scroll.appendChild(table);
  root.appendChild(scroll);

  // --- sorting / filtering ---
  function toggleSort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else {
      sortKey = key;
      sortDir = 1;
    }
    recompute();
    updateSortCarets();
    renderBody();
  }

  function updateSortCarets() {
    headRow.querySelectorAll('th[data-sortable]').forEach((th, i) => {
      const col = columns.filter((c) => sortable && c.sortable !== false)[i];
      th.removeAttribute('aria-sort');
    });
    headRow.querySelectorAll('.sort-caret').forEach((c) => (c.textContent = ''));
    if (sortKey != null) {
      const caret = headRow.querySelector(`.sort-caret[data-col="${sortKey}"]`);
      if (caret) {
        caret.textContent = sortDir > 0 ? '▲' : '▼';
        const th = caret.closest('th');
        if (th) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
      }
    }
  }

  function recompute() {
    let out = allRows;
    if (filterText) {
      out = out.filter((row) =>
        columns.some((col) => {
          const v = row[col.key];
          return v != null && String(v).toLowerCase().includes(filterText);
        }),
      );
    }
    if (sortKey != null) {
      out = out.slice().sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return (av - bv) * sortDir;
        }
        return String(av).localeCompare(String(bv)) * sortDir;
      });
    }
    viewRows = out;
  }

  // --- row rendering ---
  function buildRow(row, index) {
    const tr = document.createElement('tr');
    tr.style.height = `${rowHeight}px`;
    if (onRowClick) {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => onRowClick(row, index));
    }
    columns.forEach((col) => {
      const td = document.createElement('td');
      if (col.num) td.className = 'num';
      const value = row[col.key];
      if (typeof col.render === 'function') {
        const r = col.render(value, row);
        if (r instanceof Node) td.appendChild(r);
        else td.textContent = r == null ? '' : String(r);
      } else {
        td.textContent = value == null ? '' : String(value);
      }
      tr.appendChild(td);
    });
    return tr;
  }

  let scrollHandler = null;

  function renderBody() {
    if (virtual) renderVirtual();
    else renderAll();
  }

  function renderAll() {
    tbody.replaceChildren();
    viewRows.forEach((row, i) => tbody.appendChild(buildRow(row, i)));
  }

  function renderVirtual() {
    const total = viewRows.length;
    const viewport = scroll.clientHeight || rowHeight * 12;
    const scrollTop = scroll.scrollTop;
    const overscan = 4;
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
    const last = Math.min(total, first + visibleCount);

    const frag = document.createDocumentFragment();
    // top pad
    const padTop = document.createElement('tr');
    padTop.className = 'vtable-pad';
    const padTopTd = document.createElement('td');
    padTopTd.colSpan = columns.length;
    padTopTd.style.height = `${first * rowHeight}px`;
    padTop.appendChild(padTopTd);
    frag.appendChild(padTop);

    for (let i = first; i < last; i++) {
      frag.appendChild(buildRow(viewRows[i], i));
    }

    // bottom pad
    const padBot = document.createElement('tr');
    padBot.className = 'vtable-pad';
    const padBotTd = document.createElement('td');
    padBotTd.colSpan = columns.length;
    padBotTd.style.height = `${Math.max(0, (total - last) * rowHeight)}px`;
    padBot.appendChild(padBotTd);
    frag.appendChild(padBot);

    tbody.replaceChildren(frag);
  }

  if (virtual) {
    scrollHandler = () => renderVirtual();
    scroll.addEventListener('scroll', scrollHandler, { passive: true });
  }

  // update({ rows }): replace dataset, keep sort/filter, re-render.
  function update(next = {}) {
    if (Array.isArray(next)) allRows = next.slice();
    else if (Array.isArray(next.rows)) allRows = next.rows.slice();
    recompute();
    renderBody();
  }

  function destroy() {
    if (scrollHandler) scroll.removeEventListener('scroll', scrollHandler);
    root.remove();
  }

  // initial paint
  recompute();
  renderBody();

  return { el: root, update, destroy, scrollEl: scroll };
}

export default Table;
