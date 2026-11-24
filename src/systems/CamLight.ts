// Low-light helpers for the webcam: 720p/30 request, exposure tuning, brightness meter, pose-frame brightener.
// (measured on the owner's cheap USB webcam: 640x480 fell to 15 fps, 720p held 30.)

export const CAM_VIDEO: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, min: 15 },
  facingMode: 'user',
};

// Exposure keys are not in the lib.dom typings everywhere.
type ExposureCaps = MediaTrackCapabilities & {
  exposureMode?: string[];
  exposureCompensation?: { min: number; max: number };
  whiteBalanceMode?: string[];
};

/** Best-effort exposure tuning. Never throws; returns the list of settings that were accepted. */
export async function lowLightTune(track: MediaStreamTrack | null | undefined): Promise<string[]> {
  const applied: string[] = [];
  if (!track || typeof track.getCapabilities !== 'function') return applied;
  let caps: ExposureCaps = {};
  try { caps = (track.getCapabilities() || {}) as ExposureCaps; } catch { return applied; }
  const tryApply = async (name: string, advanced: Record<string, unknown>): Promise<void> => {
    try {
      await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
      applied.push(name);
    } catch { /* unsupported on this camera */ }
  };
  if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
    await tryApply('exposureMode', { exposureMode: 'continuous' });
  }
  if (caps.exposureCompensation && typeof caps.exposureCompensation.max === 'number') {
    const { min, max } = caps.exposureCompensation;
    await tryApply('exposureCompensation', { exposureCompensation: Math.min(max, Math.max(min, 1)) });
  }
  if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
    await tryApply('whiteBalanceMode', { whiteBalanceMode: 'continuous' });
  }
  return applied;
}

export const LIGHT = { dark: 60, dim: 90, target: 115, maxGain: 1.8 };

export type LightLevel = 'dark' | 'dim' | 'ok' | 'unknown';

export class LightMeter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  avg: number | null = null; // latest average luma 0-255 (null = unknown)
  gain = 1;                  // smoothed brightness gain for pose frames, 1 = untouched
  private at = 0;

  constructor(private video: HTMLVideoElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 16;
    this.canvas.height = 12;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Call every frame; it only reads pixels every ~500 ms. Returns the latest average (or null). */
  sample(nowMs: number = performance.now()): number | null {
    if (nowMs - this.at < 500 || !this.ctx || !this.video || this.video.readyState < 2) return this.avg;
    this.at = nowMs;
    try {
      this.ctx.drawImage(this.video, 0, 0, 16, 12);
      const d = this.ctx.getImageData(0, 0, 16, 12).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      this.avg = sum / (d.length / 4);
      const want = this.avg < LIGHT.target - 8 ? Math.min(LIGHT.maxGain, LIGHT.target / Math.max(this.avg, 20)) : 1;
      this.gain += (want - this.gain) * 0.35;
    } catch { this.avg = null; }
    return this.avg;
  }

  get level(): LightLevel {
    if (this.avg === null) return 'unknown';
    return this.avg < LIGHT.dark ? 'dark' : this.avg < LIGHT.dim ? 'dim' : 'ok';
  }
}

type BrightCanvas = HTMLCanvasElement & { ctx?: CanvasRenderingContext2D };
let _bf: BrightCanvas | null = null;

/** Pose-model input: the video brightened by `gain`, drawn at w x h. Returns the video itself when no boost is needed. */
export function brightFrame(
  video: HTMLVideoElement,
  gain: number,
  w = 320,
  h = 240,
): HTMLVideoElement | HTMLCanvasElement {
  if (!(gain > 1.06)) return video;
  if (!_bf) {
    _bf = document.createElement('canvas') as BrightCanvas;
    _bf.ctx = _bf.getContext('2d') ?? undefined;
  }
  const ctx = _bf.ctx;
  if (!ctx || !('filter' in ctx)) return video; // Safari: no canvas filter, keep raw frames
  if (_bf.width !== w || _bf.height !== h) { _bf.width = w; _bf.height = h; }
  ctx.filter = `brightness(${gain.toFixed(2)}) contrast(1.08)`;
  ctx.drawImage(video, 0, 0, w, h);
  return _bf;
}

export const DARK_HINT_ID = 'Ruangan terlalu gelap: nyalakan lampu di depanmu (bukan di belakang).';
export const DIM_HINT_ID = 'Agak redup: tambah cahaya dari depan supaya gerakan terbaca lebih mulus.';
