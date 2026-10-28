// Avisos con la app cerrada (Android): Web Push a través del servidor de avisos.
//
// · La app calcula los avisos de los próximos 30 días y los sube al servidor: solo la hora
//   y el texto CIFRADO (AES-GCM) con la clave de la sincronización o, si no hay, con una
//   clave propia de este dispositivo. El servidor no puede leerlos.
// · A cada hora, el servidor manda un «toque» sin contenido; el service worker (sw.js)
//   despierta, pide los avisos pendientes, los descifra y muestra la notificación.
// · La lista se vuelve a subir al abrir la app, al salir de ella y tras cada cambio.
import * as store from './store.js';
import { serverUrl, setServerUrl, api } from './server.js';
import { alarmKey, alarmText, dueBetween } from './notify.js';
import { uid } from './util.js';

export { serverUrl, setServerUrl };

const CFG_KEY = 'cdt.push';
const HORIZON_DAYS = 30;
const MAX_ENTRIES = 1200;

let cfg = read() ?? {};
let shown = new Set(); // avisos ya mostrados por el service worker (para no repetirlos en la app)
let uploadTimer = null;
const listeners = new Set();

function read() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY));
  } catch {
    return null;
  }
}
function write(patch) {
  cfg = { ...cfg, ...patch };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch { /* */ }
  listeners.forEach((f) => f(status()));
}

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const status = () => ({
  supported: supported(), url: serverUrl(), enabled: !!cfg.enabled, lastUpload: cfg.lastUpload ?? null,
  count: cfg.count ?? 0, error: cfg.error ?? null, permission: 'Notification' in window ? Notification.permission : 'unsupported',
});
export const onStatus = (f) => listeners.add(f);

// ---------------- IndexedDB compartida con el service worker ----------------

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cdt-push', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
const kvGet = (k) => kv('readonly', (s) => s.get(k)).catch(() => null);
const kvSet = (k, v) => kv('readwrite', (s) => s.put(v, k));

function syncKey() {
  return new Promise((res) => {
    const r = indexedDB.open('cdt-sync', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onerror = () => res(null);
    r.onsuccess = () => {
      const tx = r.result.transaction('keys', 'readonly');
      const q = tx.objectStore('keys').get('main');
      q.onsuccess = () => res(q.result?.key ?? null);
      q.onerror = () => res(null);
    };
  });
}

/** Clave con la que se cifran los textos: la de la sincronización o una propia del dispositivo */
async function cipherKey() {
  const k = await syncKey();
  if (k) return { key: k, source: 'sync' };
  let own = await kvGet('key');
  if (!own) {
    own = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await kvSet('key', own);
  }
  return { key: own, source: 'local' };
}

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function encrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return `${b64(iv)}.${b64(ct)}`;
}

// ---------------- Grupo (dispositivos que comparten avisos) ----------------

/** Con la sincronización, el grupo viaja en los ajustes y es el mismo en todos tus dispositivos */
function groupId() {
  let g = store.get().settings.pushGroup;
  if (!g) {
    g = (uid() + uid() + uid()).replace(/[^a-z0-9]/g, '').slice(0, 32);
    store.quiet((s) => (s.settings.pushGroup = g));
  }
  return g;
}
function deviceId() {
  if (!cfg.device) write({ device: (uid() + uid() + uid()).replace(/[^a-z0-9]/g, '').slice(0, 32) });
  return cfg.device;
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// ---------------- Activar / desactivar ----------------

export async function enable() {
  if (!supported()) throw new Error('Este navegador no admite avisos en segundo plano');
  if (!serverUrl()) throw new Error('Falta la dirección del servidor de avisos');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Sin permiso de notificaciones: actívalo en los ajustes del sitio en Chrome');
  const { publicKey } = await api('/vapid');
  if (typeof publicKey !== 'string' || publicKey.length < 80) {
    throw new Error('El servidor no ha devuelto su clave. En Cloudflare, comprueba que pegaste worker.js (Edit code → Deploy) y que el enlace KV se llama «KV».');
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Si cambió el servidor (otra clave), hay que volver a suscribirse
    const current = sub.options?.applicationServerKey;
    if (current && b64(current) !== b64(b64urlToBytes(publicKey))) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
  await api('/subscribe', { group: groupId(), device: deviceId(), sub: sub.toJSON() });
  write({ enabled: true, error: null, subscribedGroup: groupId() });
  await uploadNow();
}

/**
 * Reparación automática: Android/Chrome a veces anulan la suscripción (ahorro de batería,
 * limpiezas, renovación interna). Al abrir la app y cada pocas horas se comprueba y, si falta,
 * se vuelve a crear sin preguntar nada (el permiso ya está concedido) y se registra en el servidor.
 */
export async function ensureSubscribed() {
  if (!cfg.enabled || !serverUrl() || !supported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    let repaired = false;
    if (!sub) {
      const { publicKey } = await api('/vapid');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
      repaired = true;
    }
    // Registrar siempre (es idempotente): así el servidor recupera el dispositivo si lo había borrado
    await api('/subscribe', { group: groupId(), device: deviceId(), sub: sub.toJSON() });
    write({ subscribedGroup: groupId(), ...(repaired ? { lastRepair: Date.now() } : {}), error: null });
    return true;
  } catch (e) {
    write({ error: `No se pudo renovar la suscripción: ${e.message}` });
    return false;
  }
}

export async function disable() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await sub?.unsubscribe();
    await api('/unsubscribe', { group: groupId(), device: deviceId() });
  } catch { /* aunque falle el servidor, en este dispositivo queda desactivado */ }
  write({ enabled: false });
}

// ---------------- Subir la lista de avisos ----------------

let testEntry = null;

export async function uploadNow() {
  if (!cfg.enabled || !serverUrl()) return;
  clearTimeout(uploadTimer);
  try {
    // Si la sincronización trajo otro grupo (el de tus otros dispositivos), apuntarse a él
    if (cfg.subscribedGroup !== groupId()) {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        if (cfg.subscribedGroup) await api('/unsubscribe', { group: cfg.subscribedGroup, device: deviceId() }).catch(() => {});
        await api('/subscribe', { group: groupId(), device: deviceId(), sub: sub.toJSON() });
        write({ subscribedGroup: groupId() });
      }
    }
    const now = Date.now();
    const { key, source } = await cipherKey();
    const due = dueBetween(now - 60e3, now + HORIZON_DAYS * 86400e3).slice(0, MAX_ENTRIES);
    const entries = [];
    for (const d of due) {
      const { title, body } = alarmText(d.inst, d.r, d.at);
      entries.push({
        k: alarmKey(d.inst, d.r), at: d.at, rep: d.r.level === 'persistent' ? 1 : 0,
        c: await encrypt(key, { t: title, b: body, l: d.r.level, i: d.inst.id }),
      });
    }
    if (testEntry && testEntry.at > now - 120e3) entries.push(testEntry);
    // Lo que necesita el service worker para pedir y descifrar los avisos
    await kvSet('cfg', { url: serverUrl(), group: groupId(), device: deviceId(), keySource: source, repeatMin: store.get().settings.persistentRepeatMin || 2 });
    await api('/schedule', { group: groupId(), entries, repeatMin: store.get().settings.persistentRepeatMin || 2 });
    write({ lastUpload: Date.now(), count: entries.length, error: null });
  } catch (e) {
    write({ error: e.message });
  }
}

export function scheduleUpload(ms = 8000) {
  if (!cfg.enabled) return;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(uploadNow, ms);
}

/** Aviso de prueba que llega dentro de 1–2 minutos (con la app cerrada) */
export async function sendTest() {
  const { key } = await cipherKey();
  const at = Date.now() + 60e3;
  testEntry = { k: `test-${at}`, at, rep: 0, c: await encrypt(key, { t: '🔔 Prueba de aviso', b: 'Si ves esto con la app cerrada, los avisos funcionan.', l: 'sound', i: null }) };
  await uploadNow();
}

// ---------------- Diagnóstico ----------------

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'hace menos de 1 min' : m < 90 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
};
const at = (t) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Comprueba cada eslabón: permiso → service worker → suscripción → servidor → disparador → Google */
export async function diagnose() {
  const r = [];
  const add = (ok, label, detail = '', hint = '') => r.push({ ok, label, detail, hint });
  add(supported(), 'El navegador admite avisos en segundo plano', '', 'Usa Chrome (no el navegador de Xiaomi).');
  const perm = 'Notification' in window ? Notification.permission : 'no disponible';
  add(perm === 'granted', 'Permiso de notificaciones', perm,
    'Ajustes del móvil → Aplicaciones → Calendario (o Chrome) → Notificaciones → permitir. Y en Chrome: ⋮ → Configuración → Notificaciones.');
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  add(!!reg?.active, 'Service worker activo', reg?.active ? reg.active.scriptURL.split('/').slice(-1)[0] : 'no', 'Cierra la app del todo y ábrela otra vez.');
  // Antes de comprobar, intentar la reparación automática (como al abrir la app)
  await ensureSubscribed();
  const sub = await reg?.pushManager?.getSubscription().catch(() => null);
  add(!!sub, 'Este dispositivo está suscrito a los avisos',
    sub ? `${new URL(sub.endpoint).host}${cfg.lastRepair ? ` · renovada automáticamente ${ago(cfg.lastRepair)}` : ''}` : 'no',
    'Pulsa «Activar» en Ajustes → Avisos.');
  add(!!cfg.enabled && !!serverUrl(), 'Avisos con la app cerrada activados', serverUrl() || 'sin dirección del servidor', 'Pega la dirección de tu Worker y pulsa «Activar».');
  const swCfg = await kvGet('cfg');
  add(!!swCfg?.url, 'Datos para el service worker guardados', swCfg?.url ? `grupo ${String(swCfg.group).slice(0, 6)}…` : 'no', 'Pulsa «Actualizar ahora».');
  if (!serverUrl()) return r;
  let st = null;
  try {
    st = await api(`/status?g=${encodeURIComponent(groupId())}`);
  } catch (e) {
    add(false, 'El servidor responde', e.message, '');
    return r;
  }
  add(st.version >= 2, 'Servidor con el código actualizado', st.version ? `versión ${st.version}` : 'versión antigua',
    'En Cloudflare: Edit code → pega el worker.js nuevo → Deploy.');
  add(!!st.lastCron && Date.now() - st.lastCron < 15 * 60e3, 'El disparador de cada minuto (Cron) funciona',
    st.lastCron ? `última ejecución ${ago(st.lastCron)}` : 'nunca se ha ejecutado',
    'En Cloudflare: Worker → Settings → Trigger Events → Add → Cron Triggers → * * * * *');
  const g = st.group;
  const mine = cfg.device?.slice(0, 6);
  add(!!g && g.devicesList.includes(mine), 'Este dispositivo está registrado en el servidor',
    g ? `${g.devices} dispositivo(s) en tu grupo` : 'el servidor no conoce tu grupo', 'Pulsa «Desactivar» y luego «Activar».');
  add(!!g && g.entries > 0, 'Avisos programados en el servidor',
    g ? `${g.next24h} en las próximas 24 h${g.next ? ` · el siguiente: ${at(g.next)}` : ''}` : '0',
    'Pulsa «Actualizar ahora». Si sigue en 0, revisa que tus elementos tengan avisos y estén en la agenda.');
  if (g?.lastPush) {
    const res = g.lastPush.results?.[mine];
    const ok = res === 201 || res === 200;
    add(ok, 'Google aceptó el último toque para este dispositivo',
      `${ago(g.lastPush.at)} · respuesta ${res ?? 'sin envío a este dispositivo'}`,
      res === 403 || res === 401 ? 'Firma rechazada: pulsa «Desactivar» y «Activar» para renovar la suscripción.'
        : res === 404 || res === 410 ? 'La suscripción había caducado. La app la renueva sola al abrirse: cierra y abre la app y repite el diagnóstico.' : '');
  } else {
    add(null, 'Todavía no se ha enviado ningún toque', 'Pulsa «Enviar prueba» y vuelve a hacer el diagnóstico en 2 minutos.', '');
  }
  return r;
}

/** Notificación inmediata desde este dispositivo: comprueba si Android muestra las notificaciones de la app */
export async function localTest() {
  if (Notification.permission !== 'granted') await Notification.requestPermission();
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('🔔 Notificación de prueba', {
    body: 'Si la ves, Android muestra las notificaciones de la app.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    vibrate: [300, 120, 300], tag: 'prueba-local',
  });
}

// ---------------- Coordinación con el service worker ----------------

/** Marca un aviso como ya mostrado (lo ha mostrado la app) para que el servidor no lo repita */
export async function markShown(k) {
  if (!k) return;
  shown.add(k);
  const map = (await kvGet('shown')) ?? {};
  map[k] = Date.now();
  await kvSet('shown', map).catch(() => {});
}

/** ¿Lo ha mostrado ya el service worker (con la app cerrada)? */
export const shownElsewhere = (k) => shown.has(k);

async function refreshShown() {
  const map = (await kvGet('shown')) ?? {};
  const limit = Date.now() - 3 * 86400e3;
  for (const [k, t] of Object.entries(map)) if (t < limit) delete map[k];
  shown = new Set(Object.keys(map));
  await kvSet('shown', map).catch(() => {});
}

/** Se ha parado / atendido un aviso: que el servidor deje de repetirlo */
export function ackRemote(k) {
  if (!cfg.enabled || !k) return;
  api('/ack', { group: groupId(), k }).catch(() => {});
}

export async function init() {
  await refreshShown().catch(() => {});
  // Subir la lista al abrir, tras cada cambio y al salir de la app (solo si está activado)
  store.onDataChange(() => scheduleUpload());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') uploadNow();
    else {
      refreshShown();
      ensureSubscribed();
    }
  });
  // Al abrir: comprobar la suscripción (y repararla) y después subir la lista de avisos
  setTimeout(() => ensureSubscribed().finally(uploadNow), 2000);
  setInterval(() => ensureSubscribed().finally(uploadNow), 6 * 3600e3);
}
