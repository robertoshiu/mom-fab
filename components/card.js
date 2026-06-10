// components/card.js — pure factory: Card(props) -> HTMLElement
// Reuses .card / .panel / .label from theme.css. No classes (F4).
import { t } from '../i18n/index.js';

// Card({ title, content, titleI18nKey, panel })
// - content may be a string, a Node, or an array of Nodes.
// - titleI18nKey: resolve title via t() at render + data-i18n for locale scan.
// - panel: true → add the .panel bezel (a data surface); default is .card.
export function Card({
  title = '',
  content = null,
  titleI18nKey,
  panel = false,
} = {}) {
  const el = document.createElement('section');
  el.className = panel ? 'card panel' : 'card';

  if (title || titleI18nKey) {
    const head = document.createElement('div');
    head.className = 'panel-head';
    const label = document.createElement('span');
    label.className = 'label';
    if (titleI18nKey) {
      label.setAttribute('data-i18n', titleI18nKey);
      label.textContent = t(titleI18nKey);
    } else {
      label.textContent = title;
    }
    head.appendChild(label);
    el.appendChild(head);
  }

  const body = document.createElement('div');
  body.className = 'panel-body';
  appendContent(body, content);
  el.appendChild(body);

  return el;
}

function appendContent(parent, content) {
  if (content == null) return;
  if (Array.isArray(content)) {
    content.forEach((c) => appendContent(parent, c));
    return;
  }
  if (content instanceof Node) {
    parent.appendChild(content);
  } else {
    parent.appendChild(document.createTextNode(String(content)));
  }
}

export default Card;
