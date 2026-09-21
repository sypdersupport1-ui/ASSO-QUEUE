// Service Worker for QueueFlow / ASSO Queue Management
// Handles background lock-screen notifications and audio alerts

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push events from server
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Queue Update', body: event.data ? event.data.text() : 'Your table is ready!' };
  }

  const title = data.title || 'Table Call';
  const options = {
    body: data.body || 'Your table is ready! Please return to the restaurant now.',
    icon: data.icon || '/brand/asso/asso-customer-white.png',
    badge: data.badge || '/brand/asso/asso-customer-white.png',
    tag: data.tag || 'queue-table-alert',
    renotify: true,
    requireInteraction: true,
    vibrate: [350, 100, 350, 100, 600, 150, 600],
    data: {
      url: data.url || '/',
      time: Date.now(),
    },
    actions: [
      { action: 'open', title: 'Open Ticket' },
      { action: 'close', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification click from lock screen or notification tray
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Allow client page to trigger background notifications via postMessage
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    event.waitUntil(
      self.registration.showNotification(title || 'Queue Alert', {
        icon: '/brand/asso/asso-customer-white.png',
        badge: '/brand/asso/asso-customer-white.png',
        vibrate: [350, 100, 350, 100, 600, 150, 600],
        requireInteraction: true,
        renotify: true,
        ...options,
      })
    );
  }
});
