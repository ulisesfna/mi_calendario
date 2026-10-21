// Estado de la app, persistencia en localStorage y deshacer/rehacer.
import { shade, uid } from './util.js';

const KEY = 'calendario-tareas.v1';

export const DEFAULT_SETTINGS = {
  theme: 'auto', // auto | light | dark
  weekStart: 1, // 1 = lunes
  dayStart: 0,
  dayEnd: 24,
  scrollTo: 7,
  hourHeight: 52,
  defaultView: 'week',
  eventStyle: 'solid', // solid | soft
  showOutOfAgenda: true, // lo que está fuera de la agenda se sigue viendo (atenuado) en el calendario
  showDone: true,
  showTypes: { event: true, task: true, plan: true },
  monthText: 'full', // full | short | color — texto de los bloques en la vista mensual
  defaultDuration: 60,
  defaultReminders: [{ id: 'd1', value: 10, unit: 'min', level: 'vibrate' }],
  // Avisos de las tareas: por defecto, a la hora en que empiezan
  taskReminders: [{ id: 't1', value: 0, unit: 'min', level: 'sound' }],
  // Avisos de los plannings: por defecto, al acabar cada sesión
  planReminders: [{ id: 'p1', value: 0, unit: 'endmin', level: 'sound' }],
  // Las tareas sin completar de días anteriores se muestran también hoy
  rollOver: true,
  // Avisos automáticos de los exámenes (elementos marcados como examen)
  examReminders: [
    { id: 'e1', value: 2, unit: 'w', level: 'sound' },
    { id: 'e2', value: 1, unit: 'w', level: 'sound' },
    { id: 'e3', value: 90, unit: 'min', level: 'alarm' },
  ],
  persistentRepeatMin: 2,
  alarmVolume: 0.8,
  alarmSound: 'clasica', // clasica | suave | digital | campana
  vibration: {
    vibrate: [200, 100, 200],
    sound: [300, 120, 300],
    alarm: [800, 300, 800, 300, 800],
    persistent: [1000, 300, 1000, 300, 1000],
  },
  holidays: [], // [{id, from, to, label}]
};

function defaultState() {
  const c = (name, color, icon, extra = {}) => ({
    id: uid(), name, color, icon, parentId: null, visible: true, inAgenda: true,
    reminders: null, defaultType: 'event', defaultDuration: 60, skipHolidays: false, ...extra,
  });
  return {
    version: 1,
    categories: [
      c('Personal', '#039be5', '🏠'),
      c('Estudios', '#8e24aa', '📚', { skipHolidays: true }),
      c('Salud', '#33b679', '🩺'),
      c('Ocio', '#f4511e', '🎉'),
    ],
    items: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    notif: { lastCheck: Date.now(), fired: {}, snoozes: [], active: [], missed: [] },
    ui: { view: null, expanded: {} },
  };
}

const SETTINGS_VERSION = 2;

let state = null;
let undoStack = [];
let redoStack = [];
const listeners = new Set();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? JSON.parse(raw) : defaultState();
  } catch {
    state = defaultState();
  }
  // Rellenar campos nuevos en datos antiguos
  state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...state.settings };
  state.settings.vibration = { ...DEFAULT_SETTINGS.vibration, ...state.settings.vibration };
  state.settings.showTypes = { ...DEFAULT_SETTINGS.showTypes, ...state.settings.showTypes };
  state.notif = { lastCheck: Date.now(), fired: {}, snoozes: [], active: [], missed: [], ...state.notif };
  state.ui = { view: null, expanded: {}, ...state.ui };
  // Migraciones
  if ((state.settingsVersion ?? 1) < 2) {
    state.settings.showOutOfAgenda = true; // ahora por defecto: fuera de agenda pero visible
    state.settingsVersion = 2;
  }
  state.settingsVersion = SETTINGS_VERSION;
  state.deleted ??= {};
  indexEntities();
  return state;
}

export const get = () => state;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('No se pudo guardar', e);
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (info) => listeners.forEach((fn) => fn(info));

const snapshot = () => JSON.stringify({ categories: state.categories, items: state.items });

/**
 * Aplica un cambio. Si es "deshacible" guarda una copia previa de categorías e ítems.
 * @param {string} label  texto para el aviso "Deshacer"
 */
export function mutate(label, fn, { undoable = true, silent = false } = {}) {
  if (undoable) {
    undoStack.push({ label, snap: snapshot() });
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
  }
  fn(state);
  const changed = stampChanges();
  save();
  if (!silent) emit({ label, undoable });
  if (changed) dataListeners.forEach((f) => f());
}

// ---------- Marcas de tiempo para sincronizar ----------
// Cada categoría/ítem lleva `updatedAt` (último cambio) y los borrados quedan en
// `state.deleted[id] = fecha`, así dos dispositivos pueden fusionar sus cambios.

let lastJson = null; // id → JSON sin updatedAt (como estaba tras el último cambio)
let lastSettingsJson = null;
const dataListeners = new Set();
/** Avisa cuando cambian datos que hay que sincronizar */
export const onDataChange = (fn) => dataListeners.add(fn);

const entityJson = (e) => {
  const { updatedAt, ...rest } = e;
  return JSON.stringify(rest);
};
function indexEntities() {
  lastJson = new Map();
  for (const e of [...state.categories, ...state.items]) lastJson.set(e.id, entityJson(e));
  lastSettingsJson = JSON.stringify(state.settings);
}

/** Pone fecha a lo que ha cambiado desde la última vez. Devuelve true si algo cambió. */
function stampChanges() {
  if (!lastJson) indexEntities();
  const now = Date.now();
  let changed = false;
  const seen = new Set();
  for (const e of [...state.categories, ...state.items]) {
    seen.add(e.id);
    const j = entityJson(e);
    if (lastJson.get(e.id) !== j) {
      e.updatedAt = now;
      lastJson.set(e.id, j);
      if (state.deleted?.[e.id]) delete state.deleted[e.id];
      changed = true;
    }
  }
  for (const id of [...lastJson.keys()]) {
    if (!seen.has(id)) {
      state.deleted ??= {};
      state.deleted[id] = now;
      lastJson.delete(id);
      changed = true;
    }
  }
  const sj = JSON.stringify(state.settings);
  if (sj !== lastSettingsJson) {
    state.settingsUpdatedAt = now;
    lastSettingsJson = sj;
    changed = true;
  }
  return changed;
}

/** Sustituye los datos por los ya fusionados con la nube (sin volver a fecharlos) */
export function applyRemote({ categories, items, deleted, settings, settingsUpdatedAt }) {
  state.categories = categories;
  state.items = items;
  state.deleted = deleted;
  if (settings) {
    state.settings = { ...structuredClone(DEFAULT_SETTINGS), ...settings };
    state.settingsUpdatedAt = settingsUpdatedAt;
  }
  indexEntities();
  save();
  emit({ label: 'sync' });
}

/** Cambios que no deben entrar en el historial (ajustes, estado de avisos...) */
export const quiet = (fn, emitChange = false) => mutate('', fn, { undoable: false, silent: !emitChange });

export function undo() {
  const last = undoStack.pop();
  if (!last) return null;
  redoStack.push({ label: last.label, snap: snapshot() });
  Object.assign(state, JSON.parse(last.snap));
  const changed = stampChanges();
  save();
  emit({ label: 'undo' });
  if (changed) dataListeners.forEach((f) => f());
  return last.label;
}
export function redo() {
  const next = redoStack.pop();
  if (!next) return null;
  undoStack.push({ label: next.label, snap: snapshot() });
  Object.assign(state, JSON.parse(next.snap));
  const changed = stampChanges();
  save();
  emit({ label: 'redo' });
  if (changed) dataListeners.forEach((f) => f());
  return next.label;
}
export const canUndo = () => undoStack.length > 0;

export function replaceAll(data) {
  mutate('Restaurar copia', (s) => {
    s.categories = data.categories ?? [];
    s.items = data.items ?? [];
    if (data.settings) s.settings = { ...structuredClone(DEFAULT_SETTINGS), ...data.settings };
  });
}

// ---------- Categorías ----------

export const getCategory = (id) => state.categories.find((c) => c.id === id) ?? null;
export const childrenOf = (id) => state.categories.filter((c) => c.parentId === id);

/** Lista de la categoría y sus ancestros (de la más cercana a la raíz) */
export function categoryChain(id) {
  const out = [];
  let c = getCategory(id);
  let guard = 0;
  while (c && guard++ < 20) {
    out.push(c);
    c = c.parentId ? getCategory(c.parentId) : null;
  }
  return out;
}

/** IDs de una categoría y todas sus descendientes */
export function categoryWithDescendants(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) childrenOf(out[i]).forEach((c) => out.push(c.id));
  return out;
}

export const isCategoryVisible = (id) => (id ? categoryChain(id).every((c) => c.visible !== false) : state.ui.showUncategorized !== false);

export function itemColor(item) {
  if (item.color) return item.color;
  // El tono (más claro / más oscuro) sigue al color de la categoría si este cambia
  return shade(getCategory(item.categoryId)?.color ?? '#6b7280', item.shade ?? 0);
}

/** Texto de los bloques en la vista mensual: 'full' | 'short' | 'color' */
export function monthTextMode(item) {
  for (const c of categoryChain(item.categoryId)) {
    if (c.monthText && c.monthText !== 'auto') return c.monthText;
  }
  return state.settings.monthText ?? 'full';
}

export function itemIcon(item) {
  if (item.icon) return item.icon;
  return getCategory(item.categoryId)?.icon ?? '';
}

/** ¿Entra en la agenda? El ítem manda; si no lo indica hereda de su categoría */
export function inAgenda(item) {
  if (item.inAgenda === true || item.inAgenda === false) return item.inAgenda;
  for (const c of categoryChain(item.categoryId)) {
    if (c.inAgenda === false) return false;
  }
  return true;
}

export function effectiveReminders(item) {
  if (Array.isArray(item.reminders)) return item.reminders;
  if (item.exam) return state.settings.examReminders ?? [];
  if (item.type === 'task') return state.settings.taskReminders ?? [];
  if (item.type === 'plan') return state.settings.planReminders ?? [];
  for (const c of categoryChain(item.categoryId)) {
    if (Array.isArray(c.reminders)) return c.reminders;
  }
  return state.settings.defaultReminders ?? [];
}

export function skipsHolidays(item) {
  return categoryChain(item.categoryId).some((c) => c.skipHolidays);
}

export function newCategory(data = {}) {
  return {
    id: uid(), name: 'Nueva categoría', color: '#039be5', icon: '', parentId: null, visible: true,
    inAgenda: true, reminders: null, defaultType: 'event', defaultDuration: 60, skipHolidays: false, ...data,
  };
}

// ---------- Ítems ----------

export const getItem = (id) => state.items.find((i) => i.id === id) ?? null;

export function newItem(data = {}) {
  return {
    id: uid(), type: 'event', title: '', notes: '', location: '', categoryId: null, color: null, icon: null,
    start: null, duration: state.settings.defaultDuration ?? 60, allDay: false,
    recurrence: null, overrides: {}, reminders: null, inAgenda: null,
    done: false, priority: 0, checklist: [], deadline: null, steps: [], source: null,
    createdAt: Date.now(), ...data,
  };
}
