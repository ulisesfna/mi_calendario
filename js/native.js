// App de Android (APK): alarmas del propio móvil, botón «atrás» y aviso de versiones nuevas.
// En el navegador (PWA) no hace nada: `isNative` es false.
import * as store from './store.js';
import { alarmKey, alarmText, dueBetween, LEVELS } from './notify.js';

const Cap = window.Capacitor;
export const isNative = !!Cap?.isNativePlatform?.() && typeof Cap.registerPlugin === 'function';
const Alarmas = isNative ? Cap.registerPlugin('Alarmas') : null;
const App = isNative ? Cap.registerPlugin('App') : null;

const HORIZON_DAYS = 45;
const MAX_ALARMS = 400; // Android admite unas 500 alarmas por app
const UPDATE_KEY = 'cdt.apk.update';

let lastState = null;
let timer = null;
const listeners = new Set();
export const onState = (f) => listeners.add(f);
export const state = () => lastState;

/** Identificador numérico estable de cada aviso (los pospuestos usan 0x40000000 en adelante) */
export function idFor(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h & 0x3fffffff) || 1;
}

/** Lista de avisos de las próximas semanas, tal y como la programa el móvil */
export function buildAlarms(now = Date.now()) {
  const rep = store.get().settings.persistentRepeatMin || 2;
  const seen = new Set();
  const out = [];
  for (const d of dueBetween(now, now + HORIZON_DAYS * 86400e3)) {
    const key = alarmKey(d.inst, d.r);
    const id = idFor(key);
    if (seen.has(id)) continue;
    seen.add(id);
    const { title, body } = alarmText(d.inst, d.r, d.at);
    out.push({ id, at: d.at, titulo: title, texto: body, nivel: d.r.level || 'sound', clave: key, repetirMin: rep });
    if (out.length >= MAX_ALARMS) break;
  }
  return out;
}

export async function reschedule() {
  if (!isNative) return;
  clearTimeout(timer);
  try {
    lastState = { ...(await Alarmas.programar({ avisos: buildAlarms() })), at: Date.now(), error: null };
  } catch (e) {
    lastState = { ...(lastState ?? {}), error: e.message ?? String(e) };
  }
  listeners.forEach((f) => f(lastState));
  return lastState;
}

const scheduleSoon = (ms = 2500) => {
  clearTimeout(timer);
  timer = setTimeout(reschedule, ms);
};

export async function refreshState() {
  if (!isNative) return null;
  try {
    lastState = { ...(lastState ?? {}), ...(await Alarmas.estado()) };
  } catch { /* */ }
  return lastState;
}

/** Permiso de notificaciones (Android 13+ lo pregunta; en versiones anteriores, abre los ajustes) */
export async function requestPermission() {
  const st = await refreshState();
  if (st?.notificaciones) return 'granted';
  if ((st?.android ?? 33) >= 33) {
    const r = await Alarmas.requestPermissions({ permissions: ['avisos'] }).catch(() => null);
    if (r?.avisos === 'granted') {
      await refreshState();
      return 'granted';
    }
  }
  await Alarmas.abrirAjustes({ tipo: 'avisos' });
  return 'default';
}

export const openSettings = (tipo) => Alarmas?.abrirAjustes({ tipo });

/** Prueba de un nivel: ahora mismo o dentro de unos segundos (para probar con la app cerrada) */
export function test(level, seconds = 0) {
  return Alarmas?.probar({
    nivel: level, segundos: seconds,
    titulo: `Prueba: ${LEVELS[level]?.label ?? level}`,
    texto: seconds ? 'Aviso programado con la app cerrada: funciona.' : 'Así sonará este aviso',
  });
}

// ---------------- Versiones nuevas (GitHub) ----------------

let buildInfo = null;
export const buildInfoSync = () => buildInfo;
export async function getBuildInfo() {
  if (!isNative) return null;
  buildInfo ??= await fetch('apk-version.json').then((r) => r.json()).catch(() => ({}));
  return buildInfo;
}

/** Comprueba si hay un APK más nuevo publicado en GitHub. Devuelve {version, url} o null. */
export async function checkUpdate() {
  const info = await getBuildInfo();
  if (!info?.repo) return null;
  const r = await fetch(`https://api.github.com/repos/${info.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
  const j = await r.json();
  const latest = parseInt(String(j.tag_name ?? '').replace(/\D/g, ''), 10);
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now(), latest }));
  } catch { /* */ }
  if (!(latest > info.build)) return null;
  const asset = j.assets?.find((a) => a.name.endsWith('.apk'));
  return { version: latest, url: asset?.browser_download_url ?? `https://github.com/${info.repo}/releases/latest/download/Calendario.apk` };
}

/** Abre el enlace en el navegador del móvil (que descarga el APK) */
export function openExternal(url) {
  location.href = url;
}

// ---------------- Arranque ----------------

/**
 * @param {{ back: () => boolean, toast: Function }} hooks
 *   back(): cierra lo que haya abierto (menú, ventana, barra lateral); devuelve false si no había nada
 */
export async function init({ back, toast }) {
  if (!isNative) return;
  document.documentElement.classList.add('native');
  // Programar al abrir, tras cada cambio (también los que llegan sincronizados) y al volver a la app
  store.onDataChange(() => scheduleSoon());
  store.subscribe((info) => info?.label === 'sync' && scheduleSoon());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && scheduleSoon(800));
  setTimeout(reschedule, 1200);

  App?.addListener('backButton', () => {
    if (!back()) App.minimizeApp();
  });

  // Pedir permiso de notificaciones la primera vez
  const st = await refreshState();
  if (st && !st.notificaciones) {
    toast('Para que suenen los avisos, la app necesita permiso de notificaciones', {
      actionLabel: 'Permitir', timeout: 20000, action: () => requestPermission().then(reschedule),
    });
  } else if (st && !st.exactas) {
    toast('Permite las «alarmas y recordatorios» para que los avisos suenen a su hora exacta', {
      actionLabel: 'Permitir', timeout: 20000, action: () => openSettings('exactas'),
    });
  }

  // Versión nueva: como mucho una comprobación cada 12 h
  let last = null;
  try {
    last = JSON.parse(localStorage.getItem(UPDATE_KEY));
  } catch { /* */ }
  if (!last || Date.now() - last.at > 12 * 3600e3) {
    setTimeout(() => checkUpdate().then((u) => u && toast(`Hay una versión nueva de la app (v${u.version})`, {
      actionLabel: 'Descargar', timeout: 30000, action: () => openExternal(u.url),
    })).catch(() => {}), 6000);
  }
}
