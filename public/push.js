// Importeras av service workern (vite-plugin-pwa generateSW → importScripts). Tar emot push och öppnar appen vid klick.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Pluggappen', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Pluggappen', { body: d.body || '', icon: '/icon-512.png', badge: '/icon-512.png', tag: d.tag || 'plugg', renotify: true, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => { for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } } return self.clients.openWindow(url); }));
});
