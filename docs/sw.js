// Service worker: app shell em cache (funciona offline). Dados ficam no IndexedDB e nunca são tocados aqui.
// A cada nova versão do app: aumente VERSION aqui e em js/version.js.
const VERSION = '1.1.0';
const CACHE = `gastos-viagem-${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/version.js', './js/constants.js', './js/money.js', './js/dates.js',
  './js/split.js', './js/trip.js', './js/calc.js', './js/forecast.js', './js/backup.js', './js/db.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' evita copiar arquivos velhos do cache HTTP para o cache novo.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  // Sem skipWaiting automático: a versão nova só assume quando o usuário tocar em "Atualizar".
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gastos-viagem-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});
