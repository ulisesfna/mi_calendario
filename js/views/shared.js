// Piezas comunes de las vistas: "chips" de eventos y arrastrar entre días.
import * as store from '../store.js';
import { findInstance } from '../engine.js';
import { ctx } from '../ui/dom.js';
import { addDays, diffDays, esc, fmtTime, parseLocal, rgba, textOn } from '../util.js';

/**
 * Bloque de evento para la vista mensual.
 * mode: 'full' (hora + título) | 'short' (solo título) | 'color' (solo la barra de color).
 * Lo que está fuera de la agenda se muestra siempre solo con color, atenuado.
 */
/** Marca de las tareas: ⚠ vencida y sin hacer, ∞ sin fin (en curso) */
function taskMark(inst) {
  if (inst.rolled) return inst.pending === 'overdue' ? '⚠ ' : '∞ ';
  return inst.openEnd ? '∞ ' : '';
}
const rolledTip = (inst) =>
  inst.rolled ? ` — ${inst.pending === 'overdue' ? 'sin completar, venció el' : 'en curso desde el'} ${inst.start.getDate()}/${inst.start.getMonth() + 1}` : '';

export function blockHTML(inst) {
  const soft = store.get().settings.eventStyle === 'soft';
  let mode = inst.inAgenda ? store.monthTextMode(inst.item) : 'color';
  if (inst.rolled && mode === 'color') mode = 'short'; // las pendientes siempre se leen
  const bg = soft ? rgba(inst.color, 0.25) : inst.color;
  const fg = soft ? 'inherit' : textOn(inst.color);
  const checkable = inst.item.type === 'task' || inst.kind === 'step';
  const cls = ['chip', 'block', `m-${mode}`, inst.done ? 'done' : '', inst.inAgenda ? '' : 'ghost', inst.kind, inst.item.type, inst.rolled ? 'rolled' : '', ctx.selected === inst.id ? 'sel' : ''].join(' ');
  const tip = `${inst.allDay ? '' : fmtTime(inst.start) + ' '}${inst.title}${inst.inAgenda ? '' : ' (fuera de la agenda)'}${rolledTip(inst)}`;
  if (mode === 'color') return `<div class="${cls}" data-inst="${inst.id}" draggable="true" style="--c:${inst.color};--bg:${bg}" title="${esc(tip)}"></div>`;
  return `<div class="${cls}" data-inst="${inst.id}" draggable="true" style="--c:${inst.color};--bg:${bg};--fg:${fg}" title="${esc(tip)}">
    ${checkable ? `<span class="chip-check" data-check="${inst.id}">${inst.done ? '✔' : ''}</span>` : ''}
    ${mode === 'full' && !inst.allDay && !inst.rolled ? `<span class="chip-time">${fmtTime(inst.start)}</span>` : ''}<span class="chip-t">${taskMark(inst)}${esc(inst.title)}</span>
  </div>`;
}

export function chipHTML(inst, { time = false } = {}) {
  const solid = inst.allDay || inst.long || inst.kind !== 'item';
  const soft = store.get().settings.eventStyle === 'soft';
  const bg = solid ? (soft ? rgba(inst.color, 0.22) : inst.color) : 'transparent';
  const fg = solid && !soft ? textOn(inst.color) : 'inherit';
  const checkable = inst.item.type === 'task' || inst.kind === 'step';
  const cls = ['chip', solid ? 'solid' : 'timed', inst.done ? 'done' : '', inst.kind, inst.rolled ? 'rolled' : '', ctx.selected === inst.id ? 'sel' : ''].join(' ');
  const last = inst.long ? addDays(inst.end, inst.end.getHours() || inst.end.getMinutes() ? 0 : -1) : null;
  const until = last ? ` (hasta el ${last.getDate()}/${last.getMonth() + 1})` : '';
  return `<div class="${cls}" data-inst="${inst.id}" draggable="true" style="--c:${inst.color};--bg:${bg};--fg:${fg}" title="${esc(inst.title + until + rolledTip(inst))}">
    ${checkable ? `<span class="chip-check" data-check="${inst.id}">${inst.done ? '✔' : ''}</span>` : solid ? '' : '<span class="dot"></span>'}
    ${time && !inst.allDay ? `<span class="chip-time">${fmtTime(inst.start)}</span>` : ''}
    ${inst.icon ? `<span class="chip-i">${inst.icon}</span>` : ''}<span class="chip-t">${taskMark(inst)}${esc(inst.title)}</span>
  </div>`;
}

/** Clic en chip = abrir detalles; arrastrar chip (escritorio) a otra celda [data-day] = mover de día */
export function enableChipDnD(root) {
  root.addEventListener('click', (e) => {
    const check = e.target.closest('.chip [data-check]');
    if (check) {
      e.stopPropagation();
      ctx.toggleDone(check.dataset.check);
      return;
    }
    const chip = e.target.closest('.chip');
    if (chip) {
      e.stopPropagation();
      ctx.openPopover(chip.dataset.inst, chip);
    }
  });
  root.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    e.dataTransfer.setData('text/x-inst', chip.dataset.inst);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });
  root.addEventListener('dragend', (e) => e.target.closest?.('.chip')?.classList.remove('dragging'));
  root.addEventListener('dragover', (e) => {
    const cell = e.target.closest('[data-day]');
    if (!cell || !e.dataTransfer.types.includes('text/x-inst')) return;
    e.preventDefault();
    root.querySelectorAll('.drop-over').forEach((c) => c !== cell && c.classList.remove('drop-over'));
    cell.classList.add('drop-over');
  });
  root.addEventListener('dragleave', (e) => {
    const cell = e.target.closest('[data-day]');
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('drop-over');
  });
  root.addEventListener('drop', (e) => {
    const cell = e.target.closest('[data-day]');
    const id = e.dataTransfer.getData('text/x-inst');
    root.querySelectorAll('.drop-over').forEach((c) => c.classList.remove('drop-over'));
    if (!cell || !id) return;
    e.preventDefault();
    const inst = findInstance(id);
    if (!inst) return;
    const dd = diffDays(inst.start, parseLocal(cell.dataset.day));
    if (dd) ctx.commitMove(inst, addDays(inst.start, dd), null);
  });
}
