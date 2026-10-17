// Vista mensual: bloques compactos de color (con texto completo, corto o solo color).
import * as store from '../store.js';
import { instancesInRange, rolledOverTasks } from '../engine.js';
import { ctx } from '../ui/dom.js';
import { blockHTML, enableChipDnD } from './shared.js';
import { addDays, dateKey, DAY_SHORT, sameDay, startOfMonth, startOfWeek } from '../util.js';

export function renderMonth(el) {
  const ws = store.get().settings.weekStart ?? 1;
  const first = startOfMonth(ctx.cursor);
  const gridStart = startOfWeek(first, ws);
  const weeks = 6;
  const end = addDays(gridStart, weeks * 7);
  const insts = instancesInRange(gridStart, end);
  const byDay = new Map();
  for (const inst of insts) {
    // Un elemento de varios días aparece en cada día que ocupa
    let d = new Date(inst.start);
    d.setHours(0, 0, 0, 0);
    const last = inst.allDay ? addDays(inst.end, -1) : new Date(inst.end.getTime() - 1);
    for (let guard = 0; d <= last && guard < 62; guard++, d = addDays(d, 1)) {
      const k = dateKey(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(inst);
    }
  }
  const today = new Date();
  const mobile = matchMedia('(max-width: 720px)').matches;
  // Tareas pendientes de días anteriores: se muestran también en el día de hoy
  const tk = dateKey(today);
  if (today >= gridStart && today < end) {
    const rolled = rolledOverTasks(today);
    if (rolled.length) byDay.set(tk, [...(byDay.get(tk) ?? []), ...rolled]);
  }
  let html = `<div class="month"><div class="month-head">${Array.from({ length: 7 }, (_, i) => `<div>${DAY_SHORT[(ws + i) % 7]}</div>`).join('')}</div><div class="month-grid">`;
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(gridStart, i);
    const k = dateKey(d);
    // Primero lo de todo el día, luego por hora; lo que está fuera de la agenda al final
    const list = (byDay.get(k) ?? []).sort((a, b) => !!b.rolled - !!a.rolled || b.inAgenda - a.inAgenda || b.allDay - a.allDay || a.start - b.start);
    html += `<div class="mcell ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${sameDay(d, today) ? 'today' : ''}" data-day="${k}">
      <button class="mnum" data-goto="${k}">${d.getDate()}</button>
      <div class="mchips">${list.map(blockHTML).join('')}</div>
    </div>`;
  }
  html += '</div></div>';
  el.innerHTML = html;
  const root = el.querySelector('.month');
  enableChipDnD(root);
  fitCells(root);
  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      ctx.goto(go.dataset.goto, 'day');
      return;
    }
    const cell = e.target.closest('.mcell');
    if (!cell || e.target.closest('.chip')) return;
    if (mobile) ctx.goto(cell.dataset.day, 'day');
    else ctx.openEditor({ date: cell.dataset.day, minutes: 9 * 60 });
  });
}

/** Oculta los bloques que no caben en cada día y pone «+N» */
export function fitCells(root) {
  for (const box of root.querySelectorAll('.mchips')) {
    box.querySelector('.more')?.remove();
    const chips = [...box.children];
    chips.forEach((c) => (c.hidden = false));
    if (box.scrollHeight <= box.clientHeight + 1) continue;
    const more = document.createElement('button');
    more.className = 'more';
    more.dataset.goto = box.parentElement.dataset.day;
    box.appendChild(more);
    let hidden = 0;
    for (let i = chips.length - 1; i >= 0 && box.scrollHeight > box.clientHeight + 1; i--) {
      chips[i].hidden = true;
      hidden++;
      more.textContent = `+${hidden}`;
    }
  }
}
