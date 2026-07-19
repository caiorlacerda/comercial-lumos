/* Handlers de Web Push do app Lumos.
   Importado pelo service worker gerado pelo Workbox (vite-plugin-pwa) via
   workbox.importScripts. Mostra a notificação quando o app está fechado e
   abre a tela certa ao tocar. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: 'Lumos', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Lumos';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { link: data.link || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já houver uma janela do app aberta, foca e navega.
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try { client.navigate(link); } catch (_e) { /* noop */ }
          }
          return client.focus();
        }
      }
      // Senão, abre uma nova.
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
