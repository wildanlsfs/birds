/**
 * Procedural Web Audio Engine for AeroWing 3D
 * Generates all sounds dynamically: wind rushing, wing flap swoosh,
 * clap sonic boom, ring collection chimes, and updraft hums.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;

  // Continuous wind sound
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windSource: AudioBufferSourceNode | null = null;

  // Master volume
  private masterGain: GainNode | null = null;
  private isMuted = false;

  constructor() {
    // Lazy init on first user gesture
  }

  public init(): void {
    if (this.isInitialized) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.setupWindAmbience();
      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  public ensureRunning(): void {
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Generates continuous filtered white noise representing airspeed wind
   */
  private setupWindAmbience(): void {
    if (!this.ctx || !this.masterGain) return;

    // Create 3 seconds of white noise buffer
    const bufferSize = this.ctx.sampleRate * 3;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = noiseBuffer;
    this.windSource.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(400, this.ctx.currentTime);
    this.windFilter.Q.setValueAtTime(1.8, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.05, this.ctx.currentTime);

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    this.windSource.start();
  }

  /**
   * Dynamically update wind noise frequency & volume based on airspeed
   */
  public updateAirspeed(normalizedSpeed: number): void {
    if (!this.ctx || !this.windFilter || !this.windGain || this.isMuted) return;

    const clamped = Math.max(0, Math.min(1.5, normalizedSpeed));
    const targetFreq = 250 + clamped * 1800; // 250Hz up to 2950Hz
    const targetGain = 0.04 + clamped * 0.28;

    const now = this.ctx.currentTime;
    this.windFilter.frequency.setTargetAtTime(targetFreq, now, 0.1);
    this.windGain.gain.setTargetAtTime(targetGain, now, 0.1);
  }

  /**
   * Sound of wings flapping (soft air displacement)
   */
  public playFlap(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();

    const now = this.ctx.currentTime;

    // Low frequency sine thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.2);

    // Noise gust sweep
    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.05));
    }

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(900, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(150, now + 0.2);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noiseSrc.start(now);
    noiseSrc.stop(now + 0.22);
  }

  /**
   * Resounding clap boom: powerful upward thrust sound effect
   */
  public playClapBoom(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();

    const now = this.ctx.currentTime;

    // Sub bass punch
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(180, now);
    subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.4);

    subGain.gain.setValueAtTime(0.7, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);

    subOsc.start(now);
    subOsc.stop(now + 0.5);

    // Air sonic burst
    const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.35, this.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.35);
    filter.Q.value = 2.5;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.5, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 0.36);

    // Shimmer chime
    const shimmer = this.ctx.createOscillator();
    const shimmerGain = this.ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(1046.5, now); // C6
    shimmer.frequency.exponentialRampToValueAtTime(1318.5, now + 0.25); // E6

    shimmerGain.gain.setValueAtTime(0.25, now);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.masterGain);

    shimmer.start(now);
    shimmer.stop(now + 0.3);
  }

  /**
   * Passing through glowing ring waypoint
   */
  public playRingChime(combo = 1): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();

    const now = this.ctx.currentTime;
    // Harmonic notes based on combo
    const basePitches = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]; // C5, E5, G5, C6, E6, G6
    const pitchIndex = Math.min(basePitches.length - 1, (combo - 1) % basePitches.length);
    const freq1 = basePitches[pitchIndex];
    const freq2 = freq1 * 1.5; // Perfect fifth

    [freq1, freq2].forEach((f, i) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f, now + i * 0.04);

      gain.gain.setValueAtTime(0.35 / (i + 1), now + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now + i * 0.04);
      osc.stop(now + 0.5);
    });
  }

  /**
   * Entering an updraft thermal column
   */
  public playUpdraftEnter(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.35);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  /**
   * Course victory chord
   */
  public playVictoryFanfare(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();

    const now = this.ctx.currentTime;
    const chords = [
      [523.25, 659.25, 783.99],          // C major
      [587.33, 739.99, 880.00],          // D major
      [659.25, 830.61, 987.77],          // E major
      [1046.50, 1318.51, 1567.98, 2093]  // High C maj swell
    ];

    chords.forEach((chord, step) => {
      const stepTime = now + step * 0.18;
      chord.forEach((freq) => {
        if (!this.ctx || !this.masterGain) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, stepTime);

        const duration = step === chords.length - 1 ? 0.9 : 0.22;
        gain.gain.setValueAtTime(0.18, stepTime);
        gain.gain.exponentialRampToValueAtTime(0.001, stepTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(stepTime);
        osc.stop(stepTime + duration + 0.05);
      });
    });
  }

  /**
   * Play synthesized countdown beep
   */
  public playCountdownBeep(isHigh = false): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isHigh ? 880 : 440, now);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * Dramatic Crash Explosion & Impact Thud (Game Over)
   */
  public playCrashSound(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();
    const now = this.ctx.currentTime;

    // 1. Deep Sub-bass Thud
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(160, now);
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.7);

    subGain.gain.setValueAtTime(0.85, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.9);

    // 2. Impact Noise Burst (Foliage / Rock Crunch)
    const noiseLen = this.ctx.sampleRate * 0.6;
    const noiseBuf = this.ctx.createBuffer(1, noiseLen, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.18));
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(1200, now);
    noiseFilter.frequency.linearRampToValueAtTime(150, now + 0.55);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.7, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noiseSource.start(now);
  }

  /**
   * Bird Selection harmonic chime
   */
  public playBirdSelectSound(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();
    const now = this.ctx.currentTime;
    const notes = [440, 554, 659, 880];

    notes.forEach((freq, idx) => {
      const t = now + idx * 0.055;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.38);
    });
  }

  /**
   * Golden Feather collection chime
   */
  public playFeatherCollectSound(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    this.ensureRunning();
    const now = this.ctx.currentTime;
    const notes = [880, 1174, 1567, 1760];

    notes.forEach((freq, idx) => {
      const t = now + idx * 0.045;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.isMuted;
  }
}
