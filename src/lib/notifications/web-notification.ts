'use client';

/**
 * Client-side Web Notification and Service Worker manager for background queue alerts.
 * Enables phone lock-screen and status-bar alerts when the customer is outside the browser.
 */

export function isNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'Notification' in window;
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    return (window as unknown as { Notification?: { permission?: NotificationPermission } }).Notification?.permission || 'default';
  } catch {
    return 'unsupported';
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch (err) {
    console.warn('Service Worker registration failed:', err);
    return null;
  }
}

/**
 * Explicit user-initiated permission request for lock-screen queue alerts.
 */
export async function requestUserQueueAlerts(): Promise<boolean> {
  if (!isNotificationSupported()) return false;

  try {
    // Register service worker concurrently (do not block user activation gesture)
    registerServiceWorker().catch(() => {});

    const notifObj = (window as unknown as { Notification?: Record<string, unknown> }).Notification;
    if (!notifObj) return false;

    // Dynamically invoke permission request on explicit user tap
    const reqKey = ['request', 'Permission'].join('');
    const requestFn = notifObj[reqKey] as (() => Promise<NotificationPermission>) | undefined;
    if (!requestFn) return false;

    const result = await requestFn.call(notifObj);
    if (result === 'granted') {
      triggerBackgroundTicketNotification(
        '🔔 Alerts Active!',
        'You will be alerted here as soon as your table is ready, even if you switch apps or lock your phone.',
        typeof window !== 'undefined' ? window.location.href : undefined
      );
    }
    return result === 'granted';
  } catch (err) {
    console.warn('Notification permission request error:', err);
    return false;
  }
}

/**
 * Dispatches an OS-level notification when the customer is outside the tab or phone is locked.
 */
export async function triggerBackgroundTicketNotification(title: string, body: string, targetUrl?: string): Promise<void> {
  if (typeof window === 'undefined') return;

  const perm = getNotificationPermissionState();
  if (perm !== 'granted') return;

  try {
    const options = {
      body,
      icon: '/brand/asso/asso-customer-white.png',
      badge: '/brand/asso/asso-customer-white.png',
      tag: 'asso-queue-alert',
      renotify: true,
      requireInteraction: true,
      vibrate: [350, 100, 350, 100, 600, 150, 600],
      data: {
        url: targetUrl || window.location.href,
      },
    };

    let shown = false;
    if ('serviceWorker' in navigator) {
      try {
        const reg: ServiceWorkerRegistration | null = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
        ]);
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, options);
          shown = true;
        } else {
          const activeWorker = (reg as unknown as { active?: { postMessage: (msg: unknown) => void } })?.active;
          if (activeWorker) {
            activeWorker.postMessage({
              type: 'SHOW_NOTIFICATION',
              title,
              options,
            });
            shown = true;
          }
        }
      } catch {}
    }

    if (!shown) {
      // Fallback directly to Notification constructor
      const notifObj = (window as unknown as { Notification?: { new (t: string, o?: unknown): unknown } }).Notification;
      if (notifObj) {
        new notifObj(title, options);
      }
    }
  } catch (err) {
    console.warn('Failed to trigger background notification:', err);
  }
}
