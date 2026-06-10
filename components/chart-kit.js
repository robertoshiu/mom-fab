// components/chart-kit.js — D3 chart factory (5C-A). NO classes, NO inheritance,
// NO plugin system — just four closures, each returning {render, update, destroy}.
//   createLineChart / createBarChart / createGantt / createHeatmap
// Discipline centralized here (H4): destroy() runs selection.interrupt() then
// .remove(). Tokens consumed for axis (10px) / grid / tooltip (12px) / 200ms
// (via CSS classes .axis-t/.limit-t/.ck-tooltip in components.css). Built-in
// empty / loading / partial states (2A). ResizeObserver re-render (T33).
//
// Visual target: the X-bar craft in design/reference-spc.html — hairline grid,
// hollow points, dashed limit lines with right-edge labels, sigma bands.
import * as d3 from 'd3';
import { t } from '../i18n/index.js';

const TRANSITION_MS = 200; // mirrors --transition; D3 needs a number

// ---- shared scaffold every factory reuses ----------------------------------
// config (common): { emptyText, emptyI18nKey, predictedTick, partialCapacity,
//   color, ariaLabel }. partialCapacity = expected full window length; when
//   data.length < it, the chart draws left-anchored and leaves the right with
//   faint grid (PARTIAL, matrix rule d).
function createChart(kind, config = {}) {
  let container = null;
  let svg = null;
  let g = null;
  let tooltip = null;
  let ro = null;
  let data = [];
  let state = 'loading'; // loading | empty | partial | success
  let destroyed = false;

  const margin = { top: 16, right: 50, bottom: 26, left: 46 };

  function render(target) {
    container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) return api;
    container.classList.add('chartkit');
    if (config.ariaLabel) container.setAttribute('aria-label', config.ariaLabel);

    svg = d3
      .select(container)
      .append('svg')
      .attr('preserveAspectRatio', 'none');
    g = svg.append('g');

    tooltip = d3
      .select(container)
      .append('div')
      .attr('class', 'ck-tooltip');

    // ResizeObserver: re-render on container width change (T33).
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (!destroyed) draw();
      });
      ro.observe(container);
    }
    draw();
    return api;
  }

  function update(next) {
    data = Array.isArray(next) ? next : [];
    if (data.length === 0) state = 'empty';
    else if (config.partialCapacity && data.length < config.partialCapacity)
      state = 'partial';
    else state = 'success';
    draw();
    return api;
  }

  function setLoading() {
    state = 'loading';
    draw();
    return api;
  }

  function dims() {
    const rect = container.getBoundingClientRect();
    const W = Math.max(rect.width || container.clientWidth || 320, 80);
    const H = Math.max(rect.height || container.clientHeight || 200, 60);
    return { W, H, iw: W - margin.left - margin.right, ih: H - margin.top - margin.bottom };
  }

  // ---- state overlays (loading skeleton / empty / inherit partial) ----
  function clearOverlays() {
    d3.select(container).selectAll('.chartkit-state, .chartkit-skeleton').remove();
  }

  function drawLoading() {
    svg.style('opacity', 0);
    clearOverlays();
    const sk = document.createElement('div');
    sk.className = 'chartkit-skeleton';
    container.appendChild(sk);
  }

  function drawEmpty() {
    svg.style('opacity', 0);
    clearOverlays();
    const wrap = document.createElement('div');
    wrap.className = 'chartkit-state';
    const msg = document.createElement('div');
    msg.className = 'chartkit-empty-msg';
    const baseText = config.emptyI18nKey ? t(config.emptyI18nKey) : (config.emptyText || t('states.empty'));
    msg.textContent = baseText;
    if (config.predictedTick != null) {
      // deterministic arrival preview (matrix rule b)
      const pred = document.createElement('div');
      pred.className = 'chartkit-predict';
      pred.textContent = `~ tick ${config.predictedTick}`;
      msg.appendChild(pred);
    }
    wrap.appendChild(msg);
    container.appendChild(wrap);
  }

  function draw() {
    if (!container || !svg) return;
    if (state === 'loading') return drawLoading();
    if (state === 'empty') return drawEmpty();

    clearOverlays();
    svg.style('opacity', 1);
    const { W, H } = dims();
    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);
    g.attr('transform', `translate(${margin.left},${margin.top})`);

    if (kind === 'line') drawLine();
    else if (kind === 'bar') drawBar();
    else if (kind === 'gantt') drawGantt();
    else if (kind === 'heatmap') drawHeatmap();
  }

  // ---- helpers --------------------------------------------------------------
  function gridLines(scaleY, iw) {
    const ticks = scaleY.ticks(5);
    const sel = g.selectAll('line.ck-grid').data(ticks);
    sel.join('line')
      .attr('class', 'ck-grid')
      .attr('x1', 0).attr('x2', iw)
      .attr('y1', (d) => scaleY(d)).attr('y2', (d) => scaleY(d))
      .attr('stroke', 'var(--grid)').attr('stroke-width', 1);
  }

  function axisText(x, y, text, anchor = 'middle', cls = 'axis-t') {
    g.append('text').attr('class', cls).attr('x', x).attr('y', y)
      .attr('text-anchor', anchor).text(text);
  }

  function showTip(html, px, py) {
    tooltip.html(html).style('left', `${px}px`).style('top', `${py}px`).classed('show', true);
  }
  function hideTip() { tooltip.classed('show', false); }

  // ---- LINE (the X-bar reference: sigma bands, limits, hollow points) -------
  function drawLine() {
    g.selectAll('*').remove();
    const { iw, ih } = innerDims();
    const cap = config.partialCapacity || data.length;
    const xs = d3.scaleLinear().domain([0, Math.max(cap - 1, data.length - 1, 1)]).range([0, iw]);
    const ext = d3.extent(data, (d) => d.value);
    const lo = config.lcl != null ? config.lcl : ext[0];
    const hi = config.ucl != null ? config.ucl : ext[1];
    const pad = (hi - lo) * 0.12 || 1;
    const ys = d3.scaleLinear().domain([lo - pad, hi + pad]).range([ih, 0]);

    // sigma bands when control limits given
    if (config.cl != null && config.sigma != null) {
      [1, 2].forEach((k) => {
        g.append('rect')
          .attr('x', 0).attr('width', iw)
          .attr('y', ys(config.cl + k * config.sigma))
          .attr('height', ys(config.cl - k * config.sigma) - ys(config.cl + k * config.sigma))
          .attr('fill', 'var(--accent)').attr('opacity', 0.025);
      });
    }
    gridLines(ys, iw);

    // control limit lines + right-edge labels
    const limit = (v, label, color, dash) => {
      if (v == null) return;
      g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', ys(v)).attr('y2', ys(v))
        .attr('stroke', color).attr('stroke-width', 1).attr('opacity', 0.8)
        .attr('stroke-dasharray', dash ? '5 4' : null);
      g.append('text').attr('class', 'limit-t').attr('x', iw + 6).attr('y', ys(v) + 3)
        .attr('fill', color).text(label);
    };
    limit(config.ucl, 'UCL', 'var(--danger)', true);
    limit(config.cl, 'CL', 'var(--text-secondary)', false);
    limit(config.lcl, 'LCL', 'var(--danger)', true);

    // line path (left-anchored; not stretched when partial)
    const lineGen = d3.line().x((d, i) => xs(i)).y((d) => ys(d.value));
    g.append('path').datum(data).attr('class', 'ck-line').attr('fill', 'none')
      .attr('stroke', config.color || 'var(--accent)').attr('stroke-width', 1.4)
      .attr('opacity', 0).attr('d', lineGen)
      .transition().duration(TRANSITION_MS).attr('opacity', 0.85);

    // hollow points; last is the live accent dot; violations are filled danger
    g.selectAll('circle.ck-pt').data(data).join('circle')
      .attr('class', 'ck-pt')
      .attr('cx', (d, i) => xs(i)).attr('cy', (d) => ys(d.value))
      .attr('r', (d, i) => (i === data.length - 1 ? 3.5 : d.violation ? 4.5 : 2.2))
      .attr('fill', (d, i) => (i === data.length - 1 ? 'var(--accent)' : d.violation ? 'var(--danger)' : 'var(--bg-elevated)'))
      .attr('stroke', (d) => (d.violation ? 'var(--danger)' : 'var(--text-secondary)'))
      .attr('stroke-width', 1)
      .on('mouseenter', function (ev, d) {
        const i = data.indexOf(d);
        showTip(`<b>${d.value}</b>`, margin.left + xs(i), margin.top + ys(d.value));
      })
      .on('mouseleave', hideTip);

    // x ticks
    [0, Math.floor((cap - 1) / 2), cap - 1].forEach((i) => {
      axisText(xs(i), ih + 18, String(i).padStart(2, '0'));
    });
  }

  // ---- BAR ------------------------------------------------------------------
  function drawBar() {
    g.selectAll('*').remove();
    const { iw, ih } = innerDims();
    const xs = d3.scaleBand().domain(data.map((d) => d.label)).range([0, iw]).padding(0.25);
    const ys = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value) || 1]).nice().range([ih, 0]);
    gridLines(ys, iw);
    g.selectAll('rect.ck-bar').data(data).join('rect')
      .attr('class', 'ck-bar')
      .attr('x', (d) => xs(d.label)).attr('width', xs.bandwidth())
      .attr('y', ih).attr('height', 0)
      .attr('fill', config.color || 'var(--accent)').attr('opacity', 0.85)
      .on('mouseenter', function (ev, d) {
        showTip(`<b>${d.label}</b> ${d.value}`, margin.left + xs(d.label), margin.top + ys(d.value));
      })
      .on('mouseleave', hideTip)
      .transition().duration(TRANSITION_MS)
      .attr('y', (d) => ys(d.value)).attr('height', (d) => ih - ys(d.value));
    xs.domain().forEach((label) => axisText(xs(label) + xs.bandwidth() / 2, ih + 18, label));
  }

  // ---- GANTT (rows of time blocks) -----------------------------------------
  // data: [{ row, label, start, end, status? }]
  function drawGantt() {
    g.selectAll('*').remove();
    const { iw, ih } = innerDims();
    const rowKeys = Array.from(new Set(data.map((d) => d.row)));
    const ys = d3.scaleBand().domain(rowKeys).range([0, ih]).padding(0.2);
    const tMax = d3.max(data, (d) => d.end) || 1;
    const cap = config.partialCapacity || tMax;
    const xs = d3.scaleLinear().domain([0, Math.max(cap, tMax)]).range([0, iw]);
    g.selectAll('rect.ck-grow').data(rowKeys).join('rect')
      .attr('class', 'ck-grow').attr('x', 0).attr('width', iw)
      .attr('y', (d) => ys(d)).attr('height', ys.bandwidth())
      .attr('fill', 'var(--bg-inset)').attr('opacity', 0.4);
    g.selectAll('rect.ck-block').data(data).join('rect')
      .attr('class', 'ck-block')
      .attr('x', (d) => xs(d.start)).attr('y', (d) => ys(d.row) + ys.bandwidth() * 0.15)
      .attr('width', 0).attr('height', ys.bandwidth() * 0.7)
      .attr('rx', 1)
      .attr('fill', (d) => statusColor(d.status))
      .on('mouseenter', function (ev, d) {
        showTip(`<b>${d.label || d.row}</b>`, margin.left + xs(d.start), margin.top + ys(d.row));
      })
      .on('mouseleave', hideTip)
      .transition().duration(TRANSITION_MS)
      .attr('width', (d) => Math.max(1, xs(d.end) - xs(d.start)));
    rowKeys.forEach((r) => axisText(-8, ys(r) + ys.bandwidth() / 2 + 3, String(r), 'end'));
  }

  // ---- HEATMAP (grid; color depth = value) ----------------------------------
  // data: [{ x, y, value }]; config.cols / config.rows optional
  function drawHeatmap() {
    g.selectAll('*').remove();
    const { iw, ih } = innerDims();
    const cols = config.cols || (d3.max(data, (d) => d.x) + 1) || 1;
    const rows = config.rows || (d3.max(data, (d) => d.y) + 1) || 1;
    const cw = iw / cols;
    const ch = ih / rows;
    const vmax = d3.max(data, (d) => d.value) || 1;
    g.selectAll('rect.ck-cell').data(data).join('rect')
      .attr('class', 'ck-cell')
      .attr('x', (d) => d.x * cw).attr('y', (d) => d.y * ch)
      .attr('width', Math.max(1, cw - 1)).attr('height', Math.max(1, ch - 1))
      .attr('fill', config.color || 'var(--accent)')
      .attr('opacity', 0)
      .on('mouseenter', function (ev, d) {
        showTip(`<b>${d.value}</b>`, margin.left + d.x * cw, margin.top + d.y * ch);
      })
      .on('mouseleave', hideTip)
      .transition().duration(TRANSITION_MS)
      .attr('opacity', (d) => 0.12 + 0.78 * (d.value / vmax));
  }

  function innerDims() {
    const { iw, ih } = dims();
    return { iw, ih };
  }

  function statusColor(status) {
    if (status === 'warn') return 'var(--warn)';
    if (status === 'danger' || status === 'hold') return 'var(--danger)';
    if (status === 'done') return 'var(--success)';
    return 'var(--accent)';
  }

  // ---- destroy: interrupt running transitions THEN remove (H4) -------------
  function destroy() {
    destroyed = true;
    if (ro) { ro.disconnect(); ro = null; }
    if (svg) {
      svg.selectAll('*').interrupt();
      svg.interrupt();
    }
    if (container) {
      d3.select(container).selectAll('svg, .ck-tooltip, .chartkit-state, .chartkit-skeleton')
        .interrupt().remove();
      container.classList.remove('chartkit');
    }
    svg = g = tooltip = null;
  }

  const api = { render, update, destroy, setLoading, get state() { return state; } };
  return api;
}

export function createLineChart(config) { return createChart('line', config); }
export function createBarChart(config) { return createChart('bar', config); }
export function createGantt(config) { return createChart('gantt', config); }
export function createHeatmap(config) { return createChart('heatmap', config); }

export default { createLineChart, createBarChart, createGantt, createHeatmap };
