// Tu servidor (Cloudflare Worker): avisos con la app cerrada en el navegador y sincronización cifrada.
import { PUSH_SERVER_URL } from './config.js';

const KEY = 'cdt.server';

export function serverUrl() {
  let u = null;
  try {
    u = localStorage.getItem(KEY) || JSON.parse(localStorage.getItem('cdt.push'))?.url;
  } catch { /* */ }
  return (u || PUSH_SERVER_URL || '').replace(/\/+$/, '');
}

/** Guarda solo el origen (https://…workers.dev), aunque se pegue con /vapid u otra ruta detrás */
export function setServerUrl(u) {
  let url = u.trim();
  try {
    url = new URL(url).origin;
  } catch { /* se valida al usarla */ }
  try {
    localStorage.setItem(KEY, url);
  } catch { /* */ }
}

/** Petición al servidor. Con `allow` se devuelven sin error las respuestas con esos códigos. */
export async function api(path, body, { allow = [] } = {}) {
  const base = serverUrl();
  if (!base) throw new Error('Falta la dirección de tu servidor (Ajustes → Sincronización)');
  let r;
  try {
    r = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  } catch {
    throw new Error(`No se puede conectar con ${base}. Revisa la conexión a internet y la dirección del servidor.`);
  }
  const text = await r.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch { /* no es JSON */ }
  if (!j) {
    const hint = /hello world/i.test(text)
      ? 'El Worker todavía tiene el código de ejemplo: en Cloudflare, «Edit code», pega worker.js y pulsa «Deploy».'
      : 'Esa dirección no responde como tu servidor. Comprueba que es la de tu Worker y que tiene pegado worker.js.';
    throw new Error(hint);
  }
  if (allow.includes(r.status)) return { ...j, status: r.status };
  if (r.status === 404 && path.startsWith('/sync')) {
    throw new Error('Tu servidor tiene el código antiguo: en Cloudflare, «Edit code», pega el worker.js nuevo y pulsa «Deploy».');
  }
  if (!r.ok || j.error) throw new Error(j.error || `El servidor respondió ${r.status}`);
  return j;
}
