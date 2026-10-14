// Service worker: funciona sin conexión y gestiona los botones de las notificaciones.
// Al publicar una versión nueva, sube el número de VERSION para renovar la caché.
const VERSION = 'cal-v4';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/palette.js', 'js/recurrence.js', 'js/engine.js', 'js/notify.js', 'js/ics.js', 'js/quickadd.js',
  'js/config.js', 'js/sync.js',
  'js/ui/dom.js', 'js/ui/colorpicker.js', 'js/ui/popover.js', 'js/ui/editor.js', 'js/ui/categories.js', 'js/ui/importer.js',
  'js/ui/settings.js', 'js/ui/reminders-ui.js', 'js/ui/catpicker.js', 'js/ui/syncui.js',
  'js/views/shared.js', 'js/views/timegrid.js', 'js/views/month.js', 'js/views/agenda.js', 'js/views/planning.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
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
  const msg = { type: 'notification-action', action: e.action || 'open', alarmId: e.notification.data?.alarmId };
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      list.forEach((c) => c.postMessage(msg));
      if (e.action === 'snooze') return;
      const c = list[0];
      if (c) return c.focus();
      return self.clients.openWindow('./');
    }),
  );
});
