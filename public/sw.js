// Service Worker for QueueFlow / ASSO Queue Management
// Handles background lock-screen notifications and audio alerts
// Enhanced: self-contained background polling when JS tab is throttled/suspended

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Background Polling State ───────────────────────────────────────────────
let bgPollInterval = null;
let lastKnownStatus = {};

/**
 * Polls the queue status API for a given token and triggers a notification
 * if a status transition is detected (e.g. WAITING -> CALLED).
 */
async function pollTicketStatus(token, restaurantSlug, currentUrl) {
  try {
    const url = `/api/q/status?token=${encodeURIComponent(token)}&restaurantSlug=${encodeURIComponent(restaurantSlug)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const status = data?.status?.status;
    if (!status) return;

    const key = `${token}__${restaurantSlug}`;
    const prev = lastKnownStatus[key];

    if (prev && prev !== status) {
      lastKnownStatus[key] = status;

      let title = '';
      let body = '';

      if (status === 'CALLED') {
        title = '⚡ YOUR TABLE IS READY!';
        body = 'Please proceed to the restaurant host stand now!';
      } else if (status === 'NOTIFIED') {
        title = "⚡ You're Getting Close! Table Preparing";
        body = 'The host is setting up your table. Please head to the entrance!';
      } else if (status === 'SEATED') {
        title = '🍽️ You Are Seated!';
        body = 'Welcome to your table! Enjoy your meal.';
      } else if (status === 'NO_SHOW') {
        title = 'Queue Update';
        body = 'You have been marked as no-show. Visit the host stand for assistance.';
      } else if (status === 'CANCELLED') {
        title = 'Queue Ticket Cancelled';
        body = 'Your queue ticket has been cancelled.';
      }

      if (title) {
        await self.registration.showNotification(title, {
          body,
          icon: '/brand/asso/asso-customer-white.png',
          badge: '/brand/asso/asso-customer-white.png',
          tag: `asso-queue-${token}-${Date.now()}`,
          renotify: true,
          requireInteraction: status === 'CALLED' || status === 'NOTIFIED',
          silent: false,
          vibrate: status === 'CALLED' ? [300, 100, 300, 100, 500] : [200, 100, 200],
          data: { url: currentUrl || '/', token, restaurantSlug },
          actions: [
            { action: 'open', title: '📲 Open Ticket' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        });
      }
    } else if (!prev) {
      // First check — just record the current status, don't notify
      lastKnownStatus[key] = status;
    }
  } catch (err) {
    // Silently continue
  }
}

// ─── Message Handler ─────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;

  // Client page triggering a direct notification
  if (msg.type === 'SHOW_NOTIFICATION') {
    const { title, options } = msg;
    event.waitUntil(
      self.registration.showNotification(title || 'Queue Alert', {
        icon: '/brand/asso/asso-customer-white.png',
        badge: '/brand/asso/asso-customer-white.png',
        silent: false,
        vibrate: [200, 100, 200],
        requireInteraction: true,
        renotify: true,
        ...options,
      })
    );
    return;
  }

  // Client page registering this ticket for background polling
  // Sent when the customer ticket page mounts or becomes visible
  if (msg.type === 'REGISTER_BG_POLL') {
    const { token, restaurantSlug, currentUrl, status } = msg;
    if (!token || !restaurantSlug) return;

    const key = `${token}__${restaurantSlug}`;

    // Record the current known status so we only alert on transitions
    if (status) {
      lastKnownStatus[key] = status;
    }

    // Clear any existing interval and start fresh
    if (bgPollInterval) {
      clearInterval(bgPollInterval);
    }

    // Poll every 5 seconds from the SW — independent of page JS
    bgPollInterval = setInterval(() => {
      pollTicketStatus(token, restaurantSlug, currentUrl);
    }, 5000);

    return;
  }

  // Client page asking SW to stop polling (e.g. ticket completed)
  if (msg.type === 'STOP_BG_POLL') {
    if (bgPollInterval) {
      clearInterval(bgPollInterval);
      bgPollInterval = null;
    }
    return;
  }
});

// ─── Handle Push Events (server-triggered) ───────────────────────────────────
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
    tag: data.tag || `queue-table-alert-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [300, 100, 300, 100, 500],
    data: {
      url: data.url || '/',
      time: Date.now(),
    },
    actions: [
      { action: 'open', title: '📲 Open Ticket' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification Click Handler ───────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url && client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open a new window if not already open
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
