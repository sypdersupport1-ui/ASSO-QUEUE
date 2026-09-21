'use client';

/**
 * High-tech synthetic audio chimes and loud ringing pager bells using Web Audio API + HTML5 Audio.
 * Zero external audio files required; works seamlessly in modern browsers and mobile devices.
 */

class AudioChimeEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  initAudio() {
    try {
      const ctx = this.getContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch {}
  }

  /**
   * Loud, energetic multi-pulse ringing bell sound.
   * Produces an unmistakable loud telephone/restaurant pager ring with
   * dual-frequency bell harmonics and 18Hz hammer tremolo modulation.
   */
  playRingingSound(bursts = 2) {
    // 1. Strong hardware tactile vibration
    this.triggerPhoneVibration([500, 150, 500, 150, 800, 200, 800]);

    // 2. Play HTML5 Audio asset directly as backup through native audio channel
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const directAudio = new Audio('/brand/pager-chime.wav');
        directAudio.volume = 1.0;
        const p = directAudio.play();
        if (p) p.catch(() => {});
      }
    } catch {}

    // 3. High-volume Web Audio synthetic bell ring with dynamics limiter
    const synthesize = (ctx: AudioContext) => {
      try {
        const now = ctx.currentTime;

        // Limiter/compressor to maximize loudness without digital distortion
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-14, now);
        comp.knee.setValueAtTime(6, now);
        comp.ratio.setValueAtTime(14, now);
        comp.attack.setValueAtTime(0.002, now);
        comp.release.setValueAtTime(0.2, now);
        comp.connect(ctx.destination);

        const burstDuration = 0.42;
        const burstGap = 0.16;

        for (let b = 0; b < bursts; b++) {
          const burstStart = now + b * (burstDuration + burstGap);

          // Canonical ringing bell harmonics: G5 (784Hz) + B5 (988Hz) + E6 (1319Hz) + G6 (1568Hz)
          const notes = [
            { freq: 783.99, type: 'sine' as const, vol: 0.85 },
            { freq: 987.77, type: 'triangle' as const, vol: 0.90 },
            { freq: 1318.51, type: 'sine' as const, vol: 0.75 },
            { freq: 1567.98, type: 'triangle' as const, vol: 0.60 },
          ];

          notes.forEach(({ freq, type, vol }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            // 18Hz tremolo bell hammer flutter (creates the classic mechanical telephone/service bell ring)
            const tremolo = ctx.createOscillator();
            const tremoloGain = ctx.createGain();
            tremolo.frequency.setValueAtTime(18, burstStart);
            tremoloGain.gain.setValueAtTime(0.35, burstStart);

            osc.type = type;
            osc.frequency.setValueAtTime(freq, burstStart);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.995, burstStart + burstDuration);

            // Punchy attack, sustained energetic ringing, crisp decay
            gain.gain.setValueAtTime(0.01, burstStart);
            gain.gain.linearRampToValueAtTime(vol, burstStart + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, burstStart + burstDuration);

            tremolo.connect(tremoloGain.gain);
            osc.connect(gain);
            gain.connect(comp);

            osc.start(burstStart);
            osc.stop(burstStart + burstDuration + 0.05);
            tremolo.start(burstStart);
            tremolo.stop(burstStart + burstDuration + 0.05);
          });
        }
      } catch {}
    };

    try {
      const ctx = this.getContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => synthesize(ctx)).catch(() => {});
      } else {
        synthesize(ctx);
      }
    } catch {}
  }

  /**
   * Loud, High-Attention Restaurant Pager Buzzer Sound for customer devices.
   * Plays 3 loud ringing bell bursts for high urgency.
   */
  playBuzzerSound() {
    this.playRingingSound(3);
  }

  /**
   * Immediate loud ringing chime for staff action buttons (Call, Notify).
   */
  playCallChime() {
    this.playRingingSound(1);
  }

  /**
   * Celebratory upward arpeggio chime for seating or completing orders.
   */
  playSeatChime() {
    try {
      const play = (ctx: AudioContext) => {
        const now = ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.09);

          gain.gain.setValueAtTime(0.01, now + idx * 0.09);
          gain.gain.linearRampToValueAtTime(0.75, now + idx * 0.09 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.45);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.09);
          osc.stop(now + idx * 0.09 + 0.50);
        });
      };

      const ctx = this.getContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => play(ctx)).catch(() => {});
      } else {
        play(ctx);
      }
    } catch {}
  }

  /**
   * Loud crisp alert chime for remove, no-show, and cancel actions.
   */
  playAlertChime() {
    try {
      const play = (ctx: AudioContext) => {
        const now = ctx.currentTime;
        const freqs = [587.33, 440];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);

          gain.gain.setValueAtTime(0.01, now + idx * 0.12);
          gain.gain.linearRampToValueAtTime(0.70, now + idx * 0.12 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.40);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.45);
        });
      };

      const ctx = this.getContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => play(ctx)).catch(() => {});
      } else {
        play(ctx);
      }
    } catch {}
  }

  triggerPhoneVibration(pattern: number[] = [500, 150, 500]) {
    if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }
}

export const chimeEngine = new AudioChimeEngine();

// Auto-prime audio on first user gesture anywhere on page
if (typeof window !== 'undefined') {
  const unlock = () => {
    chimeEngine.initAudio();
  };
  window.addEventListener('click', unlock, { capture: true, passive: true });
  window.addEventListener('touchstart', unlock, { capture: true, passive: true });
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
}

