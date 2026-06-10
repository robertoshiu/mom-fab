// components/sparkline.js — pure factory: Sparkline(props) -> SVGElement
// Mini trend chart in pure SVG (NO D3, no axes, no tooltip). Last point gets a
// live accent dot. Consumes color tokens via the caller (default --accent).
// No classes (F4).

const SVG_NS = 'http://www.w3.org/2000/svg';

// Sparkline({ data, width, height, color, ariaLabel })
// - data: number[]; empty/single-point handled gracefully (flat baseline).
// - color: any CSS color string; default the cyan accent token.
export function Sparkline({
  data = [],
  width = 120,
  height = 28,
  color = 'var(--accent)',
  ariaLabel = '',
} = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  if (ariaLabel) svg.setAttribute('aria-label', ariaLabel);

  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const n = data.length;

  if (n === 0) return svg;

  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const x = (i) => pad + (n === 1 ? w / 2 : (w * i) / (n - 1));
  const y = (v) => pad + h * (1 - (v - min) / span);

  let d = '';
  data.forEach((v, i) => {
    d += `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`;
  });

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);

  // live dot on the most recent sample
  const last = n - 1;
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', x(last).toFixed(2));
  dot.setAttribute('cy', y(data[last]).toFixed(2));
  dot.setAttribute('r', '1.8');
  dot.setAttribute('fill', color);
  svg.appendChild(dot);

  return svg;
}

export default Sparkline;
