import { change } from './format.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function setText(key, text) {
  for (const node of document.querySelectorAll(`[data-k="${key}"]`)) node.textContent = text;
}

export function setChange(key, pct) {
  const c = change(pct);
  for (const node of document.querySelectorAll(`[data-c="${key}"]`)) {
    node.textContent = c.text;
    node.dataset.dir = c.dir;
  }
}

export function notice(id, show, text) {
  const node = document.getElementById(`notice-${id}`);
  if (!node) return;
  if (node.hidden === show) node.hidden = !show;
  if (show) {
    const target = node.querySelector('.notice-text');
    if (target.textContent !== text) target.textContent = text;
  }
}

// Show the first `top` items of a list; a button reveals the rest and hides them again.
// The open/closed choice survives re-renders of the same list (kept on the list element).
export function showTop(list, top, noun) {
  list.parentElement.querySelector('.list-more')?.remove();
  const extra = [...list.children].slice(top);
  if (extra.length === 0) return;
  const button = el('button', 'list-more');
  button.type = 'button';
  const update = () => {
    const open = list.dataset.open === 'true';
    for (const item of extra) item.hidden = !open;
    button.textContent = open ? `Show top ${top}` : `Show all ${list.children.length} ${noun}`;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => { list.dataset.open = String(list.dataset.open !== 'true'); update(); });
  update();
  list.after(button);
}
