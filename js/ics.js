// Lectura y escritura de iCalendar (.ics) + utilidades para importar horarios.
import { addDays, dateKey, diffDays, keyAddDays, minutesOfDay, norm, pad, parseLocal, startOfWeek, toLocalISO } from './util.js';
import * as store from './store.js';
import { describeRule } from './recurrence.js';

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WD_REV = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function unescapeText(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** Interpreta un valor de fecha ICS. Las horas con TZID se toman como hora local. */
function parseIcsDate(value, params) {
  const v = value.trim();
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', z] = m;
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)) : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return { date, allDay: false };
}

export function parseICS(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  let inAlarm = false;
  for (const line of lines) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      cur = { exdates: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur?.start) events.push(cur);
      cur = null;
      continue;
    }
    if (line === 'BEGIN:VALARM') inAlarm = true;
    if (line === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (!cur || inAlarm) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const left = line.slice(0, idx), value = line.slice(idx + 1);
    const [name, ...ps] = left.split(';');
    const params = Object.fromEntries(ps.map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), (v ?? '').replace(/"/g, '')]));
    switch (name.toUpperCase()) {
      case 'SUMMARY': cur.summary = unescapeText(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescapeText(value).trim(); break;
      case 'LOCATION': cur.location = unescapeText(value).trim(); break;
      case 'UID': cur.uid = value.trim(); break;
      case 'DTSTART': {
        const r = parseIcsDate(value, params);
        if (r) { cur.start = r.date; cur.allDay = r.allDay; }
        break;
      }
      case 'DTEND': {
        const r = parseIcsDate(value, params);
        if (r) cur.end = r.date;
        break;
      }
      case 'DURATION': {
        const m = value.match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
        if (m) cur.durationMin = (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0);
        break;
      }
      case 'RRULE': cur.rrule = Object.fromEntries(value.split(';').map((p) => p.split('='))); break;
      case 'EXDATE':
        value.split(',').forEach((v) => {
          const r = parseIcsDate(v, params);
          if (r) cur.exdates.push(dateKey(r.date));
        });
        break;
      case 'RECURRENCE-ID': {
        const r = parseIcsDate(value, params);
        if (r) cur.recurrenceId = dateKey(r.date);
        break;
      }
      case 'STATUS': cur.status = value.trim(); break;
      case 'CATEGORIES': cur.categories = unescapeText(value).split(',').map((s) => s.trim()); break;
    }
  }
  for (const e of events) {
    let dur = e.durationMin;
    if (dur == null && e.end) dur = Math.round((e.end - e.start) / 60000);
    e.duration = dur ?? (e.allDay ? 1440 : 60);
  }
  return events.filter((e) => e.status !== 'CANCELLED');
}

/** Convierte un RRULE de ICS a nuestra regla */
export function rruleToRule(rr, startDate, exdates = []) {
  const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[rr.FREQ];
  if (!freq) return null;
  const rule = {
    freq, interval: +rr.INTERVAL || 1, byDay: [], monthMode: 'day', nth: 1,
    until: null, count: +rr.COUNT || null, exdates: [...exdates], skipRanges: [], dates: [],
  };
  if (rr.UNTIL) {
    const r = parseIcsDate(rr.UNTIL, {});
    if (r) rule.until = dateKey(r.date);
  }
  if (rr.BYDAY) {
    const parts = rr.BYDAY.split(',');
    if (freq === 'weekly') rule.byDay = parts.map((p) => WD[p.slice(-2)]).filter((d) => d != null);
    else if (freq === 'monthly') {
      const m = parts[0].match(/^(-?\d)?([A-Z]{2})$/);
      if (m?.[1]) {
        rule.monthMode = 'nth';
        rule.nth = +m[1];
      }
    }
  }
  if (freq === 'weekly' && !rule.byDay.length) rule.byDay = [startDate.getDay()];
  return rule;
}

// ---------------- Agrupar por asignatura ----------------

// Códigos de tipo de actividad que usa Chronos (y variantes en catalán/castellano)
const ACTIVITIES = [
  [['teopr', 'teoprob', 'tp'], 'Teoría y problemas'],
  [['teoria', 'teo', 'teor'], 'Teoría'],
  [['prob', 'problemes', 'problemas', 'pro'], 'Problemas'],
  [['prac', 'pract', 'practiques', 'practicas', 'pra'], 'Prácticas'],
  [['lab', 'labo', 'laboratori', 'laboratorio'], 'Laboratorio'],
  [['sem', 'semi', 'seminari', 'seminario'], 'Seminario'],
  [['tut', 'tutoria'], 'Tutoría'],
  [['exam', 'examen', 'aval', 'ava', 'avaluacio', 'evaluacion'], 'Examen'],
];
const ACT_MAP = new Map(ACTIVITIES.flatMap(([codes, label]) => codes.map((c) => [c, label])));
const activityOf = (w) => ACT_MAP.get(norm(w).replace(/[^a-z]/g, ''));
const isGroupCode = (w) => /^[a-z]{1,3}\d{1,3}[a-z]?$/i.test(w); // M1, M2, T1, Z1, PA2…
const isStrictCode = (w) => isGroupCode(w) || /^\d{3,}$/.test(w) || /^(grup|grupo|group|gr)$/i.test(norm(w));
const isCodeWord = (w) => !!activityOf(w) || isStrictCode(w);
/** Palabra o compuesto tipo «TEOPR-M1» formado solo por códigos */
const allCodes = (w, test) => {
  const sub = w.split(/[-–_.]/).filter(Boolean);
  return sub.length > 0 && sub.every(test);
};

/**
 * Quita de un fragmento las palabras que son códigos (TEORIA, PROB, M1, 364100, «TEOPR-M1»…)
 * sin estropear nombres como «Teoria de Grups»: en medio del nombre solo se quitan los
 * códigos de grupo y los de actividad escritos en MAYÚSCULAS.
 */
function stripCodes(part) {
  let words = part.split(/\s+/).filter(Boolean);
  if (words.every((w) => allCodes(w, isCodeWord))) return '';
  const upperPart = part === part.toUpperCase();
  // Formato de Chronos: «Asignatura CÓDIGO GRUPO» (TEORIA M1, PROB M1A, PROB ZU, EXAM EX-G…):
  // todo lo que sigue al código de actividad en MAYÚSCULAS es el grupo
  if (!upperPart) {
    const i = words.findIndex((w, k) => k > 0 && w.length > 1 && w === w.toUpperCase() && activityOf(w));
    if (i > 0) words = words.slice(0, i);
  }
  // Un código de actividad al principio solo se quita si va en MAYÚSCULAS («TEORIA Física»),
  // para no romper nombres como «Teoria de Grups»
  const leadingCode = (w) => allCodes(w, isStrictCode) || (!upperPart && w === w.toUpperCase() && allCodes(w, isCodeWord));
  while (words.length && allCodes(words.at(-1), isCodeWord)) words.pop();
  while (words.length && leadingCode(words[0])) words.shift();
  words = words.filter((w) => {
    if (allCodes(w, isStrictCode)) return false;
    if (!upperPart && w.length > 1 && w === w.toUpperCase() && allCodes(w, isCodeWord)) return false;
    return true;
  });
  return words.join(' ').replace(/^[-–·:,\s]+|[-–·:,\s]+$/g, '');
}

/**
 * Nombre "limpio" de asignatura a partir del título del evento:
 * «364100 - Física Quàntica I - TEOPR - M1» → «Física Quàntica I».
 * Así teoría, problemas y todos los grupos cuentan como la misma asignatura.
 */
export function guessSubject(summary) {
  const s = (summary ?? '').trim();
  const parts = s
    .split(/\s+[-–|·:]\s+|\s*[()[\]{}]\s*|\s*[,;/]\s*/)
    .map((p) => stripCodes(p.trim()))
    .filter(Boolean);
  if (!parts.length) return s || 'Sin título';
  return parts.sort((a, b) => b.length - a.length)[0];
}

/** Tipo de actividad (Teoría, Problemas, Teoría y problemas…) o '' si no se reconoce */
export function guessActivity(summary) {
  const split = (s) => String(s ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Las palabras que forman parte del nombre de la asignatura («Teoria de Grups») no cuentan
  const inName = new Map();
  split(guessSubject(summary)).forEach((w) => inName.set(w, (inName.get(w) ?? 0) + 1));
  const words = split(summary).filter((w) => {
    if (inName.get(w) > 0) {
      inName.set(w, inName.get(w) - 1);
      return false;
    }
    return !!activityOf(w);
  });
  if (!words.length) return '';
  // Preferir el código en MAYÚSCULAS (TEORIA, PROB…) y, si no, el último (el primero suele ser parte del nombre)
  const code = words.find((w) => w.length > 1 && w === w.toUpperCase()) ?? words.at(-1);
  return activityOf(code);
}

/** Tono por defecto de cada tipo: 0 = color de la asignatura, >0 más claro, <0 más oscuro */
export const DEFAULT_ACTIVITY_SHADE = {
  'Teoría': 0, 'Teoría y problemas': 0.3, 'Problemas': 0.3, 'Prácticas': -0.3, 'Laboratorio': -0.3,
  'Seminario': 0.3, 'Tutoría': 0.5, 'Examen': -0.5, '': 0,
};

/**
 * Une eventos sueltos que se repiten cada semana (mismo título, día y hora)
 * en un único evento recurrente con excepciones. Así luego se pueden mover en bloque.
 */
export function buildItemsFromEvents(events, { merge = true } = {}) {
  const items = [];
  const singles = [];
  const overridesByUid = {};
  for (const e of events) {
    if (e.recurrenceId) (overridesByUid[e.uid] ??= []).push(e);
  }
  for (const e of events) {
    if (e.recurrenceId) continue;
    if (e.rrule) {
      const rule = rruleToRule(e.rrule, e.start, e.exdates);
      const it = { ev: e, start: toLocalISO(e.start), duration: e.duration, allDay: e.allDay, recurrence: rule, overrides: {} };
      for (const o of overridesByUid[e.uid] ?? []) {
        it.overrides[o.recurrenceId] = { start: toLocalISO(o.start), duration: o.duration };
      }
      items.push(it);
    } else singles.push(e);
  }
  if (!merge) {
    singles.forEach((e) => items.push({ ev: e, start: toLocalISO(e.start), duration: e.duration, allDay: e.allDay, recurrence: null, overrides: {} }));
    return items;
  }
  const groups = new Map();
  for (const e of singles) {
    const k = [e.summary, e.allDay, e.start.getDay(), minutesOfDay(e.start), e.duration].join('§');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.start - b.start);
    if (list.length < 2) {
      const e = list[0];
      items.push({ ev: e, start: toLocalISO(e.start), duration: e.duration, allDay: e.allDay, recurrence: null, overrides: {} });
      continue;
    }
    // Detectar intervalo semanal (1 o 2 semanas, p. ej. prácticas en semanas alternas)
    const weeks = list.map((e) => Math.round(diffDays(startOfWeek(list[0].start), startOfWeek(e.start)) / 7));
    const gaps = weeks.slice(1).map((w, i) => w - weeks[i]).filter((g) => g > 0);
    const allEven = gaps.length && gaps.every((g) => g % 2 === 0);
    const interval = allEven ? 2 : 1;
    const first = list[0], last = list.at(-1);
    const present = new Set(list.map((e) => dateKey(e.start)));
    const exdates = [];
    for (let k = dateKey(first.start); k <= dateKey(last.start); k = keyAddDays(k, 7 * interval)) {
      if (!present.has(k)) exdates.push(k);
    }
    // Si hay demasiados huecos no merece la pena una serie: usar fechas concretas
    const useDates = exdates.length > list.length;
    const loc = mostCommon(list.map((e) => e.location).filter(Boolean));
    const rule = useDates
      ? { freq: 'dates', interval: 1, byDay: [], monthMode: 'day', nth: 1, until: null, count: null, exdates: [], skipRanges: [], dates: list.slice(1).map((e) => dateKey(e.start)) }
      : { freq: 'weekly', interval, byDay: [first.start.getDay()], monthMode: 'day', nth: 1, until: dateKey(last.start), count: null, exdates, skipRanges: [], dates: [] };
    items.push({ ev: { ...first, location: loc ?? first.location }, start: toLocalISO(first.start), duration: first.duration, allDay: first.allDay, recurrence: rule, overrides: {}, mergedCount: list.length });
  }
  return items;
}

function mostCommon(arr) {
  const m = new Map();
  arr.forEach((v) => m.set(v, (m.get(v) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export const ruleText = (it) => describeRule(it.recurrence, it.start);

// ---------------- Exportar ----------------

const icsEsc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function fold(line) {
  const out = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = ' ' + line.slice(74);
  }
  out.push(line);
  return out.join('\r\n');
}

export function exportICS(items) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calendario de tareas//ES', 'CALSCALE:GREGORIAN'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  for (const it of items) {
    if (!it.start) continue;
    const s = parseLocal(it.start);
    const cat = store.getCategory(it.categoryId);
    L.push(it.type === 'task' ? 'BEGIN:VEVENT' : 'BEGIN:VEVENT');
    L.push(`UID:${it.id}@calendario-tareas`, `DTSTAMP:${stamp}`);
    if (it.allDay) {
      L.push(`DTSTART;VALUE=DATE:${icsDate(s)}`, `DTEND;VALUE=DATE:${icsDate(addDays(s, Math.max(1, Math.round(it.duration / 1440))))}`);
    } else {
      L.push(`DTSTART:${icsLocal(s)}`, `DTEND:${icsLocal(new Date(s.getTime() + it.duration * 60000))}`);
    }
    L.push(`SUMMARY:${icsEsc(it.title)}`);
    if (it.notes) L.push(`DESCRIPTION:${icsEsc(it.notes)}`);
    if (it.location) L.push(`LOCATION:${icsEsc(it.location)}`);
    if (cat) L.push(`CATEGORIES:${icsEsc(cat.name)}`);
    const r = it.recurrence;
    if (r && r.freq !== 'dates') {
      const parts = [`FREQ=${r.freq.toUpperCase()}`];
      if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
      if (r.freq === 'weekly' && r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => WD_REV[d]).join(',')}`);
      if (r.freq === 'monthly' && r.monthMode === 'nth') parts.push(`BYDAY=${r.nth}${WD_REV[s.getDay()]}`);
      if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, '')}T235959`);
      else if (r.count) parts.push(`COUNT=${r.count}`);
      L.push(`RRULE:${parts.join(';')}`);
      if (r.exdates?.length) L.push(`EXDATE:${r.exdates.map((k) => icsLocal(new Date(parseLocal(k).setHours(s.getHours(), s.getMinutes())))).join(',')}`);
    } else if (r?.freq === 'dates' && r.dates?.length) {
      L.push(`RDATE:${r.dates.map((k) => icsLocal(new Date(parseLocal(k).setHours(s.getHours(), s.getMinutes())))).join(',')}`);
    }
    for (const rem of store.effectiveReminders(it)) {
      if (rem.unit === 'abs') continue;
      const min = (rem.value | 0) * ({ min: 1, h: 60, d: 1440, w: 10080, endmin: 1 }[rem.unit] ?? 1);
      // Los avisos «antes de acabar» se miden respecto al final del evento
      const trigger = rem.unit === 'endmin' ? `TRIGGER;RELATED=END:-PT${min}M` : `TRIGGER:-PT${min}M`;
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(it.title)}`, trigger, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n');
}
