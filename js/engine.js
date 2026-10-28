// Motor de "instancias": convierte ítems (con repeticiones) en apariciones concretas
// y aplica movimientos, borrados y marcados con el alcance elegido.
import * as store from './store.js';
import { occurrenceKeys, lastOccurrence } from './recurrence.js';
import {
  addDays, addMinutes, dateKey, diffDays, keyAddDays, parseLocal, startOfDay, toLocalISO, uid,
} from './util.js';

function holidaySkipper(item) {
  const hol = store.get().settings.holidays ?? [];
  if (!hol.length || !store.skipsHolidays(item)) return null;
  return (k) => hol.some((h) => k >= h.from && k <= h.to);
}

/** Construye la aparición de un ítem para una fecha original concreta (key) */
export function buildInstance(item, key) {
  const recurring = !!item.recurrence;
  const ov = recurring && key ? item.overrides?.[key] : null;
  const base = parseLocal(item.start);
  let start;
  if (ov?.start) start = parseLocal(ov.start);
  else if (recurring && key) {
    start = parseLocal(key);
    start.setHours(base.getHours(), base.getMinutes());
  } else start = base;
  const duration = ov?.duration ?? item.duration ?? 60;
  // Tarea de duración indefinida: empieza en `start` y sigue «en curso» hasta completarla.
  // Para dibujarla se le da un hueco corto (30 min o el día).
  const openEnd = item.type === 'task' && !!item.openEnd;
  let end;
  if (item.allDay) {
    start = startOfDay(start);
    end = addDays(start, openEnd ? 1 : Math.max(1, Math.round(duration / 1440)));
  } else end = addMinutes(start, openEnd ? 30 : Math.max(5, duration));
  return {
    openEnd,
    // Tareas de un día o más: se dibujan como barra en la fila «todo el día»
    long: item.type === 'task' && !openEnd && !item.allDay && duration >= 1440,
    id: recurring ? `${item.id}|${key}` : item.id,
    kind: 'item',
    item,
    key: recurring ? key : null,
    recurring,
    start,
    end,
    allDay: !!item.allDay,
    title: ov?.title || item.title || '(sin título)',
    done: recurring ? !!ov?.done : !!item.done,
    color: store.itemColor(item),
    icon: store.itemIcon(item),
    inAgenda: store.inAgenda(item),
  };
}

function stepInstance(plan, step) {
  const start = parseLocal(step.date);
  return {
    id: `${plan.id}#${step.id}`, kind: 'step', item: plan, step, key: null, recurring: false,
    start, end: addDays(start, 1), allDay: true, title: step.text || '(paso)', done: !!step.done,
    color: store.itemColor(plan), icon: '📋', inAgenda: store.inAgenda(plan),
  };
}

function deadlineInstance(item) {
  const start = parseLocal(item.deadline);
  return {
    id: `${item.id}#deadline`, kind: 'deadline', item, key: null, recurring: false,
    start, end: addDays(start, 1), allDay: true, title: `Entrega: ${item.title}`, done: false,
    color: store.itemColor(item), icon: '🏁', inAgenda: store.inAgenda(item),
  };
}

/**
 * Todas las apariciones visibles que se solapan con [from, to).
 * opts.all: ignora filtros de visibilidad / agenda / completadas
 * opts.categoryIds: limita a esas categorías
 */
export function instancesInRange(from, to, opts = {}) {
  const st = store.get();
  const showOut = opts.all || (!opts.excludeOutOfAgenda && (opts.showOutOfAgenda || st.settings.showOutOfAgenda));
  const showDone = opts.all || st.settings.showDone;
  const types = st.settings.showTypes ?? {};
  const out = [];
  const fromK = dateKey(from), toK = dateKey(to);
  for (const item of st.items) {
    if (opts.categoryIds && !opts.categoryIds.includes(item.categoryId)) continue;
    if (!opts.all && !store.isCategoryVisible(item.categoryId)) continue;
    if (!opts.all && types[item.type] === false) continue; // filtro rápido Eventos / Tareas / Plannings
    const ag = store.inAgenda(item);
    if (!ag && !showOut) continue;
    if (opts.types && !opts.types.includes(item.type)) continue;
    if (item.start) {
      const spanDays = Math.ceil((item.duration ?? 60) / 1440) + 1;
      const keys = occurrenceKeys(item.start.slice(0, 10), item.recurrence, dateKey(addDays(from, -spanDays)), toK, holidaySkipper(item));
      for (const k of keys) {
        const inst = buildInstance(item, k);
        if (inst.end > from && inst.start < to && (showDone || !inst.done)) out.push(inst);
      }
    }
    if (item.type === 'plan') {
      for (const s of item.steps ?? []) {
        if (s.date && s.date >= fromK && s.date <= toK && (showDone || !s.done)) out.push(stepInstance(item, s));
      }
    }
    if (item.deadline && item.deadline >= fromK && item.deadline <= toK && !(item.type === 'task' && item.done && !showDone)) {
      out.push(deadlineInstance(item));
    }
  }
  out.sort((a, b) => a.start - b.start || (b.allDay - a.allDay) || (b.end - b.start) - (a.end - a.start));
  return out;
}

/**
 * Tareas sin completar cuyo momento ya pasó:
 *  · pending 'overdue': tenían duración y ya terminó su plazo
 *  · pending 'running': duración indefinida y ya empezaron (siguen en curso)
 * Las repetitivas solo cuentan los últimos 30 días.
 * opts.visibleOnly: respeta categorías ocultas, el filtro de tareas y «fuera de agenda».
 */
export function pendingTasks(now = new Date(), { visibleOnly = false, agendaOnly = false } = {}) {
  const st = store.get();
  const today0 = startOfDay(now);
  const out = [];
  for (const item of st.items) {
    if (item.type !== 'task' || !item.start) continue;
    if (visibleOnly && (!store.isCategoryVisible(item.categoryId) || st.settings.showTypes?.task === false)) continue;
    if ((visibleOnly || agendaOnly) && !store.inAgenda(item)) continue;
    const insts = item.recurrence
      ? occurrenceKeys(item.start.slice(0, 10), item.recurrence, dateKey(addDays(today0, -30)), dateKey(now), holidaySkipper(item)).map((k) => buildInstance(item, k))
      : [buildInstance(item, null)];
    for (const inst of insts) {
      if (inst.done) continue;
      if (!inst.openEnd && inst.end <= now) out.push(Object.assign(inst, { pending: 'overdue' }));
      else if (inst.openEnd && inst.start <= now) out.push(Object.assign(inst, { pending: 'running' }));
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Pendientes de días anteriores que no se ven ya hoy: se «arrastran» a hoy en el calendario */
export function rolledOverTasks(now = new Date()) {
  if (store.get().settings.rollOver === false) return [];
  const today0 = startOfDay(now);
  return pendingTasks(now, { visibleOnly: true })
    .filter((i) => (i.pending === 'overdue' ? i.end <= today0 : i.start < today0))
    .map((i) => Object.assign(i, { rolled: true }));
}

/** Pasa una aparición a otro día manteniendo la hora (solo esa aparición si se repite) */
export function moveToDay(inst, day) {
  const ns = new Date(day);
  ns.setHours(inst.start.getHours(), inst.start.getMinutes(), 0, 0);
  return applyMove(inst, ns, null, 'one');
}

/** Recupera una aparición a partir de su id ("item", "item|fecha", "plan#paso") */
export function findInstance(id) {
  if (!id) return null;
  if (id.includes('#')) {
    const [itemId, sub] = id.split('#');
    const item = store.getItem(itemId);
    if (!item) return null;
    if (sub === 'deadline') return item.deadline ? deadlineInstance(item) : null;
    const step = item.steps?.find((s) => s.id === sub);
    return step?.date ? stepInstance(item, step) : null;
  }
  const [itemId, key] = id.split('|');
  const item = store.getItem(itemId);
  if (!item || !item.start) return null;
  return buildInstance(item, key ?? null);
}

/** Próximas apariciones de un ítem a partir de una fecha */
export function nextOccurrences(item, from = new Date(), n = 5, horizonDays = 800) {
  if (!item.start) return [];
  const keys = occurrenceKeys(item.start.slice(0, 10), item.recurrence, dateKey(addDays(from, -1)), dateKey(addDays(from, horizonDays)), holidaySkipper(item));
  const out = [];
  for (const k of keys) {
    const inst = buildInstance(item, k);
    if (inst.end > from) out.push(inst);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- Operaciones (se llaman dentro de store.mutate) ----------

/** Desplaza toda una serie deltaMin minutos (ajusta días de la semana, excepciones, etc.) */
export function shiftSeries(item, deltaMin) {
  if (!item.start || !deltaMin) return;
  const old = parseLocal(item.start);
  const nw = addMinutes(old, deltaMin);
  const dd = diffDays(old, nw);
  item.start = toLocalISO(nw);
  const r = item.recurrence;
  if (r && dd) {
    if (r.byDay?.length) r.byDay = r.byDay.map((d) => (((d + dd) % 7) + 7) % 7);
    r.exdates = (r.exdates ?? []).map((k) => keyAddDays(k, dd));
    if (r.until) r.until = keyAddDays(r.until, dd);
    if (r.dates?.length) r.dates = r.dates.map((k) => keyAddDays(k, dd));
  }
  if (item.overrides && Object.keys(item.overrides).length) {
    const ovs = {};
    for (const [k, ov] of Object.entries(item.overrides)) {
      const o = { ...ov };
      if (o.start) o.start = toLocalISO(addMinutes(parseLocal(o.start), deltaMin));
      ovs[dd ? keyAddDays(k, dd) : k] = o;
    }
    item.overrides = ovs;
  }
}

/** Corta la serie en `key`: devuelve un ítem nuevo con las repeticiones desde key */
export function splitSeries(item, key) {
  const r = item.recurrence;
  const st = store.get();
  if (r.count) {
    r.until = lastOccurrence(item.start.slice(0, 10), r);
    r.count = null;
  }
  const clone = structuredClone(item);
  clone.id = uid();
  clone.createdAt = Date.now();
  clone.start = key + item.start.slice(10);
  clone.overrides = {};
  clone.recurrence.exdates = (r.exdates ?? []).filter((k) => k >= key);
  if (clone.recurrence.dates) clone.recurrence.dates = r.dates.filter((k) => k > key);
  for (const [k, ov] of Object.entries(item.overrides ?? {})) {
    if (k >= key) {
      clone.overrides[k] = ov;
      delete item.overrides[k];
    }
  }
  r.until = keyAddDays(key, -1);
  r.exdates = (r.exdates ?? []).filter((k) => k < key);
  if (r.dates) r.dates = r.dates.filter((k) => k < key);
  st.items.push(clone);
  return clone;
}

function setOverride(item, key, patch) {
  item.overrides ??= {};
  item.overrides[key] = { ...(item.overrides[key] ?? {}), ...patch };
}

/**
 * Mueve / redimensiona una aparición.
 * scope: 'one' (solo esta) | 'following' (esta y siguientes) | 'all' (toda la serie)
 */
export function applyMove(inst, newStart, newDuration, scope = 'one') {
  const item = store.getItem(inst.item.id);
  if (!item) return null;
  if (inst.kind === 'step') {
    const step = item.steps.find((s) => s.id === inst.step.id);
    if (step) step.date = dateKey(newStart);
    return inst.id;
  }
  if (inst.kind === 'deadline') {
    item.deadline = dateKey(newStart);
    return inst.id;
  }
  const delta = Math.round((newStart - inst.start) / 60000);
  if (!item.recurrence) {
    item.start = toLocalISO(newStart);
    if (newDuration != null) item.duration = newDuration;
    return item.id;
  }
  if (scope === 'one') {
    const patch = { start: toLocalISO(newStart) };
    if (newDuration != null) patch.duration = newDuration;
    setOverride(item, inst.key, patch);
    return inst.id;
  }
  let target = item;
  if (scope === 'following' && inst.key !== item.start.slice(0, 10)) target = splitSeries(item, inst.key);
  // Si esta aparición ya estaba movida a mano, el desplazamiento de la serie es el
  // mismo delta aplicado a la hora base.
  const baseShift = diffDays(parseLocal(target.start), addMinutes(parseLocal(target.start), delta));
  shiftSeries(target, delta);
  if (newDuration != null) {
    target.duration = newDuration;
    for (const ov of Object.values(target.overrides ?? {})) delete ov.duration;
  }
  return `${target.id}|${keyAddDays(inst.key, baseShift)}`;
}

/** Desplaza también las apariciones posteriores del mismo día ("efecto dominó") */
export function rippleAfter(inst, deltaMin) {
  const dayStart = startOfDay(inst.start);
  const later = instancesInRange(dayStart, addDays(dayStart, 1)).filter(
    (o) => o.kind === 'item' && !o.allDay && o.id !== inst.id && o.start >= inst.start && o.inAgenda,
  );
  for (const o of later) applyMove(o, addMinutes(o.start, deltaMin), null, 'one');
}

export function applyDelete(inst, scope = 'one') {
  const st = store.get();
  const item = store.getItem(inst.item.id);
  if (!item) return;
  if (inst.kind === 'step') {
    item.steps = item.steps.filter((s) => s.id !== inst.step.id);
    return;
  }
  if (inst.kind === 'deadline') {
    item.deadline = null;
    return;
  }
  if (!item.recurrence || scope === 'all') {
    st.items = st.items.filter((i) => i.id !== item.id);
    return;
  }
  if (scope === 'one') {
    item.recurrence.exdates = [...new Set([...(item.recurrence.exdates ?? []), inst.key])];
    delete item.overrides?.[inst.key];
  } else {
    if (inst.key <= item.start.slice(0, 10)) st.items = st.items.filter((i) => i.id !== item.id);
    else {
      item.recurrence.until = keyAddDays(inst.key, -1);
      item.recurrence.count = null;
    }
  }
}

export function applyDone(inst, done) {
  const item = store.getItem(inst.item.id);
  if (!item) return;
  if (inst.kind === 'step') {
    const s = item.steps.find((x) => x.id === inst.step.id);
    if (s) {
      s.done = done;
      s.doneAt = done ? Date.now() : null;
    }
  } else if (item.recurrence) setOverride(item, inst.key, { done });
  else item.done = done;
}

/** Desplaza en bloque todos los ítems de unas categorías (p. ej. "las clases de X empiezan 30 min más tarde") */
export function shiftCategory(categoryIds, deltaMin, fromKey = null) {
  // Copia de la lista: splitSeries añade ítems nuevos que no deben volver a desplazarse
  for (const item of [...store.get().items]) {
    if (!categoryIds.includes(item.categoryId) || !item.start) continue;
    if (fromKey && item.recurrence && item.start.slice(0, 10) < fromKey) {
      const first = occurrenceKeys(item.start.slice(0, 10), { ...item.recurrence, exdates: [], skipRanges: [] }, fromKey, keyAddDays(fromKey, 800))[0];
      if (!first) continue;
      const target = splitSeries(item, first);
      shiftSeries(target, deltaMin);
    } else if (!fromKey || item.start.slice(0, 10) >= fromKey) shiftSeries(item, deltaMin);
  }
}

/** Días que un planning terminado sigue en la pestaña Planning */
export const PLAN_KEEP_DAYS = 3;

/**
 * Cuándo acaba un planning (null = no tiene final y se queda siempre en Planning):
 *  · si todos sus pasos están hechos, cuando se completó el último;
 *  · si no, lo último de: fecha objetivo, última sesión y último paso con fecha.
 */
export function planEnd(item) {
  const steps = item.steps ?? [];
  if (steps.length && steps.every((s) => s.done)) {
    const last = Math.max(...steps.map((s) => s.doneAt ?? 0));
    if (last) return new Date(last);
  }
  let end = null;
  const later = (d) => {
    if (d && (!end || d > end)) end = d;
  };
  if (item.deadline) later(addDays(parseLocal(item.deadline), 1));
  for (const s of steps) if (s.date) later(addDays(parseLocal(s.date), 1));
  if (item.start) {
    if (!item.recurrence) later(buildInstance(item, null).end);
    else {
      const lastKey = lastOccurrence(item.start.slice(0, 10), item.recurrence);
      if (!lastKey) return null; // se repite sin fin
      later(buildInstance(item, lastKey).end);
    }
  }
  return end;
}

/** ¿Terminó hace más de PLAN_KEEP_DAYS días? (sale de la pestaña Planning, no del calendario) */
export function isPlanArchived(item, now = new Date()) {
  const end = planEnd(item);
  return !!end && now - end > PLAN_KEEP_DAYS * 86400e3;
}

/** Progreso de un planning (pasos completados) */
export function planProgress(item) {
  const steps = item.steps ?? [];
  if (!steps.length) return null;
  return steps.filter((s) => s.done).length / steps.length;
}
