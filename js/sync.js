// Sincronización entre dispositivos a través de tu servidor (Cloudflare Worker), con cifrado de extremo a extremo.
//
// · Solo hace falta una contraseña de sincronización, la misma en todos tus dispositivos.
// · De ella se derivan (PBKDF2-SHA256, 600 000 iteraciones) dos cosas distintas:
//     - un identificador y un código de acceso para el servidor (sin la contraseña no se puede
//       ni encontrar tu copia ni sobrescribirla), y
//     - la clave AES-GCM 256 con la que se cifran los datos EN el dispositivo.
//   El servidor solo guarda texto cifrado: ni Cloudflare ni nadie puede leerlo.
// · La clave se guarda en este dispositivo como no exportable (IndexedDB); la contraseña no se guarda.
// · Fusión: gana la versión más reciente de cada categoría/elemento; los borrados también se sincronizan.
import * as store from './store.js';
import { api, serverUrl } from './server.js';

const ITERATIONS = 600000;
const CFG_KEY = 'cdt.sync';
const TOMBSTONE_DAYS = 120;
const ACCOUNT_SALT = 'calendario-tareas/cuenta/v1';

// ---------------- Estado ----------------

let cfg = readJSON(CFG_KEY) ?? {};
let status = { state: 'off', error: null };
const statusListeners = new Set();
let passPrompt = null; // función de la interfaz que pide la contraseña
let busy = false;
let again = false;
let pushTimer = null;
let changeSeq = 0;

function readJSON(k) {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
}
function writeCfg(patch) {
  cfg = { ...cfg, ...patch };
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch { /* */ }
}
function setStatus(state, error = null) {
  status = { state, error };
  statusListeners.forEach((f) => f(getStatus()));
}

export const getStatus = () => ({
  ...status, configured: !!serverUrl(), enabled: !!cfg.enabled, lastSync: cfg.lastSync ?? null, pending: !!cfg.dirty,
  wasGoogle: !!cfg.wasGoogle, server: serverUrl(),
});
export const onStatus = (f) => statusListeners.add(f);
export const setPassPrompt = (f) => (passPrompt = f);

// ---------------- Cifrado ----------------

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// btoa con arrays grandes: trocear para no desbordar la pila
const b64big = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Identificador y código de acceso de tu copia en el servidor (independientes de la clave de cifrado) */
async function deriveAccount(passphrase) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(ACCOUNT_SALT), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256,
  ));
  const tagged = async (tag) => hex(await crypto.subtle.digest('SHA-256', new Uint8Array([...enc.encode(tag), ...bits])));
  return { id: (await tagged('id')).slice(0, 32), tok: await tagged('tok') };
}

async function encryptPayload(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ app: 'calendario-tareas', v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64big(ct) });
}

class WrongPassphrase extends Error {}

async function decryptPayload(fileJson, key) {
  const f = JSON.parse(fileJson);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, key, unb64(f.data));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new WrongPassphrase('La contraseña de sincronización no coincide');
  }
}

// Clave guardada en IndexedDB (no exportable: ni siquiera la app puede leer sus bytes).
// El service worker la usa también para descifrar los avisos con la app cerrada.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cdt-sync', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('keys', mode);
    const req = fn(tx.objectStore('keys'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
const loadKey = () => idbOp('readonly', (s) => s.get('main')).catch(() => null);
const loadAuth = () => idbOp('readonly', (s) => s.get('auth')).catch(() => null);
const saveSecrets = (main, auth) => idbOp('readwrite', (s) => {
  s.put(main, 'main');
  return s.put(auth, 'auth');
});
const clearSecrets = () => idbOp('readwrite', (s) => {
  s.delete('main');
  return s.delete('auth');
}).catch(() => {});

// ---------------- Fusión ----------------

function localPayload() {
  const s = store.get();
  return { categories: s.categories, items: s.items, deleted: s.deleted ?? {}, settings: s.settings, settingsUpdatedAt: s.settingsUpdatedAt ?? 0 };
}

function mergeList(local, remote, deleted) {
  const map = new Map();
  for (const e of [...local, ...remote]) {
    const cur = map.get(e.id);
    if (!cur || (e.updatedAt ?? 0) > (cur.updatedAt ?? 0)) map.set(e.id, e);
  }
  return [...map.values()].filter((e) => !(deleted[e.id] && deleted[e.id] >= (e.updatedAt ?? 0)));
}

export function merge(local, remote) {
  const deleted = { ...(remote.deleted ?? {}) };
  for (const [id, t] of Object.entries(local.deleted ?? {})) deleted[id] = Math.max(t, deleted[id] ?? 0);
  const limit = Date.now() - TOMBSTONE_DAYS * 86400000;
  for (const [id, t] of Object.entries(deleted)) if (t < limit) delete deleted[id];
  const remoteNewer = (remote.settingsUpdatedAt ?? 0) > (local.settingsUpdatedAt ?? 0);
  return {
    categories: mergeList(local.categories, remote.categories ?? [], deleted),
    items: mergeList(local.items, remote.items ?? [], deleted),
    deleted,
    settings: remoteNewer ? remote.settings : local.settings,
    settingsUpdatedAt: Math.max(local.settingsUpdatedAt ?? 0, remote.settingsUpdatedAt ?? 0),
  };
}

// Comparación que no depende del orden (cada dispositivo guarda las listas en su propio orden;
// si contara, dos dispositivos se pasarían el día resubiendo lo mismo)
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return v;
}
const byId = (list) => [...(list ?? [])].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
const canon = (p) => JSON.stringify(stable({ c: byId(p.categories), i: byId(p.items), d: p.deleted ?? {}, s: p.settings ?? null }));
const sameData = (a, b) => canon(a) === canon(b);

// ---------------- Flujo principal ----------------

/** Conecta este dispositivo con la contraseña de sincronización (la misma en todos tus dispositivos) */
export async function connect() {
  if (!serverUrl()) throw new Error('Falta la dirección de tu servidor');
  let adopt = false;
  try {
    let error = null;
    for (;;) {
      const pass = await passPrompt?.({ mode: 'enter', error });
      if (!pass) throw new Error('Conexión cancelada');
      setStatus('syncing');
      const auth = await deriveAccount(pass);
      const r = await api('/sync/get', { ...auth, since: 0 });
      let main;
      if (r.exists) {
        // Ya hay una copia con esta contraseña (de otro dispositivo): descifrarla para comprobarla
        const salt = unb64(JSON.parse(r.data).salt);
        const key = await deriveKey(pass, salt);
        await decryptPayload(r.data, key);
        main = { key, salt };
        // Un dispositivo nuevo (sin nada propio) adopta lo del servidor tal cual, para no
        // duplicar las categorías de ejemplo que trae la app al instalarse
        adopt = store.get().items.length === 0;
      } else {
        // No hay nada con esta contraseña: puede ser la primera vez… o una errata
        setStatus(cfg.enabled ? 'idle' : 'off');
        const repeat = await passPrompt?.({ mode: 'confirm-new' });
        if (repeat == null) throw new Error('Conexión cancelada');
        if (repeat !== pass) {
          error = 'Las dos contraseñas no coinciden. Vuelve a escribirla.';
          continue;
        }
        setStatus('syncing');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        main = { key: await deriveKey(pass, salt), salt };
      }
      await saveSecrets(main, auth);
      break;
    }
    writeCfg({ enabled: true, rev: 0, dirty: true, wasGoogle: false });
    setStatus('idle');
    await syncNow({ adopt });
    if (status.state === 'error') throw new Error(status.error);
  } catch (e) {
    setStatus(cfg.enabled ? 'error' : 'off', e.message);
    throw e;
  }
}

/** Olvida la contraseña en este dispositivo (los datos locales y los del servidor se quedan) */
export async function disconnect() {
  await clearSecrets();
  writeCfg({ enabled: false, lastSync: null, rev: 0 });
  setStatus('off');
}

/** Descarga, fusiona y sube lo necesario */
export async function syncNow({ adopt = false } = {}) {
  if (!cfg.enabled) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  again = false;
  setStatus('syncing');
  try {
    const [stored, auth] = await Promise.all([loadKey(), loadAuth()]);
    if (!stored?.key || !auth?.id) throw Object.assign(new Error('Falta la contraseña de sincronización en este dispositivo'), { needsPass: true });
    for (let attempt = 0; ; attempt++) {
      const seq = changeSeq;
      const r = await api('/sync/get', { ...auth, since: adopt ? 0 : cfg.rev ?? 0 });
      let merged = localPayload();
      let upload = !r.exists || !!cfg.dirty;
      if (r.exists && !r.same) {
        if (JSON.parse(r.data).salt !== b64(stored.salt)) throw new WrongPassphrase('La contraseña de sincronización se cambió en otro dispositivo');
        const remote = await decryptPayload(r.data, stored.key);
        const local = adopt ? { categories: [], items: [], deleted: {}, settings: merged.settings, settingsUpdatedAt: 0 } : merged;
        merged = merge(local, remote);
        if (!sameData(merged, localPayload())) store.applyRemote(merged);
        upload = !sameData(merged, remote);
      }
      if (!upload) {
        writeCfg({ rev: r.rev, lastSync: Date.now(), ...(seq === changeSeq ? { dirty: false } : {}) });
        break;
      }
      const content = await encryptPayload({ v: 1, savedAt: Date.now(), ...merged }, stored.key, stored.salt);
      const w = await api('/sync/put', { ...auth, rev: r.exists ? r.rev : 0, data: content }, { allow: [409] });
      if (w.conflict) {
        // Otro dispositivo ha subido algo justo ahora: volver a traerlo y fusionar
        if (attempt >= 3) throw new Error('Otro dispositivo está sincronizando a la vez; se reintentará en unos minutos');
        adopt = false;
        continue;
      }
      writeCfg({ rev: w.rev, lastSync: Date.now(), ...(seq === changeSeq ? { dirty: false } : {}) });
      break;
    }
    setStatus('idle');
  } catch (e) {
    if (e.needsPass || e instanceof WrongPassphrase) setStatus('needs-pass', e.message);
    else setStatus('error', e.message);
  } finally {
    busy = false;
    if (again) setTimeout(() => syncNow(), 500);
  }
}

/** Vuelve a pedir la contraseña (p. ej. si se cambió en otro dispositivo) */
export async function unlockAgain() {
  await clearSecrets();
  writeCfg({ enabled: false });
  return connect();
}

export function init() {
  // Versión anterior (Google Drive): queda desconectada y se avisa para volver a conectar
  if (cfg.enabled && !cfg.rev && cfg.rev !== 0) {
    writeCfg({ enabled: false, wasGoogle: true, email: undefined, clientId: undefined });
    try {
      localStorage.removeItem('cdt.sync.token');
    } catch { /* */ }
  }
  if (cfg.enabled) setStatus('idle');
  // Subir cambios poco después de hacerlos
  store.onDataChange(() => {
    changeSeq++;
    if (!cfg.enabled) return;
    if (!cfg.dirty) writeCfg({ dirty: true });
    statusListeners.forEach((f) => f(getStatus()));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow(), 4000);
  });
  // Traer cambios al abrir, al volver a la app y cada 3 minutos
  const pull = () => cfg.enabled && document.visibilityState === 'visible' && syncNow();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cfg.enabled && cfg.dirty) syncNow(); // subir antes de cerrar
    else pull();
  });
  setInterval(pull, 3 * 60000);
  setTimeout(pull, 1500);
}
