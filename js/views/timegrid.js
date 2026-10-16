// Vista de horas (día / 3 días / semana) con arrastrar para mover, estirar y crear.
import * as store from '../store.js';
import { findInstance, instancesInRange } from '../engine.js';
import { ctx } from '../ui/dom.js';
import { chipHTML, enableChipDnD } from './shared.js';
import {
  addDays, addMinutes, dateKey, DAY_SHORT, esc, fmtTime, minutesOfDay, sameDay, startOfDay, textOn, rgba,
} from '../util.js';

const SNAP = 15;

function layoutDay(segs) {
  // Agrupa solapados y asigna columnas
  segs.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], cols = [], clusterEnd = -1;
  const flush = () => {
    const n = cols.length;
    cluster.forEach((x) => (x.n = n));
    cluster = [];
    cols = [];
  };
  for (const seg of segs) {
    if (seg.s >= clusterEnd && cluster.length) flush();
    let c = cols.findIndex((end) => end <= seg.s);
    if (c < 0) {
      c = cols.length;
      cols.push(seg.e);
    } else cols[c] = seg.e;
    seg.col = c;
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, seg.e);
  }
  flush();
  // Expandir a la derecha si las columnas vecinas están libres
  return segs;
}

export function eventStyleVars(color) {
  const st = store.get().settings;
  if (st.eventStyle === 'soft') return `--c:${color};--bg:${rgba(color, 0.22)};--fg:inherit`;
  return `--c:${color};--bg:${color};--fg:${textOn(color)}`;
}

const overlaps = (a, b) => a.s < b.e && b.s < a.e;

/**
 * Coloca los bloques de un día. Los plannings no empujan a los eventos: se dibujan
 * encima, semitransparentes, cuando coinciden con un evento. Si dos plannings
 * coinciden entre sí se ponen uno al lado del otro y se marcan con ⚠.
 */
function dayHTML(segs, hh, dayStartMin) {
  const plans = segs.filter((x) => x.inst.item.type === 'plan');
  const others = segs.filter((x) => x.inst.item.type !== 'plan');
  layoutDay(others);
  layoutDay(plans);
  let clashes = 0;
  // El evento que queda debajo de un planning es el que se vuelve translúcido
  for (const o of others) o.under = plans.some((p) => overlaps(o, p));
  for (const p of plans) {
    p.over = others.some((o) => overlaps(o, p));
    p.clash = plans.some((q) => q !== p && overlaps(q, p));
    if (p.clash) clashes++;
  }
  const html = [...others, ...plans].map((seg) => eventHTML(seg.inst, seg, hh, dayStartMin)).join('');
  return { html, clashes: clashes ? Math.max(2, clashes) : 0 };
}

function eventHTML(inst, seg, hh, dayStartMin) {
  const top = ((seg.s - dayStartMin) / 60) * hh;
  const height = Math.max(((seg.e - seg.s) / 60) * hh - 2, 16);
  const w = 100 / seg.n;
  // Un planning encima de un evento deja ver a la izquierda el texto del evento
  // (si hay varios plannings a la vez ya van repartidos y no se desplazan más)
  const shift = seg.over && seg.n === 1;
  const left = shift ? 28 : seg.col * w;
  const width = shift ? 72 : w;
  const it = inst.item;
  // En las vistas de horas lo que está fuera de la agenda se ve igual que el resto
  const cls = ['ev', it.type, inst.done ? 'done' : '', ctx.selected === inst.id ? 'sel' : '', height < 34 ? 'short' : '',
    seg.over ? 'plan-over' : '', seg.under ? 'under-plan' : '', seg.clash ? 'clash' : ''].join(' ');
  const time = `${fmtTime(inst.start)}–${fmtTime(inst.end)}`;
  const check = it.type === 'task' ? `<span class="ev-check" data-check="${inst.id}">${inst.done ? '✔' : ''}</span>` : '';
  return `<div class="${cls}" data-inst="${inst.id}" style="top:${top}px;height:${height}px;left:calc(${left}% + 1px);width:calc(${width}% - 3px);${eventStyleVars(inst.color)}"${seg.clash ? ' title="Este planning se solapa con otro planning"' : ''}>
    <div class="ev-t">${seg.clash ? '<span class="clash-i">⚠</span>' : ''}${check}${inst.icon ? `<span class="ev-i">${inst.icon}</span>` : ''}${esc(inst.title)}${inst.recurring ? ' <span class="ev-r">↻</span>' : ''}</div>
    <div class="ev-s">${time}${it.location ? ' · ' + esc(it.location) : ''}</div>
    <div class="ev-resize" title="Arrastra para cambiar la duración"></div>
  </div>`;
}

export function renderTimeGrid(el, { start, days }) {
  const st = store.get().settings;
  const hh = st.hourHeight || 52;
  const dayStartMin = (st.dayStart ?? 0) * 60;
  const dayEndMin = (st.dayEnd ?? 24) * 60;
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const end = addDays(start, days);
  const insts = instancesInRange(start, end);
  const today = new Date();

  const allDay = dates.map(() => []);
  const timed = dates.map(() => []);
  for (const inst of insts) {
    if (inst.allDay) {
      dates.forEach((d, i) => {
        if (inst.start < addDays(d, 1) && inst.end > d) allDay[i].push(inst);
      });
      continue;
    }
    dates.forEach((d, i) => {
      const d0 = d.getTime(), d1 = addDays(d, 1).getTime();
      if (inst.end <= d0 || inst.start >= d1) return;
      const s = inst.start.getTime() <= d0 ? 0 : minutesOfDay(inst.start);
      const e = inst.end.getTime() >= d1 ? 1440 : minutesOfDay(inst.end);
      const cs = Math.max(s, dayStartMin), ce = Math.min(Math.max(e, s + 15), dayEndMin);
      if (ce > cs) timed[i].push({ inst, s: cs, e: ce });
    });
  }

  const hours = [];
  for (let h = st.dayStart ?? 0; h < (st.dayEnd ?? 24); h++) hours.push(h);
  const bodyH = hours.length * hh;
  const daysHTML = timed.map((segs) => dayHTML(segs, hh, dayStartMin));

  el.innerHTML = `<div class="tg" style="--hh:${hh}px;--n:${days}">
    <div class="tg-head">
      <div class="tg-gutter"></div>
      ${dates.map((d, i) => `<button class="tg-dayhead ${sameDay(d, today) ? 'today' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}" data-goto="${dateKey(d)}">
        <span class="dn">${DAY_SHORT[d.getDay()]}</span><span class="dd">${d.getDate()}</span>
        ${daysHTML[i].clashes ? `<span class="clash-badge" title="Hay plannings que se solapan este día">⚠ ${daysHTML[i].clashes} plannings</span>` : ''}</button>`).join('')}
    </div>
    <div class="tg-allday">
      <div class="tg-gutter small">todo<br>el día</div>
      ${dates.map((d, i) => `<div class="tg-adcell" data-day="${dateKey(d)}">${allDay[i].map((x) => chipHTML(x)).join('')}</div>`).join('')}
    </div>
    <div class="tg-scroll">
      <div class="tg-body" style="height:${bodyH}px">
        <div class="tg-hours">${hours.map((h) => `<div class="tg-hour" style="height:${hh}px"><span>${h ? String(h).padStart(2, '0') + ':00' : ''}</span></div>`).join('')}</div>
        <div class="tg-cols">
          ${dates.map((d, i) => `<div class="tg-col ${sameDay(d, today) ? 'today' : ''}" data-day="${dateKey(d)}">
            ${daysHTML[i].html}
            ${sameDay(d, today) ? `<div class="now-line" style="top:${((minutesOfDay(today) - dayStartMin) / 60) * hh}px"></div>` : ''}
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;

  const scroller = el.querySelector('.tg-scroll');
  // Al abrir: mostrar desde el primer evento del periodo (o la hora actual si es antes), si no la hora configurada
  const firstEvent = Math.min(...timed.flat().map((s) => s.s), Infinity);
  const nowMin = dates.some((d) => sameDay(d, today)) ? minutesOfDay(today) - 60 : Infinity;
  let target = Math.min(firstEvent - 30, nowMin);
  if (!Number.isFinite(target)) target = (st.scrollTo ?? 7) * 60;
  if (ctx.keepScroll != null) scroller.scrollTop = ctx.keepScroll;
  else scroller.scrollTop = ((target - dayStartMin) / 60) * hh;
  scroller.addEventListener('scroll', () => (ctx.keepScroll = scroller.scrollTop), { passive: true });

  enableChipDnD(el.querySelector('.tg'));
  wireGrid(el, { hh, dayStartMin, dayEndMin, dates });
}

let touchDragging = false;

function wireGrid(el, g) {
  const root = el.querySelector('.tg');
  const cols = [...root.querySelectorAll('.tg-col')];
  // En móvil: tras mantener pulsado un evento, el dedo lo arrastra en vez de desplazar la vista
  root.addEventListener('touchmove', (e) => touchDragging && e.cancelable && e.preventDefault(), { passive: false });
  root.addEventListener('contextmenu', (e) => e.target.closest('.ev') && e.preventDefault());

  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) {
      ctx.goto(go.dataset.goto, 'day');
      return;
    }
    const ad = e.target.closest('.tg-adcell');
    if (ad && !e.target.closest('.chip')) ctx.openEditor({ date: ad.dataset.day, allDay: true });
  });

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-check]') || e.target.closest('.chip')) return; // se gestiona en el clic
    const evEl = e.target.closest('.ev');
    const col = e.target.closest('.tg-col');
    if (evEl) startEventDrag(e, evEl);
    else if (col) startCreate(e, col);
  });
  root.addEventListener('click', (e) => {
    const check = e.target.closest('.ev [data-check]');
    if (check) {
      e.stopPropagation();
      ctx.toggleDone(check.dataset.check);
    }
  });

  const colIndexAt = (x) => {
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect();
      if (x >= r.left && x < r.right) return i;
    }
    return x < cols[0].getBoundingClientRect().left ? 0 : cols.length - 1;
  };
  const minuteAt = (col, y) => {
    const r = col.getBoundingClientRect();
    return g.dayStartMin + ((y - r.top) / g.hh) * 60;
  };
  const snap = (m) => Math.round(m / SNAP) * SNAP;

  function startEventDrag(e, evEl) {
    const inst = findInstance(evEl.dataset.inst);
    if (!inst) return;
    const resize = e.target.classList.contains('ev-resize');
    const touch = e.pointerType === 'touch';
    const x0 = e.clientX, y0 = e.clientY;
    const col0 = cols.indexOf(evEl.parentElement);
    const top0 = parseFloat(evEl.style.top), h0 = parseFloat(evEl.style.height);
    let active = !touch, moved = false, dayDelta = 0, minDelta = 0, timer = null, cancelled = false;
    const label = evEl.querySelector('.ev-s');

    if (touch) {
      timer = setTimeout(() => {
        if (cancelled) return;
        active = true;
        touchDragging = ctx.touchDragging = true;
        evEl.classList.add('dragging');
        try {
          navigator.vibrate?.(30);
        } catch { /* */ }
      }, 380);
    }

    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!active) {
        if (Math.hypot(dx, dy) > 8) {
          clearTimeout(timer);
          cancelled = true;
        }
        return;
      }
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      evEl.classList.add('dragging');
      minDelta = snap((dy / g.hh) * 60);
      if (resize) {
        const dur = Math.max(SNAP, Math.round((inst.end - inst.start) / 60000) + minDelta);
        evEl.style.height = Math.max(16, (dur / 60) * g.hh - 2) + 'px';
        label.textContent = `${fmtTime(inst.start)}–${fmtTime(addMinutes(inst.start, dur))}`;
      } else {
        const ci = colIndexAt(ev.clientX);
        dayDelta = ci - col0;
        if (cols[ci] !== evEl.parentElement) cols[ci].appendChild(evEl);
        evEl.style.top = top0 + (minDelta / 60) * g.hh + 'px';
        evEl.style.left = '1px';
        evEl.style.width = 'calc(100% - 3px)';
        const ns = addMinutes(addDays(inst.start, dayDelta), minDelta);
        label.textContent = `${fmtTime(ns)}–${fmtTime(addMinutes(ns, (inst.end - inst.start) / 60000))}`;
      }
    };
    const up = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      touchDragging = ctx.touchDragging = false;
      if (cancelled) return;
      if (!moved) {
        evEl.classList.remove('dragging');
        ctx.openPopover(inst.id, evEl);
        return;
      }
      if (resize) {
        const dur = Math.max(SNAP, Math.round((inst.end - inst.start) / 60000) + minDelta);
        ctx.commitMove(inst, inst.start, dur);
      } else if (dayDelta || minDelta) {
        ctx.commitMove(inst, addMinutes(addDays(inst.start, dayDelta), minDelta), null);
      } else ctx.render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    if (!touch) e.preventDefault();
  }

  function startCreate(e, col) {
    const touch = e.pointerType === 'touch';
    const m0 = snap(minuteAt(col, e.clientY) - SNAP / 2);
    let ghost = null, m1 = m0 + SNAP, moved = false;
    const y0 = e.clientY;
    const move = (ev) => {
      if (touch) {
        if (Math.abs(ev.clientY - y0) > 8) moved = true;
        return;
      }
      if (!moved && Math.abs(ev.clientY - y0) < 6) return;
      moved = true;
      m1 = Math.max(m0 + SNAP, snap(minuteAt(col, ev.clientY)));
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'ev ghost-new';
        col.appendChild(ghost);
      }
      ghost.style.top = ((m0 - g.dayStartMin) / 60) * g.hh + 'px';
      ghost.style.height = ((m1 - m0) / 60) * g.hh + 'px';
      ghost.textContent = `${String(Math.floor(m0 / 60)).padStart(2, '0')}:${String(m0 % 60).padStart(2, '0')} – ${String(Math.floor(m1 / 60) % 24).padStart(2, '0')}:${String(m1 % 60).padStart(2, '0')}`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      ghost?.remove();
      if (touch && moved) return;
      const day = col.dataset.day;
      const dur = moved ? m1 - m0 : null;
      ctx.openEditor({ date: day, minutes: m0, duration: dur });
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      ghost?.remove();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
}

export function updateNowLine(el) {
  const line = el.querySelector('.now-line');
  if (!line) return;
  const st = store.get().settings;
  line.style.top = ((minutesOfDay(new Date()) - (st.dayStart ?? 0) * 60) / 60) * (st.hourHeight || 52) + 'px';
}

export const startOfRange = (cursor, days, weekStart) => (days === 7 ? startOfWeekFrom(cursor, weekStart) : startOfDay(cursor));
function startOfWeekFrom(d, ws) {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() - ws + 7) % 7));
}
