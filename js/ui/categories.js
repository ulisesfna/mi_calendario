// Categorías: árbol de la barra lateral y editor con acciones en bloque.
import * as store from '../store.js';
import * as engine from '../engine.js';
import { NAMED_PALETTES, nextFreeColor, EMOJIS } from '../palette.js';
import { ctx, openModal, confirmDialog, floatingMenu, toast } from './dom.js';
import { openColorPicker, colorButton, wireColorButtons } from './colorpicker.js';
import { remindersHTML, wireReminders } from './reminders-ui.js';
import { duplicateSubjects, unifySubjects } from './importer.js';
import { addDays, dateKey, esc, startOfDay } from '../util.js';

// ---------------- Barra lateral ----------------

export function renderCategoryTree(el) {
  const st = store.get();
  const expanded = st.ui.expanded ?? {};
  const counts = new Map();
  st.items.forEach((i) => counts.set(i.categoryId, (counts.get(i.categoryId) ?? 0) + 1));
  const total = (id) => store.categoryWithDescendants(id).reduce((a, x) => a + (counts.get(x) ?? 0), 0);
  const rows = [];
  const walk = (parentId, depth) => {
    for (const c of st.categories.filter((x) => (x.parentId ?? null) === parentId)) {
      const kids = store.childrenOf(c.id);
      const open = !!expanded[c.id];
      // Si alguna subcategoría está oculta, el cuadro del grupo se ve «a medias»
      const partial = kids.length && c.visible !== false && store.categoryWithDescendants(c.id).some((x) => store.getCategory(x)?.visible === false);
      rows.push(`<li class="cat-row ${c.visible === false ? 'off' : ''} ${partial ? 'partial' : ''} ${kids.length ? 'group' : ''}" data-cat="${c.id}" style="--c:${c.color};--depth:${depth}">
        ${kids.length ? `<button class="cat-fold" data-fold title="${open ? 'Plegar' : 'Ver subcategorías'}">${open ? '▾' : '▸'}</button>` : '<span class="cat-fold"></span>'}
        <button class="cat-vis" data-vis title="${c.visible === false ? 'Mostrar' : 'Ocultar'} en el calendario" aria-pressed="${c.visible !== false}"></button>
        <span class="cat-name" ${kids.length ? 'data-fold' : 'data-edit'} title="${kids.length ? `${kids.length} subcategorías: pulsa para ${open ? 'plegarlas' : 'verlas'}` : 'Pulsa para editar'}">${c.icon ? c.icon + ' ' : ''}${esc(c.name)}${kids.length && !open ? ` <span class="muted small">(${kids.length})</span>` : ''}</span>
        ${c.inAgenda === false ? '<span class="cat-flag" title="Fuera de la agenda">🚫</span>' : ''}
        <span class="cat-count">${(kids.length ? total(c.id) : counts.get(c.id)) || ''}</span>
        <button class="icon-btn cat-more" data-more title="Más opciones">⋯</button>
      </li>`);
      if (kids.length && open) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  const unc = counts.get(null) ?? 0;
  el.innerHTML = `<div class="side-head"><h3>Categorías</h3>
      <button class="icon-btn" data-act="solo-off" title="Mostrar todas">👁</button>
      <button class="icon-btn" data-act="cat-add" title="Nueva categoría">＋</button></div>
    <form class="cat-quick" hidden><input class="input" placeholder="Nombre y Enter (p. ej. Física)" name="n"></form>
    <ul class="cat-tree">${rows.join('')}
      ${unc ? `<li class="cat-row ${st.ui.showUncategorized === false ? 'off' : ''}" data-cat="" style="--c:#9ca3af;--depth:0"><span class="cat-fold"></span><button class="cat-vis" data-vis></button><span class="cat-name muted">Sin categoría</span><span class="cat-count">${unc}</span></li>` : ''}
    </ul>`;
}

export function wireCategoryTree(el) {
  el.addEventListener('click', (e) => {
    const t = e.target;
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'cat-add') {
      const f = el.querySelector('.cat-quick');
      f.hidden = !f.hidden;
      if (!f.hidden) f.n.focus();
      return;
    }
    if (act === 'solo-off') {
      store.quiet((s) => {
        s.categories.forEach((c) => (c.visible = true));
        s.ui.showUncategorized = true;
      }, true);
      return;
    }
    const row = t.closest('[data-cat]');
    if (!row) return;
    const id = row.dataset.cat || null;
    if (t.closest('[data-vis]')) {
      if (!id) store.quiet((s) => (s.ui.showUncategorized = s.ui.showUncategorized === false), true);
      else store.quiet(() => {
        const c = store.getCategory(id);
        c.visible = c.visible === false;
      }, true);
      return;
    }
    if (t.closest('[data-fold]')) {
      store.quiet((s) => (s.ui.expanded[id] = !s.ui.expanded[id]), true);
      return;
    }
    if (!id) return;
    if (t.closest('[data-more]')) return categoryMenu(t.closest('[data-more]'), id);
    if (t.closest('[data-edit]')) return openCategory(id);
  });
  el.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.n.value.trim();
    if (!name) return;
    const cat = store.newCategory({ name, color: nextFreeColor(store.get().categories.map((c) => c.color)) });
    store.mutate('Nueva categoría', (s) => s.categories.push(cat));
    toast(`Categoría «${name}» creada`);
    requestAnimationFrame(() => {
      const f = el.querySelector('.cat-quick');
      f.hidden = false;
      f.n.focus();
    });
  });
}

function categoryMenu(anchor, id) {
  const c = store.getCategory(id);
  floatingMenu(anchor, `<div class="menu">
    <button data-v="edit">✎ Editar…</button>
    <button data-v="color">🎨 Cambiar color</button>
    <button data-v="solo">👁 Ver solo esta</button>
    <button data-v="agenda">${c.inAgenda === false ? '📅 Meter en la agenda' : '🚫 Sacar de la agenda'}</button>
    <hr>
    <button data-v="event">＋ Evento en esta categoría</button>
    <button data-v="task">＋ Tarea en esta categoría</button>
    <button data-v="plan">＋ Planning para esta categoría</button>
    <button data-v="sub">＋ Subcategoría</button>
    ${duplicateSubjects(id) ? `<button data-v="unify">🧩 Unir asignaturas repetidas (TEORIA/PROB/grupos)</button>` : ''}
    <hr>
    <button data-v="del" class="danger">🗑 Eliminar…</button>
  </div>`, (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (!v) return false;
    switch (v) {
      case 'edit': return openCategory(id);
      case 'color':
        setTimeout(() => openColorPicker(anchor, c.color, (col) => store.mutate('Color', () => (store.getCategory(id).color = col))));
        return;
      case 'solo':
        return store.quiet((s) => {
          const keep = new Set([...store.categoryWithDescendants(id), ...store.categoryChain(id).map((x) => x.id)]);
          s.categories.forEach((x) => (x.visible = keep.has(x.id)));
          s.ui.showUncategorized = false;
        }, true);
      case 'agenda':
        return store.mutate('Agenda', () => (store.getCategory(id).inAgenda = c.inAgenda === false));
      case 'event':
      case 'task':
        return ctx.openEditor({ categoryId: id, type: v });
      case 'plan':
        return ctx.openEditor({ categoryId: id, type: 'plan', title: `Planning de ${c.name}` });
      case 'sub': {
        const sub = store.newCategory({ name: 'Subcategoría', parentId: id, color: c.color, icon: c.icon });
        store.mutate('Nueva subcategoría', (s) => {
          s.categories.push(sub);
          s.ui.expanded[id] = true;
        });
        return openCategory(sub.id);
      }
      case 'unify': {
        const n = unifySubjects(id);
        store.quiet((s) => (s.ui.expanded[id] = true), true);
        return toast(`Unidas ${n} subcategorías repetidas`, { action: ctx.undo });
      }
      case 'del': return deleteCategory(id);
    }
  });
}

export async function deleteCategory(id) {
  const c = store.getCategory(id);
  const ids = store.categoryWithDescendants(id);
  const n = store.get().items.filter((i) => ids.includes(i.categoryId)).length;
  return new Promise((resolve) => {
    openModal({
      title: `Eliminar «${c.name}»`,
      onClose: resolve,
      build(body, close) {
        body.innerHTML = `<p>${ids.length > 1 ? `Incluye ${ids.length - 1} subcategoría(s). ` : ''}Tiene ${n} elemento(s).</p>
          <div class="scope-list">
            <button class="btn block" data-d="keep">Eliminar la categoría y dejar sus elementos «Sin categoría»</button>
            <button class="btn block danger" data-d="all">Eliminar la categoría y todos sus elementos</button>
            <button class="btn block" data-close>Cancelar</button>
          </div>`;
        body.onclick = (e) => {
          const d = e.target.closest('[data-d]')?.dataset.d;
          if (!d) return;
          store.mutate('Eliminar categoría', (s) => {
            if (d === 'all') s.items = s.items.filter((i) => !ids.includes(i.categoryId));
            else s.items.forEach((i) => ids.includes(i.categoryId) && (i.categoryId = null));
            s.categories = s.categories.filter((x) => !ids.includes(x.id));
          });
          toast('Categoría eliminada', { action: ctx.undo });
          close();
        };
      },
    });
  });
}

// ---------------- Editor de categoría ----------------

export function openCategory(id) {
  const orig = store.getCategory(id);
  if (!orig) return;
  const c = structuredClone(orig);
  openModal({
    title: 'Categoría',
    wide: true,
    build(body, close) {
      const render = () => {
        const st = store.get();
        const ids = store.categoryWithDescendants(id);
        const items = st.items.filter((i) => ids.includes(i.categoryId));
        const now = startOfDay(new Date());
        const week = engine.instancesInRange(now, addDays(now, 7), { all: true, categoryIds: ids }).filter((i) => i.kind === 'item' && !i.allDay);
        const hours = week.reduce((a, i) => a + (i.end - i.start) / 3600000, 0);
        const parents = st.categories.filter((x) => !ids.includes(x.id));
        const kids = store.childrenOf(id);
        body.innerHTML = `<form class="cat-form">
          <div class="title-row">
            <button type="button" class="emoji-btn" data-act="emoji">${c.icon || '🙂'}</button>
            <input class="input big" name="name" value="${esc(c.name)}" placeholder="Nombre">
            ${colorButton('color', c.color)}
          </div>
          <div class="stats">${items.filter((i) => i.type === 'event').length} eventos · ${items.filter((i) => i.type === 'task').length} tareas · ${items.filter((i) => i.type === 'plan').length} plannings · <b>${hours.toFixed(1)} h</b> en los próximos 7 días</div>
          <fieldset class="box"><legend>Comportamiento</legend>
            <div class="row wrap">
              <label class="field">Dentro de
                <select class="input" name="parentId"><option value="">— (nivel superior)</option>
                ${parents.map((p) => `<option value="${p.id}" ${p.id === c.parentId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
              <label class="field">Tipo por defecto
                <select class="input" name="defaultType">
                  ${[['event', 'Evento'], ['task', 'Tarea'], ['plan', 'Planning']].map(([v, l]) => `<option value="${v}" ${c.defaultType === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select></label>
              <label class="field">Duración por defecto (min)<input type="number" min="5" step="5" class="input num" name="defaultDuration" value="${c.defaultDuration ?? 60}"></label>
              <label class="field">Texto en la vista mensual
                <select class="input" name="monthText">
                  ${[['auto', c.parentId ? 'Como la categoría superior' : 'Según Ajustes'], ['full', 'Hora y título'], ['short', 'Solo título'], ['color', 'Solo color']].map(([v, l]) => `<option value="${v}" ${(c.monthText ?? 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select></label>
            </div>
            <label class="check"><input type="checkbox" name="inAgenda" ${c.inAgenda !== false ? 'checked' : ''}> Sus elementos entran en la agenda (si no, siguen en el calendario pero sin avisos automáticos ni en la vista Agenda)</label>
            <label class="check"><input type="checkbox" name="skipHolidays" ${c.skipHolidays ? 'checked' : ''}> Respetar los periodos festivos / sin clases (definidos en Ajustes)</label>
            <label class="check"><input type="checkbox" name="visible" ${c.visible !== false ? 'checked' : ''}> Visible en el calendario</label>
          </fieldset>
          <fieldset class="box"><legend>Avisos por defecto</legend>
            <label class="check"><input type="checkbox" name="ownRem" ${Array.isArray(c.reminders) ? 'checked' : ''}> Avisos propios para esta categoría</label>
            ${Array.isArray(c.reminders) ? remindersHTML(c.reminders) : '<div class="muted small">Hereda los de la categoría superior o los de Ajustes.</div>'}
          </fieldset>
          <fieldset class="box"><legend>Acciones en bloque</legend>
            <div class="row wrap center">Desplazar todos sus eventos
              <input type="number" class="input num" name="shiftVal" value="30">
              <select class="input" name="shiftUnit"><option value="1">min</option><option value="60">horas</option><option value="1440">días</option></select>
              a partir del <input type="date" class="input" name="shiftFrom" value="${dateKey(new Date())}">
              <button type="button" class="btn" data-act="shift-earlier">⬆ Antes</button>
              <button type="button" class="btn" data-act="shift-later">⬇ Después</button>
            </div>
            <div class="row wrap">
              <button type="button" class="btn small" data-act="all-in">📅 Meter todos sus elementos en la agenda</button>
              <button type="button" class="btn small" data-act="all-out">🚫 Sacar todos de la agenda</button>
              <button type="button" class="btn small" data-act="newplan">🗺️ Nuevo planning vinculado</button>
            </div>
            ${kids.length ? `<div class="row wrap center">Recolorear subcategorías con la paleta
              <select class="input" name="palette">${Object.keys(NAMED_PALETTES).map((n) => `<option>${n}</option>`).join('')}</select>
              <button type="button" class="btn small" data-act="recolor">Aplicar</button></div>` : ''}
          </fieldset>
          <div class="modal-actions">
            <button type="button" class="btn danger" data-act="delete">Eliminar…</button>
            <span class="grow"></span>
            <button type="button" class="btn" data-close>Cancelar</button>
            <button class="btn primary">Guardar</button>
          </div>
        </form>`;
        wireColorButtons(body, (col) => (c.color = col));
      };

      body.addEventListener('input', (e) => {
        const t = e.target;
        if (t.name === 'name') c.name = t.value;
      });
      body.addEventListener('change', (e) => {
        const t = e.target;
        switch (t.name) {
          case 'parentId': c.parentId = t.value || null; break;
          case 'defaultType': c.defaultType = t.value; break;
          case 'defaultDuration': c.defaultDuration = Math.max(5, +t.value || 60); break;
          case 'monthText': c.monthText = t.value; break;
          case 'inAgenda': c.inAgenda = t.checked; break;
          case 'skipHolidays': c.skipHolidays = t.checked; break;
          case 'visible': c.visible = t.checked; break;
          case 'ownRem':
            c.reminders = t.checked ? structuredClone(store.get().settings.defaultReminders ?? []) : null;
            render();
            break;
        }
      });
      wireReminders(body, () => c.reminders, render);

      body.addEventListener('submit', (e) => {
        e.preventDefault();
        c.name = c.name.trim() || 'Categoría';
        store.mutate('Guardar categoría', (s) => {
          const i = s.categories.findIndex((x) => x.id === id);
          if (i >= 0) s.categories[i] = c;
        });
        close();
      });

      body.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        const q = (n) => body.querySelector(`[name=${n}]`);
        const ids = store.categoryWithDescendants(id);
        switch (act) {
          case 'emoji':
            floatingMenu(e.target.closest('[data-act]'), `<div class="emoji-grid">${EMOJIS.map((x) => `<button type="button" data-v="${x}">${x}</button>`).join('')}<button type="button" data-v="" class="wide">Sin icono</button></div>`, (ev) => {
              const b = ev.target.closest('[data-v]');
              if (!b) return false;
              c.icon = b.dataset.v;
              render();
            });
            break;
          case 'shift-earlier':
          case 'shift-later': {
            const delta = (+q('shiftVal').value || 0) * +q('shiftUnit').value * (act === 'shift-earlier' ? -1 : 1);
            if (!delta) return;
            store.mutate('Desplazar categoría', () => engine.shiftCategory(ids, delta, q('shiftFrom').value || null));
            toast(`Eventos de «${c.name}» desplazados`, { action: ctx.undo });
            render();
            break;
          }
          case 'all-in':
          case 'all-out':
            store.mutate('Agenda en bloque', (s) => {
              s.items.forEach((i) => ids.includes(i.categoryId) && (i.inAgenda = null));
              store.getCategory(id).inAgenda = act === 'all-in';
            });
            c.inAgenda = act === 'all-in';
            render();
            break;
          case 'newplan':
            close();
            ctx.openEditor({ categoryId: id, type: 'plan', title: `Planning de ${c.name}` });
            break;
          case 'recolor': {
            const pal = NAMED_PALETTES[q('palette').value];
            store.mutate('Recolorear', () => store.childrenOf(id).forEach((k, i) => (k.color = pal[i % pal.length])));
            render();
            break;
          }
          case 'delete':
            close();
            deleteCategory(id);
            break;
        }
      });
      render();
    },
  });
}
