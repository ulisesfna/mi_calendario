// Utilidades generales: fechas en hora local, HTML, colores.

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' de una fecha local */
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 'YYYY-MM-DDTHH:mm' en hora local */
export const toLocalISO = (d) => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Interpreta 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm' como hora local */
export function parseLocal(s) {
  if (!s) return null;
  const [dp, tp = '00:00'] = s.split('T');
  const [y, m, d] = dp.split('-').map(Number);
  const [h, mi] = tp.split(':').map(Number);
  return new Date(y, m - 1, d, h || 0, mi || 0);
}

export const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
export const addMinutes = (d, n) => new Date(d.getTime() + n * 60000);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const startOfWeek = (d, weekStart = 1) => {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() - weekStart + 7) % 7));
};
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const sameDay = (a, b) => dateKey(a) === dateKey(b);
/** Días naturales de a hasta b (robusto frente a cambios de horario) */
export const diffDays = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
export const keyAddDays = (k, n) => dateKey(addDays(parseLocal(k), n));

export const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const DAY_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DAY_LETTER = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

export const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtDate = (d) => `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
export const fmtDateLong = (d) =>
  `${DAY_LONG[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
export function fmtDuration(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 24 && m === 0 && h % 24 === 0) return `${h / 24} d`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
export function fmtRelative(ms) {
  const abs = Math.abs(ms), past = ms < 0;
  const min = Math.round(abs / 60000);
  let t;
  if (min < 1) t = 'ahora';
  else if (min < 60) t = `${min} min`;
  else if (min < 1440) t = `${Math.round(min / 60)} h`;
  else t = `${Math.round(min / 1440)} días`;
  if (t === 'ahora') return t;
  return past ? `hace ${t}` : `en ${t}`;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** minúsculas y sin acentos, para búsquedas */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(',')},${a})`;
/** Aclara (amt > 0) u oscurece (amt < 0) un color mezclándolo con blanco o negro */
export function shade(hex, amt) {
  if (!amt) return hex;
  const t = amt > 0 ? 255 : 0, p = Math.min(1, Math.abs(amt));
  return '#' + hexToRgb(hex).map((v) => Math.round(v + (t - v) * p).toString(16).padStart(2, '0')).join('');
}
/** Color de texto legible sobre un fondo */
export function textOn(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.42 ? '#1b1b1f' : '#ffffff';
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export const readFileText = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
