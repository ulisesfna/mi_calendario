// Editor de eventos, tareas y plannings.
import * as store from '../store.js';
import * as engine from '../engine.js';
import { defaultRule, describeRule, nthOf, isLastWeekdayOfMonth } from '../recurrence.js';
import { LEVELS, UNITS, test as testLevel } from '../notify.js';
import { nextFreeColor, EMOJIS } from '../palette.js';
import { openModal, promptDialog, toast, ctx, floatingMenu } from './dom.js';
import { deleteInstance } from './popover.js';
import { colorButton, wireColorButtons } from './colorpicker.js';
import { categoryButtonHTML, openCategoryPicker } from './catpicker.js';
import {
  addDays, addMinutes, dateKey, DAY_LETTER, DAY_LONG, diffDays, esc, fmtDate, fmtTime, keyAddDays, parseLocal, startOfDay, toLocalISO, uid,
} from '../util.js';

const LAST_CAT = 'cdt.lastCategory';
const DUR_CHIPS = [15, 30, 45, 60, 90, 120, 180];

export function openEditor(opts = {}) {
  const existing = opts.itemId ? store.getItem(opts.itemId) : null;
  let w;
  if (existing) w = structuredClone(existing);
  else {
    let catId = opts.categoryId ?? null;
    if (catId === null) {
      try {
        catId = localStorage.getItem(LAST_CAT);
      } catch { /* */ }
      if (!store.getCategory(catId)) catId = store.get().categories[0]?.id ?? null;
    }
    const cat = store.getCategory(catId);
    const type = opts.type ?? cat?.defaultType ?? 'event';
    let start = null, allDay = !!opts.allDay, duration = opts.duration ?? cat?.defaultDuration ?? store.get().settings.defaultDuration ?? 60;
    // Eventos, tareas y plannings nacen con fecha (los plannings, con una sesión en la agenda)
    if (opts.date || type === 'event' || type === 'task' || type === 'plan') {
      const d = opts.date ? parseLocal(opts.date) : new Date();
      if (allDay) duration = 1440;
      else if (opts.minutes != null) d.setHours(0, opts.minutes, 0, 0);
      else if (!opts.date) d.setMinutes(Math.ceil((d.getMinutes() + 1) / 30) * 30, 0, 0); // próxima media hora
      else d.setHours(9, 0, 0, 0);
      start = allDay ? `${dateKey(d)}T00:00` : toLocalISO(d);
    }
    // Las tareas, por defecto, sin duración (en curso hasta completarlas), salvo que se haya
    // arrastrado un hueco concreto en el calendario
    const openEnd = type === 'task' && opts.duration == null && !opts.allDay;
    // Los plannings nuevos van siempre a la agenda (aunque su categoría esté fuera de ella)
    const inAgenda = type === 'plan' ? true : null;
    w = store.newItem({ type, title: opts.title ?? '', categoryId: catId, start, allDay, duration, openEnd, inAgenda, ...(opts.extra ?? {}) });
  }
  const isNew = !existing;
  // Edición de una sola aparición de una serie
  let mode = 'series';
  const occKey = existing?.recurrence && opts.instKey ? opts.instKey : null;
  let occ = occKey ? { ...(existing.overrides?.[occKey] ?? {}) } : null;
  const occInst = occKey ? engine.buildInstance(existing, occKey) : null;
  if (occKey && opts.preferOccurrence) mode = 'one';

  const title = isNew ? 'Nuevo' : 'Editar';
  openModal({
    title,
    wide: true,
    className: 'editor',
    build(body, close) {
      const render = (focusName) => {
        body.innerHTML = mode === 'one' ? occurrenceForm() : seriesForm();
        wireColorButtons(body, (c) => (w.color = c));
        const f = focusName ? body.querySelector(`[name="${focusName}"]`) : body.querySelector('[name=title]');
        if (f && (focusName || isNew)) {
          f.focus();
          if (f.setSelectionRange && f.type === 'text') f.setSelectionRange(f.value.length, f.value.length);
        }
      };

      // ---------- Formulario de una aparición ----------
      function occurrenceForm() {
        const s = occ.start ? parseLocal(occ.start) : occInst.start;
        const dur = occ.duration ?? existing.duration;
        return `${modeBanner()}
          <div class="field"><input class="input big" name="o_title" placeholder="${esc(existing.title)}" value="${esc(occ.title ?? '')}"></div>
          <div class="row wrap">
            <label class="field">Fecha<input type="date" class="input" name="o_date" value="${dateKey(s)}"></label>
            ${existing.allDay ? '' : `<label class="field">Inicio<input type="time" class="input" name="o_time" value="${fmtTime(s)}"></label>
            ${existing.openEnd ? '' : `<label class="field">Fin<input type="time" class="input" name="o_end" value="${fmtTime(addMinutes(s, dur))}"></label>`}`}
          </div>
          ${existing.type === 'task' ? `<label class="check"><input type="checkbox" name="o_done" ${occ.done ? 'checked' : ''}> Hecha</label>` : ''}
          <p class="muted small">Los cambios solo afectan al ${fmtDate(occInst.start)}. El resto de la serie queda igual.</p>
          <div class="modal-actions">
            <button class="btn danger" data-act="delete-one">Eliminar esta</button>
            ${occ.start || occ.title || occ.duration ? '<button class="btn" data-act="reset-one">Restablecer</button>' : ''}
            <span class="grow"></span>
            <button class="btn" data-close>Cancelar</button>
            <button class="btn primary" data-act="save">Guardar</button>
          </div>`;
      }

      function modeBanner() {
        if (!occKey) return '';
        return `<div class="seg mode-seg"><button class="${mode === 'series' ? 'on' : ''}" data-mode="series">↻ Toda la serie</button><button class="${mode === 'one' ? 'on' : ''}" data-mode="one">Solo el ${fmtDate(occInst.start)}</button></div>`;
      }

      // ---------- Formulario completo ----------
      function seriesForm() {
        const cat = store.getCategory(w.categoryId);
        const s = w.start ? parseLocal(w.start) : null;
        const typeSeg = `<div class="seg type-seg">
          ${[['event', '📅 Evento'], ['task', '✅ Tarea'], ['plan', '🗺️ Planning']].map(([v, l]) => `<button type="button" class="${w.type === v ? 'on' : ''}" data-type="${v}">${l}</button>`).join('')}</div>`;
        const head = `${modeBanner()}${typeSeg}
          <div class="title-row">
            <button type="button" class="emoji-btn" data-act="emoji" title="Icono">${w.icon || cat?.icon || '🙂'}</button>
            <input class="input big" name="title" placeholder="${w.type === 'task' ? 'Qué hay que hacer' : w.type === 'plan' ? 'Nombre del planning' : 'Título del evento'}" value="${esc(w.title)}" autocomplete="off">
          </div>
          <div class="row wrap">
            <div class="field grow">Categoría
              <div class="row">${categoryButtonHTML(w.categoryId)}
              <button type="button" class="btn" data-act="newcat" title="Crear categoría">＋</button></div></div>
            <label class="field">Color<div class="row">${colorButton('color', w.color)}${w.color ? '<button type="button" class="btn small" data-act="color-auto">Usar el de la categoría</button>' : ''}</div></label>
            ${w.color ? '' : `<label class="field">Tono<select class="input" name="shade">
              ${[[0.5, 'Mucho más claro'], [0.3, 'Más claro'], [0, 'Normal'], [-0.3, 'Más oscuro'], [-0.5, 'Mucho más oscuro']].map(([v, l]) => `<option value="${v}" ${(w.shade ?? 0) === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>`}
          </div>`;

        const showWhenToggle = w.type !== 'event';
        const whenLabel = w.type === 'plan' ? 'Programar sesiones en la agenda' : 'Tiene fecha de inicio';
        const when = w.type === 'task' ? taskWhenUI() : `<fieldset class="box"><legend>Cuándo</legend>
          ${showWhenToggle ? `<label class="check"><input type="checkbox" name="hasDate" ${w.start ? 'checked' : ''}> ${whenLabel}</label>` : ''}
          ${w.start ? `<div class="row wrap">
            <label class="field">Fecha<input type="date" class="input" name="date" value="${dateKey(s)}"></label>
            ${w.allDay
              ? `<label class="field">Días<input type="number" min="1" max="365" class="input num" name="days" value="${Math.max(1, Math.round(w.duration / 1440))}"></label>`
              : `<label class="field">Inicio<input type="time" class="input" name="time" value="${fmtTime(s)}"></label>
                 <label class="field">Fin<input type="time" class="input" name="endTime" value="${fmtTime(addMinutes(s, w.duration))}"></label>`}
            <label class="check self-end"><input type="checkbox" name="allDay" ${w.allDay ? 'checked' : ''}> Todo el día</label>
          </div>
          ${w.allDay ? '' : `<div class="chips">${DUR_CHIPS.map((d) => `<button type="button" class="chipbtn ${w.duration === d ? 'on' : ''}" data-dur="${d}">${d < 60 ? d + '′' : d / 60 + ' h'}</button>`).join('')}</div>`}
          ${recurrenceUI()}` : ''}
        </fieldset>`;

        const typeExtra = w.type === 'task' ? taskUI() : w.type === 'plan' ? planUI() : '';

        const agendaSel = w.inAgenda === true ? 'yes' : w.inAgenda === false ? 'no' : 'inherit';
        const catAg = cat ? (store.inAgenda({ categoryId: cat.id, inAgenda: null }) ? 'sí' : 'no') : 'sí';
        const extra = `<fieldset class="box"><legend>Más</legend>
          <div class="row wrap">
            <label class="field">¿Entra en la agenda?
              <select class="input" name="inAgenda">
                <option value="inherit" ${agendaSel === 'inherit' ? 'selected' : ''}>Según la categoría (${catAg})</option>
                <option value="yes" ${agendaSel === 'yes' ? 'selected' : ''}>Sí, mostrar en el calendario</option>
                <option value="no" ${agendaSel === 'no' ? 'selected' : ''}>No, fuera de la agenda (sin avisos automáticos)</option>
              </select></label>
            ${w.type !== 'plan' ? `<label class="field grow">Lugar<input class="input" name="location" value="${esc(w.location)}" placeholder="Aula, dirección, enlace…"></label>` : ''}
          </div>
          <label class="field">Notas<textarea class="input" name="notes" rows="3">${esc(w.notes)}</textarea></label>
        </fieldset>`;

        return `<form class="editor-form" autocomplete="off">${head}${when}${typeExtra}${remindersUI()}${extra}
          <div class="modal-actions">
            ${isNew ? '' : '<button type="button" class="btn danger" data-act="delete">Eliminar</button>'}
            ${isNew ? '' : '<button type="button" class="btn" data-act="duplicate">Duplicar</button>'}
            <span class="grow"></span>
            <button type="button" class="btn" data-close>Cancelar</button>
            <button type="submit" class="btn primary" data-act="save">Guardar <kbd>Ctrl+↵</kbd></button>
          </div></form>`;
      }

      // ---------- Cuándo (tareas): inicio + duración indefinida o con atajos ----------
      function taskDurations(s) {
        const month = new Date(s);
        month.setMonth(month.getMonth() + 1);
        const days = (n) => n * 1440;
        return [
          ...(w.allDay ? [] : [['1h', '1 h', 60]]),
          ['1d', '1 día', days(1)],
          ['1w', '1 semana', days(7)],
          ['1m', '1 mes', w.allDay ? days(diffDays(s, month)) : Math.round((month - s) / 60000)],
        ];
      }
      function taskWhenUI() {
        const s = w.start ? parseLocal(w.start) : null;
        let body = '<p class="muted small">Sin fecha: la verás en Planning → «Tareas sin fecha».</p>';
        if (s) {
          const end = w.allDay ? addDays(s, Math.max(1, Math.round(w.duration / 1440)) - 1) : addMinutes(s, w.duration);
          body = `<div class="row wrap">
              <label class="field">Empieza<input type="date" class="input" name="date" value="${dateKey(s)}"></label>
              ${w.allDay ? '' : `<label class="field">Hora<input type="time" class="input" name="time" value="${fmtTime(s)}"></label>`}
              <label class="check self-end"><input type="checkbox" name="allDay" ${w.allDay ? 'checked' : ''}> Todo el día</label>
            </div>
            <div class="field">Duración</div>
            <div class="chips">
              <button type="button" class="chipbtn ${w.openEnd ? 'on' : ''}" data-tdur="open">∞ Sin fin</button>
              ${taskDurations(s).map(([k, l, v]) => `<button type="button" class="chipbtn ${!w.openEnd && w.duration === v ? 'on' : ''}" data-tdur="${k}">${l}</button>`).join('')}
            </div>
            ${w.openEnd
              ? '<p class="muted small">Queda «en curso» desde que empieza hasta que la marques como hecha. Si pasan los días sin completarla, seguirá apareciendo en el día de hoy.</p>'
              : `<div class="row wrap">
                  <label class="field">Termina<input type="date" class="input" name="tEndDate" value="${dateKey(end)}"></label>
                  ${w.allDay ? '' : `<label class="field">Hora<input type="time" class="input" name="tEndTime" value="${fmtTime(end)}"></label>`}
                </div>
                <p class="muted small">Si llega el final sin completarla, queda como pendiente (aparece hoy y en Agenda / Planning).</p>`}
            ${recurrenceUI()}`;
        }
        return `<fieldset class="box"><legend>Cuándo</legend>
          <label class="check"><input type="checkbox" name="hasDate" ${w.start ? 'checked' : ''}> Tiene fecha de inicio</label>
          ${body}</fieldset>`;
      }

      function recurrenceUI() {
        const r = w.recurrence;
        const s = parseLocal(w.start);
        const freq = r?.freq ?? 'none';
        let det = '';
        if (r) {
          const unit = { daily: ['día', 'días'], weekly: ['semana', 'semanas'], monthly: ['mes', 'meses'], yearly: ['año', 'años'] }[r.freq];
          if (unit) det += `<div class="row wrap center">Cada <input type="number" min="1" max="99" class="input num" name="interval" value="${r.interval}"> ${r.interval > 1 ? unit[1] : unit[0]}</div>`;
          if (r.freq === 'weekly') {
            det += `<div class="wd-toggles">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" class="wd ${r.byDay.includes(d) ? 'on' : ''}" data-wd="${d}" title="${DAY_LONG[d]}">${DAY_LETTER[d]}</button>`).join('')}
              <button type="button" class="btn small" data-wdset="1,2,3,4,5">Laborables</button><button type="button" class="btn small" data-wdset="0,6">Fin de semana</button></div>`;
          }
          if (r.freq === 'monthly') {
            const n = nthOf(s);
            det += `<div class="row wrap">
              <label class="check"><input type="radio" name="monthMode" value="day" ${r.monthMode !== 'nth' ? 'checked' : ''}> El día ${s.getDate()}</label>
              <label class="check"><input type="radio" name="monthMode" value="nth" ${r.monthMode === 'nth' && r.nth !== -1 ? 'checked' : ''} data-nth="${n}"> El ${['', 'primer', 'segundo', 'tercer', 'cuarto', 'quinto'][n]} ${DAY_LONG[s.getDay()]}</label>
              ${isLastWeekdayOfMonth(s) ? `<label class="check"><input type="radio" name="monthMode" value="nth" ${r.monthMode === 'nth' && r.nth === -1 ? 'checked' : ''} data-nth="-1"> El último ${DAY_LONG[s.getDay()]}</label>` : ''}
            </div>`;
          }
          if (r.freq === 'dates') {
            det += `<div class="muted small">Además del ${fmtDate(s)}, se repite en:</div>
              <div class="tags">${(r.dates ?? []).map((k) => `<span class="tag">${fmtDate(parseLocal(k))} <button type="button" data-del-date="${k}">✕</button></span>`).join('')}</div>
              <div class="row"><input type="date" class="input" name="addDate"><button type="button" class="btn small" data-act="add-date">Añadir fecha</button></div>`;
          } else {
            const endMode = r.until ? 'until' : r.count ? 'count' : 'never';
            det += `<div class="row wrap center">Termina
              <select class="input" name="endMode">
                <option value="never" ${endMode === 'never' ? 'selected' : ''}>nunca</option>
                <option value="until" ${endMode === 'until' ? 'selected' : ''}>el día…</option>
                <option value="count" ${endMode === 'count' ? 'selected' : ''}>tras N veces</option>
              </select>
              ${endMode === 'until' ? `<input type="date" class="input" name="until" value="${r.until}">` : ''}
              ${endMode === 'count' ? `<input type="number" min="1" class="input num" name="count" value="${r.count}"> veces` : ''}
            </div>`;
          }
          // Excepciones y periodos sin repetición
          det += `<details class="exc" ${(r.exdates?.length || r.skipRanges?.length) ? 'open' : ''}><summary>Excepciones (${(r.exdates?.length ?? 0) + (r.skipRanges?.length ?? 0)})</summary>
            <div class="muted small">Días sueltos o periodos (vacaciones, exámenes…) en los que no se repite.</div>
            <div class="tags">${(r.exdates ?? []).map((k) => `<span class="tag">${fmtDate(parseLocal(k))} <button type="button" data-del-ex="${k}">✕</button></span>`).join('')}
            ${(r.skipRanges ?? []).map((g, i) => `<span class="tag">${fmtDate(parseLocal(g.from))} → ${fmtDate(parseLocal(g.to))} <button type="button" data-del-range="${i}">✕</button></span>`).join('')}</div>
            <div class="row wrap"><input type="date" class="input" name="exDate"><button type="button" class="btn small" data-act="add-ex">Excluir día</button></div>
            <div class="row wrap"><input type="date" class="input" name="rangeFrom"> → <input type="date" class="input" name="rangeTo"><button type="button" class="btn small" data-act="add-range">Excluir periodo</button></div>
          </details>`;
          const next = engine.nextOccurrences({ ...w, overrides: w.overrides ?? {} }, startOfDay(new Date()) > s ? new Date() : s, 6);
          det += `<div class="rec-preview"><b>${esc(describeRule(r, w.start))}</b><br><span class="muted small">Próximas: ${next.map((i) => fmtDate(i.start)).join(' · ') || '—'}</span></div>`;
        }
        return `<div class="rec">
          <label class="field">Repetir
            <select class="input" name="freq">
              ${[['none', 'No se repite'], ['daily', 'Cada día / cada N días'], ['weekly', 'Semanal (elige días)'], ['monthly', 'Mensual'], ['yearly', 'Anual'], ['dates', 'Fechas concretas']]
                .map(([v, l]) => `<option value="${v}" ${freq === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
          ${det}</div>`;
      }

      function remindersUI() {
        const inherit = !Array.isArray(w.reminders);
        const list = inherit ? store.effectiveReminders(w) : w.reminders;
        const cat = store.getCategory(w.categoryId);
        const rows = list.map((r, i) => `<div class="rem-row" data-i="${i}">
            ${r.unit === 'abs'
              ? `<input type="datetime-local" class="input" data-rem="at" value="${r.at ?? ''}" ${inherit ? 'disabled' : ''}>`
              : `<input type="number" min="0" class="input num" data-rem="value" value="${r.value}" ${inherit ? 'disabled' : ''}>`}
            <select class="input" data-rem="unit" ${inherit ? 'disabled' : ''}>${Object.entries(UNITS).map(([k, u]) => `<option value="${k}" ${r.unit === k ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
            <select class="input" data-rem="level" ${inherit ? 'disabled' : ''}>${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${r.level === k ? 'selected' : ''}>${l.icon} ${l.label}</option>`).join('')}</select>
            <button type="button" class="icon-btn" data-rem-test="${r.level}" title="Probar">▶</button>
            ${inherit ? '' : '<button type="button" class="icon-btn" data-rem-del title="Quitar">✕</button>'}
          </div>`).join('');
        const source = w.exam ? 'examen (Ajustes → Avisos)'
          : w.type === 'task' ? 'tarea: a la hora de empezar (Ajustes → Avisos)'
          : w.type === 'plan' ? 'planning: al acabar la sesión (Ajustes → Avisos)'
          : cat ? `«${esc(cat.name)}»` : 'los ajustes';
        // Plannings: lo habitual es avisar al acabar la sesión
        const planChips = `<div class="chips">
            <button type="button" class="chipbtn" data-addrem="0,endmin,sound">＋ Al acabar 🔔</button>
            <button type="button" class="chipbtn" data-addrem="0,endmin,vibrate">＋ Al acabar 📳</button>
            <button type="button" class="chipbtn" data-addrem="0,endmin,alarm">＋ Al acabar ⏰</button>
            <button type="button" class="chipbtn" data-addrem="5,endmin,vibrate">＋ 5 min antes de acabar 📳</button>
            <button type="button" class="chipbtn" data-addrem="0,min,sound">＋ Al empezar 🔔</button>
            <button type="button" class="chipbtn" data-addrem="10,min,vibrate">＋ 10 min antes de empezar 📳</button>
          </div>`;
        // En las tareas lo habitual es avisar a la hora: esos botones van primero
        const taskChips = `<div class="chips">
            <button type="button" class="chipbtn" data-addrem="0,min,vibrate">＋ A la hora 📳</button>
            <button type="button" class="chipbtn" data-addrem="0,min,sound">＋ A la hora 🔔</button>
            <button type="button" class="chipbtn" data-addrem="0,min,alarm">＋ A la hora ⏰</button>
            <button type="button" class="chipbtn" data-addrem="0,min,persistent">＋ A la hora 🚨</button>
            <button type="button" class="chipbtn" data-addrem="10,min,vibrate">＋ 10 min antes 📳</button>
            <button type="button" class="chipbtn" data-addrem="1,h,sound">＋ 1 h antes 🔔</button>
            <button type="button" class="chipbtn" data-addrem="1,d,sound">＋ 1 día antes 🔔</button>
            <button type="button" class="chipbtn" data-addrem="abs">＋ Fecha exacta</button>
          </div>`;
        return `<fieldset class="box"><legend>Avisos</legend>
          ${w.type === 'event' ? `<label class="check"><input type="checkbox" name="exam" ${w.exam ? 'checked' : ''}> 📝 Es un examen (avisos de examen automáticos)</label>` : ''}
          <label class="check"><input type="checkbox" name="inheritRem" ${inherit ? 'checked' : ''}> Usar los avisos de ${source}</label>
          ${rows || '<div class="muted small">Sin avisos.</div>'}
          ${inherit ? '' : w.type === 'task' ? taskChips : w.type === 'plan' ? planChips : `<div class="chips">
            <button type="button" class="chipbtn" data-addrem="10,min,vibrate">＋ 10 min 📳</button>
            <button type="button" class="chipbtn" data-addrem="30,min,sound">＋ 30 min 🔔</button>
            <button type="button" class="chipbtn" data-addrem="1,h,sound">＋ 1 h 🔔</button>
            <button type="button" class="chipbtn" data-addrem="1,d,sound">＋ 1 día 🔔</button>
            <button type="button" class="chipbtn" data-addrem="1,w,visual">＋ 1 semana 🔕</button>
            <button type="button" class="chipbtn" data-addrem="0,min,alarm">＋ Alarma a la hora ⏰</button>
            <button type="button" class="chipbtn" data-addrem="0,min,persistent">＋ Persistente 🚨</button>
            <button type="button" class="chipbtn" data-addrem="abs">＋ Fecha exacta</button>
          </div>`}
        </fieldset>`;
      }

      function taskUI() {
        return `<fieldset class="box"><legend>Tarea</legend>
          <div class="row wrap center">Prioridad
            <div class="seg small">${['Ninguna', 'Baja', 'Media', 'Alta'].map((l, i) => `<button type="button" class="${(w.priority | 0) === i ? 'on' : ''}" data-prio="${i}">${['–', '▽', '◇', '▲'][i]} ${l}</button>`).join('')}</div>
            <label class="check"><input type="checkbox" name="done" ${w.done ? 'checked' : ''}> Hecha</label>
          </div>
          <div class="checklist">${(w.checklist ?? []).map((c, i) => `<div class="row center" data-ci="${i}"><input type="checkbox" data-cl="done" ${c.done ? 'checked' : ''}><input class="input grow" data-cl="text" value="${esc(c.text)}"><button type="button" class="icon-btn" data-cl-del>✕</button></div>`).join('')}</div>
          <div class="row"><input class="input grow" name="newCheck" placeholder="＋ Subtarea (Enter)"></div>
          <label class="field">Fecha límite (opcional)<input type="date" class="input" name="deadline" value="${w.deadline ?? ''}"></label>
        </fieldset>`;
      }

      function planUI() {
        return `<fieldset class="box"><legend>Planning</legend>
          <label class="field">Fecha objetivo / entrega<input type="date" class="input" name="deadline" value="${w.deadline ?? ''}"></label>
          <div class="muted small">Pasos: pon fecha a un paso para que aparezca en la agenda ese día.</div>
          <div class="checklist">${(w.steps ?? []).map((st, i) => `<div class="row center" data-si="${i}"><input type="checkbox" data-st="done" ${st.done ? 'checked' : ''}><input class="input grow" data-st="text" value="${esc(st.text)}"><input type="date" class="input" data-st="date" value="${st.date ?? ''}"><button type="button" class="icon-btn" data-st-del>✕</button></div>`).join('')}</div>
          <div class="row"><input class="input grow" name="newStep" placeholder="＋ Paso (Enter)"></div>
        </fieldset>`;
      }

      // ---------- Actualización del modelo ----------
      const setStart = (d) => (w.start = toLocalISO(d));
      const S = () => parseLocal(w.start);

      body.addEventListener('input', (e) => {
        const t = e.target;
        const n = t.name;
        if (mode === 'one') return;
        if (n === 'title') w.title = t.value;
        else if (n === 'location') w.location = t.value;
        else if (n === 'notes') w.notes = t.value;
        else if (t.dataset.cl === 'text') w.checklist[+t.closest('[data-ci]').dataset.ci].text = t.value;
        else if (t.dataset.st === 'text') w.steps[+t.closest('[data-si]').dataset.si].text = t.value;
        else if (t.dataset.rem === 'value') {
          w.reminders[+t.closest('[data-i]').dataset.i].value = Math.max(0, +t.value || 0);
        }
      });

      body.addEventListener('change', (e) => {
        const t = e.target;
        const n = t.name;
        if (mode === 'one') return;
        let rerender = true;
        switch (n) {
          case 'categoryId': {
            w.categoryId = t.value || null;
            try {
              localStorage.setItem(LAST_CAT, w.categoryId ?? '');
            } catch { /* */ }
            break;
          }
          case 'shade':
            w.shade = +t.value;
            rerender = false;
            break;
          case 'hasDate':
            if (t.checked) {
              const d = new Date();
              if (w.type === 'task') {
                // Tarea: empieza en la próxima media hora y sin fin, salvo que se elija duración
                d.setMinutes(Math.ceil((d.getMinutes() + 1) / 30) * 30, 0, 0);
                w.openEnd = true;
                w.allDay = false;
                w.duration = 60;
              } else {
                d.setHours(d.getHours() + 1, 0, 0, 0);
                w.allDay = false;
                w.duration = 60;
              }
              setStart(d);
            } else {
              w.start = null;
              w.recurrence = null;
            }
            break;
          case 'date': {
            if (!t.value) return;
            const old = S();
            const nd = parseLocal(t.value);
            nd.setHours(old.getHours(), old.getMinutes());
            setStart(nd);
            if (w.recurrence?.freq === 'weekly' && w.recurrence.byDay.length === 1) w.recurrence.byDay = [nd.getDay()];
            break;
          }
          case 'time': {
            if (!t.value) return;
            const [h, m] = t.value.split(':').map(Number);
            const d = S();
            d.setHours(h, m);
            setStart(d);
            break;
          }
          case 'endTime': {
            if (!t.value) return;
            const [h, m] = t.value.split(':').map(Number);
            const s = S();
            let dur = h * 60 + m - (s.getHours() * 60 + s.getMinutes());
            if (dur <= 0) dur += 1440;
            w.duration = dur;
            break;
          }
          case 'allDay':
            w.allDay = t.checked;
            if (t.checked) {
              const d = S();
              d.setHours(0, 0);
              setStart(d);
              w.duration = 1440;
            } else {
              const d = S();
              d.setHours(9, 0);
              setStart(d);
              w.duration = store.getCategory(w.categoryId)?.defaultDuration ?? 60;
            }
            break;
          case 'days':
            w.duration = Math.max(1, +t.value || 1) * 1440;
            break;
          case 'tEndDate':
          case 'tEndTime': {
            // Fin de una tarea con duración: fecha (y hora) en que termina
            const ed = body.querySelector('[name=tEndDate]')?.value;
            if (!ed) return;
            const s = S();
            if (w.allDay) w.duration = Math.max(1, diffDays(s, parseLocal(ed)) + 1) * 1440;
            else {
              const et = body.querySelector('[name=tEndTime]')?.value || fmtTime(s);
              w.duration = Math.max(15, Math.round((parseLocal(`${ed}T${et}`) - s) / 60000));
            }
            break;
          }
          case 'freq':
            if (t.value === 'none') w.recurrence = null;
            else {
              const prev = w.recurrence;
              w.recurrence = defaultRule(t.value, w.start);
              if (prev) {
                w.recurrence.until = prev.until;
                w.recurrence.count = prev.count;
                w.recurrence.exdates = prev.exdates ?? [];
                w.recurrence.skipRanges = prev.skipRanges ?? [];
              }
            }
            break;
          case 'interval':
            w.recurrence.interval = Math.max(1, +t.value || 1);
            break;
          case 'monthMode':
            w.recurrence.monthMode = t.value;
            if (t.value === 'nth') w.recurrence.nth = +t.dataset.nth;
            break;
          case 'endMode':
            w.recurrence.until = t.value === 'until' ? keyAddDays(w.start.slice(0, 10), 90) : null;
            w.recurrence.count = t.value === 'count' ? 10 : null;
            break;
          case 'until':
            w.recurrence.until = t.value || null;
            break;
          case 'count':
            w.recurrence.count = Math.max(1, +t.value || 1);
            break;
          case 'inheritRem':
            w.reminders = t.checked ? null : structuredClone(store.effectiveReminders({ ...w, reminders: null }));
            break;
          case 'exam':
            w.exam = t.checked; // false = desmarcado a mano (no se vuelve a marcar solo)
            if (t.checked) w.reminders = null; // pasar a usar los avisos de examen
            break;
          case 'inAgenda':
            w.inAgenda = t.value === 'yes' ? true : t.value === 'no' ? false : null;
            rerender = false;
            break;
          case 'done':
            w.done = t.checked;
            rerender = false;
            break;
          case 'deadline':
            w.deadline = t.value || null;
            rerender = false;
            break;
          default:
            rerender = false;
        }
        if (t.dataset.rem) {
          const r = w.reminders[+t.closest('[data-i]').dataset.i];
          if (t.dataset.rem === 'unit') {
            r.unit = t.value;
            if (t.value === 'abs' && !r.at) r.at = w.start ?? toLocalISO(new Date());
          } else if (t.dataset.rem === 'level') r.level = t.value;
          else if (t.dataset.rem === 'at') r.at = t.value;
          rerender = t.dataset.rem !== 'value';
        }
        if (t.dataset.cl === 'done') {
          w.checklist[+t.closest('[data-ci]').dataset.ci].done = t.checked;
          rerender = false;
        }
        if (t.dataset.st === 'done') {
          const stp = w.steps[+t.closest('[data-si]').dataset.si];
          stp.done = t.checked;
          stp.doneAt = t.checked ? Date.now() : null;
          rerender = false;
        }
        if (t.dataset.st === 'date') {
          w.steps[+t.closest('[data-si]').dataset.si].date = t.value || null;
          rerender = false;
        }
        if (rerender) render(n || undefined);
      });

      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
          return;
        }
        if (e.key === 'Enter' && e.target.name === 'newCheck' && e.target.value.trim()) {
          e.preventDefault();
          w.checklist = [...(w.checklist ?? []), { id: uid(), text: e.target.value.trim(), done: false }];
          render('newCheck');
        }
        if (e.key === 'Enter' && e.target.name === 'newStep' && e.target.value.trim()) {
          e.preventDefault();
          w.steps = [...(w.steps ?? []), { id: uid(), text: e.target.value.trim(), done: false, date: null }];
          render('newStep');
        }
      });

      body.addEventListener('submit', (e) => {
        e.preventDefault();
        save();
      });

      body.addEventListener('click', async (e) => {
        const t = e.target;
        const mb = t.closest('[data-mode]');
        if (mb) {
          mode = mb.dataset.mode;
          return render();
        }
        const tb = t.closest('[data-type]');
        if (tb) {
          w.type = tb.dataset.type;
          // Al convertir en tarea uno nuevo: sin fin por defecto (como las tareas creadas desde cero)
          if (isNew && w.type === 'task' && w.start && !w.allDay) w.openEnd = true;
          if (isNew && w.type === 'plan') w.inAgenda = true;
          if ((w.type === 'event' || (w.type === 'plan' && isNew)) && !w.start) {
            const d = new Date();
            d.setMinutes(Math.ceil((d.getMinutes() + 1) / 30) * 30, 0, 0); // próxima media hora
            setStart(d);
            w.allDay = false;
            w.duration = store.getCategory(w.categoryId)?.defaultDuration ?? 60;
          }
          return render('title');
        }
        const dur = t.closest('[data-dur]');
        if (dur) {
          w.duration = +dur.dataset.dur;
          return render();
        }
        const tdur = t.closest('[data-tdur]');
        if (tdur) {
          const k = tdur.dataset.tdur;
          w.openEnd = k === 'open';
          if (!w.openEnd) w.duration = taskDurations(S()).find(([key]) => key === k)[2];
          return render();
        }
        const wd = t.closest('[data-wd]');
        if (wd) {
          const d = +wd.dataset.wd;
          const set = new Set(w.recurrence.byDay);
          set.has(d) ? set.delete(d) : set.add(d);
          if (!set.size) set.add(S().getDay());
          w.recurrence.byDay = [...set];
          return render();
        }
        const wds = t.closest('[data-wdset]');
        if (wds) {
          w.recurrence.byDay = wds.dataset.wdset.split(',').map(Number);
          return render();
        }
        const prio = t.closest('[data-prio]');
        if (prio) {
          w.priority = +prio.dataset.prio;
          return render();
        }
        if (t.closest('[data-del-date]')) {
          w.recurrence.dates = w.recurrence.dates.filter((k) => k !== t.closest('[data-del-date]').dataset.delDate);
          return render();
        }
        if (t.closest('[data-del-ex]')) {
          w.recurrence.exdates = w.recurrence.exdates.filter((k) => k !== t.closest('[data-del-ex]').dataset.delEx);
          return render();
        }
        if (t.closest('[data-del-range]')) {
          w.recurrence.skipRanges.splice(+t.closest('[data-del-range]').dataset.delRange, 1);
          return render();
        }
        const addRem = t.closest('[data-addrem]');
        if (addRem) {
          const v = addRem.dataset.addrem;
          w.reminders ??= [];
          if (v === 'abs') w.reminders.push({ id: uid(), unit: 'abs', at: w.start ?? toLocalISO(new Date()), value: 0, level: 'sound' });
          else {
            const [value, unit, level] = v.split(',');
            w.reminders.push({ id: uid(), value: +value, unit, level });
          }
          return render();
        }
        if (t.closest('[data-rem-del]')) {
          w.reminders.splice(+t.closest('[data-i]').dataset.i, 1);
          return render();
        }
        const tst = t.closest('[data-rem-test]');
        if (tst) return testLevel(tst.dataset.remTest);
        if (t.closest('[data-cl-del]')) {
          w.checklist.splice(+t.closest('[data-ci]').dataset.ci, 1);
          return render();
        }
        if (t.closest('[data-st-del]')) {
          w.steps.splice(+t.closest('[data-si]').dataset.si, 1);
          return render();
        }
        const act = t.closest('[data-act]')?.dataset.act;
        switch (act) {
          case 'pickcat':
            return openCategoryPicker(t.closest('[data-act]'), w.categoryId, (id) => {
              w.categoryId = id;
              try {
                localStorage.setItem(LAST_CAT, id ?? '');
              } catch { /* */ }
              render();
            });
          case 'newcat': {
            const name = await promptDialog('Nueva categoría', '', { placeholder: 'p. ej. Física, Gimnasio, Trabajo…' });
            if (!name) return;
            const used = store.get().categories.map((c) => c.color);
            const cat = store.newCategory({ name, color: nextFreeColor(used) });
            store.mutate('Nueva categoría', (s) => s.categories.push(cat));
            w.categoryId = cat.id;
            return render();
          }
          case 'color-auto':
            w.color = null;
            return render();
          case 'emoji': {
            const btn = t.closest('[data-act]');
            floatingMenu(btn, `<div class="emoji-grid">${EMOJIS.map((x) => `<button type="button" data-v="${x}">${x}</button>`).join('')}<button type="button" data-v="" class="wide">Quitar icono</button></div>`, (ev) => {
              const b = ev.target.closest('[data-v]');
              if (!b) return false;
              w.icon = b.dataset.v || null;
              render();
            });
            return;
          }
          case 'add-date': {
            const v = body.querySelector('[name=addDate]').value;
            if (v) w.recurrence.dates = [...new Set([...(w.recurrence.dates ?? []), v])].sort();
            return render();
          }
          case 'add-ex': {
            const v = body.querySelector('[name=exDate]').value;
            if (v) w.recurrence.exdates = [...new Set([...(w.recurrence.exdates ?? []), v])].sort();
            return render();
          }
          case 'add-range': {
            const a = body.querySelector('[name=rangeFrom]').value, b = body.querySelector('[name=rangeTo]').value;
            if (a && b) w.recurrence.skipRanges = [...(w.recurrence.skipRanges ?? []), { from: a < b ? a : b, to: a < b ? b : a }];
            return render();
          }
          case 'delete': {
            close();
            const inst = occInst ?? (existing.start ? engine.buildInstance(existing, null) : null);
            if (inst) return deleteInstance(inst);
            store.mutate('Eliminar', (s) => (s.items = s.items.filter((x) => x.id !== existing.id)));
            return toast('Eliminado', { action: ctx.undo });
          }
          case 'delete-one':
            close();
            return deleteInstance(occInst);
          case 'reset-one':
            occ = {};
            store.mutate('Restablecer aparición', () => delete store.getItem(existing.id).overrides[occKey]);
            return render();
          case 'duplicate': {
            const copy = structuredClone(w);
            copy.id = uid();
            copy.title += ' (copia)';
            copy.createdAt = Date.now();
            store.mutate('Duplicar', (s) => s.items.push(copy));
            close();
            return openEditor({ itemId: copy.id });
          }
          case 'save':
            if (mode === 'one') {
              e.preventDefault();
              return save();
            }
        }
      });

      function save() {
        if (mode === 'one') {
          const q = (n) => body.querySelector(`[name=${n}]`);
          const date = q('o_date').value;
          const s = occInst.start;
          let start = parseLocal(date);
          let dur = occ.duration ?? existing.duration;
          if (!existing.allDay) {
            const [h, m] = q('o_time').value.split(':').map(Number);
            start.setHours(h, m);
            if (q('o_end')) {
              const [eh, em] = q('o_end').value.split(':').map(Number);
              dur = eh * 60 + em - (h * 60 + m);
              if (dur <= 0) dur += 1440;
            }
          }
          const patch = {};
          const ttl = q('o_title').value.trim();
          if (ttl && ttl !== existing.title) patch.title = ttl;
          if (start.getTime() !== s.getTime() || occ.start) patch.start = toLocalISO(start);
          if (dur !== existing.duration) patch.duration = dur;
          if (q('o_done')) patch.done = q('o_done').checked;
          store.mutate('Editar aparición', () => {
            const it = store.getItem(existing.id);
            it.overrides ??= {};
            it.overrides[occKey] = { ...patch };
          });
          close();
          return;
        }
        if (!w.title.trim()) w.title = w.type === 'task' ? 'Tarea' : w.type === 'plan' ? 'Planning' : 'Evento';
        w.title = w.title.trim();
        if (w.type !== 'task') delete w.openEnd; // la duración indefinida solo existe en tareas
        if (w.recurrence && w.recurrence.freq === 'weekly' && !w.recurrence.byDay?.length) w.recurrence.byDay = [S().getDay()];
        try {
          localStorage.setItem(LAST_CAT, w.categoryId ?? '');
        } catch { /* */ }
        store.mutate(isNew ? 'Crear' : 'Guardar', (s) => {
          const i = s.items.findIndex((x) => x.id === w.id);
          if (i >= 0) s.items[i] = w;
          else s.items.push(w);
        });
        close();
        if (isNew && !store.inAgenda(w) && !store.get().settings.showOutOfAgenda) toast('Guardado fuera de la agenda (míralo en Planning)');
        else if (isNew && w.start && !store.isCategoryVisible(w.categoryId)) toast('Guardado en una categoría oculta');
      }

      render();
    },
  });
}
