// Procedural Web Audio API sound generator for AI-Bomberman
// Completely self-contained with no external audio file dependencies.

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private explosionNoiseBuffer: AudioBuffer | null = null;
  private isSfxMuted: boolean = false; // Default ON for Sound Effects (SE)
  private bgmPlaying: boolean = false;
  private bgmStep: number = 0;
  private bgmTimer: number | null = null;
  private lastExplosionAt: number = 0;
  private lastKickAt: number = 0;
  private lastItemAt: number = 0;

  constructor() {
    // Lazily initialize upon first user gesture
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();

      this.sfxGain.gain.value = this.isSfxMuted ? 0 : 0.7;
      this.bgmGain.gain.value = 0.22;
      this.masterGain.gain.value = 1.0;

      this.sfxGain.connect(this.masterGain);
      this.bgmGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      // Pre-generate white noise buffer once for explosions
      const dur = 0.55;
      const bufferSize = Math.floor(this.ctx.sampleRate * dur);
      this.explosionNoiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = this.explosionNoiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public enableAudio() {
    this.initContext();
  }

  public toggleMute(): boolean {
    this.isSfxMuted = !this.isSfxMuted;
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setValueAtTime(this.isSfxMuted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.isSfxMuted;
  }

  public isAudioMuted(): boolean {
    return this.isSfxMuted;
  }

  // Sound Effects

  public playBombDrop() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.12);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.15);
  }

  public playExplosion() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || !this.explosionNoiseBuffer || this.isSfxMuted) return;

    const now = performance.now();
    if (now - this.lastExplosionAt < 28) return;
    this.lastExplosionAt = now;

    const t = this.ctx.currentTime;
    const dur = 0.55;

    // 1. Noise blast (reusing pre-generated buffer)
    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = this.explosionNoiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + dur);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.9, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    whiteNoise.start(t);
    whiteNoise.stop(t + dur);

    // 2. Sub-bass rumble
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(130, t);
    subOsc.frequency.exponentialRampToValueAtTime(35, t + dur * 0.8);

    subGain.gain.setValueAtTime(0.8, t);
    subGain.gain.exponentialRampToValueAtTime(0.01, t + dur);

    subOsc.connect(subGain);
    subGain.connect(this.sfxGain);

    subOsc.start(t);
    subOsc.stop(t + dur);
  }

  public playItemGet() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const now = performance.now();
    if (now - this.lastItemAt < 25) return;
    this.lastItemAt = now;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const noteTime = t + idx * 0.055;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.4, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.12);

      osc.connect(gain);
      gain.connect(this.sfxGain!);

      osc.start(noteTime);
      osc.stop(noteTime + 0.13);
    });
  }

  public playKick() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const now = performance.now();
    if (now - this.lastKickAt < 25) return;
    this.lastKickAt = now;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.1);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.13);
  }

  public playShieldBreak() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.25);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.32);
  }

  public playPlayerDeath() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.4);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.45);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.46);
  }

  public playWallThud() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.18);

    gain.gain.setValueAtTime(0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.22);
  }

  public playWin() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const t = this.ctx.currentTime;
    // Fanfare: C4, E4, G4, C5, E5, G5, C6 (Held)
    const melody = [
      { f: 523.25, d: 0.12 },
      { f: 659.25, d: 0.12 },
      { f: 783.99, d: 0.12 },
      { f: 1046.5, d: 0.4 },
    ];

    let current = t;
    melody.forEach((note) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.f, current);

      gain.gain.setValueAtTime(0.5, current);
      gain.gain.exponentialRampToValueAtTime(0.01, current + note.d);

      osc.connect(gain);
      gain.connect(this.sfxGain!);

      osc.start(current);
      osc.stop(current + note.d + 0.05);
      current += note.d * 0.9;
    });
  }

  public playHurry() {
    this.initContext();
    if (!this.ctx || !this.sfxGain || this.isSfxMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.setValueAtTime(1200, t + 0.08);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  // Procedural 8-bit Chiptune BGM
  public startBGM() {
    this.initContext();
    if (this.bgmPlaying) return;
    this.bgmPlaying = true;
    this.bgmStep = 0;

    const tempo = 138; // BPM
    const stepDuration = 60 / tempo / 2; // Eighth note in seconds

    // Bass notes (A-minor based catchy arcade bounce)
    const bassline = [
      220, 220, 261.63, 220, 196, 196, 220, 246.94,
      220, 220, 261.63, 220, 174.61, 174.61, 196, 196,
    ];

    // Lead arpeggio melody
    const leadNotes = [
      440, 0, 523.25, 659.25, 587.33, 523.25, 493.88, 523.25,
      440, 659.25, 523.25, 440, 392, 440, 493.88, 523.25,
    ];

    const playStep = () => {
      if (!this.bgmPlaying || !this.ctx || !this.bgmGain ) {
        if (this.bgmPlaying) {
          this.bgmTimer = window.setTimeout(playStep, stepDuration * 1000);
        }
        return;
      }

      const t = this.ctx.currentTime;
      const step = this.bgmStep % 16;

      // 1. Bass synth
      const bassFreq = bassline[step];
      if (bassFreq > 0) {
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(bassFreq / 2, t);

        bassGain.gain.setValueAtTime(0.3, t);
        bassGain.gain.exponentialRampToValueAtTime(0.01, t + stepDuration * 0.9);

        bassOsc.connect(bassGain);
        bassGain.connect(this.bgmGain);

        bassOsc.start(t);
        bassOsc.stop(t + stepDuration);
      }

      // 2. Lead synth (every 2nd step or melody)
      const leadFreq = leadNotes[step];
      if (leadFreq > 0) {
        const leadOsc = this.ctx.createOscillator();
        const leadGain = this.ctx.createGain();
        leadOsc.type = 'pulse' as OscillatorType || 'square';
        leadOsc.frequency.setValueAtTime(leadFreq, t);

        leadGain.gain.setValueAtTime(0.18, t);
        leadGain.gain.exponentialRampToValueAtTime(0.01, t + stepDuration * 0.85);

        leadOsc.connect(leadGain);
        leadGain.connect(this.bgmGain);

        leadOsc.start(t);
        leadOsc.stop(t + stepDuration);
      }

      // 3. Simple hi-hat / snare on alternate beats
      if (step % 2 === 0) {
        // High hat tick
        const hatDur = 0.03;
        const bSize = Math.floor(this.ctx.sampleRate * hatDur);
        const noiseBuf = this.ctx.createBuffer(1, bSize, this.ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < bSize; i++) data[i] = Math.random() * 2 - 1;

        const hatSource = this.ctx.createBufferSource();
        hatSource.buffer = noiseBuf;

        const hatFilter = this.ctx.createBiquadFilter();
        hatFilter.type = 'highpass';
        hatFilter.frequency.setValueAtTime(7000, t);

        const hatGain = this.ctx.createGain();
        hatGain.gain.setValueAtTime(step % 4 === 2 ? 0.25 : 0.12, t);
        hatGain.gain.exponentialRampToValueAtTime(0.005, t + hatDur);

        hatSource.connect(hatFilter);
        hatFilter.connect(hatGain);
        hatGain.connect(this.bgmGain);

        hatSource.start(t);
        hatSource.stop(t + hatDur);
      }

      this.bgmStep++;
      this.bgmTimer = window.setTimeout(playStep, stepDuration * 1000);
    };

    playStep();
  }

  public stopBGM() {
    this.bgmPlaying = false;
    if (this.bgmTimer !== null) {
      clearTimeout(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  public toggleBGM(): boolean {
    if (this.bgmPlaying) {
      this.stopBGM();
      return false;
    } else {
      this.startBGM();
      return true;
    }
  }

  public isBGMPlaying(): boolean {
    return this.bgmPlaying;
  }
}

export const sounds = new SoundManager();
