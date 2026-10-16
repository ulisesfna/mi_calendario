// Ayudas de interfaz: modales, avisos (toasts), confirmaciones y selector de alcance.
import { esc } from '../util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Contexto compartido entre módulos (se rellena en app.js) */
export const ctx = {
  view: 'week',
  cursor: new Date(),
  selected: null,
  render: () => {},
};

let modalStack = [];

/**
 * Abre un modal. `build(body, close)` rellena el contenido.
 * Devuelve la función close.
 */
export function openModal({ title, wide = false, className = '', build, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close title="Cerrar (Esc)">✕</button></header>
      <div class="modal-body"></div>
    </div>`;
  document.body.appendChild(wrap);
  const body = wrap.querySelector('.modal-body');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    modalStack = modalStack.filter((m) => m.close !== close);
    wrap.classList.add('closing');
    setTimeout(() => wrap.remove(), 120);
    onClose?.();
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === wrap) wrap.dataset.downOutside = '1';
  });
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap && wrap.dataset.downOutside) close();
    delete wrap.dataset.downOutside;
    if (e.target.closest('[data-close]')) close();
  });
  modalStack.push({ close, wrap });
  build(body, close, wrap);
  requestAnimationFrame(() => wrap.querySelector('[autofocus]')?.focus());
  return close;
}

export const hasModal = () => modalStack.length > 0;
export function closeTopModal() {
  const m = modalStack.at(-1);
  if (m) {
    m.close();
    return true;
  }
  return false;
}

export function toast(msg, { action, actionLabel = 'Deshacer', timeout = 5000 } = {}) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="btn link">${esc(actionLabel)}</button>` : ''}`;
  host.appendChild(el);
  const remove = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('button')?.addEventListener('click', () => {
    action();
    remove();
  });
  setTimeout(remove, timeout);
}

export function confirmDialog(message, { okLabel = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openModal({
      title: 'Confirmar',
      onClose: () => resolve(result),
      build(body, close) {
        body.innerHTML = `<p>${esc(message)}</p>
          <div class="modal-actions"><button class="btn" data-close>Cancelar</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-ok autofocus>${esc(okLabel)}</button></div>`;
        body.querySelector('[data-ok]').onclick = () => {
          result = true;
          close();
        };
      },
    });
  });
}

/** Pregunta el alcance de un cambio en un elemento que se repite */
export function chooseScope(verb = 'mover') {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title: `¿Qué quieres ${verb}?`,
      onClose: () => resolve(result),
      build(body, close) {
        body.innerHTML = `<p class="muted">Este elemento se repite.</p>
          <div class="scope-list">
            <button class="btn block" data-s="one" autofocus>Solo esta vez</button>
            <button class="btn block" data-s="following">Esta y las siguientes</button>
            <button class="btn block" data-s="all">Toda la serie</button>
          </div>`;
        body.onclick = (e) => {
          const b = e.target.closest('[data-s]');
          if (!b) return;
          result = b.dataset.s;
          close();
        };
      },
    });
  });
}

export function promptDialog(title, value = '', { placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    openModal({
      title,
      onClose: () => resolve(result),
      build(body, close) {
        body.innerHTML = `<form><input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>
          <div class="modal-actions"><button type="button" class="btn" data-close>Cancelar</button><button class="btn primary">Aceptar</button></div></form>`;
        body.querySelector('form').onsubmit = (e) => {
          e.preventDefault();
          result = body.querySelector('input').value.trim();
          close();
        };
      },
    });
  });
}

/** Pequeño menú flotante junto a un elemento */
export function floatingMenu(anchor, html, onClick) {
  document.querySelectorAll('.float-menu').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'float-menu';
  m.innerHTML = html;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  // Recolocar cada vez que cambia de tamaño (p. ej. al desplegar «Paletas»), para que
  // siempre quepa entera en pantalla: debajo, encima o, si no, ocupando el alto disponible
  const place = () => {
    m.style.maxHeight = innerHeight - 16 + 'px';
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
    let top;
    if (r.bottom + 4 + mh <= innerHeight - 8) top = r.bottom + 4;
    else if (r.top - 4 - mh >= 8) top = r.top - mh - 4;
    else top = Math.max(8, innerHeight - mh - 8);
    m.style.top = top + 'px';
  };
  place();
  const ro = new ResizeObserver(place);
  ro.observe(m);
  const off = (e) => {
    if (!m.contains(e.target)) close();
  };
  const close = () => {
    ro.disconnect();
    m.remove();
    document.removeEventListener('pointerdown', off, true);
  };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
  m.addEventListener('click', (e) => {
    const r2 = onClick(e, close);
    if (r2 !== false && e.target.closest('[data-v]')) close();
  });
  return close;
}
