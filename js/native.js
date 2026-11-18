// App de Android (APK): alarmas del propio móvil, botón «atrás» y aviso de versiones nuevas.
// En el navegador (PWA) no hace nada: `isNative` es false.
import * as store from './store.js';
import { alarmKey, alarmText, completeTask, dueBetween, LEVELS } from './notify.js';
import { hasModal } from './ui/dom.js';

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
    out.push({
      id, at: d.at, titulo: title, texto: body, nivel: d.r.level || 'sound', clave: key, repetirMin: rep,
      // Las tareas llevan el botón «✔ Hecha» (inst = la aparición concreta que se completa)
      ...(d.inst.item.type === 'task' ? { tarea: true, inst: d.inst.id } : {}),
    });
    if (out.length >= MAX_ALARMS) break;
  }
  return out;
}

/**
 * Tareas marcadas como hechas desde la notificación (con la app cerrada o abierta): se apuntan aquí.
 * Va antes de programar, para no volver a programar avisos de tareas que ya están hechas.
 */
let toastFn = () => {};
async function collectDone() {
  let list = [];
  try {
    list = (await Alarmas.hechas())?.hechas ?? [];
  } catch { /* */ }
  const titles = list.map((id) => completeTask(id)).filter(Boolean);
  if (titles.length) toastFn(titles.length === 1 ? `✔ «${titles[0]}» marcada como hecha desde el aviso` : `✔ ${titles.length} tareas marcadas como hechas desde los avisos`, { timeout: 6000 });
}

export async function reschedule() {
  if (!isNative) return;
  clearTimeout(timer);
  await collectDone();
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

// ---------------- Sonido y volumen ----------------

export const ALARM_SOUNDS = { digital: 'Despertador digital', clasica: 'Pitidos en dos tonos', sirena: 'Sirena', campana: 'Campanas', suave: 'Melodía suave', sistema: 'La alarma del móvil' };
export const NOTIF_SOUNDS = { ding: 'Ding', doble: 'Dos notas', campana: 'Campanita', sistema: 'El sonido de notificación del móvil' };

/** Cambia sonido/volumen ({ alarma, aviso, volAlarma, volAviso, avisoFuerte }); devuelve el estado nuevo */
export async function configureSound(cfg) {
  lastState = { ...(lastState ?? {}), ...(await Alarmas.configurarSonido(cfg)) };
  return lastState;
}

/** Escucha el sonido elegido ('alarma' | 'aviso'); si ya sonaba, lo para. Devuelve true si está sonando. */
export async function listen(tipo) {
  return (await Alarmas.escuchar({ tipo }))?.sonando ?? false;
}

/** Selector de tonos de Android ('alarma' | 'aviso') */
export async function pickTone(tipo) {
  lastState = { ...(lastState ?? {}), ...(await Alarmas.elegirTono({ tipo })) };
  return lastState;
}

/**
 * Por qué podría no sonar un aviso: lista de { level: 'sound' | 'alarm', text, act? } a partir del estado del móvil
 * (modo silencio/vibración, volúmenes, No molestar y canales a los que se les ha quitado el sonido)
 */
export function soundProblems(st = lastState) {
  if (!st?.sonido) return [];
  const out = [];
  const s = st.sonido;
  const ch = st.canales ?? {};
  const off = (c) => c && c.existe && (c.importancia === 0 || !c.sonido);
  if (off(ch.sound)) out.push({ level: 'sound', text: 'En los ajustes de Android, el canal «Avisos con sonido» está sin sonido o desactivado.', act: 'channels' });
  if (off(ch.alarm) || off(ch.persistent)) out.push({ level: 'alarm', text: 'En los ajustes de Android, el canal «Alarmas» o «Alarmas persistentes» está sin sonido o desactivado.', act: 'channels' });
  if (!s.avisoFuerte) {
    if (st.modo === 'vibracion' || st.modo === 'silencio') {
      out.push({ level: 'sound', text: `Tu móvil está en modo ${st.modo === 'vibracion' ? 'vibración' : 'silencio'}: los avisos 🔔 solo vibran. Si quieres que suenen igualmente, marca «Que suenen aunque el móvil esté en silencio».` });
    } else if (st.volNotif === 0) {
      out.push({ level: 'sound', text: 'El volumen de notificaciones del móvil está a 0: los avisos 🔔 no se oyen.' });
    }
    if (st.noMolestar) out.push({ level: 'sound', text: '«No molestar» está activado: los avisos 🔔 no suenan (las alarmas sí, si «No molestar» deja pasar las alarmas).' });
  }
  if (s.volAlarma < 0 && st.maxAlarma && st.volAlarmaMovil / st.maxAlarma < 0.35) {
    out.push({ level: 'alarm', text: `El volumen de alarma del móvil está bajo (${st.volAlarmaMovil}/${st.maxAlarma}). Pon un volumen propio para las alarmas.` });
  }
  return out;
}

// ---------------- Versiones nuevas (GitHub) ----------------
// Cada vez que se suben cambios, GitHub publica el APK, la app web (web.zip) y version.json.
// · Si la parte nativa no ha cambiado, la app web nueva se descarga sola y se usa en lugar de la del
//   APK (sin instalar nada). Ver android-app/nativo/Actualizar.java.
// · Si ha cambiado, el APK se descarga e instala desde la propia app.

let buildInfo = null;
export const buildInfoSync = () => buildInfo;
/** { build: APK, web: versión de la app web en uso, nativo, date, self: admite actualizaciones propias } */
export async function getBuildInfo() {
  if (!isNative) return null;
  if (!buildInfo) {
    const file = await fetch('apk-version.json').then((r) => r.json()).catch(() => ({}));
    const v = await Alarmas.version().catch(() => null); // APK anteriores no lo tienen
    buildInfo = { ...file, web: file.build, ...(v ? { build: v.build, web: v.web, nativo: v.nativo, self: true } : {}) };
  }
  return buildInfo;
}

function saveCheck() {
  try {
    localStorage.setItem(UPDATE_KEY, JSON.stringify({ at: Date.now() }));
  } catch { /* */ }
}

/**
 * ¿Hay una versión nueva? Devuelve null o { version, kind, … }:
 * kind 'web' (se descarga sola), 'apk' (hay que instalar el APK) o 'link' (APK antiguo: abrir la descarga)
 */
export async function checkUpdate() {
  const info = await getBuildInfo();
  if (!info) return null;
  if (info.self) {
    const rel = await Alarmas.buscarVersion();
    saveCheck();
    if (!(rel.build > Math.max(info.web ?? 0, info.build ?? 0))) return null;
    if (rel.nativo === info.nativo && rel.web) return { version: rel.build, kind: 'web', rel };
    return { version: rel.build, kind: 'apk', url: rel.apk };
  }
  if (!info.repo) return null;
  const r = await fetch(`https://api.github.com/repos/${info.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
  const j = await r.json();
  saveCheck();
  const latest = parseInt(String(j.tag_name ?? '').replace(/\D/g, ''), 10);
  if (!(latest > info.build)) return null;
  return { version: latest, kind: 'link', url: `https://github.com/${info.repo}/releases/latest/download/Calendario.apk` };
}

/** Aplica una versión nueva. Web: la descarga y, con `now`, recarga la app con ella (si no, al volver a abrirla). */
export async function applyUpdate(u, { now = false } = {}) {
  if (u.kind === 'web') {
    await Alarmas.bajarWeb({ build: u.rel.build, web: u.rel.web, nativo: u.rel.nativo });
    if (now) await Alarmas.aplicarWeb({ build: u.rel.build });
    return;
  }
  if (u.kind === 'apk') return installApk(u.url);
  openExternal(u.url);
}

/** Descarga el APK desde la app (con el progreso) y abre el instalador de Android */
async function installApk(url) {
  const t = toastFn('Descargando la actualización… 0 %', { timeout: 0 });
  const h = await Alarmas.addListener('descarga', ({ pct }) => t?.set(`Descargando la actualización… ${pct} %`)).catch(() => null);
  try {
    await Alarmas.instalarApk({ url });
    t?.set('Instalando… (cuando acabe, ábrela desde la notificación)');
    setTimeout(() => t?.remove(), 10000);
  } catch (e) {
    t?.remove();
    throw e;
  } finally {
    h?.remove?.();
  }
}

/** Al abrir la app y al volver a ella (como mucho cada 30 min): buscar y descargar la versión nueva */
async function autoUpdate(justOpened) {
  let last = null;
  try {
    last = JSON.parse(localStorage.getItem(UPDATE_KEY));
  } catch { /* */ }
  if (last && Date.now() - last.at < 30 * 60e3) return;
  const u = await checkUpdate();
  if (!u) return;
  const fail = (e) => toastFn(e?.message ?? String(e), { timeout: 10000 });
  if (u.kind !== 'web') {
    toastFn(`Hay una versión nueva de la app (v${u.version})`, {
      actionLabel: 'Actualizar', timeout: 30000, action: () => applyUpdate(u).catch(fail),
    });
    return;
  }
  await applyUpdate(u); // descargada: si no se aplica ahora, se usará al volver a abrir la app
  const busy = hasModal() || document.activeElement?.matches?.('input, textarea, select') || document.visibilityState !== 'visible';
  if (justOpened && performance.now() < 30000 && !busy) {
    // Recién abierta y sin nada a medias: recargar ya con la versión nueva
    toastFn(`Actualizando a la versión ${u.version}…`, { timeout: 3000 });
    setTimeout(() => Alarmas.aplicarWeb({ build: u.version }).catch(fail), 1200);
  } else {
    toastFn(`Versión ${u.version} descargada`, {
      actionLabel: 'Aplicar ahora', timeout: 15000, action: () => Alarmas.aplicarWeb({ build: u.version }).catch(fail),
    });
  }
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
  toastFn = toast;
  // La app ha arrancado: si esta versión web es una descargada, se queda (si no llegara aquí,
  // la próxima vez que se abra la app se volvería sola a la versión que trae el APK)
  Alarmas.webOk().catch(() => {});
  document.documentElement.classList.add('native');
  // «✔ Hecha» pulsado con la app abierta: apuntarlo ya
  Alarmas.addListener?.('hechas', () => scheduleSoon(300));
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

  // Versiones nuevas: al abrir y al volver a la app (como mucho cada 30 min)
  Alarmas.addListener?.('instalacion', ({ error }) => error && toast(error, { timeout: 10000 }));
  setTimeout(() => autoUpdate(true).catch(() => {}), 4000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && autoUpdate(false).catch(() => {}));
}
