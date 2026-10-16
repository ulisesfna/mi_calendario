// Interfaz de la sincronización: contraseña de cifrado, estado y sección de Ajustes.
import * as sync from '../sync.js';
import { openModal, toast } from './dom.js';
import { esc, fmtRelative } from '../util.js';

/** Pide la contraseña de cifrado. mode: 'create' (nueva, dos veces) | 'unlock' */
function askPassphrase({ mode, email, error }) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title: mode === 'create' ? 'Crea tu contraseña de cifrado' : 'Contraseña de cifrado',
      onClose: () => resolve(result),
      build(body, close) {
        body.innerHTML = `<form class="pass-form" autocomplete="on">
          <input type="email" name="username" value="${esc(email ?? '')}" autocomplete="username" hidden>
          ${mode === 'create'
            ? `<p>Tus datos se cifrarán <b>en este dispositivo</b> antes de subirse a Google Drive. Ni Google ni nadie más puede leerlos sin esta contraseña.</p>
               <p class="warn-box">⚠️ Si la olvidas no se puede recuperar lo que hay en la nube (lo guardado en tus dispositivos seguirá ahí). Apúntala en un lugar seguro.</p>`
            : `<p>Ya hay datos cifrados en la cuenta <b>${esc(email ?? '')}</b>. Escribe la contraseña de cifrado que pusiste en tu otro dispositivo.</p>`}
          ${error ? `<p class="error-box">${esc(error)}</p>` : ''}
          <label class="field">Contraseña<input class="input" type="password" name="p1" minlength="${mode === 'create' ? 8 : 1}" required autocomplete="${mode === 'create' ? 'new-password' : 'current-password'}" autofocus></label>
          ${mode === 'create' ? '<label class="field">Repítela<input class="input" type="password" name="p2" required autocomplete="new-password"></label>' : ''}
          <label class="check small"><input type="checkbox" data-show> Mostrar</label>
          <p class="muted small" data-msg></p>
          <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">${mode === 'create' ? 'Cifrar y sincronizar' : 'Desbloquear'}</button></div>
        </form>`;
        const f = body.querySelector('form');
        body.querySelector('[data-show]').onchange = (e) => f.querySelectorAll('input[type=password], input[data-pw]').forEach((i) => {
          i.type = e.target.checked ? 'text' : 'password';
          i.dataset.pw = '1';
        });
        f.onsubmit = (e) => {
          e.preventDefault();
          const p1 = f.p1.value;
          if (mode === 'create') {
            if (p1.length < 8) return (body.querySelector('[data-msg]').textContent = 'Usa al menos 8 caracteres (mejor una frase).');
            if (p1 !== f.p2.value) return (body.querySelector('[data-msg]').textContent = 'Las dos contraseñas no coinciden.');
          }
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
  'needs-auth': '☁️ Toca para sincronizar',
  'needs-pass': '🔒 Falta la contraseña de cifrado',
  error: '⚠️ Error al sincronizar',
};

export function statusLine(s = sync.getStatus()) {
  let t = STATE_TEXT[s.state] ?? '';
  if (s.state === 'idle' && s.lastSync) t += ` · ${fmtRelative(s.lastSync - Date.now())}`;
  if (s.pending && s.state !== 'syncing') t += ' · cambios por subir';
  return t;
}

/** Acción del botón de estado (barra lateral) */
export async function statusAction(openSettings) {
  const s = sync.getStatus();
  try {
    if (!s.enabled) return openSettings();
    if (s.state === 'needs-pass') return await sync.unlockAgain();
    await sync.syncNow({ interactive: true });
    const after = sync.getStatus();
    if (after.state === 'error') toast(after.error);
  } catch (e) {
    toast(e.message);
  }
}

export function settingsHTML() {
  const s = sync.getStatus();
  const origin = location.origin;
  return `<fieldset class="box" data-sync><legend>🔄 Sincronización entre dispositivos</legend>
    <p class="muted small">Con tu cuenta de Google. Todo se cifra en el dispositivo con tu contraseña (AES-256) y se guarda en una carpeta oculta de tu Drive que solo ve esta app.</p>
    ${!s.configured ? `<div class="warn-box small">Falta el <b>ID de cliente de Google</b> (se crea una vez, gratis; pasos en <code>LEEME.md</code> → «Sincronización»).
        Orígenes autorizados que tendrás que poner: <code>${esc(origin)}</code></div>
      <div class="row"><input class="input grow" name="clientId" placeholder="xxxxxxxx.apps.googleusercontent.com"><button type="button" class="btn" data-sync-act="save-id">Guardar</button></div>`
    : !s.enabled ? `<button type="button" class="btn primary" data-sync-act="connect">Conectar con Google</button>
      <details class="small"><summary>ID de cliente</summary><div class="row"><input class="input grow" name="clientId" value="${esc(sync.clientId())}"><button type="button" class="btn small" data-sync-act="save-id">Guardar</button></div></details>`
    : `<div class="row center wrap"><b>${esc(s.email ?? 'Cuenta de Google')}</b><span class="muted small">${esc(statusLine(s))}</span></div>
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
      if (act === 'save-id') {
        const v = root.querySelector('[name=clientId]').value.trim();
        if (!/\.apps\.googleusercontent\.com$/.test(v)) return toast('Ese no parece un ID de cliente (acaba en .apps.googleusercontent.com)');
        sync.setClientId(v);
        toast('ID de cliente guardado');
      } else if (act === 'connect') {
        await sync.connect();
        toast('Sincronización activada');
      } else if (act === 'now') {
        await sync.syncNow({ interactive: true });
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
