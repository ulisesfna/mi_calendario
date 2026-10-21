// Ficha flotante de un evento/tarea con acciones rápidas, sobre todo desplazar antes/después.
import * as store from '../store.js';
import * as engine from '../engine.js';
import { describeRule } from '../recurrence.js';
import { describeReminder } from '../notify.js';
import { ctx, chooseScope, toast } from './dom.js';
import { addDays, addMinutes, esc, fmtDateLong, fmtDuration, fmtTime, startOfDay, uid } from '../util.js';

let current = null; // id de la aparición
let pos = null;
let scope = 'one';
let ripple = false;
const el = () => document.getElementById('popover');

export const popoverOpen = () => !!current;
export const popoverId = () => current;

export function openPopover(id, anchor) {
  current = id;
  ctx.selected = id;
  scope = 'one';
  const r = anchor?.getBoundingClientRect?.();
  pos = r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
  renderPopover();
  document.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
  document.querySelectorAll(`[data-inst="${CSS.escape(id)}"]`).forEach((x) => x.classList.add('sel'));
}

export function closePopover() {
  current = null;
  ctx.selected = null;
  const p = el();
  p.hidden = true;
  p.innerHTML = '';
  document.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
}

function place() {
  const p = el();
  if (matchMedia('(max-width: 720px)').matches || !pos) {
    p.classList.add('sheet');
    p.style.left = p.style.top = '';
    return;
  }
  p.classList.remove('sheet');
  const w = p.offsetWidth, h = p.offsetHeight;
  let left = pos.right + 10;
  if (left + w > innerWidth - 10) left = pos.left - w - 10;
  if (left < 10) left = Math.max(10, Math.min(innerWidth - w - 10, pos.left));
  let top = Math.min(Math.max(10, pos.top), innerHeight - h - 10);
  p.style.left = left + 'px';
  p.style.top = Math.max(10, top) + 'px';
}

export function renderPopover() {
  if (!current) return;
  const inst = engine.findInstance(current);
  if (!inst) return closePopover();
  const it = inst.item;
  const cat = store.getCategory(it.categoryId);
  const p = el();
  const isItem = inst.kind === 'item';
  const checkable = it.type === 'task' || inst.kind === 'step';
  const agenda = store.inAgenda(it);
  const reminders = isItem ? store.effectiveReminders(it) : [];
  const chain = store.categoryChain(it.categoryId).map((c) => c.id);
  const linkedPlans = it.type !== 'plan' && chain.length ? store.get().items.filter((x) => x.type === 'plan' && chain.includes(x.categoryId)) : [];
  let when;
  if (inst.openEnd) when = `${fmtDateLong(inst.start)}<br>${inst.allDay ? '' : `desde las ${fmtTime(inst.start)} · `}<span class="muted">∞ sin fin, hasta que la completes</span>`;
  else if (inst.long) when = `${fmtDateLong(inst.start)} · ${fmtTime(inst.start)}<br>→ ${fmtDateLong(inst.end)} · ${fmtTime(inst.end)}`;
  else if (inst.allDay) when = `${fmtDateLong(inst.start)}${inst.end - inst.start > 86400000 ? ` → ${fmtDateLong(addDays(inst.end, -1))}` : ''}`;
  else when = `${fmtDateLong(inst.start)}<br>${fmtTime(inst.start)} – ${fmtTime(inst.end)} <span class="muted">(${fmtDuration((inst.end - inst.start) / 60000)})</span>`;
  // Tarea sin completar cuyo momento ya pasó
  const now = new Date();
  const pending = it.type === 'task' && inst.kind === 'item' && !inst.done
    ? (!inst.openEnd && inst.end <= now ? 'overdue' : inst.openEnd && inst.start < startOfDay(now) ? 'running' : null)
    : null;
  const typeLabel = { event: 'Evento', task: 'Tarea', plan: 'Planning' }[it.type];

  p.innerHTML = `<div class="pop" style="--c:${inst.color}">
    <div class="pop-head">
      <span class="pop-swatch"></span>
      <div class="pop-title">${inst.icon ? inst.icon + ' ' : ''}${esc(inst.title)}<div class="muted small">${inst.kind === 'step' ? `Paso de «${esc(it.title)}»` : inst.kind === 'deadline' ? 'Fecha límite' : typeLabel}</div></div>
      <button class="icon-btn" data-a="edit" title="Editar (E)">✎</button>
      <button class="icon-btn" data-a="delete" title="Eliminar (Supr)">🗑</button>
      <button class="icon-btn" data-a="close" title="Cerrar (Esc)">✕</button>
    </div>
    <div class="pop-body">
      <div class="pop-line">🕒 <div>${when}</div></div>
      ${inst.recurring ? `<div class="pop-line">↻ <div>${esc(describeRule(it.recurrence, it.start))}</div></div>` : ''}
      ${it.location ? `<div class="pop-line">📍 <div>${esc(it.location)}</div></div>` : ''}
      ${cat ? `<div class="pop-line">🏷️ <div><button class="cat-chip" data-a="cat" style="--c:${cat.color}">${cat.icon ? cat.icon + ' ' : ''}${esc(cat.name)}</button></div></div>` : ''}
      ${reminders.length ? `<div class="pop-line">🔔 <div>${reminders.map((r) => `<span class="tag">${esc(describeReminder(r))}</span>`).join(' ')}${Array.isArray(it.reminders) ? '' : ` <span class="muted small">(${it.exam ? 'de examen' : 'de la categoría'})</span>`}</div></div>` : ''}
      ${it.notes ? `<div class="pop-line">📝 <div class="pre">${esc(it.notes)}</div></div>` : ''}
      ${it.type === 'plan' && it.steps?.length ? `<div class="pop-line">📋 <div>${it.steps.filter((s) => s.done).length}/${it.steps.length} pasos completados</div></div>` : ''}

      ${pending ? `<div class="pend-box">${pending === 'overdue' ? '⚠ Se pasó el plazo y no está hecha' : '∞ Sigue en curso desde hace días'}
        <div class="row"><button class="btn small" data-a="to-today">→ Pasar a hoy</button><button class="btn small" data-a="to-tomorrow">→ Pasar a mañana</button></div></div>` : ''}
      ${checkable ? `<button class="btn block ${inst.done ? '' : 'primary'}" data-a="done">${inst.done ? '↩︎ Marcar como pendiente' : '✔ Marcar como hecha'}</button>` : ''}

      <div class="pop-section">
        <div class="pop-label">Mover ${inst.allDay ? '' : '<span class="muted small kbd-hint">(o usa ↑ ↓ ← → del teclado)</span>'}</div>
        <div class="shift-grid">
          <button class="btn" data-shift-d="-1">−1 día</button>
          ${inst.allDay ? '' : `<button class="btn" data-shift="-60">−1 h</button><button class="btn" data-shift="-15">−15′</button>
          <button class="btn" data-shift="15">+15′</button><button class="btn" data-shift="60">+1 h</button>`}
          <button class="btn" data-shift-d="1">+1 día</button>
        </div>
        ${inst.recurring ? `<div class="seg small" role="radiogroup" aria-label="Alcance">
          <button class="${scope === 'one' ? 'on' : ''}" data-scope="one">Solo esta</button>
          <button class="${scope === 'following' ? 'on' : ''}" data-scope="following">Esta y siguientes</button>
          <button class="${scope === 'all' ? 'on' : ''}" data-scope="all">Toda la serie</button></div>` : ''}
        ${isItem && !inst.allDay ? `<label class="check small"><input type="checkbox" data-ripple ${ripple ? 'checked' : ''}> Desplazar también lo que viene después ese día</label>` : ''}
      </div>

      <div class="pop-actions">
        <button class="btn small ${agenda ? '' : 'warn'}" data-a="agenda" title="Decide si aparece en el calendario">${agenda ? '📅 En la agenda' : '🚫 Fuera de agenda'}</button>
        ${isItem ? '<button class="btn small" data-a="dup">⧉ Duplicar</button>' : ''}
        ${it.type === 'plan' || inst.kind !== 'item' ? '<button class="btn small" data-a="planning">🗺️ Ver en Planning</button>' : ''}
        ${cat && it.type !== 'plan' ? '<button class="btn small" data-a="newplan">＋ Planning de esta categoría</button>' : ''}
      </div>
      ${linkedPlans.length ? `<div class="pop-section"><div class="pop-label">Plannings vinculados</div>
        ${linkedPlans.map((pl) => {
          const prog = engine.planProgress(pl);
          return `<button class="linked-plan" data-plan="${pl.id}">🗺️ ${esc(pl.title)} ${prog != null ? `<span class="muted small">${Math.round(prog * 100)}%</span>` : ''}</button>`;
        }).join('')}</div>` : ''}
    </div>
  </div>`;
  p.hidden = false;
  place();
}

/** Desplaza la aparición abierta (o la indicada) */
export function shiftCurrent(minutes = 0, days = 0, id = current) {
  const inst = engine.findInstance(id);
  if (!inst) return;
  const newStart = addMinutes(addDays(inst.start, days), minutes);
  const sc = inst.recurring ? (id === current ? scope : 'one') : 'one';
  let newId = id;
  store.mutate('Desplazar', () => {
    newId = engine.applyMove(inst, newStart, null, sc) ?? id;
    if (ripple && id === current && !inst.allDay && inst.kind === 'item') engine.rippleAfter(inst, minutes + days * 1440);
  });
  if (id === current) {
    current = newId;
    ctx.selected = newId;
  }
}

async function onClick(e) {
  const t = e.target;
  const inst = engine.findInstance(current);
  if (!inst) return closePopover();
  const item = inst.item;
  const sh = t.closest('[data-shift]');
  if (sh) return shiftCurrent(+sh.dataset.shift, 0);
  const shd = t.closest('[data-shift-d]');
  if (shd) return shiftCurrent(0, +shd.dataset.shiftD);
  const sc = t.closest('[data-scope]');
  if (sc) {
    scope = sc.dataset.scope;
    return renderPopover();
  }
  const pl = t.closest('[data-plan]');
  if (pl) {
    closePopover();
    return ctx.setView('planning');
  }
  const a = t.closest('[data-a]')?.dataset.a;
  switch (a) {
    case 'close':
      return closePopover();
    case 'edit':
      closePopover();
      return ctx.openEditor({ itemId: item.id, instKey: inst.key, stepId: inst.step?.id });
    case 'delete':
      return deleteInstance(inst);
    case 'done':
      return ctx.toggleDone(inst.id);
    case 'to-today':
      return ctx.moveTaskToDay(inst.id, 0);
    case 'to-tomorrow':
      return ctx.moveTaskToDay(inst.id, 1);
    case 'cat':
      closePopover();
      return ctx.openCategory(item.categoryId);
    case 'agenda': {
      const v = !store.inAgenda(item);
      store.mutate(v ? 'Añadido a la agenda' : 'Quitado de la agenda', () => (store.getItem(item.id).inAgenda = v));
      if (!v && !store.get().settings.showOutOfAgenda) {
        closePopover();
        toast('Quitado de la agenda (lo verás en Planning → Fuera de la agenda)', { action: ctx.undo });
      } else if (!v) toast('Fuera de la agenda: sigue en el calendario (en Mes como línea fina), sin avisos automáticos', { action: ctx.undo });
      return;
    }
    case 'dup': {
      const copy = structuredClone(store.getItem(item.id));
      copy.id = uid();
      copy.createdAt = Date.now();
      copy.title = copy.title + ' (copia)';
      if (inst.recurring) {
        copy.recurrence = null;
        copy.overrides = {};
        copy.start = `${inst.key}T${item.start.slice(11)}`;
      }
      store.mutate('Duplicar', (s) => s.items.push(copy));
      closePopover();
      return ctx.openEditor({ itemId: copy.id });
    }
    case 'planning':
      closePopover();
      return ctx.setView('planning');
    case 'newplan': {
      closePopover();
      return ctx.openEditor({ type: 'plan', title: `Planning de ${store.getCategory(item.categoryId)?.name ?? ''}`, categoryId: item.categoryId });
    }
  }
}

export async function deleteInstance(inst) {
  let sc = 'one';
  if (inst.recurring) {
    sc = await chooseScope('eliminar');
    if (!sc) return;
  }
  store.mutate('Eliminar', () => engine.applyDelete(inst, sc));
  closePopover();
  toast('Eliminado', { action: ctx.undo });
}

export function initPopover() {
  const p = el();
  p.addEventListener('click', onClick);
  p.addEventListener('change', (e) => {
    if (e.target.matches('[data-ripple]')) ripple = e.target.checked;
  });
  document.addEventListener('pointerdown', (e) => {
    if (!current) return;
    if (p.contains(e.target) || e.target.closest('[data-inst]') || e.target.closest('.modal-wrap')) return;
    closePopover();
  });
  window.addEventListener('resize', () => current && place());
}
