// Importar horarios (Chronos UB u otro .ics): cada asignatura pasa a ser una
// subcategoría con su propio color, dentro de un grupo con nombre propio.
import * as store from '../store.js';
import { parseICS, buildItemsFromEvents, guessSubject, guessActivity, DEFAULT_ACTIVITY_SHADE } from '../ics.js';
import { NAMED_PALETTES } from '../palette.js';
import { openModal, toast, ctx } from './dom.js';
import { openColorPicker } from './colorpicker.js';
import { esc, norm, readFileText, shade, uid } from '../util.js';

const SHADE_OPTIONS = [[0.5, 'Mucho más claro'], [0.3, 'Más claro'], [0, 'Color de la asignatura'], [-0.3, 'Más oscuro'], [-0.5, 'Mucho más oscuro']];

const CHRONOS = 'https://grad.ub.edu/chronos/pages/horaris/index2.xhtml';

const REM_PRESETS = {
  none: [],
  v10: [{ value: 10, unit: 'min', level: 'vibrate' }],
  s15: [{ value: 15, unit: 'min', level: 'sound' }],
  s30: [{ value: 30, unit: 'min', level: 'sound' }],
  a30: [{ value: 30, unit: 'min', level: 'alarm' }],
};

export function openImporter() {
  let events = null;
  let subjects = [];
  let paletteName = 'Vivo';
  const year = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const opts = {
    groupName: `Horario UB ${year}-${String(year + 1).slice(2)}`,
    merge: true, titleMode: 'clean', inAgenda: true, rem: 'v10', skipHolidays: true, replace: true,
    useShades: true, shades: {}, // tipo de actividad → tono
  };
  let activities = [];

  openModal({
    title: 'Importar horario',
    wide: true,
    build(body, close) {
      const step1 = () => {
        body.innerHTML = `<div class="import">
          <ol class="howto">
            <li>Abre <a href="${CHRONOS}" target="_blank" rel="noopener">Chronos (UB)</a>, elige tus asignaturas y grupos.</li>
            <li>En «Visualitza la teva agenda» pulsa <b>Exporta-la</b> y descarga el archivo <code>.ics</code>.</li>
            <li>Arrástralo aquí (sirve cualquier .ics: Google Calendar, Outlook…).</li>
          </ol>
          <label class="drop" tabindex="0">
            <input type="file" accept=".ics,text/calendar" hidden>
            <span class="drop-icon">📥</span><b>Suelta el archivo .ics aquí</b><span class="muted">o pulsa para elegirlo</span>
          </label>
          <details><summary>…o pega el contenido del .ics</summary>
            <textarea class="input mono" rows="6" placeholder="BEGIN:VCALENDAR…"></textarea>
            <button class="btn" data-act="paste">Leer texto</button>
          </details>
        </div>`;
        const drop = body.querySelector('.drop');
        const input = drop.querySelector('input');
        input.onchange = () => input.files[0] && readFileText(input.files[0]).then(load);
        drop.addEventListener('dragover', (e) => {
          e.preventDefault();
          drop.classList.add('over');
        });
        drop.addEventListener('dragleave', () => drop.classList.remove('over'));
        drop.addEventListener('drop', (e) => {
          e.preventDefault();
          drop.classList.remove('over');
          const f = e.dataTransfer.files[0];
          if (f) readFileText(f).then(load);
        });
        body.querySelector('[data-act=paste]').onclick = () => load(body.querySelector('textarea').value);
      };

      const load = (text) => {
        try {
          events = parseICS(text);
        } catch (e) {
          console.error(e);
          events = [];
        }
        if (!events.length) {
          toast('No he encontrado eventos en ese archivo');
          return;
        }
        const map = new Map();
        for (const ev of events) {
          const name = guessSubject(ev.summary);
          const k = norm(name);
          if (!map.has(k)) map.set(k, { key: k, name, count: 0, activities: new Set(), include: true, color: null, samples: new Set() });
          const s = map.get(k);
          s.count++;
          const a = guessActivity(ev.summary);
          if (a) s.activities.add(a);
          s.samples.add(ev.summary);
        }
        subjects = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
        const actCount = new Map();
        events.forEach((ev) => {
          const a = guessActivity(ev.summary);
          actCount.set(a, (actCount.get(a) ?? 0) + 1);
        });
        activities = [...actCount.entries()].filter(([a]) => a).sort((x, y) => y[1] - x[1]);
        activities.forEach(([a]) => (opts.shades[a] ??= DEFAULT_ACTIVITY_SHADE[a] ?? 0.3));
        applyPalette();
        step2();
      };

      const applyPalette = () => {
        const pal = NAMED_PALETTES[paletteName];
        subjects.forEach((s, i) => (s.color = pal[i % pal.length]));
      };

      const step2 = () => {
        const existing = store.get().categories.find((c) => !c.parentId && norm(c.name) === norm(opts.groupName));
        const first = events.reduce((a, e) => (e.start < a ? e.start : a), events[0].start);
        const last = events.reduce((a, e) => (e.start > a ? e.start : a), events[0].start);
        body.innerHTML = `<div class="import">
          <p><b>${events.length}</b> sesiones · <b>${subjects.length}</b> asignaturas · del ${first.toLocaleDateString()} al ${last.toLocaleDateString()}</p>
          <div class="row wrap">
            <label class="field grow">Nombre del horario (grupo de categorías)<input class="input" name="groupName" value="${esc(opts.groupName)}"></label>
            <label class="field">Paleta de colores<select class="input" name="palette">${Object.keys(NAMED_PALETTES).map((n) => `<option ${n === paletteName ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          </div>
          <div class="pal-preview">${NAMED_PALETTES[paletteName].map((c) => `<span style="background:${c}"></span>`).join('')}</div>
          <table class="subj">
            <thead><tr><th></th><th>Color</th><th>Categoría (puedes renombrar o unir poniendo el mismo nombre)</th><th>Sesiones</th></tr></thead>
            <tbody>${subjects.map((s, i) => `<tr data-i="${i}" class="${s.include ? '' : 'off'}">
              <td><input type="checkbox" data-inc ${s.include ? 'checked' : ''} title="Importar"></td>
              <td><button class="color-btn" data-col style="--c:${s.color}"></button></td>
              <td><input class="input" data-name value="${esc(s.name)}"><div class="muted small" title="${esc([...s.samples].join('\n'))}">${esc([...s.samples][0])}${s.samples.size > 1 ? ` (+${s.samples.size - 1} variantes)` : ''}</div></td>
              <td>${s.count}${s.activities.size ? `<div class="act-swatches">${[...s.activities].map((a) => `<span class="act-sw" style="--c:${opts.useShades ? shade(s.color, opts.shades[a] ?? 0) : s.color}" title="${esc(a)}">${esc(a)}</span>`).join('')}</div>` : ''}</td>
            </tr>`).join('')}</tbody>
          </table>
          ${activities.length > 1 ? `<fieldset class="box"><legend>Tipos de clase</legend>
            <label class="check"><input type="checkbox" name="useShades" ${opts.useShades ? 'checked' : ''}> Distinguir cada tipo con un tono de la misma asignatura</label>
            ${opts.useShades ? `<div class="shade-rows">${activities.map(([a, n]) => `<div class="row center wrap">
              <span class="act-sw" style="--c:${shade(subjects[0].color, opts.shades[a])}">${esc(a)}</span><span class="muted small">${n} sesiones</span>
              <select class="input" data-shade="${esc(a)}">${SHADE_OPTIONS.map(([v, l]) => `<option value="${v}" ${opts.shades[a] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div>`).join('')}</div>` : ''}
          </fieldset>` : ''}
          <fieldset class="box"><legend>Opciones</legend>
            <label class="check"><input type="checkbox" name="merge" ${opts.merge ? 'checked' : ''}> Unir las sesiones semanales en eventos que se repiten (así se mueven en bloque)</label>
            <label class="check"><input type="checkbox" name="inAgenda" ${opts.inAgenda ? 'checked' : ''}> Mostrar en la agenda</label>
            <label class="check"><input type="checkbox" name="skipHolidays" ${opts.skipHolidays ? 'checked' : ''}> Respetar periodos festivos / sin clases de Ajustes</label>
            <div class="row wrap">
              <label class="field">Título de cada clase
                <select class="input" name="titleMode">
                  <option value="clean" ${opts.titleMode === 'clean' ? 'selected' : ''}>Asignatura · tipo (p. ej. «Física · Prácticas»)</option>
                  <option value="orig" ${opts.titleMode === 'orig' ? 'selected' : ''}>Título original del archivo</option>
                </select></label>
              <label class="field">Aviso por defecto
                <select class="input" name="rem">
                  <option value="none" ${opts.rem === 'none' ? 'selected' : ''}>Sin aviso</option>
                  <option value="v10" ${opts.rem === 'v10' ? 'selected' : ''}>📳 10 min antes, vibración</option>
                  <option value="s15" ${opts.rem === 's15' ? 'selected' : ''}>🔔 15 min antes, sonido</option>
                  <option value="s30" ${opts.rem === 's30' ? 'selected' : ''}>🔔 30 min antes, sonido</option>
                  <option value="a30" ${opts.rem === 'a30' ? 'selected' : ''}>⏰ 30 min antes, alarma</option>
                </select></label>
            </div>
            ${existing ? `<label class="check"><input type="checkbox" name="replace" ${opts.replace ? 'checked' : ''}> Ya existe «${esc(existing.name)}»: reemplazar las clases importadas antes</label>` : ''}
          </fieldset>
          <div class="modal-actions"><button class="btn" data-act="back">← Otro archivo</button><span class="grow"></span>
            <button class="btn" data-close>Cancelar</button><button class="btn primary" data-act="import">Importar ${subjects.filter((s) => s.include).length} asignaturas</button></div>
        </div>`;
      };

      body.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.shade != null) {
          opts.shades[t.dataset.shade] = +t.value;
          return step2();
        }
        if (t.name === 'useShades') {
          opts.useShades = t.checked;
          return step2();
        }
        const row = t.closest('[data-i]');
        if (row) {
          const s = subjects[+row.dataset.i];
          if (t.matches('[data-inc]')) {
            s.include = t.checked;
            step2();
          }
          if (t.matches('[data-name]')) s.name = t.value.trim() || s.name;
          return;
        }
        if (t.name === 'palette') {
          paletteName = t.value;
          applyPalette();
          step2();
        } else if (t.name === 'groupName') {
          opts.groupName = t.value.trim() || opts.groupName;
          step2();
        } else if (t.name in opts) opts[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      });

      body.addEventListener('click', (e) => {
        const t = e.target;
        const col = t.closest('[data-col]');
        if (col) {
          const s = subjects[+col.closest('[data-i]').dataset.i];
          openColorPicker(col, s.color, (c) => {
            s.color = c;
            step2();
          });
          return;
        }
        const act = t.closest('[data-act]')?.dataset.act;
        if (act === 'back') step1();
        if (act === 'import') {
          const n = doImport(events, subjects, opts);
          close();
          const first = events.reduce((a, ev) => (ev.start < a ? ev.start : a), events[0].start);
          ctx.cursor = first > new Date() ? first : new Date();
          ctx.setView('week');
          toast(`Importadas ${n} clases`, { action: ctx.undo });
        }
      });

      step1();
    },
  });
}

/**
 * Marca como examen los elementos importados que lo son (título «· Examen» o código EXAM en el
 * original), para que usen los avisos de examen. Solo toca los que aún no estaban marcados.
 * Devuelve cuántos ha marcado.
 */
export function markExams() {
  const isExam = (i) => i.exam === undefined && i.type === 'event' &&
    (guessActivity((i.notes || '').split('\n')[0]) === 'Examen' || / · (Examen|Evaluación)$/.test(i.title));
  const found = store.get().items.filter(isExam);
  if (found.length) store.quiet(() => found.forEach((i) => (i.exam = true)), true);
  return found.length;
}

/** Subcategorías de un grupo que son la misma asignatura con otro tipo/grupo (TEORIA M1, PROB M1A…) */
export function duplicateSubjects(groupId) {
  const kids = store.childrenOf(groupId);
  const keys = kids.map((c) => norm(guessSubject(c.name)));
  return kids.filter((c, i) => keys.indexOf(keys[i]) !== i || norm(c.name) !== keys[i]).length;
}

/**
 * Une en una sola subcategoría por asignatura las que solo se diferencian por el tipo
 * de clase o el grupo. Los elementos pasan a la asignatura con un tono según su tipo.
 */
export function unifySubjects(groupId) {
  let merged = 0;
  store.mutate('Unir asignaturas', (st) => {
    const bySubj = new Map();
    for (const c of st.categories.filter((x) => x.parentId === groupId)) {
      const subj = guessSubject(c.name);
      const k = norm(subj);
      if (!bySubj.has(k)) bySubj.set(k, { subj, cats: [] });
      bySubj.get(k).cats.push(c);
    }
    for (const { subj, cats } of bySubj.values()) {
      const keep = cats.find((c) => norm(c.name) === norm(subj)) ?? cats.find((c) => guessActivity(c.name) === 'Teoría') ?? cats[0];
      for (const c of cats) {
        const catAct = guessActivity(c.name);
        for (const it of st.items.filter((i) => i.categoryId === c.id)) {
          const original = (it.notes || '').split('\n')[0];
          const act = guessActivity(original) || catAct;
          it.categoryId = keep.id;
          if (!it.shade) it.shade = DEFAULT_ACTIVITY_SHADE[act] ?? 0;
          if (act === 'Examen') it.exam = true;
          // Títulos generados al importar («Asignatura TEORIA M1 · Teoría») → «Asignatura · Teoría»
          if (it.title.startsWith(c.name)) it.title = `${subj}${act ? ' · ' + act : ''}`;
        }
        if (c !== keep) {
          st.categories.forEach((x) => x.parentId === c.id && (x.parentId = keep.id));
          st.categories = st.categories.filter((x) => x.id !== c.id);
          merged++;
        }
      }
      keep.name = subj;
    }
  });
  return merged;
}

function doImport(events, subjects, opts) {
  const bySubject = new Map(subjects.map((s) => [s.key, s]));
  const included = (ev) => bySubject.get(norm(guessSubject(ev.summary)))?.include;
  const evs = events.filter(included);
  const built = buildItemsFromEvents(evs, { merge: opts.merge });
  let count = 0;
  store.mutate('Importar horario', (st) => {
    let group = st.categories.find((c) => !c.parentId && norm(c.name) === norm(opts.groupName));
    if (group && opts.replace) {
      st.items = st.items.filter((i) => i.source !== `import:${group.id}`);
      // Quitar las subcategorías que se han quedado vacías (p. ej. las de una importación antigua)
      const used = new Set(st.items.map((i) => i.categoryId));
      const gid = group.id;
      st.categories = st.categories.filter((c) => c.parentId !== gid || used.has(c.id) || st.categories.some((x) => x.parentId === c.id));
    }
    if (!group) {
      group = store.newCategory({ name: opts.groupName, color: subjects[0]?.color ?? '#3f51b5', icon: '🎓' });
      st.categories.push(group);
    }
    group.skipHolidays = !!opts.skipHolidays;
    group.inAgenda = !!opts.inAgenda;
    group.reminders = structuredClone(REM_PRESETS[opts.rem] ?? []).map((r) => ({ ...r, id: uid() }));
    // Una subcategoría por nombre de asignatura (nombres iguales = misma categoría)
    const catByName = new Map();
    for (const s of subjects.filter((x) => x.include)) {
      const k = norm(s.name);
      if (catByName.has(k)) continue;
      let cat = st.categories.find((c) => c.parentId === group.id && norm(c.name) === k);
      if (!cat) {
        cat = store.newCategory({ name: s.name, parentId: group.id, icon: '📚' });
        st.categories.push(cat);
      }
      cat.color = s.color;
      catByName.set(k, cat);
    }
    for (const b of built) {
      const subj = bySubject.get(norm(guessSubject(b.ev.summary)));
      if (!subj) continue;
      const cat = catByName.get(norm(subj.name));
      const act = guessActivity(b.ev.summary);
      const title = opts.titleMode === 'orig' ? b.ev.summary : `${subj.name}${act ? ' · ' + act : ''}`;
      st.items.push(store.newItem({
        type: 'event', title, location: b.ev.location ?? '', notes: [b.ev.summary !== title ? b.ev.summary : '', b.ev.description ?? ''].filter(Boolean).join('\n'),
        categoryId: cat.id, start: b.start, duration: b.duration, allDay: b.allDay, recurrence: b.recurrence, overrides: b.overrides ?? {},
        shade: opts.useShades && act ? opts.shades[act] ?? 0 : 0,
        exam: act === 'Examen', // usa los avisos de examen (Ajustes → Avisos)
        source: `import:${group.id}`,
      }));
      count += b.mergedCount ?? 1;
    }
  });
  return count;
}
