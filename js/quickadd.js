// "Añadir rápido" en lenguaje natural:
//   "Estudiar física mañana 18:00 2h #Física !alarma-15m"
//   "tarea: entregar práctica viernes #Programación"
//   "Gimnasio cada lunes y miércoles 19-20:30 #Salud !vibra"
import { addDays, dateKey, norm, pad, startOfDay, toLocalISO } from './util.js';
import { defaultRule } from './recurrence.js';

const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LEVEL_WORDS = {
  silencio: 'visual', visual: 'visual', vibra: 'vibrate', vibracion: 'vibrate', vibrar: 'vibrate',
  sonido: 'sound', suena: 'sound', alarma: 'alarm', persistente: 'persistent', insistente: 'persistent',
};

export function parseQuick(input, now = new Date()) {
  let s = ' ' + input.trim() + ' ';
  const res = { type: 'event', title: '', categoryName: null, date: null, time: null, endTime: null, duration: null, recurrence: null, reminder: null, inAgenda: null };
  const take = (re, fn) => {
    s = s.replace(re, (...m) => {
      fn(...m);
      return ' ';
    });
  };

  take(/^\s*(tarea|task|t)\s*:\s*/i, () => (res.type = 'task'));
  take(/^\s*(planning|plan|p)\s*:\s*/i, () => (res.type = 'plan'));
  take(/^\s*(evento|e)\s*:\s*/i, () => (res.type = 'event'));
  take(/\s#([^\s#!~]+)/, (_, c) => (res.categoryName = c.replace(/_/g, ' ')));
  take(/\s!([a-záéíóúñ]+)(?:-(\d+)\s*(m|min|h|d)?)?(?=\s)/i, (_, w, n, u) => {
    const level = LEVEL_WORDS[norm(w)] ?? 'sound';
    const unit = !u || u.startsWith('m') ? 'min' : u;
    // Sin antelación: las alarmas suenan a la hora y el resto avisa 10 min antes
    // (las tareas avisan siempre a la hora, salvo que se indique otra antelación)
    const def = level === 'alarm' || level === 'persistent' || res.type === 'task' ? 0 : 10;
    res.reminder = { value: n ? +n : def, unit, level };
  });
  take(/\s~(?=\s)/, () => (res.inAgenda = false));

  // Repetición
  take(/\s(?:todos los|todas las|cada)\s+((?:(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)(?:\s*(?:,|y)\s*)?)+)/i, (_, days) => {
    const list = norm(days).split(/\s*(?:,|\by\b)\s*|\s+/).map((d) => WEEKDAYS[d] ?? WEEKDAYS[d.replace(/s$/, '')]).filter((d) => d != null);
    if (list.length) res.recurrence = { freq: 'weekly', byDay: [...new Set(list)] };
  });
  take(/\s(?:cada|todos los)\s+(\d+\s+)?(d[ií]as?|semanas?|mes(?:es)?|a[ñn]os?)(?=\s)/i, (_, n, u) => {
    const freq = /^d/i.test(u) ? 'daily' : /^s/i.test(u) ? 'weekly' : /^m/i.test(u) ? 'monthly' : 'yearly';
    res.recurrence = { freq, interval: n ? +n : 1 };
  });
  take(/\s(?:entre semana|laborables|d[ií]as laborables)(?=\s)/i, () => (res.recurrence = { freq: 'weekly', byDay: [1, 2, 3, 4, 5] }));

  // Fecha
  take(/\s(hoy)(?=\s)/i, () => (res.date = startOfDay(now)));
  take(/\s(pasado mañana|pasado manana)(?=\s)/i, () => (res.date = addDays(startOfDay(now), 2)));
  take(/\s(mañana|manana)(?=\s)/i, () => (res.date = addDays(startOfDay(now), 1)));
  take(/\s(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?=\s)/, (_, d, m, y) => {
    let yy = y ? +y : now.getFullYear();
    if (yy < 100) yy += 2000;
    let dt = new Date(yy, +m - 1, +d);
    if (!y && dt < startOfDay(now)) dt = new Date(yy + 1, +m - 1, +d);
    res.date = dt;
  });
  take(/\s(?:el\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?(?=\s)/i, (m0, d, mon, y) => {
    const mi = MONTHS.indexOf(norm(mon));
    if (mi < 0) return;
    let dt = new Date(y ? +y : now.getFullYear(), mi, +d);
    if (!y && dt < startOfDay(now)) dt = new Date(now.getFullYear() + 1, mi, +d);
    res.date = dt;
  });
  if (!res.date) {
    take(/\s(?:el\s+|este\s+|pr[oó]ximo\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?=\s)/i, (_, w) => {
      const wd = WEEKDAYS[norm(w)];
      const diff = (wd - now.getDay() + 7) % 7;
      res.date = addDays(startOfDay(now), diff);
    });
  }

  // Duración explícita
  take(/\s(?:durante\s+)?(\d+)\s*h\s*(\d{1,2})\s*(?:m|min)?(?=\s)/i, (_, h, m) => (res.duration = +h * 60 + +m));
  take(/\s(?:durante\s+)?(\d+)\s*(?:min|minutos|m)(?=\s)/i, (_, m) => (res.duration = +m));
  take(/\sdurante\s+(\d+(?:[.,]\d)?)\s*(?:h|horas?)(?=\s)/i, (_, h) => (res.duration = Math.round(parseFloat(h.replace(',', '.')) * 60)));

  // Hora: rango "10-12", "10:30 a 12", hora suelta "a las 9", "18:00", "18h"
  const T = '(\\d{1,2})(?::(\\d{2}))?\\s*(?:h)?';
  take(new RegExp(`\\s(?:de\\s+)?${T}\\s*(?:-|–|a|hasta)\\s*${T}(?=\\s)`, 'i'), (_, h1, m1, h2, m2) => {
    if (+h1 > 23 || +h2 > 24) return;
    res.time = [+h1, +(m1 ?? 0)];
    res.endTime = [+h2, +(m2 ?? 0)];
  });
  take(/\s(?:a\s+las?\s+)(\d{1,2})(?::(\d{2}))?\s*(?:h)?(?=\s)/i, (_, h, m) => (res.time = [+h, +(m ?? 0)]));
  take(/\s(\d{1,2}):(\d{2})(?=\s)/, (_, h, m) => (res.time = [+h, +m]));
  take(/\s(\d{1,2})\s*(am|pm)(?=\s)/i, (_, h, ap) => (res.time = [(+h % 12) + (/pm/i.test(ap) ? 12 : 0), 0]));
  take(/\s(\d{1,2})\s*h(?:oras?)?(?=\s)/i, (_, h) => {
    if (!res.time && +h >= 6) res.time = [+h, 0];
    else if (!res.duration) res.duration = +h * 60;
  });

  res.title = s.replace(/\s+/g, ' ').trim();
  return res;
}

/** Convierte el resultado del análisis en campos de ítem */
export function quickToItem(p, { defaultDuration = 60 } = {}) {
  const hasWhen = p.date || p.time || p.recurrence;
  if (!hasWhen && p.type === 'plan') {
    // Planning sin fecha: una sesión desde la próxima media hora, para que esté en la agenda
    const d = new Date();
    d.setMinutes(Math.ceil((d.getMinutes() + 1) / 30) * 30, 0, 0);
    return { type: 'plan', title: p.title, start: toLocalISO(d), duration: p.duration ?? defaultDuration, allDay: false, inAgenda: p.inAgenda ?? true };
  }
  if (!hasWhen) return { type: p.type, title: p.title, start: null, inAgenda: p.inAgenda };
  const date = p.date ?? startOfDay(new Date());
  const allDay = !p.time;
  const start = new Date(date);
  if (p.time) start.setHours(p.time[0], p.time[1]);
  let duration = p.duration ?? (allDay ? 1440 : defaultDuration);
  if (p.time && p.endTime) {
    duration = (p.endTime[0] * 60 + p.endTime[1]) - (p.time[0] * 60 + p.time[1]);
    if (duration <= 0) duration += 1440;
  }
  const out = { type: p.type, title: p.title, start: toLocalISO(start), duration, allDay, inAgenda: p.inAgenda ?? (p.type === 'plan' ? true : null) };
  // Tareas sin duración indicada: sin fin (en curso hasta completarlas)
  if (p.type === 'task' && !p.duration && !p.endTime) out.openEnd = true;
  if (p.recurrence) {
    const r = defaultRule(p.recurrence.freq, out.start);
    r.interval = p.recurrence.interval ?? 1;
    if (p.recurrence.byDay) {
      r.byDay = p.recurrence.byDay;
      // Empezar en el primer día válido
      if (!p.date) {
        const today = startOfDay(new Date());
        for (let i = 0; i < 7; i++) {
          const d = addDays(today, i);
          if (r.byDay.includes(d.getDay())) {
            out.start = `${dateKey(d)}T${out.start.slice(11)}`;
            break;
          }
        }
      }
    }
    out.recurrence = r;
  }
  return out;
}

export function quickSummary(p) {
  const bits = [];
  bits.push({ event: '📅 Evento', task: '✅ Tarea', plan: '🗺️ Planning' }[p.type]);
  if (p.date) bits.push(`${p.date.getDate()}/${p.date.getMonth() + 1}`);
  if (p.time) bits.push(`${pad(p.time[0])}:${pad(p.time[1])}${p.endTime ? `–${pad(p.endTime[0])}:${pad(p.endTime[1])}` : ''}`);
  if (p.duration) bits.push(`${p.duration} min`);
  if (p.recurrence) bits.push('🔁');
  if (p.categoryName) bits.push(`#${p.categoryName}`);
  if (p.reminder) bits.push(`aviso ${p.reminder.level}`);
  if (p.inAgenda === false) bits.push('fuera de agenda');
  return bits.join(' · ');
}
