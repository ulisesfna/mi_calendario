// Arranque de la app: navegación, barra lateral, atajos y "añadir rápido".
import * as store from './store.js';
import * as engine from './engine.js';
import * as notify from './notify.js';
import * as push from './push.js';
import * as native from './native.js';
import { ctx, $, toast, chooseScope, openModal, hasModal, closeTopModal, floatingMenu } from './ui/dom.js';
import { openPopover, closePopover, renderPopover, popoverOpen, popoverId, shiftCurrent, deleteInstance } from './ui/popover.js';
import { initPopover } from './ui/popover.js';
import { openEditor } from './ui/editor.js';
import { renderCategoryTree, wireCategoryTree, openCategory } from './ui/categories.js';
import { openImporter, duplicateSubjects, unifySubjects, markExams } from './ui/importer.js';
import { openSettings } from './ui/settings.js';
import { initSyncUI, statusLine, statusAction } from './ui/syncui.js';
import { getStatus as syncStatus } from './sync.js';
import { renderTimeGrid, updateNowLine } from './views/timegrid.js';
import { renderMonth, fitCells } from './views/month.js';
import { renderAgenda } from './views/agenda.js';
import { renderPlanning } from './views/planning.js';
import { parseQuick, quickToItem, quickSummary } from './quickadd.js';
import { nextFreeColor } from './palette.js';
import {
  addDays, addMonths, dateKey, DAY_LETTER, esc, fmtDate, fmtRelative, fmtTime, MONTHS, MONTHS_SHORT, norm, parseLocal,
  sameDay, startOfDay, startOfMonth, startOfWeek, uid,
} from './util.js';

const VIEWS = {
  day: { label: 'Día', key: 'd' },
  '3day': { label: '3 días', key: '3' },
  week: { label: 'Semana', key: 's' },
  month: { label: 'Mes', key: 'm' },
  agenda: { label: 'Agenda', key: 'a' },
  planning: { label: 'Planning', key: 'p' },
};
const VIEW_ICONS = { day: '▤', '3day': '▥', week: '▦', month: '▩', agenda: '☰', planning: '🗺️' };

store.load();
const S = () => store.get().settings;

ctx.view = store.get().ui.view ?? S().defaultView ?? 'week';
if (!VIEWS[ctx.view]) ctx.view = 'week';
if (matchMedia('(max-width: 720px)').matches && ctx.view === 'week' && !store.get().ui.view) ctx.view = '3day';
ctx.cursor = new Date();
let miniCursor = startOfMonth(new Date());

// ---------------- Contexto compartido ----------------

ctx.render = render;
ctx.openEditor = (o) => {
  closePopover();
  openEditor(o);
};
ctx.openPopover = openPopover;
ctx.closePopover = closePopover;
ctx.openCategory = openCategory;
ctx.undo = () => {
  const l = store.undo();
  if (l) toast(`Deshecho: ${l}`, { action: () => store.redo(), actionLabel: 'Rehacer', timeout: 3000 });
  else toast('Nada que deshacer');
};
ctx.goto = (key, view) => {
  ctx.cursor = parseLocal(key);
  miniCursor = startOfMonth(ctx.cursor);
  if (view) setView(view);
  else render();
};
ctx.setView = setView;
ctx.applyTheme = applyTheme;
ctx.toggleDone = (id) => {
  const inst = engine.findInstance(id);
  if (!inst) return;
  store.mutate(inst.done ? 'Marcar pendiente' : 'Completar', () => engine.applyDone(inst, !inst.done));
  if (!inst.done && navigator.userActivation?.hasBeenActive !== false) {
    try {
      navigator.vibrate?.(20);
    } catch { /* */ }
  }
};
ctx.quickShift = (id, min) => shiftCurrent(min, 0, id);
/** Pasa una tarea pendiente a hoy (offset 0) o mañana (1), manteniendo su hora */
ctx.moveTaskToDay = (id, offset) => {
  const inst = engine.findInstance(id);
  if (!inst) return;
  const day = addDays(startOfDay(new Date()), offset);
  let newId = null;
  store.mutate(offset ? 'Pasar a mañana' : 'Pasar a hoy', () => {
    newId = engine.moveToDay(inst, day);
    // Si hoy esa hora ya ha pasado, que empiece ahora (en la próxima media hora)
    const moved = engine.findInstance(newId);
    if (!offset && moved && !moved.allDay && moved.start < new Date()) {
      const d = new Date();
      d.setMinutes(Math.ceil((d.getMinutes() + 1) / 30) * 30, 0, 0);
      newId = engine.applyMove(moved, d, null, 'one');
    }
  });
  if (popoverOpen() && popoverId() === id) closePopover();
  toast(offset ? 'Pasada a mañana' : 'Pasada a hoy', { action: ctx.undo, timeout: 3500 });
};
ctx.commitMove = async (inst, newStart, newDuration) => {
  let scope = 'one';
  if (inst.recurring) {
    scope = await chooseScope(newDuration != null && +newStart === +inst.start ? 'cambiar' : 'mover');
    if (!scope) return render();
  }
  let newId = null;
  store.mutate(newDuration != null ? 'Cambiar duración' : 'Mover', () => {
    newId = engine.applyMove(inst, newStart, newDuration, scope);
  });
  if (popoverOpen() && popoverId() === inst.id && newId) {
    ctx.selected = newId;
    openPopover(newId, document.querySelector(`[data-inst="${CSS.escape(newId)}"]`));
  }
  toast(newDuration != null && +newStart === +inst.start ? 'Duración cambiada' : `Movido a ${fmtDate(newStart)}${inst.allDay ? '' : ' ' + fmtTime(newStart)}`, { action: ctx.undo, timeout: 3500 });
};

// ---------------- Vistas ----------------

function setView(v) {
  if (!VIEWS[v]) return;
  ctx.view = v;
  ctx.keepScroll = null;
  store.quiet((s) => (s.ui.view = v));
  closePopover();
  render();
}

function range() {
  const ws = S().weekStart ?? 1;
  switch (ctx.view) {
    case 'day': return { start: startOfDay(ctx.cursor), days: 1 };
    case '3day': return { start: startOfDay(ctx.cursor), days: 3 };
    case 'week': return { start: startOfWeek(ctx.cursor, ws), days: 7 };
    default: return null;
  }
}

/** Eje en el que se desliza cada vista: el mes de arriba a abajo, el resto de lado */
const swipeAxis = () => (ctx.view === 'month' ? 'y' : 'x');

function step(dir, { animate = true } = {}) {
  const c = ctx.cursor;
  switch (ctx.view) {
    case 'day': ctx.cursor = addDays(c, dir); break;
    case '3day': ctx.cursor = addDays(c, 3 * dir); break;
    case 'week': ctx.cursor = addDays(c, 7 * dir); break;
    case 'month': ctx.cursor = addMonths(c, dir); break;
    case 'agenda': ctx.cursor = addDays(c, 7 * dir); break;
    default: return;
  }
  miniCursor = startOfMonth(ctx.cursor);
  closePopover();
  render();
  if (animate) {
    // El periodo nuevo entra por el lado hacia el que se avanza
    const el = $('#view').firstElementChild;
    const prop = swipeAxis() === 'x' ? 'translateX' : 'translateY';
    el?.animate?.([{ transform: `${prop}(${dir * 48}px)`, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

function title() {
  const c = ctx.cursor;
  const r = range();
  if (ctx.view === 'planning') return 'Planning';
  if (ctx.view === 'month') return `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
  if (ctx.view === 'agenda') return `Desde el ${c.getDate()} ${MONTHS_SHORT[c.getMonth()]}`;
  const narrow = matchMedia('(max-width: 720px)').matches;
  if (r.days === 1) return `${c.getDate()} ${(narrow ? MONTHS_SHORT : MONTHS)[c.getMonth()]} ${c.getFullYear()}`;
  const end = addDays(r.start, r.days - 1);
  if (narrow && r.start.getMonth() === end.getMonth()) return `${r.start.getDate()}–${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`;
  if (r.start.getMonth() === end.getMonth()) return `${r.start.getDate()}–${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  return `${r.start.getDate()} ${MONTHS_SHORT[r.start.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

function render() {
  const view = $('#view');
  view.className = `view-${ctx.view}`;
  const r = range();
  if (r) renderTimeGrid(view, r);
  else if (ctx.view === 'month') renderMonth(view);
  else if (ctx.view === 'agenda') renderAgenda(view);
  else if (ctx.view === 'planning') renderPlanning(view);

  $('#rangeTitle').textContent = title();
  document.title = `${title()} · Calendario`;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === ctx.view));
  $('#navArrows').style.visibility = ctx.view === 'planning' ? 'hidden' : '';
  renderMiniCal();
  renderCategoryTree($('#cats'));
  renderFilters();
  renderBell();
  $('#undoBtn').disabled = !store.canUndo();
  if (popoverOpen()) renderPopover();
}

// ---------------- Filtros rápidos (qué se ve) ----------------

const TYPE_FILTERS = [['event', '📅', 'Eventos'], ['task', '✅', 'Tareas'], ['plan', '🗺️', 'Plannings']];

function filtersHTML() {
  const s = S();
  const t = s.showTypes ?? {};
  return `<div class="filter-types" role="group" aria-label="Qué mostrar">
      ${TYPE_FILTERS.map(([k, i, l]) => `<button class="ftype ${t[k] !== false ? 'on' : ''}" data-ftype="${k}" aria-pressed="${t[k] !== false}" title="${t[k] !== false ? 'Ocultar' : 'Mostrar'} ${l.toLowerCase()}">${i} ${l}</button>`).join('')}
    </div>
    <label class="check small"><input type="checkbox" data-fopt="showOutOfAgenda" ${s.showOutOfAgenda ? 'checked' : ''}> Ver en el calendario lo que está fuera de la agenda (en Mes, como línea fina)</label>
    <label class="check small"><input type="checkbox" data-fopt="showDone" ${s.showDone !== false ? 'checked' : ''}> Ver tareas completadas</label>
    <label class="check small"><input type="checkbox" data-fopt="rollOver" ${s.rollOver !== false ? 'checked' : ''}> Mostrar hoy las tareas pendientes de días anteriores</label>
    <div class="row center wrap small mtext-row">Texto en la vista mes
      <div class="seg small">${[['full', 'Hora y título'], ['short', 'Título'], ['color', 'Solo color']].map(([v, l]) => `<button class="${(s.monthText ?? 'full') === v ? 'on' : ''}" data-mtext="${v}">${l}</button>`).join('')}</div>
    </div>`;
}

function renderFilters() {
  document.querySelectorAll('[data-filters]').forEach((el) => (el.innerHTML = filtersHTML()));
  const t = S().showTypes ?? {};
  const hiddenTypes = TYPE_FILTERS.filter(([k]) => t[k] === false).length;
  $('#showBtn').classList.toggle('active', hiddenTypes > 0);
  $('#showBtn').title = hiddenTypes ? `Mostrar (hay ${hiddenTypes} tipo${hiddenTypes > 1 ? 's' : ''} oculto${hiddenTypes > 1 ? 's' : ''})` : 'Qué mostrar';
}

function wireFilters() {
  document.addEventListener('click', (e) => {
    const ft = e.target.closest('[data-ftype]');
    if (ft) {
      const k = ft.dataset.ftype;
      store.quiet((s) => (s.settings.showTypes = { ...s.settings.showTypes, [k]: s.settings.showTypes?.[k] === false }), true);
      const on = S().showTypes[k];
      toast(`${TYPE_FILTERS.find((x) => x[0] === k)[2]}: ${on ? 'visibles' : 'ocultos'}`, { timeout: 1500 });
      return;
    }
    const mt = e.target.closest('[data-mtext]');
    if (mt) store.quiet((s) => (s.settings.monthText = mt.dataset.mtext), true);
  });
  document.addEventListener('change', (e) => {
    const k = e.target.dataset?.fopt;
    if (k) store.quiet((s) => (s.settings[k] = e.target.checked), true);
  });
}

// ---------------- Deslizar para cambiar de periodo ----------------

function wireSwipe() {
  const view = $('#view');
  let s = null;
  const canSwipe = () => ['day', '3day', 'week', 'month', 'agenda'].includes(ctx.view) && !hasModal();

  view.addEventListener('touchstart', (e) => {
    s = null;
    if (e.touches.length !== 1 || !canSwipe() || e.target.closest('input, textarea, select')) return;
    s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), axis: null, d: 0, el: null };
  }, { passive: true });

  view.addEventListener('touchmove', (e) => {
    if (!s || ctx.touchDragging) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.axis) {
      if (Math.hypot(dx, dy) < 12) return;
      const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis !== swipeAxis()) {
        s = null; // es un desplazamiento normal (scroll)
        return;
      }
      s.axis = axis;
      s.el = view.firstElementChild;
      if (s.el) s.el.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();
    s.d = s.axis === 'x' ? dx : dy;
    if (s.el) {
      s.el.style.transform = `${s.axis === 'x' ? 'translateX' : 'translateY'}(${s.d * 0.9}px)`;
      s.el.style.opacity = String(1 - Math.min(0.5, Math.abs(s.d) / 600));
    }
  }, { passive: false });

  const end = () => {
    if (!s?.axis || !s.el) {
      s = null;
      return;
    }
    const { el, d, axis, t } = s;
    s = null;
    const size = axis === 'x' ? view.clientWidth : view.clientHeight;
    const fast = Math.abs(d) / Math.max(1, Date.now() - t) > 0.45;
    const prop = axis === 'x' ? 'translateX' : 'translateY';
    if (Math.abs(d) > size * 0.2 || (fast && Math.abs(d) > 40)) {
      // Deslizar hacia la izquierda (o hacia arriba) = periodo siguiente
      const dir = d < 0 ? 1 : -1;
      el.style.transition = 'transform .14s ease-in, opacity .14s';
      el.style.transform = `${prop}(${-dir * size * 0.6}px)`;
      el.style.opacity = '0';
      setTimeout(() => step(dir), 130);
    } else {
      el.style.transition = 'transform .18s ease-out, opacity .18s';
      el.style.transform = '';
      el.style.opacity = '';
    }
  };
  view.addEventListener('touchend', end);
  view.addEventListener('touchcancel', end);

  // Ratón / panel táctil: rueda en el mes y deslizamiento horizontal en el resto
  let acc = 0, lock = 0, resetT = null;
  view.addEventListener('wheel', (e) => {
    if (!canSwipe() || e.ctrlKey) return;
    const axis = swipeAxis();
    const delta = axis === 'y' ? e.deltaY : e.deltaX;
    if (Math.abs(delta) <= Math.abs(axis === 'y' ? e.deltaX : e.deltaY)) return;
    // En el mes solo si la propia vista no tiene nada que desplazar
    if (axis === 'y' && view.scrollHeight > view.clientHeight + 4) return;
    e.preventDefault();
    if (Date.now() < lock) return;
    acc += delta;
    clearTimeout(resetT);
    resetT = setTimeout(() => (acc = 0), 250);
    if (Math.abs(acc) > (axis === 'y' ? 60 : 90)) {
      step(acc > 0 ? 1 : -1);
      acc = 0;
      lock = Date.now() + 450;
    }
  }, { passive: false });
}

// ---------------- Mini calendario ----------------

function renderMiniCal() {
  const ws = S().weekStart ?? 1;
  const start = startOfWeek(miniCursor, ws);
  const end = addDays(start, 42);
  const busy = new Set(engine.instancesInRange(start, end).map((i) => dateKey(i.start)));
  const r = range();
  const inRange = (d) => (r ? d >= r.start && d < addDays(r.start, r.days) : ctx.view === 'month' ? d.getMonth() === ctx.cursor.getMonth() : sameDay(d, ctx.cursor));
  const today = new Date();
  let html = `<div class="mini-head"><button class="icon-btn" data-mini="-1">‹</button><b>${MONTHS[miniCursor.getMonth()]} ${miniCursor.getFullYear()}</b><button class="icon-btn" data-mini="1">›</button></div>
    <div class="mini-grid">${Array.from({ length: 7 }, (_, i) => `<span class="mini-dow">${DAY_LETTER[(ws + i) % 7]}</span>`).join('')}`;
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const cls = [d.getMonth() !== miniCursor.getMonth() ? 'other' : '', sameDay(d, today) ? 'today' : '', inRange(d) ? 'inrange' : '', busy.has(dateKey(d)) ? 'busy' : ''].join(' ');
    html += `<button class="mini-day ${cls}" data-mday="${dateKey(d)}">${d.getDate()}</button>`;
  }
  $('#minical').innerHTML = html + '</div>';
}

// ---------------- Campana de avisos ----------------

function renderBell() {
  const n = notify.activeList().filter((a) => a.level !== 'alarm' && a.level !== 'persistent').length + notify.missedList().length;
  const b = $('#bellCount');
  b.textContent = n || '';
  b.hidden = !n;
}

function openBell(anchor) {
  const active = notify.activeList();
  const missed = notify.missedList();
  const next = notify.upcoming(24).slice(0, 6);
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  floatingMenu(anchor, `<div class="bell-panel">
    ${perm === 'default' ? '<button class="btn primary block" data-b="perm">Activar notificaciones</button>' : ''}
    <h4>Avisos</h4>
    ${active.length ? active.map((a) => `<div class="bell-item" style="--c:${a.color}"><div><b>${esc(a.title)}</b><div class="small muted">${esc(a.body)}</div></div>
      <button class="btn small" data-b="snooze" data-id="${a.id}">+10′</button><button class="btn small" data-b="ack" data-id="${a.id}">Vale</button></div>`).join('') : '<p class="muted small">No hay avisos activos.</p>'}
    ${missed.length ? `<h4>Perdidos mientras estaba cerrada <button class="btn link small" data-b="clear">Limpiar</button></h4>
      ${missed.slice(0, 10).map((a) => `<div class="bell-item" style="--c:${a.color}"><div><b>${esc(a.title)}</b><div class="small muted">${fmtRelative(a.at - Date.now())}</div></div></div>`).join('')}` : ''}
    <h4>Próximas 24 h</h4>
    ${next.length ? next.map((d) => `<div class="small">${fmtTime(new Date(d.at))} · ${esc(d.inst.title)} ${notify.LEVELS[d.r.level]?.icon ?? ''}</div>`).join('') : '<p class="muted small">Nada programado.</p>'}
    <button class="btn link small" data-b="settings">Configurar avisos…</button>
  </div>`, (e, close) => {
    const b = e.target.closest('[data-b]');
    if (!b) return false;
    const k = b.dataset.b;
    if (k === 'ack') notify.ack(b.dataset.id);
    if (k === 'snooze') notify.snooze(b.dataset.id, 10);
    if (k === 'clear') notify.clearMissed();
    if (k === 'perm') notify.requestPermission().then(renderBell);
    if (k === 'settings') openSettings();
    close();
  });
}

// ---------------- Añadir rápido ----------------

function findOrCreateCategory(name) {
  if (!name) return null;
  const n = norm(name);
  const cats = store.get().categories;
  const found = cats.find((c) => norm(c.name) === n) ?? cats.find((c) => norm(c.name).startsWith(n)) ?? cats.find((c) => norm(c.name).includes(n));
  if (found) return found.id;
  const cat = store.newCategory({ name, color: nextFreeColor(cats.map((c) => c.color)) });
  store.mutate('Nueva categoría', (s) => s.categories.push(cat));
  toast(`Categoría «${name}» creada`);
  return cat.id;
}

function quickAdd(text, openAfter = false) {
  const p = parseQuick(text);
  if (!p.title && !p.date) return;
  const fields = quickToItem(p, { defaultDuration: S().defaultDuration });
  const categoryId = p.categoryName ? findOrCreateCategory(p.categoryName) : (localStorage.getItem('cdt.lastCategory') || store.get().categories[0]?.id || null);
  const item = store.newItem({
    ...fields,
    categoryId: store.getCategory(categoryId) ? categoryId : null,
    inAgenda: p.inAgenda,
    reminders: p.reminder ? [{ id: uid(), ...p.reminder }] : null,
  });
  if (!item.start && item.type === 'event') {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    item.start = `${dateKey(d)}T${String(d.getHours()).padStart(2, '0')}:00`;
  }
  store.mutate('Añadir', (s) => s.items.push(item));
  if (openAfter) return ctx.openEditor({ itemId: item.id });
  if (item.start) {
    ctx.cursor = parseLocal(item.start);
    miniCursor = startOfMonth(ctx.cursor);
    render();
  }
  toast(`Añadido: ${item.title}${item.start ? ' · ' + fmtDate(parseLocal(item.start)) : ' (sin fecha)'}`, { action: () => ctx.openEditor({ itemId: item.id }), actionLabel: 'Editar' });
}

function wireQuick() {
  const input = $('#quickInput');
  const hint = $('#quickHint');
  input.addEventListener('input', () => {
    const v = input.value.trim();
    if (!v) {
      hint.hidden = true;
      return;
    }
    const p = parseQuick(v);
    hint.hidden = false;
    hint.innerHTML = `<b>${esc(p.title || '…')}</b> · ${esc(quickSummary(p))}<span class="muted"> — Enter para crear, Mayús+Enter para abrir el editor</span>`;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      quickAdd(v, e.shiftKey);
      input.value = '';
      hint.hidden = true;
    } else if (e.key === 'Escape') {
      input.value = '';
      hint.hidden = true;
      input.blur();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => (hint.hidden = true), 150));
  input.addEventListener('focus', () => input.value && input.dispatchEvent(new Event('input')));
}

// ---------------- Ayuda y bienvenida ----------------

function openHelp() {
  openModal({
    title: 'Atajos y trucos',
    wide: true,
    build(body) {
      body.innerHTML = `<div class="help">
        <h3>Teclado</h3>
        <table>
          <tr><td><kbd>N</kbd> / <kbd>T</kbd> / <kbd>L</kbd></td><td>Nuevo evento / tarea / planning</td></tr>
          <tr><td><kbd>/</kbd></td><td>Ir a «Añadir rápido»</td></tr>
          <tr><td><kbd>H</kbd></td><td>Ir a hoy</td></tr>
          <tr><td><kbd>D</kbd> <kbd>3</kbd> <kbd>S</kbd> <kbd>M</kbd> <kbd>A</kbd> <kbd>P</kbd></td><td>Día · 3 días · Semana · Mes · Agenda · Planning</td></tr>
          <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>Periodo anterior / siguiente</td></tr>
          <tr><td>Con un evento abierto: <kbd>↑</kbd> <kbd>↓</kbd></td><td>Moverlo 15 min antes / después (<kbd>Mayús</kbd> = 1 hora)</td></tr>
          <tr><td>Con un evento abierto: <kbd>←</kbd> <kbd>→</kbd></td><td>Moverlo un día antes / después</td></tr>
          <tr><td>Con un evento abierto: <kbd>E</kbd> · <kbd>Supr</kbd> · <kbd>Espacio</kbd></td><td>Editar · eliminar · completar</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td>Deshacer / rehacer cualquier cambio</td></tr>
        </table>
        <h3>Añadir rápido</h3>
        <ul>
          <li><code>Estudiar física mañana 18:00 2h #Física !alarma-15m</code></li>
          <li><code>tarea: entregar práctica viernes #Programación !sonido-1d</code></li>
          <li><code>plan: preparar parcial #Química</code></li>
          <li><code>Gimnasio cada lunes y miércoles 19-20:30 #Salud !vibra</code></li>
          <li><code>Idea de viaje ~</code> (el <code>~</code> lo guarda fuera de la agenda)</li>
        </ul>
        <p class="muted small">Niveles de aviso: <code>!silencio</code> <code>!vibra</code> <code>!sonido</code> <code>!alarma</code> <code>!persistente</code>, con antelación opcional: <code>-10m</code>, <code>-2h</code>, <code>-1d</code>.</p>
        <h3>Ratón y dedo</h3>
        <ul>
          <li>Arrastra en un hueco para crear con esa duración. Arrastra un evento para moverlo; estira su borde inferior para cambiar la duración.</li>
          <li>En el móvil: mantén pulsado un evento y arrástralo.</li>
          <li>En Mes, arrastra un evento a otro día.</li>
        </ul>
      </div>`;
    },
  });
}

function welcome() {
  if (store.get().ui.welcomed) return;
  openModal({
    title: '¡Bienvenido/a!',
    onClose: () => store.quiet((s) => (s.ui.welcomed = true)),
    build(body, close) {
      body.innerHTML = `<div class="welcome">
        <p>Tu calendario se guarda en este dispositivo. Para empezar:</p>
        <div class="welcome-grid">
          <button class="wbtn" data-w="import"><span>🎓</span><b>Importar mi horario</b><small>Desde Chronos (UB) u otro .ics, cada asignatura con su color</small></button>
          <button class="wbtn" data-w="cats"><span>🏷️</span><b>Crear categorías</b><small>Escribe el nombre y pulsa Enter, el color se asigna solo</small></button>
          <button class="wbtn" data-w="notif"><span>🔔</span><b>Activar avisos</b><small>Vibración, sonido, alarma o alarma persistente</small></button>
          <button class="wbtn" data-w="help"><span>⌨️</span><b>Ver trucos</b><small>Añadir rápido, atajos, arrastrar</small></button>
        </div></div>`;
      body.onclick = async (e) => {
        const w = e.target.closest('[data-w]')?.dataset.w;
        if (!w) return;
        close();
        if (w === 'import') openImporter();
        if (w === 'cats') {
          openSidebar(true);
          const f = $('.cat-quick');
          f.hidden = false;
          f.n.focus();
        }
        if (w === 'notif') await notify.requestPermission();
        if (w === 'help') openHelp();
      };
    },
  });
}

// ---------------- Tema y barra lateral ----------------

function applyTheme() {
  const t = S().theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

function openSidebar(v) {
  document.body.classList.toggle('side-open', v);
}

// ---------------- Atajos ----------------

function isTyping(e) {
  const t = e.target;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** Cierra lo que esté abierto encima (Escape o botón «atrás» de Android). false si no había nada. */
function closeTop() {
  if (document.querySelector('.float-menu')) {
    document.querySelectorAll('.float-menu').forEach((m) => m.remove());
    return true;
  }
  if (closeTopModal()) return true;
  if (popoverOpen()) {
    closePopover();
    return true;
  }
  if (document.body.classList.contains('side-open')) {
    openSidebar(false);
    return true;
  }
  return false;
}

function onKey(e) {
  if (e.key === 'Escape') {
    closeTop();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !isTyping(e)) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      return ctx.undo();
    }
    if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      const l = store.redo();
      return l && toast(`Rehecho: ${l}`);
    }
    return;
  }
  if (isTyping(e) || hasModal() || e.altKey || e.ctrlKey || e.metaKey) return;

  if (popoverOpen()) {
    const big = e.shiftKey ? 60 : 15;
    const inst = engine.findInstance(popoverId());
    const map = { ArrowUp: [-big, 0], ArrowDown: [big, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (map[e.key]) {
      e.preventDefault();
      if (inst?.allDay && map[e.key][0]) return;
      return shiftCurrent(...map[e.key]);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return inst && deleteInstance(inst);
    if (e.key.toLowerCase() === 'e' && inst) {
      closePopover();
      return ctx.openEditor({ itemId: inst.item.id, instKey: inst.key });
    }
    if (e.key === ' ' && inst && (inst.item.type === 'task' || inst.kind === 'step')) {
      e.preventDefault();
      return ctx.toggleDone(inst.id);
    }
  }
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowLeft') return step(-1);
  if (e.key === 'ArrowRight') return step(1);
  if (k === 'n') return ctx.openEditor({ type: 'event' });
  if (k === 't') return ctx.openEditor({ type: 'task' });
  if (k === 'l') return ctx.openEditor({ type: 'plan' });
  if (k === 'h') return goToday();
  if (k === '/' || k === 'q') {
    e.preventDefault();
    return $('#quickInput').focus();
  }
  if (k === '?') return openHelp();
  const v = Object.entries(VIEWS).find(([, x]) => x.key === k);
  if (v) setView(v[0]);
}

function goToday() {
  ctx.cursor = new Date();
  miniCursor = startOfMonth(ctx.cursor);
  ctx.keepScroll = null;
  render();
}

// ---------------- Montaje ----------------

function buildChrome() {
  const seg = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}" title="${v.label} (${v.key.toUpperCase()})">${v.label}</button>`).join('');
  $('#viewSeg').innerHTML = seg;
  $('#bottomnav').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}"><span>${VIEW_ICONS[k]}</span>${v.label}</button>`).join('');

  document.addEventListener('click', (e) => {
    const vb = e.target.closest('[data-view]');
    if (vb) {
      setView(vb.dataset.view);
      return;
    }
  });
  $('#todayBtn').onclick = goToday;
  $('#prevBtn').onclick = () => step(-1);
  $('#nextBtn').onclick = () => step(1);
  $('#menuBtn').onclick = () => openSidebar(!document.body.classList.contains('side-open'));
  $('#scrim').onclick = () => openSidebar(false);
  $('#undoBtn').onclick = ctx.undo;
  $('#bellBtn').onclick = (e) => openBell(e.currentTarget);
  $('#createBtn').onclick = () => {
    openSidebar(false);
    ctx.openEditor({ type: 'event' });
  };
  $('#fab').onclick = (e) => {
    floatingMenu(e.currentTarget, `<div class="menu">
      <button data-v="event">📅 Evento</button><button data-v="task">✅ Tarea</button><button data-v="plan">🗺️ Planning</button>
      <button data-v="quick">⚡ Añadir rápido</button></div>`, (ev) => {
      const v = ev.target.closest('[data-v]')?.dataset.v;
      if (!v) return false;
      if (v === 'quick') setTimeout(() => $('#quickInput').focus(), 50);
      else ctx.openEditor({ type: v, date: ctx.view === 'planning' ? undefined : dateKey(ctx.cursor) });
    });
  };
  document.querySelectorAll('[data-create]').forEach((b) => (b.onclick = () => {
    openSidebar(false);
    ctx.openEditor({ type: b.dataset.create });
  }));
  $('#importBtn').onclick = () => {
    openSidebar(false);
    openImporter();
  };
  $('#settingsBtn').onclick = () => {
    openSidebar(false);
    openSettings();
  };
  $('#helpBtn').onclick = openHelp;
  $('#minical').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mini]');
    if (m) {
      miniCursor = addMonths(miniCursor, +m.dataset.mini);
      return renderMiniCal();
    }
    const d = e.target.closest('[data-mday]');
    if (d) {
      ctx.cursor = parseLocal(d.dataset.mday);
      ctx.keepScroll = null;
      if (ctx.view === 'planning') ctx.view = 'day';
      if (matchMedia('(max-width: 720px)').matches) openSidebar(false);
      render();
    }
  });
  wireCategoryTree($('#cats'));
  wireQuick();
  wireFilters();
  wireSwipe();
  document.addEventListener('keydown', onKey);
  $('#showBtn').onclick = (e) => floatingMenu(e.currentTarget, `<div class="show-menu"><h4>Mostrar</h4><div class="filters" data-filters>${filtersHTML()}</div></div>`, () => false);

  // En el mes, volver a calcular cuántos bloques caben al cambiar el tamaño
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => ctx.view === 'month' && $('#view .month') && fitCells($('#view .month')), 120);
  });
}

applyTheme();
buildChrome();
initPopover();
store.subscribe(() => render());
render();
// Primero saber qué avisos llegaron ya con la app cerrada, para no repetirlos al abrirla
push.init().catch(() => {}).finally(() => notify.init(() => renderBell()));
setInterval(() => {
  updateNowLine($('#view'));
}, 60000);
welcome();

// Horarios importados con la versión anterior (una subcategoría por TEORIA/PROB/grupo): ofrecer unirlos
setTimeout(() => {
  const exams = markExams();
  if (exams) toast(`📝 ${exams} ${exams > 1 ? 'exámenes' : 'examen'} con avisos automáticos (2 y 1 semanas antes, alarma 1 h 30 min antes)`, { timeout: 8000 });
  for (const g of store.get().categories.filter((c) => !c.parentId && store.childrenOf(c.id).length)) {
    const n = duplicateSubjects(g.id);
    if (n) {
      toast(`«${g.name}» tiene asignaturas repetidas por tipo de clase o grupo`, {
        actionLabel: 'Unir', timeout: 20000,
        action: () => {
          const m = unifySubjects(g.id);
          toast(`Unidas ${m} subcategorías`, { action: ctx.undo });
        },
      });
    }
  }
}, 800);

// ---------------- Sincronización ----------------

function renderSync(s) {
  const b = $('#syncBtn');
  b.textContent = statusLine(s);
  b.classList.toggle('attention', ['needs-pass', 'error'].includes(s.state) || (s.wasGoogle && !s.enabled));
}
initSyncUI({ onChange: renderSync });
renderSync(syncStatus());
$('#syncBtn').onclick = () => statusAction(openSettings).then(() => renderSync(syncStatus()));
setInterval(() => renderSync(syncStatus()), 60000);
setTimeout(() => {
  const s = syncStatus();
  if (s.enabled && s.state === 'needs-pass') {
    toast('Sincronización: falta la contraseña', { actionLabel: 'Escribirla', timeout: 12000, action: () => statusAction(openSettings) });
  } else if (s.wasGoogle && !s.enabled) {
    toast('La sincronización ya no usa Google: vuelve a conectar con tu contraseña', { actionLabel: 'Conectar', timeout: 15000, action: openSettings });
  }
}, 2000);

// ---------------- Instalar como aplicación ----------------

// No se intercepta «beforeinstallprompt»: Chrome gestiona la instalación con su propio menú
// (en Android, interceptarlo podía dejar la instalación a medias).
ctx.promptInstall = () => toast('Menú del navegador ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio»');
window.addEventListener('appinstalled', () => toast('¡Aplicación instalada!'));

// Pedir almacenamiento persistente: así Android/Chrome no borran los datos ni el service worker
// para liberar espacio (en apps instaladas se concede sin preguntar)
navigator.storage?.persist?.().catch(() => {});

// App de Android: alarmas del móvil, botón «atrás» y versiones nuevas
native.init({ back: closeTop, toast }).catch((e) => console.warn('native', e));

// (en la app de Android no hace falta service worker: los archivos van dentro del APK)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !native.isNative) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}

// Para depurar desde la consola
window.__cal = { store, engine, notify, ctx };
