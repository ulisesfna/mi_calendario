// Reglas de repetición.
//
// rule = {
//   freq: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'dates',
//   interval: 1,                 // cada N días/semanas/meses/años
//   byDay: [1, 3],               // semanal: días (0 = domingo)
//   monthMode: 'day' | 'nth',    // mensual: mismo día del mes, o "2º martes"
//   nth: 2 | -1,                 // mensual nth: 1..5 o -1 (último)
//   until: 'YYYY-MM-DD' | null,
//   count: N | null,
//   exdates: ['YYYY-MM-DD'],     // fechas excluidas
//   skipRanges: [{from, to}],    // periodos excluidos (vacaciones...)
//   dates: ['YYYY-MM-DD'],       // freq 'dates': lista de fechas extra
// }
import { addDays, dateKey, parseLocal, startOfWeek, DAY_SHORT, MONTHS, MONTHS_SHORT } from './util.js';

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export function nthWeekday(y, m, weekday, nth) {
  if (nth === -1) {
    const last = new Date(y, m + 1, 0);
    return addDays(last, -((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(y, m, 1);
  const d = addDays(first, (weekday - first.getDay() + 7) % 7 + (nth - 1) * 7);
  return d.getMonth() === ((m % 12) + 12) % 12 ? d : null;
}

export const nthOf = (d) => Math.ceil(d.getDate() / 7);
export const isLastWeekdayOfMonth = (d) => d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth());

/** Genera (sin fin) las fechas candidatas de la regla a partir de startKey */
function* candidates(rule, startKey) {
  const s = parseLocal(startKey);
  const iv = Math.max(1, rule.interval | 0 || 1);
  let guard = 0;
  switch (rule.freq) {
    case 'daily':
      for (let i = 0; guard++ < 40000; i += iv) yield dateKey(addDays(s, i));
      return;
    case 'weekly': {
      const days = (rule.byDay?.length ? [...rule.byDay] : [s.getDay()]).map((d) => (d + 6) % 7).sort((a, b) => a - b);
      const ws = startOfWeek(s, 1);
      for (let w = 0; guard++ < 10000; w += iv) {
        for (const off of days) {
          const d = addDays(ws, w * 7 + off);
          if (d >= s) yield dateKey(d);
        }
      }
      return;
    }
    case 'monthly':
      for (let m = 0; guard++ < 3000; m += iv) {
        const y = s.getFullYear(), mo = s.getMonth() + m;
        let d;
        if (rule.monthMode === 'nth') d = nthWeekday(y, mo, s.getDay(), rule.nth ?? nthOf(s));
        else {
          d = new Date(y, mo, s.getDate());
          if (d.getDate() !== s.getDate()) d = null; // p. ej. día 31 en un mes de 30
        }
        if (d && d >= s) yield dateKey(d);
      }
      return;
    case 'yearly':
      for (let k = 0; guard++ < 300; k += iv) {
        const d = new Date(s.getFullYear() + k, s.getMonth(), s.getDate());
        if (d.getMonth() === s.getMonth()) yield dateKey(d);
      }
      return;
    case 'dates': {
      const all = [...new Set([startKey, ...(rule.dates ?? [])])].sort();
      yield* all;
      return;
    }
    default:
      yield startKey;
  }
}

/**
 * Fechas (clave original de cada repetición) comprendidas entre fromKey y toKey.
 * @param {(key:string)=>boolean} [skip]  filtro adicional (festivos)
 */
export function occurrenceKeys(startKey, rule, fromKey, toKey, skip) {
  if (!rule) return startKey >= fromKey && startKey <= toKey && !skip?.(startKey) ? [startKey] : [];
  const out = [];
  const ex = new Set(rule.exdates ?? []);
  let count = 0;
  for (const k of candidates(rule, startKey)) {
    if (rule.until && k > rule.until) break;
    if (k > toKey) break;
    count++;
    if (rule.count && count > rule.count) break;
    if (k < fromKey) continue;
    if (ex.has(k)) continue;
    if (rule.skipRanges?.some((r) => k >= r.from && k <= r.to)) continue;
    if (skip?.(k)) continue;
    out.push(k);
  }
  return out;
}

/** Última fecha de una serie (null si es infinita) */
export function lastOccurrence(startKey, rule) {
  if (!rule) return startKey;
  if (!rule.until && !rule.count && rule.freq !== 'dates') return null;
  const keys = occurrenceKeys(startKey, { ...rule, exdates: [], skipRanges: [] }, '0000-01-01', rule.until ?? '9999-12-31');
  return keys.at(-1) ?? startKey;
}

const ORD = { 1: 'primer', 2: 'segundo', 3: 'tercer', 4: 'cuarto', 5: 'quinto', '-1': 'último' };

export function describeRule(rule, startStr) {
  if (!rule) return 'No se repite';
  const s = parseLocal(startStr);
  const iv = rule.interval > 1 ? rule.interval : 1;
  let t = '';
  switch (rule.freq) {
    case 'daily':
      t = iv === 1 ? 'Cada día' : `Cada ${iv} días`;
      break;
    case 'weekly': {
      const days = (rule.byDay?.length ? rule.byDay : [s.getDay()]).slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      t = (iv === 1 ? 'Cada semana' : `Cada ${iv} semanas`) + ' el ' + days.map((d) => DAY_SHORT[d]).join(', ');
      if (days.length === 5 && days.every((d) => d >= 1 && d <= 5)) t = (iv === 1 ? 'Cada día laborable' : `Laborables, cada ${iv} semanas`);
      break;
    }
    case 'monthly':
      t = iv === 1 ? 'Cada mes' : `Cada ${iv} meses`;
      if (rule.monthMode === 'nth') {
        const n = rule.nth ?? nthOf(s);
        t += ` el ${ORD[n]} ${DAY_SHORT[s.getDay()]}`;
      } else t += ` el día ${s.getDate()}`;
      break;
    case 'yearly':
      t = (iv === 1 ? 'Cada año' : `Cada ${iv} años`) + ` el ${s.getDate()} de ${MONTHS[s.getMonth()]}`;
      break;
    case 'dates':
      t = `En ${1 + (rule.dates?.length ?? 0)} fechas concretas`;
      break;
  }
  if (rule.until) {
    const u = parseLocal(rule.until);
    t += `, hasta el ${u.getDate()} ${MONTHS_SHORT[u.getMonth()]} ${u.getFullYear()}`;
  } else if (rule.count) t += `, ${rule.count} veces`;
  const ex = (rule.exdates?.length ?? 0) + (rule.skipRanges?.length ?? 0);
  if (ex) t += ` (con ${ex} excepción${ex > 1 ? 'es' : ''})`;
  return t;
}

export function defaultRule(freq, startStr) {
  const s = parseLocal(startStr);
  return {
    freq, interval: 1, byDay: freq === 'weekly' ? [s.getDay()] : [], monthMode: 'day', nth: nthOf(s),
    until: null, count: null, exdates: [], skipRanges: [], dates: [],
  };
}
