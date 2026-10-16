// Lista editable de avisos reutilizable (categorías y ajustes).
import { LEVELS, UNITS, test as testLevel } from '../notify.js';
import { esc, uid } from '../util.js';

export function remindersHTML(list, { disabled = false } = {}) {
  const rows = (list ?? []).map((r, i) => `<div class="rem-row" data-ri="${i}">
    <input type="number" min="0" class="input num" data-r="value" value="${r.value ?? 0}" ${disabled ? 'disabled' : ''}>
    <select class="input" data-r="unit" ${disabled ? 'disabled' : ''}>${Object.entries(UNITS).filter(([k]) => k !== 'abs').map(([k, u]) => `<option value="${k}" ${r.unit === k ? 'selected' : ''}>${esc(u.label)}</option>`).join('')}</select>
    <select class="input" data-r="level" ${disabled ? 'disabled' : ''}>${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${r.level === k ? 'selected' : ''}>${l.icon} ${esc(l.label)}</option>`).join('')}</select>
    <button type="button" class="icon-btn" data-r-test title="Probar">▶</button>
    ${disabled ? '' : '<button type="button" class="icon-btn" data-r-del title="Quitar">✕</button>'}
  </div>`).join('');
  return `<div class="rem-list">${rows || '<div class="muted small">Sin avisos.</div>'}
    ${disabled ? '' : '<button type="button" class="btn small" data-r-add>＋ Añadir aviso</button>'}</div>`;
}

/** Conecta los eventos; `get()` devuelve la lista actual (mutable), `rerender()` repinta */
/** scope: selector del contenedor de esta lista, si hay varias listas dentro de root */
export function wireReminders(root, get, rerender, onChange, scope = null) {
  const outside = (e) => scope && !e.target.closest(scope);
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.r || outside(e)) return;
    const r = get()?.[+t.closest('[data-ri]').dataset.ri];
    if (!r) return;
    if (t.dataset.r === 'value') r.value = Math.max(0, +t.value || 0);
    else r[t.dataset.r] = t.value;
    onChange?.();
  });
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (outside(e)) return;
    if (t.closest('[data-r-add]')) {
      get().push({ id: uid(), value: 10, unit: 'min', level: 'vibrate' });
      rerender();
    } else if (t.closest('[data-r-del]')) {
      get().splice(+t.closest('[data-ri]').dataset.ri, 1);
      rerender();
    } else if (t.closest('[data-r-test]')) {
      const r = get()?.[+t.closest('[data-ri]').dataset.ri];
      if (r) testLevel(r.level);
    }
  });
}
