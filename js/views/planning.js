// Vista Planning: plannings agrupados por categoría (p. ej. por asignatura),
// tareas sin fecha y elementos que están fuera de la agenda.
import * as store from '../store.js';
import { instancesInRange, isPlanArchived, pendingTasks, planEnd, planProgress } from '../engine.js';
import { describeRule } from '../recurrence.js';
import { ctx } from '../ui/dom.js';
import { categoryButtonHTML, openCategoryPicker } from '../ui/catpicker.js';

let newPlanCat = null; // categoría elegida para el próximo planning
import { addDays, diffDays, esc, fmtDate, fmtDuration, fmtTime, parseLocal, startOfDay, toLocalISO, uid } from '../util.js';

function deadlineBadge(k) {
  if (!k) return '';
  const d = diffDays(new Date(), parseLocal(k));
  const cls = d < 0 ? 'late' : d <= 3 ? 'soon' : '';
  const txt = d < 0 ? `venció hace ${-d} d` : d === 0 ? 'vence hoy' : d === 1 ? 'vence mañana' : `en ${d} días`;
  return `<span class="badge ${cls}" title="${fmtDate(parseLocal(k))}">🏁 ${txt}</span>`;
}

function planCard(p) {
  const prog = planProgress(p);
  const steps = p.steps ?? [];
  const agenda = store.inAgenda(p);
  return `<article class="plan-card ${p.done ? 'done' : ''}" data-plan="${p.id}" style="--c:${store.itemColor(p)}">
    <header>
      <h4 data-edit>${store.itemIcon(p) ? store.itemIcon(p) + ' ' : '🗺️ '}${esc(p.title || '(sin título)')}</h4>
      ${deadlineBadge(p.deadline)}
      <button class="icon-btn agenda-toggle ${agenda ? 'on' : ''}" data-agenda title="${agenda ? 'Está en la agenda: pulsa para sacarlo' : 'Fuera de la agenda: pulsa para añadirlo'}">${agenda ? '📅' : '🚫'}</button>
      <button class="icon-btn" data-edit title="Editar">✎</button>
    </header>
    ${prog != null ? `<div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div><div class="muted small">${steps.filter((s) => s.done).length}/${steps.length} pasos</div>` : ''}
    ${p.start ? `<div class="plan-sessions">🗓 ${p.recurrence ? esc(describeRule(p.recurrence, p.start)) : fmtDate(parseLocal(p.start))}${p.allDay ? '' : ` · ${p.start.slice(11)} (${fmtDuration(p.duration)})`}</div>` : ''}
    ${p.notes ? `<p class="plan-notes">${esc(p.notes)}</p>` : ''}
    <ul class="steps">
      ${steps.map((s) => `<li data-step="${s.id}" class="${s.done ? 'done' : ''}">
        <span class="chip-check" data-step-check>${s.done ? '✔' : ''}</span>
        <input class="step-text" value="${esc(s.text)}" aria-label="Paso">
        <input type="date" class="step-date" value="${s.date ?? ''}" title="Fecha en la agenda (opcional)">
        <button class="icon-btn" data-step-del title="Quitar paso">✕</button>
      </li>`).join('')}
    </ul>
    <form class="add-step"><input class="input" placeholder="＋ Añadir paso…" name="t"><input type="date" name="d" title="Fecha (opcional)"><button class="btn small">Añadir</button></form>
  </article>`;
}

let showArchived = false; // ver los plannings que terminaron hace más de 3 días

export function renderPlanning(el) {
  const st = store.get();
  const allPlans = st.items.filter((i) => i.type === 'plan');
  // Los terminados hace más de 3 días salen de esta pestaña (siguen en el calendario)
  const archived = allPlans.filter((p) => isPlanArchived(p));
  const plans = allPlans.filter((p) => !archived.includes(p));
  const groups = new Map();
  for (const p of plans) {
    const k = p.categoryId ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const now = new Date();
  if (newPlanCat && !store.getCategory(newPlanCat)) newPlanCat = null;

  let html = `<div class="planning">
    <div class="planning-main">
      <div class="plan-toolbar">
        <h2>Planning</h2>
        <form class="new-plan">
          <input class="input" name="title" placeholder="Nuevo planning (p. ej. Preparar examen parcial)" required>
          ${categoryButtonHTML(newPlanCat, 'newplan-cat')}
          <button class="btn primary">Crear</button>
        </form>
      </div>`;
  if (!allPlans.length) {
    html += `<div class="empty">
      <p><b>¿Qué es un planning?</b> Un plan con pasos (y fechas opcionales) vinculado a una categoría.
      Por ejemplo, pon cada asignatura del horario en su categoría y crea aquí su planning de estudio:
      verás la próxima clase junto a tus pasos y podrás llevar los pasos a la agenda cuando quieras.</p></div>`;
  }
  for (const [catId, list] of groups) {
    const cat = store.getCategory(catId);
    let info = '';
    if (cat) {
      const ids = store.categoryWithDescendants(cat.id);
      const upcoming = instancesInRange(now, addDays(now, 30), { all: true, categoryIds: ids, types: ['event'] }).filter((i) => i.start >= now);
      const week = upcoming.filter((i) => i.start < addDays(now, 7)).length;
      if (upcoming[0]) info = `Próximo: <b>${esc(upcoming[0].title)}</b> · ${fmtDate(upcoming[0].start)} ${upcoming[0].allDay ? '' : fmtTime(upcoming[0].start)} · ${week} evento${week === 1 ? '' : 's'} esta semana`;
    }
    html += `<section class="plan-group" style="--c:${cat?.color ?? '#888'}">
      <header class="plan-group-head">
        <span class="cat-dot big" style="--c:${cat?.color ?? '#888'}"></span>
        <h3>${cat ? (cat.icon ? cat.icon + ' ' : '') + esc(cat.name) : 'Sin categoría'}</h3>
        ${cat ? `<button class="btn small" data-cat-edit="${cat.id}">Categoría…</button>` : ''}
        ${info ? `<div class="plan-group-info">${info}</div>` : ''}
      </header>
      <div class="plan-cards">${list.sort((a, b) => (a.deadline ?? '9') < (b.deadline ?? '9') ? -1 : 1).map(planCard).join('')}</div>
    </section>`;
  }
  if (archived.length) {
    html += `<section class="plan-archive">
      <button class="btn small" data-toggle-archive>📦 ${showArchived ? 'Ocultar' : 'Ver'} terminados (${archived.length})</button>
      <span class="muted small">Los plannings salen de aquí 3 días después de terminar; en el calendario siguen apareciendo.</span>
      ${showArchived ? `<div class="plan-cards">${archived.sort((a, b) => (planEnd(b) ?? 0) - (planEnd(a) ?? 0)).map(planCard).join('')}</div>` : ''}
    </section>`;
  }
  html += '</div>';

  // Columna lateral
  const undated = st.items.filter((i) => i.type === 'task' && !i.start && !i.done);
  const outside = st.items.filter((i) => !store.inAgenda(i));
  const today0 = startOfDay(now);
  const pend = pendingTasks(now).filter((i) => i.pending === 'overdue' || i.start < today0);
  html += `<aside class="planning-side">
    <section class="side-box"><h3>⏳ Pendientes <span class="count">${pend.length}</span></h3>
      <p class="muted small">Tareas vencidas sin completar y tareas sin fin que siguen en curso. Se quedan aquí hasta que las completes.</p>
      ${pend.length ? pend.map((t) => `<div class="mini-row" data-inst="${t.id}" style="--c:${t.color}">
          <span class="chip-check" data-pend-done></span>
          <span class="mini-t" data-pend-open title="${t.pending === 'overdue' ? 'Venció' : 'En curso desde'} el ${fmtDate(t.pending === 'overdue' ? t.end : t.start)}">${t.pending === 'overdue' ? '⚠' : '∞'} ${esc(t.title)}</span>
          <button class="btn small" data-pend-move="0">Hoy</button><button class="btn small" data-pend-move="1">Mañana</button></div>`).join('') : '<p class="muted small">Nada pendiente. 🎉</p>'}
    </section>
    <section class="side-box"><h3>✅ Tareas sin fecha <span class="count">${undated.length}</span></h3>
      ${undated.length ? undated.map((t) => `<div class="mini-row" data-item="${t.id}" style="--c:${store.itemColor(t)}">
          <span class="chip-check" data-item-done></span><span class="mini-t" data-item-edit>${esc(t.title)}</span>
          <button class="btn small" data-when="0">Hoy</button><button class="btn small" data-when="1">Mañana</button></div>`).join('') : '<p class="muted small">Nada pendiente sin fecha.</p>'}
    </section>
    <section class="side-box"><h3>🚫 Fuera de la agenda <span class="count">${outside.length}</span></h3>
      <p class="muted small">Existen pero no aparecen en el calendario. Pulsa 📅 para meterlos.</p>
      ${outside.map((t) => `<div class="mini-row" data-item="${t.id}" style="--c:${store.itemColor(t)}">
          <span class="cat-dot" style="--c:${store.itemColor(t)}"></span><span class="mini-t" data-item-edit>${esc(t.title)}</span>
          <button class="icon-btn" data-item-agenda title="Añadir a la agenda">📅</button></div>`).join('')}
    </section>
  </aside></div>`;
  el.innerHTML = html;
  wire(el.querySelector('.planning'));
}

function wire(root) {
  const planOf = (e) => store.getItem(e.target.closest('[data-plan]')?.dataset.plan);

  root.querySelector('.new-plan').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    // Se abre el editor con una sesión ya programada (próxima media hora), para ajustarla o quitarla
    ctx.openEditor({ type: 'plan', title: f.title.value.trim(), categoryId: newPlanCat ?? undefined });
    f.title.value = '';
  });

  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-toggle-archive]')) {
      showArchived = !showArchived;
      return ctx.render();
    }
    if (t.closest('[data-cat-edit]')) return ctx.openCategory(t.closest('[data-cat-edit]').dataset.catEdit);
    const pick = t.closest('[data-act="newplan-cat"]');
    if (pick) {
      const title = root.querySelector('.new-plan [name=title]').value;
      return openCategoryPicker(pick, newPlanCat, (id) => {
        newPlanCat = id;
        ctx.render();
        const inp = document.querySelector('.new-plan [name=title]');
        if (inp) inp.value = title;
      });
    }
    const plan = planOf(e);
    if (plan) {
      if (t.closest('[data-edit]')) return ctx.openEditor({ itemId: plan.id });
      if (t.closest('[data-agenda]')) {
        const v = !store.inAgenda(plan);
        return store.mutate(v ? 'Añadido a la agenda' : 'Quitado de la agenda', () => (plan.inAgenda = v));
      }
      const li = t.closest('[data-step]');
      if (li) {
        const sid = li.dataset.step;
        if (t.closest('[data-step-check]')) {
          return store.mutate('Paso', () => {
            const s = plan.steps.find((x) => x.id === sid);
            s.done = !s.done;
            s.doneAt = s.done ? Date.now() : null; // para saber cuándo terminó el planning
          });
        }
        if (t.closest('[data-step-del]')) return store.mutate('Quitar paso', () => (plan.steps = plan.steps.filter((x) => x.id !== sid)));
      }
    }
    const prow = t.closest('[data-inst]');
    if (prow) {
      if (t.closest('[data-pend-done]')) return ctx.toggleDone(prow.dataset.inst);
      if (t.closest('[data-pend-move]')) return ctx.moveTaskToDay(prow.dataset.inst, +t.closest('[data-pend-move]').dataset.pendMove);
      if (t.closest('[data-pend-open]')) return ctx.openPopover(prow.dataset.inst, prow);
    }
    const row = t.closest('[data-item]');
    if (row) {
      const item = store.getItem(row.dataset.item);
      if (!item) return;
      if (t.closest('[data-item-edit]')) return ctx.openEditor({ itemId: item.id });
      if (t.closest('[data-item-done]')) return store.mutate('Tarea completada', () => (item.done = true));
      if (t.closest('[data-item-agenda]')) return store.mutate('Añadido a la agenda', () => (item.inAgenda = true));
      const when = t.closest('[data-when]');
      if (when) {
        const d = addDays(startOfDay(new Date()), +when.dataset.when);
        return store.mutate('Tarea programada', () => {
          item.start = toLocalISO(d);
          item.allDay = true;
          item.duration = 1440;
        });
      }
    }
  });

  root.addEventListener('change', (e) => {
    const plan = planOf(e);
    const li = e.target.closest('[data-step]');
    if (!plan || !li) return;
    const s = plan.steps.find((x) => x.id === li.dataset.step);
    if (!s) return;
    if (e.target.classList.contains('step-text')) store.mutate('Editar paso', () => (s.text = e.target.value.trim()));
    if (e.target.classList.contains('step-date')) store.mutate('Fecha de paso', () => (s.date = e.target.value || null));
  });

  root.querySelectorAll('.add-step').forEach((f) =>
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const plan = planOf(e);
      const text = f.t.value.trim();
      if (!plan || !text) return;
      store.mutate('Añadir paso', () => (plan.steps = [...(plan.steps ?? []), { id: uid(), text, done: false, date: f.d.value || null }]));
      requestAnimationFrame(() => root.querySelector(`[data-plan="${plan.id}"] .add-step input`)?.focus());
    }),
  );
}
