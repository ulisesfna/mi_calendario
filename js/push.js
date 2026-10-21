// Avisos con la app cerrada (Android): Web Push a través del servidor de avisos.
//
// · La app calcula los avisos de los próximos 30 días y los sube al servidor: solo la hora
//   y el texto CIFRADO (AES-GCM) con la clave de la sincronización o, si no hay, con una
//   clave propia de este dispositivo. El servidor no puede leerlos.
// · A cada hora, el servidor manda un «toque» sin contenido; el service worker (sw.js)
//   despierta, pide los avisos pendientes, los descifra y muestra la notificación.
// · La lista se vuelve a subir al abrir la app, al salir de ella y tras cada cambio.
import * as store from './store.js';
import { PUSH_SERVER_URL } from './config.js';
import { alarmKey, alarmText, dueBetween } from './notify.js';
import { uid } from './util.js';

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

export const serverUrl = () => (cfg.url || PUSH_SERVER_URL || '').replace(/\/+$/, '');
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const status = () => ({
  supported: supported(), url: serverUrl(), enabled: !!cfg.enabled, lastUpload: cfg.lastUpload ?? null,
  count: cfg.count ?? 0, error: cfg.error ?? null, permission: 'Notification' in window ? Notification.permission : 'unsupported',
});
export const onStatus = (f) => listeners.add(f);
export function setServerUrl(u) {
  write({ url: u.trim() });
}

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

async function api(path, body) {
  const r = await fetch(serverUrl() + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `El servidor de avisos respondió ${r.status}`);
  return j;
}

const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// ---------------- Activar / desactivar ----------------

export async function enable() {
  if (!supported()) throw new Error('Este navegador no admite avisos en segundo plano');
  if (!serverUrl()) throw new Error('Falta la dirección del servidor de avisos');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Sin permiso de notificaciones: actívalo en los ajustes del sitio en Chrome');
  const { publicKey } = await api('/vapid');
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
    await kvSet('cfg', { url: serverUrl(), group: groupId(), keySource: source, repeatMin: store.get().settings.persistentRepeatMin || 2 });
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
    else refreshShown();
  });
  setTimeout(uploadNow, 3000);
  setInterval(uploadNow, 6 * 3600e3);
}
