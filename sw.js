// Service worker: funciona sin conexión y gestiona los botones de las notificaciones.
// Al publicar una versión nueva, sube el número de VERSION para renovar la caché.
const VERSION = 'cal-v16';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/palette.js', 'js/recurrence.js', 'js/engine.js', 'js/notify.js', 'js/ics.js', 'js/quickadd.js',
  'js/config.js', 'js/server.js', 'js/sync.js', 'js/push.js', 'js/native.js',
  'js/ui/dom.js', 'js/ui/colorpicker.js', 'js/ui/popover.js', 'js/ui/editor.js', 'js/ui/categories.js', 'js/ui/importer.js',
  'js/ui/settings.js', 'js/ui/reminders-ui.js', 'js/ui/catpicker.js', 'js/ui/syncui.js',
  'js/views/shared.js', 'js/views/timegrid.js', 'js/views/month.js', 'js/views/agenda.js', 'js/views/planning.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  // Solo se borran las cachés antiguas de ESTA app («cal-…»): en GitHub Pages todas tus apps
  // comparten dominio (usuario.github.io) y comparten también el almacén de cachés
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cal-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero (para ver siempre la última versión) y caché si no hay conexión
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Las navegaciones no admiten opciones extra; el resto se revalida siempre con el servidor
  const req = e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data ?? {};
  const msg = { type: 'notification-action', action: e.action || 'open', alarmId: data.alarmId };
  e.waitUntil((async () => {
    // Avisos llegados con la app cerrada: decirle al servidor que se ha atendido / pospuesto
    if (data.push) await remote(e.action === 'snooze' ? '/snooze' : '/ack', { k: data.k, minutes: 10 });
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach((c) => c.postMessage(msg));
    if (e.action === 'snooze') return;
    const c = list[0];
    if (c) return c.focus();
    return self.clients.openWindow('./');
  })());
});

// Deslizar la notificación para quitarla también la da por atendida (para las alarmas persistentes)
self.addEventListener('notificationclose', (e) => {
  const data = e.notification.data ?? {};
  if (data.push && data.rep) e.waitUntil(remote('/ack', { k: data.k }));
});

// ---------------- Avisos con la app cerrada (Web Push) ----------------
// El servidor manda un «toque» sin contenido a la hora del aviso. Aquí se piden los avisos
// pendientes, se descifran con la clave guardada en este dispositivo y se muestran.

function idbOpen(name, store) {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(name, store, key) {
  try {
    const d = await idbOpen(name, store);
    return await new Promise((res) => {
      const q = d.transaction(store, 'readonly').objectStore(store).get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
async function idbSet(name, store, key, value) {
  const d = await idbOpen(name, store);
  return new Promise((res) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}

async function remote(path, body) {
  const cfg = await idbGet('cdt-push', 'kv', 'cfg');
  if (!cfg?.url || !body.k) return;
  try {
    await fetch(cfg.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group: cfg.group, ...body }) });
  } catch { /* sin conexión: no pasa nada */ }
}

const VIBRATION = {
  vibrate: [200, 100, 200], sound: [300, 120, 300],
  alarm: [800, 300, 800, 300, 800], persistent: [1000, 300, 1000, 300, 1000],
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(key, c) {
  const [iv, data] = c.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data));
  return JSON.parse(new TextDecoder().decode(pt));
}

async function showPending() {
  const cfg = await idbGet('cdt-push', 'kv', 'cfg');
  if (!cfg?.url) return self.registration.showNotification('Mi calendario', { body: 'Tienes un aviso. Abre la app para verlo.', icon: 'icons/icon-192.png' });
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = wins.some((c) => c.visibilityState === 'visible');
  let entries = [];
  try {
    const r = await fetch(`${cfg.url}/pending?g=${encodeURIComponent(cfg.group)}`, { cache: 'no-store' });
    entries = (await r.json()).entries ?? [];
  } catch {
    // Sin conexión con el servidor: avisar igualmente (mejor un aviso genérico que ninguno)
    if (!visible) {
      return self.registration.showNotification('🔔 Tienes un aviso de tu calendario', {
        body: 'Abre la app para verlo.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'aviso-generico',
      });
    }
    return 0;
  }
  const shown = (await idbGet('cdt-push', 'kv', 'shown')) ?? {};
  const key = cfg.keySource === 'sync' ? (await idbGet('cdt-sync', 'keys', 'main'))?.key : await idbGet('cdt-push', 'kv', 'key');
  let count = 0;
  for (const e of entries.sort((a, b) => a.at - b.at)) {
    const again = e.rep && shown[e.k]; // alarma persistente: se vuelve a avisar hasta que se pare
    if (shown[e.k] && !e.rep) continue;
    // Con la app delante, la propia app avisa de lo suyo; pero las pruebas y los avisos pospuestos
    // desde la notificación solo los conoce el servidor, así que se muestran siempre
    const appKnowsIt = !e.k.startsWith('test-') && !e.k.includes('~');
    if (visible && !again && appKnowsIt) continue;
    let d = null;
    try {
      if (key) d = await decrypt(key, e.c);
    } catch { /* clave distinta: se muestra un aviso genérico */ }
    const level = d?.l || 'sound';
    const strong = level === 'alarm' || level === 'persistent';
    await self.registration.showNotification(d?.t || '🔔 Aviso de tu calendario', {
      body: d?.b || 'Abre la app para ver los detalles',
      tag: e.k,
      renotify: true,
      silent: level === 'visual',
      requireInteraction: strong,
      vibrate: VIBRATION[level],
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      timestamp: e.at,
      data: { push: true, k: e.k, rep: e.rep },
      actions: [{ action: 'snooze', title: 'Posponer 10 min' }, { action: 'ack', title: strong ? 'Parar' : 'Vale' }],
    });
    shown[e.k] = Date.now();
    count++;
  }
  await idbSet('cdt-push', 'kv', 'shown', shown);
  return count;
}

self.addEventListener('push', (e) => e.waitUntil(showPending()));

// Si el navegador renueva la suscripción por su cuenta, registrar la nueva en el servidor
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const cfg = await idbGet('cdt-push', 'kv', 'cfg');
    if (!cfg?.url || !cfg.device) return;
    let sub = e.newSubscription;
    if (!sub) {
      const { publicKey } = await (await fetch(`${cfg.url}/vapid`)).json();
      const raw = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((publicKey.length + 3) % 4)), (c) => c.charCodeAt(0));
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    }
    await fetch(`${cfg.url}/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: cfg.group, device: cfg.device, sub: sub.toJSON() }),
    });
  })().catch(() => {}));
});
// Para comprobar la entrega sin esperar a un toque real (lo usa la prueba de diagnóstico)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'check-pending') e.waitUntil(showPending().then((n) => e.source?.postMessage({ type: 'pending-shown', count: n })));
});
