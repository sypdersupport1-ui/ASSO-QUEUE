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
   * Snappy button click chime (Tactile micro-click + D5 -> A5 melodic rise).
   * The signature pleasant button click sound for restaurant dashboard staff buttons.
   * Plays directly through native HTML5 Audio element + Web Audio synth for 100% reliability.
   */
  playCallChime() {
    // 1. Play dedicated button click WAV at moderate volume
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const directAudio = new Audio('/brand/button-click.wav');
        directAudio.volume = 0.65;
        const p = directAudio.play();
        if (p) p.catch(() => {});
      }
    } catch {}

    // 2. Web Audio synthesis — always fires as primary source of sound
    // High gain so it's always clearly audible on restaurant staff tablets/phones
    try {
      const play = (ctx: AudioContext) => {
        const now = ctx.currentTime;

        // 1. Punchy mechanical click transient (40ms)
        const clickOsc = ctx.createOscillator();
        const clickGain = ctx.createGain();
        clickOsc.type = 'square';
        clickOsc.frequency.setValueAtTime(1200, now);
        clickOsc.frequency.exponentialRampToValueAtTime(180, now + 0.035);
        clickGain.gain.setValueAtTime(0.45, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        clickOsc.connect(clickGain);
        clickGain.connect(ctx.destination);
        clickOsc.start(now);
        clickOsc.stop(now + 0.045);

        // 2. Loud signature upward melodic chime (D5 587Hz -> A5 880Hz)
        const chimeOsc = ctx.createOscillator();
        const chimeGain = ctx.createGain();
        chimeOsc.type = 'triangle';
        chimeOsc.frequency.setValueAtTime(587.33, now);
        chimeOsc.frequency.exponentialRampToValueAtTime(880.00, now + 0.14);

        chimeGain.gain.setValueAtTime(0.001, now);
        chimeGain.gain.linearRampToValueAtTime(0.42, now + 0.03);
        chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

        chimeOsc.connect(chimeGain);
        chimeGain.connect(ctx.destination);
        chimeOsc.start(now);
        chimeOsc.stop(now + 0.55);

        // 3. Harmonic overtone for richness
        const harmOsc = ctx.createOscillator();
        const harmGain = ctx.createGain();
        harmOsc.type = 'sine';
        harmOsc.frequency.setValueAtTime(1174.66, now);
        harmOsc.frequency.exponentialRampToValueAtTime(1760.00, now + 0.14);
        harmGain.gain.setValueAtTime(0.001, now);
        harmGain.gain.linearRampToValueAtTime(0.22, now + 0.03);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);
        harmOsc.connect(harmGain);
        harmGain.connect(ctx.destination);
        harmOsc.start(now);
        harmOsc.stop(now + 0.40);
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
   * Alias for button click feedback.
   */
  playButtonClick() {
    this.playCallChime();
  }

  /**
   * Ultra-Loud, High-Attention Restaurant Pager Buzzer Sound for customer devices.
   * Engineered with 6 urgent, piercing multi-harmonic piezo pulses (1174Hz - 2093Hz)
   * matching peak human ear sensitivity and mobile loudspeaker resonance.
   * Coupled with HTML5 Audio (/brand/pager-chime.wav) and heavy vibration pattern.
   */
  playBuzzerSound() {
    // 1. Heavy tactile hardware vibration pattern for mobile phones
    this.triggerPhoneVibration([600, 150, 600, 150, 800, 200, 1000]);

    // 2. Play newly remastered high-power pager WAV directly through HTML5 Audio
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const directAudio = new Audio('/brand/pager-chime.wav');
        directAudio.volume = 0.75;
        const p = directAudio.play();
        if (p) p.catch(() => {});
      }
    } catch {}

    // 3. Ultra-loud multi-harmonic synthetic piezo buzzer directly to audio output
    const synthesize = (ctx: AudioContext) => {
      try {
        const now = ctx.currentTime;

        // 6 urgent high-decibel pulses matching authentic restaurant pager alarm
        const pulses = [
          { start: 0.00, dur: 0.25, freq: 1174.66 }, // D6
          { start: 0.32, dur: 0.25, freq: 1567.98 }, // G6
          { start: 0.64, dur: 0.25, freq: 1174.66 }, // D6
          { start: 0.96, dur: 0.25, freq: 1567.98 }, // G6
          { start: 1.28, dur: 0.25, freq: 1760.00 }, // A6
          { start: 1.68, dur: 1.70, freq: 2093.00 }, // C7 sustained high alarm
        ];

        pulses.forEach(({ start, dur, freq }) => {
          // Fundamental + 3rd harmonic for piezo buzzer penetration
          [freq, freq * 1.5].forEach((f, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = idx === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(f, now + start);

            const peakVol = idx === 0 ? 0.55 : 0.38;
            gain.gain.setValueAtTime(0.01, now + start);
            gain.gain.linearRampToValueAtTime(peakVol, now + start + 0.008);
            gain.gain.setValueAtTime(peakVol, now + start + dur - 0.02);
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
    // 1. Play HTML5 Audio
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const directAudio = new Audio('/brand/seat-chime.wav');
        directAudio.volume = 0.70;
        const p = directAudio.play();
        if (p) p.catch(() => {});
      }
    } catch {}

    // 2. Web Audio backup
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
          gain.gain.linearRampToValueAtTime(0.40, now + idx * 0.09 + 0.02);
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
    // 1. Play HTML5 Audio
    try {
      if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
        const directAudio = new Audio('/brand/alert-chime.wav');
        directAudio.volume = 0.65;
        const p = directAudio.play();
        if (p) p.catch(() => {});
      }
    } catch {}

    // 2. Web Audio backup
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
          gain.gain.linearRampToValueAtTime(0.38, now + idx * 0.12 + 0.02);
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

