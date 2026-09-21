'use client';

/**
 * Client-side Web Notification and Service Worker manager for background queue alerts.
 * Enables phone lock-screen and status-bar alerts when the customer is outside the browser.
 */

export function isNotificationSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Notification' in window;
}

export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return Notification.permission;
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
 * Universal browser-compatible notification permission request.
 * Handles both modern Promise-based and older callback-based APIs (Safari/iOS).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined') return 'denied';
  const notifObj = (window as unknown as { Notification?: Record<string, unknown> }).Notification;
  if (!notifObj) return 'denied';

  try {
    const currentPerm = (notifObj as unknown as { permission?: NotificationPermission }).permission;
    if (currentPerm && currentPerm !== 'default') {
      return currentPerm;
    }

    const reqKey = ['request', 'Permission'].join('');
    const requestFn = notifObj[reqKey] as
      | ((cb?: (p: NotificationPermission) => void) => Promise<NotificationPermission> | void)
      | undefined;
    if (!requestFn) return 'denied';

    const result = await new Promise<NotificationPermission>((resolve) => {
      try {
        const res = requestFn.call(notifObj, resolve);
        if (res && typeof (res as Promise<NotificationPermission>).then === 'function') {
          (res as Promise<NotificationPermission>)
            .then(resolve)
            .catch(() =>
              resolve((notifObj as unknown as { permission?: NotificationPermission }).permission || 'denied')
            );
        }
      } catch {
        resolve((notifObj as unknown as { permission?: NotificationPermission }).permission || 'denied');
      }
    });

    return result || (notifObj as unknown as { permission?: NotificationPermission }).permission || 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Explicit user-initiated permission request for lock-screen queue alerts.
 */
export async function requestUserQueueAlerts(): Promise<boolean> {
  if (!isNotificationSupported()) return false;

  try {
    // 1. Ensure Service Worker registration is initiated
    registerServiceWorker().catch(() => {});

    // 2. Request native permission dynamically
    const result = await requestNotificationPermission();

    if (result === 'granted') {
      // Send an immediate confirmation notification so the customer sees it working right away
      await triggerBackgroundTicketNotification(
        '🔔 Lock-Screen Alerts Activated!',
        'You will receive a loud buzzer and notification here when your table is called, even if you switch apps or lock your phone.',
        typeof window !== 'undefined' ? window.location.href : undefined
      );
      return true;
    }

    return false;
  } catch (err) {
    console.warn('Notification permission request error:', err);
    return false;
  }
}

/**
 * Dispatches an OS-level notification when the customer is outside the tab or phone is locked.
 * Prioritizes ServiceWorkerRegistration.showNotification for lockscreen/system tray visibility.
 */
export async function triggerBackgroundTicketNotification(
  title: string,
  body: string,
  targetUrl?: string
): Promise<void> {
  if (typeof window === 'undefined') return;

  const perm = getNotificationPermissionState();
  if (perm !== 'granted') return;

  try {
    const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
      body,
      icon: '/brand/asso/asso-customer-white.png',
      badge: '/brand/asso/asso-customer-white.png',
      tag: 'asso-queue-alert',
      renotify: true,
      requireInteraction: true,
      vibrate: [350, 100, 350, 100, 600, 150, 600],
      data: {
        url: targetUrl || window.location.href,
        time: Date.now(),
      },
    };

    // 1. Primary: Service Worker showNotification (works on lock-screen and Android Chrome)
    if ('serviceWorker' in navigator) {
      try {
        let reg: ServiceWorkerRegistration | null | undefined = await navigator.serviceWorker.getRegistration();
        if (!reg) {
          reg = await registerServiceWorker();
        }
        if (!reg && navigator.serviceWorker.ready) {
          reg = await navigator.serviceWorker.ready;
        }

        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, options);
          return;
        }

        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title,
            options,
          });
          return;
        }
      } catch (swErr) {
        console.warn('Service Worker notification dispatch error:', swErr);
      }
    }

    // 2. Desktop Fallback: Standard Notification constructor (macOS / Windows desktop browsers)
    try {
      const notifConstructor = (
        window as unknown as {
          Notification?: { new (t: string, o?: unknown): { onclick?: () => void } };
        }
      ).Notification;
      if (notifConstructor && getNotificationPermissionState() === 'granted') {
        const notifInstance = new notifConstructor(title, options);
        notifInstance.onclick = () => {
          window.focus();
          if (targetUrl) window.location.href = targetUrl;
        };
      }
    } catch {
      // Ignore Android illegal constructor fallback error
    }
  } catch (err) {
    console.warn('Failed to trigger background notification:', err);
  }
}
