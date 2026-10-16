// Selector de categoría en árbol: las subcategorías están plegadas y se abren
// pulsando su categoría (o la flecha). Tiene buscador y permite crear categorías.
import * as store from '../store.js';
import { nextFreeColor } from '../palette.js';
import { floatingMenu, promptDialog } from './dom.js';
import { esc, norm } from '../util.js';

/** Texto «Grupo › Subcategoría» de una categoría */
export function categoryPath(id) {
  const chain = store.categoryChain(id).reverse();
  return chain.length ? chain.map((c) => `${c.icon ? c.icon + ' ' : ''}${c.name}`).join(' › ') : 'Sin categoría';
}

/** Botón que muestra la categoría elegida (se usa con data-act="pickcat") */
export function categoryButtonHTML(id, act = 'pickcat') {
  const c = store.getCategory(id);
  // Primero la categoría y después, en gris, dónde está (así en el móvil no se corta lo importante)
  const parents = store.categoryChain(id).slice(1).reverse().map((p) => p.name).join(' › ');
  const label = c ? `${c.icon ? c.icon + ' ' : ''}${esc(c.name)}${parents ? ` <span class="muted small">· ${esc(parents)}</span>` : ''}` : 'Sin categoría';
  return `<button type="button" class="input cat-pick" data-act="${act}" title="${esc(categoryPath(id))}"><span class="cat-dot" style="--c:${c?.color ?? '#9ca3af'}"></span><span class="cat-pick-t">${label}</span><span class="muted">▾</span></button>`;
}

export function openCategoryPicker(anchor, selectedId, onPick) {
  const expanded = new Set(store.categoryChain(selectedId).slice(1).map((c) => c.id));
  let query = '';

  const rowsHTML = () => {
    const st = store.get();
    const rows = [];
    if (query) {
      const q = norm(query);
      st.categories.filter((c) => norm(c.name).includes(q)).forEach((c) => rows.push(row(c, 0, false, true)));
      if (!rows.length) rows.push(`<div class="muted small pad">Sin resultados. Pulsa «＋ Crear "${esc(query)}"».</div>`);
      return rows.join('');
    }
    rows.push(`<div class="cp-row-cat ${selectedId ? '' : 'sel'}" style="--depth:0"><span class="cat-fold"></span><button type="button" class="cp-cat" data-v="">Sin categoría</button></div>`);
    const walk = (parentId, depth) => {
      for (const c of st.categories.filter((x) => (x.parentId ?? null) === parentId)) {
        const kids = store.childrenOf(c.id).length > 0;
        rows.push(row(c, depth, kids));
        if (kids && expanded.has(c.id)) {
          // Opción para elegir la propia categoría superior
          rows.push(`<div class="cp-row-cat ${c.id === selectedId ? 'sel' : ''}" style="--depth:${depth + 1}"><span class="cat-fold"></span>
            <button type="button" class="cp-cat muted" data-v="${c.id}"><span class="cat-dot" style="--c:${c.color}"></span>Todo «${esc(c.name)}» (sin subcategoría)</button></div>`);
          walk(c.id, depth + 1);
        }
      }
    };
    walk(null, 0);
    return rows.join('');
  };
  const row = (c, depth, kids, showPath = false) => `<div class="cp-row-cat ${c.id === selectedId ? 'sel' : ''}" style="--depth:${depth}">
      ${kids ? `<button type="button" class="cat-fold" data-fold="${c.id}" title="Ver subcategorías">${expanded.has(c.id) ? '▾' : '▸'}</button>` : '<span class="cat-fold"></span>'}
      <button type="button" class="cp-cat" ${kids ? `data-fold="${c.id}"` : `data-v="${c.id}"`}><span class="cat-dot" style="--c:${c.color}"></span>${esc(showPath ? categoryPath(c.id) : `${c.icon ? c.icon + ' ' : ''}${c.name}`)}
        ${kids ? `<span class="muted small">${store.childrenOf(c.id).length} ${expanded.has(c.id) ? '▴' : '▾'}</span>` : ''}</button>
      <button type="button" class="icon-btn small" data-sub="${c.id}" title="Nueva subcategoría dentro de «${esc(c.name)}»">＋</button>
    </div>`;

  const close = floatingMenu(anchor, `<div class="catpick">
      <input class="input" placeholder="Buscar o crear categoría…" data-q>
      <div class="catpick-list">${rowsHTML()}</div>
      <button type="button" class="btn small block" data-new>＋ Nueva categoría</button>
    </div>`, (e) => {
    const t = e.target;
    const fold = t.closest('[data-fold]');
    if (fold) {
      const id = fold.dataset.fold;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      refresh();
      return false;
    }
    const sub = t.closest('[data-sub]');
    if (sub) {
      create(sub.dataset.sub);
      return false;
    }
    if (t.closest('[data-new]')) {
      create(null, query);
      return false;
    }
    const v = t.closest('[data-v]');
    if (!v) return false;
    onPick(v.dataset.v || null);
  });
  const menu = document.querySelector('.float-menu');
  const list = menu.querySelector('.catpick-list');
  const input = menu.querySelector('[data-q]');
  const refresh = () => (list.innerHTML = rowsHTML());
  input.addEventListener('input', () => {
    query = input.value.trim();
    refresh();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = list.querySelector('[data-v]:not([data-v=""])');
      if (query && first && norm(first.textContent).includes(norm(query))) {
        onPick(first.dataset.v);
        close();
      } else create(null, query);
    }
  });
  setTimeout(() => input.focus());

  async function create(parentId, name = '') {
    close();
    const parent = store.getCategory(parentId);
    const n = name || (await promptDialog(parent ? `Nueva subcategoría en «${parent.name}»` : 'Nueva categoría', '', { placeholder: 'p. ej. Física, Gimnasio, Trabajo…' }));
    if (!n) return;
    const cat = store.newCategory({
      name: n, parentId: parent?.id ?? null, icon: parent?.icon ?? '',
      color: nextFreeColor(store.get().categories.map((c) => c.color)),
    });
    store.mutate('Nueva categoría', (s) => s.categories.push(cat));
    if (parent) store.quiet((s) => (s.ui.expanded[parent.id] = true));
    onPick(cat.id);
  }
  return close;
}
