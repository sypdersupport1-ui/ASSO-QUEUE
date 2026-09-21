'use client';

let keeperAudio: HTMLAudioElement | null = null;
let isKeepingAlive = false;

/**
 * Keeps mobile browser processes (iOS Safari & Android Chrome) alive in background
 * when the phone screen is locked.
 * By maintaining an active inaudible audio/media session, mobile operating systems
 * do NOT suspend JavaScript execution threads, allowing background pollers to detect
 * table calls and ring the pager buzzer through the device speaker even when locked.
 */
export function startBackgroundKeeper() {
  if (typeof window === 'undefined') return;
  if (isKeepingAlive && keeperAudio && !keeperAudio.paused) return;

  try {
    // 44-byte silent WAV PCM data URI
    const silentWav =
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

    if (!keeperAudio) {
      keeperAudio = new Audio(silentWav);
      keeperAudio.loop = true;
      keeperAudio.volume = 0.01; // Inaudible
    }

    const tryPlay = () => {
      if (!keeperAudio) return;
      const playPromise = keeperAudio.play();
      if (playPromise) {
        playPromise
          .then(() => {
            isKeepingAlive = true;
            if ('mediaSession' in navigator) {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: 'Queue Live Alert Active',
                artist: 'QueueFlow Table Pager',
                album: 'Live Queue Alert Active',
              });
              try {
                navigator.mediaSession.setActionHandler('play', () => {
                  keeperAudio?.play().catch(() => {});
                });
                navigator.mediaSession.setActionHandler('pause', () => {
                  keeperAudio?.play().catch(() => {}); // Re-arm to keep background active
                });
              } catch {}
            }
          })
          .catch(() => {
            // If autoplay was restricted, attach touch/click listener to start on first interaction
            const unlock = () => {
              if (keeperAudio) {
                keeperAudio.play().then(() => {
                  isKeepingAlive = true;
                }).catch(() => {});
              }
              window.removeEventListener('touchstart', unlock);
              window.removeEventListener('click', unlock);
              window.removeEventListener('pointerdown', unlock);
            };
            window.addEventListener('touchstart', unlock, { once: true, passive: true });
            window.addEventListener('click', unlock, { once: true });
            window.addEventListener('pointerdown', unlock, { once: true });
          });
      }
    };

    tryPlay();
  } catch {}
}

export function stopBackgroundKeeper() {
  if (keeperAudio) {
    try {
      keeperAudio.pause();
    } catch {}
  }
  isKeepingAlive = false;
}

