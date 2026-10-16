// Sincronización entre dispositivos a través de Google Drive, con cifrado de extremo a extremo.
//
// · Los datos se cifran en el dispositivo (AES-GCM 256) con una clave derivada de tu
//   contraseña de cifrado (PBKDF2-SHA256, 600 000 iteraciones). Google solo guarda texto cifrado.
// · El archivo va a la carpeta oculta de la app en Drive («appDataFolder»): no aparece en
//   «Mi unidad» y la app no tiene acceso a ningún otro archivo tuyo.
// · La clave se guarda en este dispositivo como no exportable (IndexedDB); la contraseña no se guarda.
// · Fusión: gana la versión más reciente de cada categoría/elemento; los borrados también se sincronizan.
import * as store from './store.js';
import { GOOGLE_CLIENT_ID } from './config.js';

const FILE_NAME = 'calendario-sync.enc.json';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata openid email';
const ITERATIONS = 600000;
const CFG_KEY = 'cdt.sync';
const TOKEN_KEY = 'cdt.sync.token';
const TOMBSTONE_DAYS = 120;

// ---------------- Estado ----------------

let cfg = readJSON(CFG_KEY) ?? {};
let status = { state: 'off', error: null };
const statusListeners = new Set();
let passPrompt = null; // función de la interfaz que pide la contraseña
let busy = false;
let pending = false;
let pushTimer = null;

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

export const clientId = () => cfg.clientId || GOOGLE_CLIENT_ID || '';
export function setClientId(id) {
  writeCfg({ clientId: id.trim() });
  setStatus(cfg.enabled ? status.state : 'off');
}
export const getStatus = () => ({
  ...status, configured: !!clientId(), enabled: !!cfg.enabled, email: cfg.email ?? null, lastSync: cfg.lastSync ?? null, pending,
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

async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
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
    throw new WrongPassphrase('La contraseña de cifrado no coincide');
  }
}

// Clave guardada en IndexedDB (no exportable: ni siquiera la app puede leer sus bytes)
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
const saveKey = (v) => idbOp('readwrite', (s) => s.put(v, 'main'));
const clearKey = () => idbOp('readwrite', (s) => s.delete('main')).catch(() => {});

// ---------------- Google: identidad y Drive ----------------

let gisPromise = null;
function loadGis() {
  gisPromise ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res(window.google);
    s.onerror = () => {
      gisPromise = null;
      rej(new Error('No se pudo cargar el inicio de sesión de Google (¿sin conexión?)'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function savedToken() {
  const t = readJSON(TOKEN_KEY);
  return t && t.exp > Date.now() + 60000 ? t.token : null;
}

/** Devuelve un token de acceso. Con interactive=false nunca abre ventanas. */
async function getToken(interactive) {
  const t = savedToken();
  if (t) return t;
  if (!interactive) throw Object.assign(new Error('Hace falta volver a entrar con Google'), { needsAuth: true });
  if (!clientId()) throw new Error('Falta el ID de cliente de Google (Ajustes → Sincronización)');
  const google = await loadGis();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPES,
      callback: (r) => {
        if (r.error || !r.access_token) return rej(new Error(r.error_description || r.error || 'Acceso no concedido'));
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000 }));
        res(r.access_token);
      },
      error_callback: (e) => rej(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google' : e?.message || 'No se pudo abrir la ventana de Google')),
    });
    client.requestAccessToken({ prompt: '', login_hint: cfg.email ?? undefined });
  });
}

async function api(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
  if (r.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    throw Object.assign(new Error('La sesión de Google ha caducado'), { needsAuth: true });
  }
  if (!r.ok) throw new Error(`Google Drive respondió ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r;
}

async function findFile(token) {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await api(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  return (await r.json()).files?.[0] ?? null;
}
const download = async (token, id) => (await api(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text();

async function upload(token, id, content) {
  if (id) {
    await api(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content,
    });
    return id;
  }
  const boundary = 'cdt' + Math.random().toString(36).slice(2);
  const meta = { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const r = await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return (await r.json()).id;
}

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

const sameData = (a, b) =>
  JSON.stringify([a.categories, a.items, a.deleted, a.settings]) === JSON.stringify([b.categories, b.items, b.deleted, b.settings]);

// ---------------- Flujo principal ----------------

/** Conecta este dispositivo: inicia sesión con Google y pide (o crea) la contraseña de cifrado */
export async function connect() {
  setStatus('syncing');
  try {
    const token = await getToken(true);
    const info = await (await api(token, 'https://www.googleapis.com/oauth2/v3/userinfo')).json();
    writeCfg({ email: info.email ?? null });
    const file = await findFile(token);
    let key, salt;
    if (file) {
      // Ya hay datos en la nube: hace falta la misma contraseña que en el otro dispositivo
      const content = await download(token, file.id);
      salt = unb64(JSON.parse(content).salt);
      let error = null;
      for (;;) {
        const pass = await passPrompt?.({ mode: 'unlock', email: info.email, error });
        if (!pass) throw new Error('Conexión cancelada');
        key = await deriveKey(pass, salt);
        try {
          await decryptPayload(content, key);
          break;
        } catch {
          error = 'Esa no es la contraseña con la que se cifraron los datos. Prueba otra vez.';
        }
      }
    } else {
      const pass = await passPrompt?.({ mode: 'create', email: info.email });
      if (!pass) throw new Error('Conexión cancelada');
      salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(pass, salt);
    }
    await saveKey({ key, salt });
    writeCfg({ enabled: true });
    setStatus('idle');
    // Un dispositivo nuevo (sin nada propio) adopta lo de la nube tal cual, para no
    // duplicar las categorías de ejemplo que trae la app al instalarse
    await syncNow({ interactive: true, adopt: !!file && store.get().items.length === 0 });
  } catch (e) {
    setStatus(cfg.enabled ? 'error' : 'off', e.message);
    throw e;
  }
}

/** Olvida la cuenta y la clave en este dispositivo (los datos locales y los de Drive se quedan) */
export async function disconnect() {
  const t = readJSON(TOKEN_KEY)?.token;
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
  localStorage.removeItem(TOKEN_KEY);
  await clearKey();
  writeCfg({ enabled: false, email: null, lastSync: null });
  setStatus('off');
}

/** Descarga, fusiona y sube. interactive=true puede abrir la ventana de Google si hace falta. */
export async function syncNow({ interactive = false, adopt = false } = {}) {
  if (!cfg.enabled) return;
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  pending = false;
  setStatus('syncing');
  try {
    const stored = await loadKey();
    if (!stored?.key) throw Object.assign(new Error('Falta la contraseña de cifrado en este dispositivo'), { needsPass: true });
    const token = await getToken(interactive);
    const file = await findFile(token);
    let local = localPayload();
    if (adopt) local = { categories: [], items: [], deleted: {}, settings: local.settings, settingsUpdatedAt: 0 };
    let merged = local;
    let salt = stored.salt;
    if (file) {
      const content = await download(token, file.id);
      const remoteSalt = JSON.parse(content).salt;
      if (remoteSalt !== b64(stored.salt)) throw new WrongPassphrase('La contraseña de cifrado se cambió en otro dispositivo');
      const remote = await decryptPayload(content, stored.key);
      merged = merge(local, remote);
      if (!sameData(merged, local)) store.applyRemote(merged);
      if (sameData(merged, remote)) {
        // Nada nuevo que subir
        writeCfg({ lastSync: Date.now() });
        setStatus('idle');
        return;
      }
    }
    const content = await encryptPayload({ v: 1, savedAt: Date.now(), ...merged }, stored.key, salt);
    await upload(token, file?.id, content);
    writeCfg({ lastSync: Date.now() });
    setStatus('idle');
  } catch (e) {
    if (e.needsAuth) setStatus('needs-auth', e.message);
    else if (e.needsPass || e instanceof WrongPassphrase) setStatus('needs-pass', e.message);
    else setStatus('error', e.message);
  } finally {
    busy = false;
    if (pending) setTimeout(() => syncNow(), 500);
  }
}

/** Vuelve a pedir la contraseña (p. ej. si se cambió en otro dispositivo) */
export async function unlockAgain() {
  await clearKey();
  writeCfg({ enabled: false });
  return connect();
}

export function init() {
  if (cfg.enabled) setStatus(savedToken() ? 'idle' : 'needs-auth');
  // Subir cambios poco después de hacerlos
  store.onDataChange(() => {
    if (!cfg.enabled) return;
    pending = true;
    statusListeners.forEach((f) => f(getStatus()));
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => savedToken() && syncNow(), 4000);
  });
  // Traer cambios al abrir, al volver a la app y cada 3 minutos
  const pull = () => cfg.enabled && savedToken() && document.visibilityState === 'visible' && syncNow();
  document.addEventListener('visibilitychange', pull);
  setInterval(pull, 3 * 60000);
  setTimeout(pull, 1500);
}
