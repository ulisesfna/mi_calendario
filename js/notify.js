// Avisos: niveles de intensidad, sonidos generados, alarma en pantalla y planificador.
import * as store from './store.js';
import { buildInstance } from './engine.js';
import { occurrenceKeys } from './recurrence.js';
import { addDays, dateKey, esc, fmtDate, fmtRelative, fmtTime, parseLocal, uid } from './util.js';
import { toast } from './ui/dom.js';
import * as push from './push.js';
import * as native from './native.js';

export const LEVELS = {
  visual: { label: 'Solo visual (silencioso)', short: 'Visual', icon: '🔕' },
  vibrate: { label: 'Vibración', short: 'Vibración', icon: '📳' },
  sound: { label: 'Vibración + sonido', short: 'Sonido', icon: '🔔' },
  alarm: { label: 'Alarma (suena hasta 3 min)', short: 'Alarma', icon: '⏰' },
  persistent: { label: 'Alarma persistente (hasta que la pares)', short: 'Persistente', icon: '🚨' },
};

export const UNITS = {
  min: { label: 'minutos antes', mult: 1 },
  h: { label: 'horas antes', mult: 60 },
  d: { label: 'días antes', mult: 1440 },
  w: { label: 'semanas antes', mult: 10080 },
  // Respecto al FINAL (p. ej. «0 min antes de acabar» = al terminar la sesión)
  endmin: { label: 'min antes de acabar', mult: 1, end: true },
  abs: { label: 'fecha y hora exactas', mult: 0 },
};

export const SOUNDS = { clasica: 'Clásica', suave: 'Suave', digital: 'Digital', campana: 'Campana' };

export function describeReminder(r) {
  if (r.unit === 'abs') {
    const d = parseLocal(r.at);
    return `${LEVELS[r.level]?.icon ?? ''} ${d ? fmtDate(d) + ' ' + fmtTime(d) : '—'}`;
  }
  const v = r.value | 0;
  if (r.unit === 'endmin') return `${LEVELS[r.level]?.icon ?? ''} ${v === 0 ? 'al acabar' : `${v} min antes de acabar`}`;
  const t = v === 0 ? 'a la hora' : `${v} ${({ min: 'min', h: 'h', d: v === 1 ? 'día' : 'días', w: v === 1 ? 'semana' : 'semanas' })[r.unit]} antes`;
  return `${LEVELS[r.level]?.icon ?? ''} ${t}`;
}

// ---------------- Sonido ----------------

let ctx = null;
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* sin audio */ }
}

function tone(freq, t0, dur, { type = 'sine', vol = 0.3, decay = false } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  else {
    g.gain.setValueAtTime(vol, t0 + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** Reproduce un patrón de sonido. Devuelve su duración en segundos. */
export function playSound(kind) {
  unlockAudio();
  if (!ctx) return 0;
  const v = store.get().settings.alarmVolume ?? 0.8;
  const t = ctx.currentTime + 0.02;
  switch (kind) {
    case 'chime':
      tone(880, t, 0.25, { vol: 0.25 * v, decay: true });
      tone(1318, t + 0.18, 0.4, { vol: 0.25 * v, decay: true });
      return 0.7;
    case 'suave':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.22, 0.5, { vol: 0.3 * v, decay: true }));
      return 1.6;
    case 'digital':
      for (let i = 0; i < 8; i++) tone(2093, t + i * 0.1, 0.05, { type: 'square', vol: 0.12 * v });
      return 1.2;
    case 'campana':
      [1, 2.76, 5.4].forEach((m, i) => tone(440 * m, t, 2.2 - i * 0.5, { vol: (0.3 / (i + 1)) * v, decay: true }));
      return 2.4;
    case 'clasica':
    default:
      for (let i = 0; i < 3; i++) tone(988, t + i * 0.28, 0.16, { type: 'square', vol: 0.15 * v });
      return 1.3;
  }
}

function vibrate(level) {
  const pat = store.get().settings.vibration?.[level];
  // Los navegadores solo permiten vibrar después de que el usuario haya tocado la página
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    if (pat && navigator.vibrate) navigator.vibrate(pat);
  } catch { /* no soportado */ }
}

// ---------------- Notificación del sistema ----------------

export async function requestPermission() {
  if (native.isNative) return native.requestPermission();
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

async function systemNotify(alarm) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const strong = alarm.level === 'alarm' || alarm.level === 'persistent';
  const opts = {
    body: alarm.body,
    tag: alarm.id,
    renotify: true,
    silent: alarm.level === 'visual',
    requireInteraction: strong,
    vibrate: alarm.level === 'visual' ? undefined : store.get().settings.vibration?.[alarm.level],
    data: { alarmId: alarm.id },
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    actions: [
      { action: 'snooze', title: 'Posponer 10 min' },
      { action: 'ack', title: strong ? 'Parar' : 'Vale' },
    ],
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(alarm.title, opts);
    else new Notification(alarm.title, opts);
  } catch (e) {
    console.warn('Notificación no mostrada', e);
  }
}

// ---------------- Alarma en pantalla ----------------

let loopTimer = null;
let onChange = () => {};

function activeAlarms() {
  return store.get().notif.active ?? [];
}

function renderOverlay() {
  const el = document.getElementById('alarm');
  const list = activeAlarms().filter((a) => a.level === 'alarm' || a.level === 'persistent');
  if (!list.length) {
    el.hidden = true;
    el.innerHTML = '';
    stopLoop();
    return;
  }
  el.hidden = false;
  el.innerHTML = `<div class="alarm-box">
    <div class="alarm-ring">⏰</div>
    ${list.map((a) => `<div class="alarm-item" style="--c:${a.color}">
        <div class="alarm-title">${esc(a.title)}</div>
        <div class="alarm-body">${esc(a.body)}</div>
        <div class="alarm-actions">
          <button class="btn" data-alarm="snooze" data-min="5" data-id="${a.id}">+5 min</button>
          <button class="btn" data-alarm="snooze" data-min="10" data-id="${a.id}">+10 min</button>
          <button class="btn" data-alarm="snooze" data-min="30" data-id="${a.id}">+30 min</button>
          <button class="btn primary big" data-alarm="ack" data-id="${a.id}">Parar</button>
        </div></div>`).join('')}
  </div>`;
  startLoop();
}

function startLoop() {
  if (loopTimer) return;
  const step = () => {
    const list = activeAlarms().filter((a) => a.level === 'alarm' || a.level === 'persistent');
    if (!list.length) return stopLoop();
    const now = Date.now();
    // Las alarmas normales se callan solas a los 3 minutos (quedan como aviso)
    for (const a of list) {
      if (a.level === 'alarm' && now - a.since > 3 * 60000) ack(a.id, false);
    }
    const sec = playSound(store.get().settings.alarmSound);
    vibrate(list.some((a) => a.level === 'persistent') ? 'persistent' : 'alarm');
    loopTimer = setTimeout(step, Math.max(1500, sec * 1000 + 600));
  };
  step();
}
function stopLoop() {
  clearTimeout(loopTimer);
  loopTimer = null;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try {
    navigator.vibrate?.(0);
  } catch { /* */ }
}

// ---------------- Disparo ----------------

/** Identificador único de un aviso concreto (aparición + aviso). Lo comparten la app y el servidor. */
export const alarmKey = (inst, r) => `${inst.id}|${r.id ?? r.value + r.unit}`;

/** Título y texto de un aviso. `now` permite calcularlo de antemano (avisos con la app cerrada). */
export function alarmText(inst, reminder, now = Date.now()) {
  const when = inst.allDay ? fmtDate(inst.start) : `${fmtDate(inst.start)} · ${fmtTime(inst.start)}`;
  const rel = fmtRelative(inst.start - now);
  const loc = inst.item.location ? ` · ${inst.item.location}` : '';
  const atEnd = !!UNITS[reminder.unit]?.end;
  const v = reminder.value | 0;
  return {
    title: `${atEnd ? (v ? '⏳ Acaba pronto: ' : '🏁 Fin: ') : ''}${inst.icon ? inst.icon + ' ' : ''}${inst.title}`,
    body: atEnd
      ? (v ? `Termina a las ${fmtTime(inst.end)} (en ${v} min)` : `Ha terminado la sesión (${fmtTime(inst.start)}–${fmtTime(inst.end)})`)
      : `${when} (${rel})${loc}`,
  };
}

function makeAlarm(inst, reminder) {
  return {
    id: uid(),
    instId: inst.id,
    key: alarmKey(inst, reminder),
    ...alarmText(inst, reminder),
    level: reminder.level ?? 'sound',
    color: inst.color,
    since: Date.now(),
    lastNotify: Date.now(),
  };
}

export function fire(alarm) {
  const visible = document.visibilityState === 'visible';
  if (alarm.key) {
    push.markShown(alarm.key); // que el aviso con la app cerrada no lo repita
    // Decirle al servidor que ya se avisó, para que no mande un toque inútil
    // (las persistentes no: el servidor debe seguir repitiéndolas si cierras la app sin pararlas)
    if (alarm.level !== 'persistent') push.ackRemote(alarm.key);
  }
  store.quiet((s) => {
    s.notif.active = [...(s.notif.active ?? []).filter((a) => a.id !== alarm.id), alarm];
  });
  systemNotify(alarm);
  if (visible) {
    if (alarm.level === 'sound') playSound('chime');
    if (alarm.level !== 'visual') vibrate(alarm.level);
    if (alarm.level !== 'alarm' && alarm.level !== 'persistent') {
      toast(`${LEVELS[alarm.level]?.icon ?? '🔔'} ${alarm.title} · ${alarm.body}`, { action: () => ack(alarm.id), actionLabel: 'Vale', timeout: 12000 });
    }
  }
  if (alarm.level === 'alarm' || alarm.level === 'persistent') renderOverlay();
  onChange();
}

/** Prueba un nivel de aviso */
export function test(level) {
  if (native.isNative) return native.test(level);
  unlockAudio();
  fire({
    id: uid(), instId: null, title: `Prueba: ${LEVELS[level].label}`, body: 'Así sonará este aviso',
    level, color: '#7c4dff', since: Date.now(), lastNotify: Date.now(),
  });
}

export function ack(id, rerender = true) {
  const a = activeAlarms().find((x) => x.id === id);
  if (a?.key) push.ackRemote(a.key); // parar también las repeticiones del servidor
  store.quiet((s) => {
    s.notif.active = (s.notif.active ?? []).filter((a) => a.id !== id);
  });
  navigator.serviceWorker?.getRegistration().then((reg) =>
    reg?.getNotifications({ tag: id }).then((ns) => ns.forEach((n) => n.close())),
  ).catch(() => {});
  if (rerender) renderOverlay();
  onChange();
}

export function snooze(id, minutes = 10) {
  const a = activeAlarms().find((x) => x.id === id);
  if (!a) return;
  store.quiet((s) => {
    s.notif.snoozes = [...(s.notif.snoozes ?? []), { ...a, id: uid(), at: Date.now() + minutes * 60000 }];
  });
  ack(id);
}

export const activeList = () => activeAlarms();
export const missedList = () => store.get().notif.missed ?? [];
export function clearMissed() {
  store.quiet((s) => (s.notif.missed = []));
  onChange();
}

// ---------------- Planificador ----------------

const offsetMin = (r) => (r.value | 0) * (UNITS[r.unit]?.mult ?? 1);

/**
 * Instante de referencia de una aparición: el inicio o, para los avisos «antes de acabar», el final.
 * Los de día completo avisan respecto a las 9:00 del primer día (o a las 20:00 del último).
 */
function refTime(inst, r) {
  if (UNITS[r.unit]?.end) {
    return inst.allDay ? addDays(inst.end, -1).setHours(20, 0, 0, 0) : inst.end.getTime();
  }
  return inst.allDay ? new Date(inst.start).setHours(9, 0, 0, 0) : inst.start.getTime();
}

/** Avisos que tocan en el intervalo (t0, t1] */
export function dueBetween(t0, t1) {
  const out = [];
  for (const item of store.get().items) {
    if (!item.start) continue;
    if (!store.inAgenda(item) && !Array.isArray(item.reminders)) continue;
    const rems = store.effectiveReminders(item);
    for (const r of rems) {
      if (r.unit === 'abs') {
        const at = parseLocal(r.at)?.getTime();
        if (at && at > t0 && at <= t1) {
          const inst = buildInstance(item, item.recurrence ? item.start.slice(0, 10) : null);
          out.push({ inst, r, at });
        }
        continue;
      }
      const off = offsetMin(r) * 60000;
      const atEnd = !!UNITS[r.unit]?.end;
      // Los avisos «al acabar» dependen del final: buscar también apariciones que empezaron antes
      const extra = atEnd ? (item.duration ?? 60) * 60000 : 0;
      const from = dateKey(addDays(new Date(t0 + off - extra), -1));
      const to = dateKey(new Date(t1 + off));
      for (const k of occurrenceKeys(item.start.slice(0, 10), item.recurrence, from, to)) {
        const inst = buildInstance(item, k);
        if (inst.done) continue;
        if (atEnd && inst.openEnd) continue; // una tarea sin fin no «acaba»
        const at = refTime(inst, r) - off;
        if (at > t0 && at <= t1) out.push({ inst, r, at });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function tick() {
  const st = store.get();
  const now = Date.now();
  const t0 = Math.max(st.notif.lastCheck ?? now, now - 14 * 86400000);
  const due = dueBetween(t0, now);
  const fired = st.notif.fired ?? {};
  const missed = [];
  for (const d of due) {
    const fk = alarmKey(d.inst, d.r);
    if (fired[fk]) continue;
    fired[fk] = now;
    if (native.isNative) continue; // en la app de Android suenan las alarmas del propio móvil
    if (push.shownElsewhere(fk)) continue; // ya llegó con la app cerrada (aviso del servidor)
    const alarm = makeAlarm(d.inst, d.r);
    if (now - d.at > 5 * 60000) missed.push({ ...alarm, at: d.at });
    else fire(alarm);
  }
  // Pospuestos
  const snoozes = st.notif.snoozes ?? [];
  const ready = snoozes.filter((s) => s.at <= now);
  // Persistentes: volver a notificar cada X minutos
  const rep = (st.settings.persistentRepeatMin || 2) * 60000;
  const renotify = (st.notif.active ?? []).filter((a) => a.level === 'persistent' && now - a.lastNotify > rep);
  store.quiet((s) => {
    s.notif.lastCheck = now;
    // olvidar disparos de hace más de 30 días
    for (const [k, t] of Object.entries(fired)) if (now - t > 30 * 86400000) delete fired[k];
    s.notif.fired = fired;
    s.notif.snoozes = snoozes.filter((x) => x.at > now);
    if (missed.length) s.notif.missed = [...missed, ...(s.notif.missed ?? [])].slice(0, 50);
    for (const a of s.notif.active ?? []) if (renotify.some((r) => r.id === a.id)) a.lastNotify = now;
  });
  ready.forEach((s) => fire({ ...s, since: now, lastNotify: now }));
  renotify.forEach((a) => systemNotify(a));
  if (missed.length) onChange();
}

/** Próximos avisos programados (para mostrarlos en Ajustes) */
export function upcoming(hours = 72) {
  const now = Date.now();
  return dueBetween(now, now + hours * 3600000);
}

export function init(changeCb) {
  onChange = changeCb ?? (() => {});
  document.getElementById('alarm').addEventListener('click', (e) => {
    const b = e.target.closest('[data-alarm]');
    if (!b) return;
    if (b.dataset.alarm === 'ack') ack(b.dataset.id);
    else snooze(b.dataset.id, +b.dataset.min);
  });
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const m = e.data;
    if (m?.type !== 'notification-action') return;
    if (m.action === 'snooze') snooze(m.alarmId, 10);
    else if (m.action === 'ack') ack(m.alarmId);
  });
  // Cualquier interacción desbloquea el audio (requisito de los navegadores)
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlockAudio, { once: true }));
  renderOverlay();
  tick();
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
}
