// Hybrid background audio controller supporting both custom audio URLs/uploads
// and a soothing built-in Web Audio API romantic piano arpeggio fallback.

class WeddingAudioEngine {
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private loopTimer: number | null = null;
  private mode: 'builtin' | 'custom' = 'builtin';
  private customUrl = '';
  private isPlaying = false;
  private isMuted = false;
  private step = 0;

  // Romantic Cmaj7 - Am7 - Fmaj7 - G6 arpeggio frequencies (Hz)
  private readonly chords = [
    [261.63, 329.63, 392.0, 493.88, 523.25, 493.88, 392.0, 329.63],
    [220.0, 261.63, 329.63, 392.0, 440.0, 392.0, 329.63, 261.63],
    [174.61, 220.0, 261.63, 329.63, 349.23, 329.63, 261.63, 220.0],
    [196.0, 246.94, 293.66, 329.63, 392.0, 329.63, 293.66, 246.94],
  ];

  configure(mode: 'builtin' | 'custom', url: string) {
    const changed = this.mode !== mode || this.customUrl !== url;
    this.mode = mode;
    this.customUrl = url;
    if (changed && this.isPlaying) {
      this.stop();
      this.play();
    }
  }

  private playNote(freq: number) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const oscHarmonic = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    oscHarmonic.type = 'triangle';
    oscHarmonic.frequency.setValueAtTime(freq * 2, now);

    const harmGain = this.ctx.createGain();
    harmGain.gain.setValueAtTime(0.08, now);

    noteGain.gain.setValueAtTime(0.0001, now);
    noteGain.gain.exponentialRampToValueAtTime(0.18, now + 0.06);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);

    osc.connect(noteGain);
    oscHarmonic.connect(harmGain);
    harmGain.connect(noteGain);
    noteGain.connect(this.masterGain);

    osc.start(now);
    oscHarmonic.start(now);
    osc.stop(now + 1.85);
    oscHarmonic.stop(now + 1.85);
  }

  private startBuiltinSynth() {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.45, this.ctx.currentTime);
    }

    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer);
    }

    const tick = () => {
      if (!this.isPlaying) return;
      const chordIndex = Math.floor(this.step / 8) % this.chords.length;
      const noteIndex = this.step % 8;
      const freq = this.chords[chordIndex][noteIndex];
      this.playNote(freq);
      this.step += 1;
    };

    tick();
    this.loopTimer = window.setInterval(tick, 520);
  }

  async play(): Promise<boolean> {
    this.isPlaying = true;
    if (this.mode === 'custom' && this.customUrl.trim()) {
      try {
        if (!this.audioEl || this.audioEl.src !== new URL(this.customUrl, window.location.origin).href) {
          this.audioEl?.pause();
          this.audioEl = new Audio(this.customUrl);
          this.audioEl.loop = true;
        }
        this.audioEl.muted = this.isMuted;
        this.audioEl.volume = 0.6;
        await this.audioEl.play();
        return true;
      } catch {
        // Fallback to built-in synth if custom stream fails
        this.startBuiltinSynth();
        return true;
      }
    } else {
      this.startBuiltinSynth();
      return true;
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.audioEl) {
      this.audioEl.pause();
    }
    if (this.loopTimer !== null) {
      window.clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.audioEl) {
      this.audioEl.muted = muted;
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.45, this.ctx.currentTime);
    }
  }

  getState() {
    return { isPlaying: this.isPlaying, isMuted: this.isMuted };
  }
}

export const weddingAudio = new WeddingAudioEngine();
