// Interfaz de la sincronización: contraseña, estado y sección de Ajustes.
import * as sync from '../sync.js';
import { setServerUrl } from '../server.js';
import { openModal, toast } from './dom.js';
import { esc, fmtRelative } from '../util.js';

/** Pide la contraseña. mode: 'enter' (conectar) | 'confirm-new' (repetirla para crear la copia) */
function askPassphrase({ mode, error }) {
  return new Promise((resolve) => {
    let result = null;
    const confirm = mode === 'confirm-new';
    openModal({
      title: confirm ? 'Primera vez con esta contraseña' : 'Contraseña de sincronización',
      onClose: () => resolve(result),
      build(body, close) {
        body.innerHTML = `<form class="pass-form" autocomplete="on">
          <input type="text" name="username" value="Mi calendario" autocomplete="username" hidden>
          ${confirm
            ? `<p>No hay datos guardados con esa contraseña.</p>
               <ul class="small"><li>Si es <b>tu primer dispositivo</b>, repítela para crear tu copia cifrada.</li>
               <li>Si ya tienes <b>otro dispositivo sincronizado</b>, pulsa «Cancelar»: la contraseña no es la misma que pusiste allí.</li></ul>
               <p class="warn-box">⚠️ Si la olvidas no se puede recuperar lo que hay en el servidor (lo guardado en tus dispositivos seguirá ahí). Apúntala en un lugar seguro.</p>`
            : `<p>La misma en todos tus dispositivos. Tus datos se cifran <b>en este dispositivo</b> con ella antes de subirse a tu servidor: nadie más puede leerlos.</p>
               <p class="muted small">Si es la primera vez, invéntala ahora (mejor una frase de varias palabras).</p>`}
          ${error ? `<p class="error-box">${esc(error)}</p>` : ''}
          <label class="field">${confirm ? 'Repítela' : 'Contraseña'}<input class="input" type="password" name="p1" minlength="8" required autocomplete="${confirm ? 'new-password' : 'current-password'}" autofocus></label>
          <label class="check small"><input type="checkbox" data-show> Mostrar</label>
          <p class="muted small" data-msg></p>
          <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">${confirm ? 'Crear y sincronizar' : 'Conectar'}</button></div>
        </form>`;
        const f = body.querySelector('form');
        body.querySelector('[data-show]').onchange = (e) => (f.p1.type = e.target.checked ? 'text' : 'password');
        f.onsubmit = (e) => {
          e.preventDefault();
          const p1 = f.p1.value;
          if (p1.length < 8) return (body.querySelector('[data-msg]').textContent = 'Usa al menos 8 caracteres (mejor una frase).');
          result = p1;
          close();
        };
      },
    });
  });
}

const STATE_TEXT = {
  off: '☁️ Sincronización desactivada',
  idle: '☁️ Sincronizado',
  syncing: '🔄 Sincronizando…',
  'needs-pass': '🔒 Falta la contraseña de sincronización',
  error: '⚠️ Error al sincronizar',
};

export function statusLine(s = sync.getStatus()) {
  let t = STATE_TEXT[s.state] ?? '';
  if (s.state === 'idle' && s.lastSync) t += ` · ${fmtRelative(s.lastSync - Date.now())}`;
  if (s.pending && s.enabled && s.state !== 'syncing') t += ' · cambios por subir';
  return t;
}

/** Acción del botón de estado (barra lateral) */
export async function statusAction(openSettings) {
  const s = sync.getStatus();
  try {
    if (!s.enabled) return openSettings();
    if (s.state === 'needs-pass') return await sync.unlockAgain();
    await sync.syncNow();
    const after = sync.getStatus();
    if (after.state === 'error') toast(after.error);
  } catch (e) {
    toast(e.message);
  }
}

export function settingsHTML() {
  const s = sync.getStatus();
  return `<fieldset class="box" data-sync><legend>🔄 Sincronización entre dispositivos</legend>
    <p class="muted small">A través de tu servidor de Cloudflare. Todo se cifra en el dispositivo con tu contraseña (AES-256): el servidor solo guarda texto ilegible.</p>
    ${s.wasGoogle && !s.enabled ? '<p class="warn-box small">La sincronización ya no usa Google. Pulsa «Conectar» y escribe tu contraseña de cifrado de siempre (o una nueva): con la misma en todos tus dispositivos, se juntan los datos.</p>' : ''}
    ${!s.enabled
      ? `<button type="button" class="btn primary" data-sync-act="connect">Conectar</button>
         <details class="small"><summary>Dirección del servidor</summary><div class="row"><input class="input grow" name="serverUrl" value="${esc(s.server)}" placeholder="https://calendario-avisos.TU-USUARIO.workers.dev"><button type="button" class="btn small" data-sync-act="save-url">Guardar</button></div></details>`
      : `<div class="row center wrap"><b>Conectado</b><span class="muted small">${esc(statusLine(s))}</span></div>
         ${s.error ? `<p class="error-box small">${esc(s.error)}</p>` : ''}
         <div class="row wrap">
           <button type="button" class="btn primary" data-sync-act="now">Sincronizar ahora</button>
           ${s.state === 'needs-pass' ? '<button type="button" class="btn" data-sync-act="unlock">Introducir contraseña</button>' : ''}
           <button type="button" class="btn danger" data-sync-act="disconnect">Desconectar este dispositivo</button>
         </div>`}
  </fieldset>`;
}

/** Conecta los botones de la sección de Ajustes; rerender() la repinta */
export function wireSettings(root, rerender) {
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-sync-act]')?.dataset.syncAct;
    if (!act) return;
    try {
      if (act === 'save-url') {
        const v = root.querySelector('[name=serverUrl]').value.trim();
        if (!/^https:\/\/.+/.test(v)) return toast('Pon la dirección https:// de tu servidor');
        setServerUrl(v);
        toast('Dirección guardada');
      } else if (act === 'connect') {
        await sync.connect();
        toast('Sincronización activada');
      } else if (act === 'now') {
        await sync.syncNow();
        const s = sync.getStatus();
        toast(s.state === 'idle' ? 'Sincronizado' : s.error ?? statusLine(s));
      } else if (act === 'unlock') {
        await sync.unlockAgain();
      } else if (act === 'disconnect') {
        await sync.disconnect();
        toast('Este dispositivo ya no se sincroniza (tus datos siguen aquí)');
      }
    } catch (err) {
      toast(err.message);
    }
    rerender();
  });
}

export function initSyncUI({ onChange }) {
  sync.setPassPrompt(askPassphrase);
  sync.onStatus(onChange);
  sync.init();
}
