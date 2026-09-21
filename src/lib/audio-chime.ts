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
   * Two-tone modern button click chime (D5 -> A5)
   * The beloved snappy click/chime sound for restaurant dashboard buttons.
   */
  playCallChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch {}
  }

  /**
   * Ultra-Loud, High-Attention Restaurant Pager Buzzer Sound for customer devices.
   * Engineered with piercing dual-harmonic bursts (1046Hz - 3136Hz) matching the
   * peak sensitivity of the human ear and mobile phone speaker transducers.
   * Produces a loud, continuous, attention-demanding alert that cuts through noise.
   */
  playBuzzerSound() {
    // 1. Strong tactile hardware vibration pattern
    this.triggerPhoneVibration([600, 150, 600, 150, 800, 200, 1000]);

    // 2. Play HTML5 Audio asset directly as backup through native audio channel
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const directAudio = new Audio('/brand/pager-chime.wav');
        directAudio.volume = 1.0;
        const p = directAudio.play();
        if (p) p.catch(() => {});
      }
    } catch {}

    // 3. High-volume piercing harmonic synthesizer directly to destination (no muffling compressor)
    const synthesize = (ctx: AudioContext) => {
      try {
        const now = ctx.currentTime;

        // 5 distinct loud piercing pager bursts across 2.2 seconds
        const bursts = [
          { start: 0.00, dur: 0.22, chord: [1046.5, 2093.0, 3136.0] },
          { start: 0.26, dur: 0.22, chord: [1046.5, 2093.0, 3136.0] },
          { start: 0.54, dur: 0.24, chord: [1318.5, 2637.0, 3951.0] },
          { start: 0.84, dur: 0.24, chord: [1318.5, 2637.0, 3951.0] },
          { start: 1.18, dur: 0.90, chord: [1567.98, 2093.0, 3136.0] },
        ];

        bursts.forEach(({ start, dur, chord }) => {
          chord.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            // Triangle & Sine mix for rich acoustic penetration on phone speakers
            osc.type = idx === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, now + start);

            const peakVol = idx === 0 ? 0.95 : 0.70;
            gain.gain.setValueAtTime(0.01, now + start);
            gain.gain.linearRampToValueAtTime(peakVol, now + start + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + start);
            osc.stop(now + start + dur + 0.05);
          });
        });
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
   * Loud ringing bell sound utility.
   */
  playRingingSound() {
    this.playBuzzerSound();
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

