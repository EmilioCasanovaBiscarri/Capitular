'use strict';

// Sube este número en cada despliegue para que los móviles descarguen la versión nueva.
const VERSION = 'capitular-v3';
const FUENTES = 'capitular-fuentes';

const ARCHIVOS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'partidas.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/favicon.svg',
  'icons/favicon.ico',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable.svg',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION && k !== FUENTES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero (para la página y las partidas nuevas), con la caché de respaldo sin conexión.
async function redPrimero(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }
}

async function cachePrimero(req) {
  const guardada = await caches.match(req, { ignoreSearch: true });
  return guardada || fetch(req);
}

// Google Fonts: lo guardado al momento y se actualiza por detrás.
async function fuentes(req) {
  const cache = await caches.open(FUENTES);
  const guardada = await cache.match(req);
  const red = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => guardada);
  return guardada || red;
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    ev.respondWith(fuentes(req));
    return;
  }
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/partidas.json')) {
    ev.respondWith(redPrimero(req));
  } else {
    ev.respondWith(cachePrimero(req));
  }
});
