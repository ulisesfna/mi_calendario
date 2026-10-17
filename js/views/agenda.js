// Vista de agenda (lista de próximos días).
import * as store from '../store.js';
import { instancesInRange, pendingTasks } from '../engine.js';
import { ctx } from '../ui/dom.js';
import { addDays, dateKey, DAY_LONG, esc, fmtTime, MONTHS, sameDay, startOfDay } from '../util.js';

const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;

function rowHTML(inst, { pending = false } = {}) {
  const it = inst.item;
  const cat = store.getCategory(it.categoryId);
  const checkable = it.type === 'task' || inst.kind === 'step';
  let time;
  if (inst.openEnd) time = `${inst.allDay ? '<span class="muted">día</span>' : fmtTime(inst.start)}<small>∞ sin fin</small>`;
  else if (inst.long) time = `${fmtTime(inst.start)}<small>→ ${shortDate(addDays(inst.end, inst.end.getHours() || inst.end.getMinutes() ? 0 : -1))}</small>`;
  else if (inst.allDay) time = '<span class="muted">todo el día</span>';
  else time = `${fmtTime(inst.start)}<small>${fmtTime(inst.end)}</small>`;
  const status = pending
    ? inst.pending === 'overdue'
      ? `<span class="tag warn-tag">⚠ venció el ${shortDate(inst.allDay ? addDays(inst.end, -1) : inst.end)}</span>`
      : `<span class="tag">∞ en curso desde el ${shortDate(inst.start)}</span>`
    : '';
  const meta = [
    status,
    cat ? `<span class="cat-dot" style="--c:${cat.color}"></span>${esc(cat.name)}` : '',
    it.location ? `📍 ${esc(it.location)}` : '',
    inst.recurring ? '↻' : '',
    inst.kind === 'step' ? `📋 ${esc(it.title)}` : '',
    inst.inAgenda ? '' : '<span class="tag">fuera de agenda</span>',
  ].filter(Boolean).join(' · ');
  return `<div class="ag-row ${inst.done ? 'done' : ''} ${inst.inAgenda ? '' : 'ghost'}" data-inst="${inst.id}" style="--c:${inst.color}">
    <div class="ag-time">${time}</div>
    <div class="ag-bar"></div>
    <div class="ag-main">
      <div class="ag-title">${checkable ? `<span class="chip-check" data-check="${inst.id}">${inst.done ? '✔' : ''}</span>` : ''}${inst.icon ? inst.icon + ' ' : ''}${esc(inst.title)}</div>
      ${meta ? `<div class="ag-meta">${meta}</div>` : ''}
    </div>
    ${pending ? `<div class="ag-move">
      <button class="btn small" data-move="0" title="Pasarla a hoy">Hoy</button>
      <button class="btn small" data-move="1" title="Pasarla a mañana">Mañana</button>
    </div>` : inst.kind === 'item' && !inst.allDay ? `<div class="ag-quick">
      <button class="icon-btn" data-shift="-15" title="15 min antes">↑</button>
      <button class="icon-btn" data-shift="15" title="15 min después">↓</button>
    </div>` : ''}
  </div>`;
}

export function renderAgenda(el) {
  const days = ctx.agendaDays ?? 45;
  const from = startOfDay(ctx.cursor);
  const to = addDays(from, days);
  // La agenda solo muestra lo que está «en la agenda»
  const insts = instancesInRange(from, to, { excludeOutOfAgenda: true });
  const today = startOfDay(new Date());
  let html = '<div class="agenda">';

  // Tareas pendientes de días anteriores: vencidas sin hacer o «sin fin» que siguen en curso.
  // Se quedan aquí hasta que las completes (o las pases a otro día).
  if (from <= today) {
    const pend = pendingTasks(new Date(), { agendaOnly: true }).filter((i) => i.pending === 'overdue' || i.start < today);
    if (pend.length) {
      html += `<section class="ag-day overdue"><h3>⏳ Pendientes <span class="count">${pend.length}</span></h3>
        ${pend.map((i) => rowHTML(i, { pending: true })).join('')}</section>`;
    }
  }

  const byDay = new Map();
  for (const inst of insts) {
    const k = dateKey(inst.start < from ? from : inst.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(inst);
  }
  if (!byDay.size) html += '<p class="empty">No hay nada en estos días. Usa «＋ Crear» o escribe arriba en «Añadir rápido».</p>';
  for (const [k, list] of byDay) {
    const d = new Date(k + 'T00:00');
    const wd = DAY_LONG[d.getDay()];
    const label = sameDay(d, today) ? 'Hoy' : sameDay(d, addDays(today, 1)) ? 'Mañana' : wd[0].toUpperCase() + wd.slice(1);
    html += `<section class="ag-day ${sameDay(d, today) ? 'is-today' : ''}"><h3 data-goto="${k}"><span class="ag-dnum">${d.getDate()}</span> ${label}<span class="muted"> · ${d.getDate()} de ${MONTHS[d.getMonth()]}</span></h3>
      ${list.map((i) => rowHTML(i)).join('')}</section>`;
  }
  html += `<button class="btn block" data-more>Ver más días</button></div>`;
  el.innerHTML = html;

  const root = el.querySelector('.agenda');
  root.addEventListener('click', (e) => {
    const check = e.target.closest('[data-check]');
    if (check) return ctx.toggleDone(check.dataset.check);
    const sh = e.target.closest('[data-shift]');
    if (sh) return ctx.quickShift(sh.closest('[data-inst]').dataset.inst, +sh.dataset.shift);
    const mv = e.target.closest('[data-move]');
    if (mv) return ctx.moveTaskToDay(mv.closest('[data-inst]').dataset.inst, +mv.dataset.move);
    if (e.target.closest('[data-more]')) {
      ctx.agendaDays = days + 60;
      return ctx.render();
    }
    const go = e.target.closest('[data-goto]');
    if (go) return ctx.goto(go.dataset.goto, 'day');
    const row = e.target.closest('[data-inst]');
    if (row) ctx.openPopover(row.dataset.inst, row);
  });
}
