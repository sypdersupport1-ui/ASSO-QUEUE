'use client';

/**
 * High-tech synthetic audio chimes using the Web Audio API.
 * Zero external audio files or bandwidth required; works seamlessly in modern browsers.
 */

class AudioChimeEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  playCallChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Two-tone modern call chime (D5 -> A5)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);
    } catch {}
  }

  playSeatChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Upward arpeggio chime (C5 -> E5 -> G5 -> C6)
      const freqs = [523.25, 659.25, 783.99, 1046.5];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.001, now + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.35);
      });
    } catch {}
  }

  playAlertChime() {
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(659.25, now + 0.1);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch {}
  }

  /**
   * Loud, High-Attention Restaurant Pager Buzzer Sound for customer devices.
   * Plays a distinct, loud 2-burst resonant harmonic bell sequence with rich presence
   * coupled with strong tactile phone vibration.
   */
  playBuzzerSound() {
    // 1. Strong hardware vibration on mobile devices
    this.triggerPhoneVibration([350, 100, 350, 100, 600, 150, 600]);

    // 2. High-audibility resonant chime synth
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Burst 1: Alert Ding-Dong (C5 -> G5)
      // Burst 2: Full resonant confirmation chord (C5 + E5 + G5 + C6)
      const notes = [
        // Burst 1 - Alert chime
        { freq: 659.25, time: 0, dur: 0.35, vol: 0.45, type: 'sine' as const },
        { freq: 880.00, time: 0.12, dur: 0.45, vol: 0.55, type: 'triangle' as const },
        
        // Burst 2 - Loud Pager Buzzer Chord (0.45s later)
        { freq: 523.25, time: 0.45, dur: 0.8, vol: 0.4, type: 'triangle' as const },
        { freq: 659.25, time: 0.45, dur: 0.85, vol: 0.45, type: 'sine' as const },
        { freq: 783.99, time: 0.45, dur: 0.9, vol: 0.5, type: 'sine' as const },
        { freq: 1046.50, time: 0.45, dur: 1.2, vol: 0.6, type: 'triangle' as const },
      ];

      notes.forEach(({ freq, time, dur, vol, type }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0.001, now + time);
        gain.gain.linearRampToValueAtTime(vol, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + dur + 0.05);
      });
    } catch {}
  }

  triggerPhoneVibration(pattern: number[] = [400, 150, 400]) {
    if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }
}

export const chimeEngine = new AudioChimeEngine();
