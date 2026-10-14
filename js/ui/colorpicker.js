// Selector de color flotante: cuadrícula de 96 tonos, neutros, paletas con nombre,
// recientes y color libre.
import { GRID, NEUTRALS, NAMED_PALETTES } from '../palette.js';
import { floatingMenu } from './dom.js';

const RECENT_KEY = 'cdt.recentColors';
const recent = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? [];
  } catch {
    return [];
  }
};
function pushRecent(c) {
  const list = [c, ...recent().filter((x) => x !== c)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* */ }
}

const sw = (c, sel) => `<button type="button" class="sw ${sel?.toLowerCase() === c.toLowerCase() ? 'sel' : ''}" data-v="${c}" style="--c:${c}" title="${c}"></button>`;

export function openColorPicker(anchor, current, onPick) {
  const rec = recent();
  const html = `<div class="cp">
    ${rec.length ? `<div class="cp-label">Recientes</div><div class="cp-row">${rec.map((c) => sw(c, current)).join('')}</div>` : ''}
    <div class="cp-label">Tonos</div>
    <div class="cp-grid">${GRID.map((r) => r.colors.map((c) => sw(c, current)).join('')).join('')}</div>
    <div class="cp-row">${NEUTRALS.map((c) => sw(c, current)).join('')}</div>
    <details class="cp-named"><summary>Paletas</summary>
      ${Object.entries(NAMED_PALETTES).map(([n, cs]) => `<div class="cp-label">${n}</div><div class="cp-row">${cs.map((c) => sw(c, current)).join('')}</div>`).join('')}
    </details>
    <label class="cp-custom">Personalizado <input type="color" value="${current || '#3366ff'}"></label>
  </div>`;
  const close = floatingMenu(anchor, html, (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return false;
    pushRecent(b.dataset.v);
    onPick(b.dataset.v);
  });
  const inp = document.querySelector('.float-menu input[type=color]');
  inp?.addEventListener('change', () => {
    pushRecent(inp.value);
    onPick(inp.value);
    close();
  });
  return close;
}

/** Botón de muestra que abre el selector y actualiza un input oculto */
export function colorButton(name, value) {
  return `<button type="button" class="color-btn" data-color-for="${name}" style="--c:${value || 'transparent'}">${value ? '' : 'Auto'}</button><input type="hidden" name="${name}" value="${value || ''}">`;
}

export function wireColorButtons(root, onChange) {
  root.querySelectorAll('[data-color-for]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = root.querySelector(`input[name="${btn.dataset.colorFor}"]`);
      openColorPicker(btn, input.value, (c) => {
        input.value = c;
        btn.style.setProperty('--c', c);
        btn.textContent = '';
        onChange?.(c, btn.dataset.colorFor);
      });
    });
  });
}
