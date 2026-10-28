// Ajustes: apariencia, avisos, periodos festivos y copias de seguridad.
import * as store from '../store.js';
import { LEVELS, SOUNDS, playSound, requestPermission, test as testLevel, upcoming, describeReminder } from '../notify.js';
import { exportICS } from '../ics.js';
import { openModal, toast, confirmDialog, ctx } from './dom.js';
import { remindersHTML, wireReminders } from './reminders-ui.js';
import { settingsHTML as syncSettingsHTML, wireSettings as wireSyncSettings } from './syncui.js';
import * as push from '../push.js';
import * as native from '../native.js';

const when = (t) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** App de Android: estado de las alarmas del móvil y de los permisos que necesitan */
function nativeHTML() {
  const st = native.state() ?? {};
  const ok = (v) => (v ? '✅' : '❌');
  const xiaomi = /xiaomi|redmi|poco/i.test(st.fabricante ?? '');
  return `<div class="push-box" data-native>
    <div class="field">📲 Alarmas del móvil (suenan con la app cerrada)</div>
    <p class="small">${st.programados ?? 0} avisos programados (45 días)${st.siguiente ? ` · el siguiente: ${esc(when(st.siguiente))}` : ''}</p>
    ${st.error ? `<p class="error-box small">${esc(st.error)}</p>` : ''}
    <div class="diag">
      <div class="diag-row ${st.notificaciones ? 'ok' : 'bad'}"><span class="diag-i">${ok(st.notificaciones)}</span><div><b>Notificaciones permitidas</b>
        ${st.notificaciones ? '' : '<div><button type="button" class="btn small primary" data-native-act="perm">Permitir</button></div>'}</div></div>
      <div class="diag-row ${st.exactas ? 'ok' : 'bad'}"><span class="diag-i">${ok(st.exactas)}</span><div><b>Alarmas a la hora exacta</b>
        ${st.exactas ? '' : '<div class="small">Sin este permiso, Android puede retrasar los avisos unos minutos.</div><div><button type="button" class="btn small primary" data-native-act="exactas">Permitir «Alarmas y recordatorios»</button></div>'}</div></div>
      <div class="diag-row ${st.bateria ? 'ok' : 'info'}"><span class="diag-i">${st.bateria ? '✅' : 'ℹ️'}</span><div><b>Sin restricciones de batería</b>
        ${st.bateria ? '' : '<div class="small">Recomendado: así el ahorro de batería no retrasa ni bloquea las alarmas.</div><div><button type="button" class="btn small" data-native-act="bateria">Quitar restricción</button></div>'}</div></div>
      ${xiaomi ? `<div class="diag-row info"><span class="diag-i">ℹ️</span><div><b>Xiaomi: activa «Inicio automático»</b>
        <div class="small">Sin él, tras reiniciar el móvil las alarmas no vuelven hasta que abras la app. En la ficha de la app: <b>Inicio automático</b> → activado, y <b>Ahorro de batería</b> → <b>Sin restricciones</b>.</div>
        <div><button type="button" class="btn small" data-native-act="app">Abrir la ficha de la app</button></div></div></div>` : ''}
    </div>
    <div class="row wrap">
      <button type="button" class="btn small" data-native-act="test-closed">Probar con la app cerrada (alarma en 1 min)</button>
      <button type="button" class="btn small" data-native-act="resched">Volver a programar</button>
      <button type="button" class="btn small" data-native-act="channels">Sonidos de Android</button>
    </div>
  </div>`;
}

/** Enlace al APK (solo en el navegador de un Android, si la app está publicada en GitHub Pages) */
function apkLink() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? `https://github.com/${m[1]}/${repo}/releases/latest/download/Calendario.apk` : null;
}

/** Avisos con la app cerrada (Web Push con el servidor de avisos) */
function pushHTML() {
  if (native.isNative) return nativeHTML();
  const p = push.status();
  if (!p.supported) return '<p class="muted small">Este navegador no admite avisos con la app cerrada.</p>';
  const when = p.lastUpload ? new Date(p.lastUpload).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  return `<div class="push-box" data-push>
    <div class="field">📲 Avisos con la app cerrada</div>
    ${p.enabled
      ? `<p class="small">✅ Activados en este dispositivo · ${p.count} avisos programados (30 días) · actualizado ${esc(when)}</p>
         ${p.error ? `<p class="error-box small">${esc(p.error)}</p>` : ''}
         <div class="row wrap">
           <button type="button" class="btn small" data-push-act="test">Enviar prueba (llega en 1–2 min)</button>
           <button type="button" class="btn small" data-push-act="upload">Actualizar ahora</button>
           <button type="button" class="btn small danger" data-push-act="disable">Desactivar</button>
         </div>
         <div class="row wrap">
           <button type="button" class="btn small" data-push-act="diagnose">🩺 Diagnóstico</button>
           <button type="button" class="btn small" data-push-act="local">Notificación ahora (sin servidor)</button>
         </div>`
      : `<p class="muted small">Necesita el servidor de avisos gratuito (README → «Avisos con la app cerrada»). Solo guarda horas y textos cifrados.</p>
         <div class="row"><input class="input grow" name="pushUrl" placeholder="https://calendario-avisos.TU-USUARIO.workers.dev" value="${esc(p.url)}">
         <button type="button" class="btn primary" data-push-act="enable">Activar</button></div>
         ${p.error ? `<p class="error-box small">${esc(p.error)}</p>` : ''}
         <div class="row wrap">
           <button type="button" class="btn small" data-push-act="diagnose">🩺 Diagnóstico</button>
           <button type="button" class="btn small" data-push-act="local">Notificación ahora (sin servidor)</button>
         </div>`}
  </div>`;
}

/** Instalar como aplicación (Android/escritorio: botón; iPhone: instrucciones) */
function installHTML() {
  if (native.isNative) return '';
  const apk = apkLink();
  const apkHTML = apk ? `<p class="small"><b>Android:</b> mejor la app propia (APK), con alarmas de verdad que suenan aunque no haya internet:
      <a href="${esc(apk)}">descargar Calendario.apk</a>. Si ya la tienes, desinstala esta versión web del móvil para no recibir los avisos dos veces.</p>` : '';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return apkHTML && /android/i.test(navigator.userAgent) ? `<fieldset class="box"><legend>📱 App para Android</legend>${apkHTML}</fieldset>` : '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return `<fieldset class="box"><legend>📲 Instalar como aplicación</legend>
    ${apkHTML}
    ${ctx.canInstall ? '<button type="button" class="btn primary" data-install>Instalar en este dispositivo</button>'
      : ios ? '<p class="small">En Safari: botón <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>.</p>'
      : '<p class="small">Como aplicación web, en Chrome: menú <b>⋮</b> → <b>Instalar aplicación</b> o <b>Añadir a pantalla de inicio</b>. Tiene que abrirse desde una dirección <code>https://</code> (por ejemplo GitHub Pages).</p>'}
  </fieldset>`;
}

/** Versión de la app de Android y botón para buscar una nueva */
function versionHTML() {
  if (!native.isNative) return '';
  const b = native.buildInfoSync();
  return `<fieldset class="box"><legend>📱 Versión de la app</legend>
    <div class="row wrap center"><span class="small">${b?.build ? `Versión ${b.build}${b.date ? ` (${esc(b.date)})` : ''}` : 'Versión de desarrollo'}</span>
    <button type="button" class="btn small" data-native-act="update">Buscar actualización</button></div>
  </fieldset>`;
}
import { download, esc, fmtDate, fmtTime, parseLocal, readFileText, uid, dateKey } from '../util.js';

export function openSettings() {
  openModal({
    title: 'Ajustes',
    wide: true,
    build(body, close) {
      const render = () => {
        const s = store.get().settings;
        const perm = 'Notification' in window ? Notification.permission : 'unsupported';
        const permTxt = { granted: '✅ Permitidas', denied: '⛔ Bloqueadas (cámbialo en los permisos del navegador)', default: '⚠️ Aún sin permiso', unsupported: '❌ Este navegador no las soporta' }[perm];
        const next = upcoming(72).slice(0, 12);
        body.innerHTML = `<div class="settings">
          ${syncSettingsHTML()}
          ${installHTML()}
          <fieldset class="box"><legend>🔔 Avisos</legend>
            ${native.isNative ? '' : `<div class="row wrap center">Notificaciones del sistema: <b>${permTxt}</b>
              ${perm === 'default' ? '<button class="btn primary small" data-act="perm">Permitir notificaciones</button>' : ''}</div>`}
            ${pushHTML()}
            <div class="muted small">Prueba cada intensidad:</div>
            <div class="chips">${Object.entries(LEVELS).map(([k, l]) => `<button class="chipbtn" data-test="${k}">${l.icon} ${l.short}</button>`).join('')}</div>
            <div class="row wrap">
              <label class="field">Sonido de alarma<select class="input" name="alarmSound">${Object.entries(SOUNDS).map(([k, l]) => `<option value="${k}" ${s.alarmSound === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <button class="btn self-end" data-act="play">▶ Escuchar</button>
              <label class="field">Volumen<input type="range" min="0" max="1" step="0.05" name="alarmVolume" value="${s.alarmVolume}"></label>
              <label class="field">Repetir la persistente cada (min)<input type="number" min="1" max="60" class="input num" name="persistentRepeatMin" value="${s.persistentRepeatMin}"></label>
            </div>
            <details><summary>Patrones de vibración (ms vibrando, pausa, vibrando…)</summary>
              ${['vibrate', 'sound', 'alarm', 'persistent'].map((k) => `<label class="field">${LEVELS[k].icon} ${LEVELS[k].short}<input class="input" data-vib="${k}" value="${(s.vibration[k] ?? []).join(', ')}"></label>`).join('')}
            </details>
            <div class="field">Avisos por defecto (para categorías sin avisos propios)</div>
            <div data-defrem>${remindersHTML(s.defaultReminders)}</div>
            <div class="field">✅ Avisos de las tareas (por defecto, a la hora en que empiezan)</div>
            <div data-taskrem>${remindersHTML(s.taskReminders)}</div>
            <div class="field">🗺️ Avisos de los plannings (por defecto, al acabar cada sesión)</div>
            <div data-planrem>${remindersHTML(s.planReminders)}</div>
            <div class="field">📝 Avisos de los exámenes (se aplican solos a los exámenes importados o marcados como examen)</div>
            <div data-examrem>${remindersHTML(s.examReminders)}</div>
            <details><summary>Próximos avisos (72 h): ${next.length}</summary>
              ${next.map((d) => `<div class="small">${fmtDate(new Date(d.at))} ${fmtTime(new Date(d.at))} — ${esc(d.inst.title)} <span class="muted">(${esc(describeReminder(d.r))})</span></div>`).join('') || '<div class="muted small">Ninguno.</div>'}
            </details>
            ${native.isNative
              ? `<p class="muted small">Cada nivel tiene su propio sonido en Android («Sonidos de Android» para cambiarlos). Las alarmas suenan con el
                 volumen de alarma, aunque el móvil esté en silencio: la normal durante 3 minutos y la persistente hasta que pulses «Parar»
                 (se repite cada pocos minutos). El sonido de alarma y los patrones de vibración de abajo solo se usan en el navegador.</p>`
              : `<p class="muted small">Con la app abierta, cada nivel suena y vibra como lo has configurado. Con la app cerrada (avisos del
                 servidor), Android usa el sonido y la vibración de las notificaciones de Chrome; las alarmas quedan fijas en pantalla y
                 las persistentes se repiten cada pocos minutos hasta que las pares.</p>`}
          </fieldset>
          ${versionHTML()}

          <fieldset class="box"><legend>🎨 Apariencia</legend>
            <div class="row wrap">
              <label class="field">Tema<select class="input" name="theme">
                <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Automático</option>
                <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Claro</option>
                <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Oscuro</option></select></label>
              <label class="field">Estilo de eventos<select class="input" name="eventStyle">
                <option value="solid" ${s.eventStyle === 'solid' ? 'selected' : ''}>Color sólido</option>
                <option value="soft" ${s.eventStyle === 'soft' ? 'selected' : ''}>Suave (fondo claro)</option></select></label>
              <label class="field">Texto en la vista mes<select class="input" name="monthText">
                <option value="full" ${s.monthText === 'full' ? 'selected' : ''}>Hora y título</option>
                <option value="short" ${s.monthText === 'short' ? 'selected' : ''}>Solo título</option>
                <option value="color" ${s.monthText === 'color' ? 'selected' : ''}>Solo color</option></select></label>
              <label class="field">La semana empieza<select class="input" name="weekStart">
                <option value="1" ${s.weekStart === 1 ? 'selected' : ''}>Lunes</option>
                <option value="0" ${s.weekStart === 0 ? 'selected' : ''}>Domingo</option></select></label>
              <label class="field">Vista inicial<select class="input" name="defaultView">
                ${[['day', 'Día'], ['3day', '3 días'], ['week', 'Semana'], ['month', 'Mes'], ['agenda', 'Agenda'], ['planning', 'Planning']].map(([v, l]) => `<option value="${v}" ${s.defaultView === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            </div>
            <div class="row wrap">
              <label class="field">Primera hora visible<input type="number" min="0" max="23" class="input num" name="dayStart" value="${s.dayStart}"></label>
              <label class="field">Última hora visible<input type="number" min="1" max="24" class="input num" name="dayEnd" value="${s.dayEnd}"></label>
              <label class="field">Ir a las (al abrir)<input type="number" min="0" max="23" class="input num" name="scrollTo" value="${s.scrollTo}"></label>
              <label class="field">Altura de cada hora (px)<input type="range" min="28" max="120" name="hourHeight" value="${s.hourHeight}"></label>
              <label class="field">Duración por defecto (min)<input type="number" min="5" step="5" class="input num" name="defaultDuration" value="${s.defaultDuration}"></label>
            </div>
          </fieldset>

          <fieldset class="box"><legend>🏖️ Periodos festivos / sin clases</legend>
            <p class="muted small">Las categorías con «Respetar periodos festivos» no se repiten en estas fechas (vacaciones de Navidad, Semana Santa, exámenes…).</p>
            <div class="tags">${(s.holidays ?? []).map((h, i) => `<span class="tag">${esc(h.label || 'Festivo')}: ${fmtDate(parseLocal(h.from))}${h.to !== h.from ? ' → ' + fmtDate(parseLocal(h.to)) : ''} <button data-del-hol="${i}">✕</button></span>`).join('') || '<span class="muted small">Ninguno.</span>'}</div>
            <div class="row wrap"><input class="input" name="holLabel" placeholder="Nombre (p. ej. Navidad)"><input type="date" class="input" name="holFrom"> → <input type="date" class="input" name="holTo"><button class="btn small" data-act="add-hol">Añadir</button></div>
          </fieldset>

          <fieldset class="box"><legend>💾 Datos</legend>
            <p class="muted small">Todo se guarda en este dispositivo. Haz copias para pasarlas a otro (móvil ↔ ordenador).</p>
            <div class="row wrap">
              <button class="btn" data-act="export-json">⬇ Copia de seguridad (.json)</button>
              <label class="btn">⬆ Restaurar copia<input type="file" accept=".json,application/json" hidden data-import-json></label>
              <button class="btn" data-act="export-ics">⬇ Exportar a .ics (Google Calendar)</button>
              <button class="btn danger" data-act="wipe">Borrar todo</button>
            </div>
          </fieldset>
        </div>`;
      };

      const set = (k, v) => store.quiet((st) => (st.settings[k] = v), true);
      wireSyncSettings(body, render);
      if (native.isNative) {
        // Estado real de los permisos (puede haber cambiado en los ajustes de Android)
        Promise.all([native.refreshState(), native.getBuildInfo()]).then(render);
        const onVisible = () => {
          if (!body.isConnected) return document.removeEventListener('visibilitychange', onVisible);
          if (document.visibilityState === 'visible') native.refreshState().then(render);
        };
        document.addEventListener('visibilitychange', onVisible);
        body.addEventListener('click', async (e) => {
          const act = e.target.closest('[data-native-act]')?.dataset.nativeAct;
          if (!act) return;
          try {
            if (act === 'perm') await native.requestPermission();
            else if (act === 'exactas' || act === 'bateria' || act === 'app') await native.openSettings(act);
            else if (act === 'channels') await native.openSettings('avisos');
            else if (act === 'resched') {
              const r = await native.reschedule();
              toast(r?.error ?? `${r?.programados ?? 0} avisos programados en el móvil`);
            } else if (act === 'test-closed') {
              await native.test('alarm', 60);
              toast('Alarma de prueba dentro de 1 minuto: cierra la app y bloquea el móvil', { timeout: 8000 });
            } else if (act === 'update') {
              const u = await native.checkUpdate();
              if (u) toast(`Hay una versión nueva (v${u.version})`, { actionLabel: 'Descargar', timeout: 30000, action: () => native.openExternal(u.url) });
              else toast('Ya tienes la última versión');
            }
          } catch (err) {
            toast(err.message ?? String(err), { timeout: 8000 });
          }
          await native.refreshState();
          render();
        });
      }
      body.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-push-act]')?.dataset.pushAct;
        if (!act) return;
        const btn = e.target.closest('button');
        btn.disabled = true;
        try {
          if (act === 'enable') {
            const u = body.querySelector('[name=pushUrl]')?.value.trim();
            if (!/^https:\/\/.+/.test(u ?? '')) throw new Error('Pon la dirección https:// de tu servidor de avisos');
            push.setServerUrl(u);
            await push.enable();
            toast('Avisos con la app cerrada activados');
          } else if (act === 'test') {
            await push.sendTest();
            toast('Prueba programada: cierra la app y espera 1–2 minutos', { timeout: 8000 });
          } else if (act === 'upload') {
            await push.uploadNow();
            toast(push.status().error ?? 'Avisos actualizados');
          } else if (act === 'disable') {
            await push.disable();
            toast('Avisos con la app cerrada desactivados en este dispositivo');
          } else if (act === 'local') {
            await push.localTest();
            toast('Notificación enviada: mira la barra de notificaciones');
          } else if (act === 'diagnose') {
            const list = await push.diagnose();
            btn.disabled = false;
            return openModal({
              title: '🩺 Diagnóstico de avisos',
              build(b) {
                b.innerHTML = `<div class="diag">${list.map((x) => `<div class="diag-row ${x.ok === true ? 'ok' : x.ok === false ? 'bad' : 'info'}">
                    <span class="diag-i">${x.ok === true ? '✅' : x.ok === false ? '❌' : 'ℹ️'}</span>
                    <div><b>${esc(x.label)}</b>${x.detail ? `<div class="small muted">${esc(String(x.detail))}</div>` : ''}
                    ${x.ok === false && x.hint ? `<div class="small diag-hint">👉 ${esc(x.hint)}</div>` : ''}</div></div>`).join('')}</div>
                  <p class="muted small">Haz una captura de esta pantalla si necesitas ayuda.</p>`;
              },
            });
          }
        } catch (err) {
          toast(err.message, { timeout: 8000 });
        }
        render();
      });
      body.addEventListener('click', (e) => e.target.closest('[data-install]') && ctx.promptInstall?.());

      body.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.closest('[data-sync]') || t.closest('[data-push]')) return;
        if (t.dataset.vib) {
          const pat = t.value.split(/[\s,;]+/).map(Number).filter((n) => n >= 0 && Number.isFinite(n));
          store.quiet((st) => (st.settings.vibration[t.dataset.vib] = pat));
          return;
        }
        if (t.matches('[data-import-json]')) {
          const f = t.files[0];
          if (!f) return;
          try {
            const data = JSON.parse(await readFileText(f));
            if (!Array.isArray(data.items) || !Array.isArray(data.categories)) throw new Error('formato');
            if (!(await confirmDialog(`Esto sustituirá tus datos por los de la copia (${data.items.length} elementos, ${data.categories.length} categorías). ¿Seguir?`, { okLabel: 'Restaurar', danger: true }))) return;
            store.replaceAll(data);
            toast('Copia restaurada', { action: ctx.undo });
            render();
          } catch {
            toast('Ese archivo no es una copia válida');
          }
          return;
        }
        const num = ['weekStart', 'dayStart', 'dayEnd', 'scrollTo', 'hourHeight', 'defaultDuration', 'persistentRepeatMin', 'alarmVolume'];
        if (!t.name || t.name.startsWith('hol')) return;
        let v = num.includes(t.name) ? +t.value : t.value;
        if (t.name === 'dayEnd') v = Math.max(v, (store.get().settings.dayStart ?? 0) + 1);
        set(t.name, v);
        if (t.name === 'theme') ctx.applyTheme();
      });
      body.addEventListener('input', (e) => {
        if (e.target.name === 'hourHeight') set('hourHeight', +e.target.value);
      });
      // Las listas se editan en sitio; quiet() guarda y fecha el cambio para sincronizarlo
      const saveSettings = () => store.quiet(() => {});
      wireReminders(body, () => store.get().settings.defaultReminders, () => {
        saveSettings();
        render();
      }, saveSettings, '[data-defrem]');
      wireReminders(body, () => (store.get().settings.taskReminders ??= []), () => {
        saveSettings();
        render();
      }, saveSettings, '[data-taskrem]');
      wireReminders(body, () => (store.get().settings.planReminders ??= []), () => {
        saveSettings();
        render();
      }, saveSettings, '[data-planrem]');
      wireReminders(body, () => (store.get().settings.examReminders ??= []), () => {
        saveSettings();
        render();
      }, saveSettings, '[data-examrem]');

      body.addEventListener('click', async (e) => {
        const t = e.target;
        const tst = t.closest('[data-test]');
        if (tst) return testLevel(tst.dataset.test);
        const dh = t.closest('[data-del-hol]');
        if (dh) {
          store.quiet((st) => st.settings.holidays.splice(+dh.dataset.delHol, 1), true);
          return render();
        }
        const act = t.closest('[data-act]')?.dataset.act;
        switch (act) {
          case 'perm':
            await requestPermission();
            return render();
          case 'play':
            return playSound(store.get().settings.alarmSound);
          case 'add-hol': {
            const q = (n) => body.querySelector(`[name=${n}]`).value;
            const from = q('holFrom'), to = q('holTo') || from;
            if (!from) return toast('Indica al menos la fecha de inicio');
            store.quiet((st) => st.settings.holidays.push({ id: uid(), label: q('holLabel'), from: from < to ? from : to, to: from < to ? to : from }), true);
            return render();
          }
          case 'export-json': {
            const st = store.get();
            return download(`calendario-${dateKey(new Date())}.json`, JSON.stringify({ app: 'calendario-tareas', version: 1, categories: st.categories, items: st.items, settings: st.settings }, null, 1), 'application/json');
          }
          case 'export-ics':
            return download(`calendario-${dateKey(new Date())}.ics`, exportICS(store.get().items.filter((i) => i.start && store.inAgenda(i))), 'text/calendar');
          case 'wipe':
            if (await confirmDialog('¿Borrar todos los eventos, tareas, plannings y categorías? (Podrás deshacerlo justo después)', { okLabel: 'Borrar todo', danger: true })) {
              store.mutate('Borrar todo', (st) => {
                st.items = [];
                st.categories = [];
              });
              toast('Todo borrado', { action: ctx.undo });
              close();
            }
        }
      });
      render();
    },
  });
}
