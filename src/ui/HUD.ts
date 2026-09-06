export interface HUDState {
  speed: number;
  altitude: number;
  score: number;
  combo: number;
  currentRing: number;
  totalRings: number;
  distance?: number;
  isFlapping: boolean;
  inUpdraft: boolean;
  isBoost: boolean;
  compassAngle: number; // Angle to next ring (-PI to +PI)
  controlMode: 'camera' | 'keyboard';
  trackingStatus: string;
}

export class HUD {
  // DOM Elements
  private speedEl: HTMLElement;
  private altEl: HTMLElement;
  private scoreEl: HTMLElement;
  private comboEl: HTMLElement;
  private ringProgressEl: HTMLElement;
  private ringCountEl: HTMLElement;
  private compassArrowEl: HTMLElement;
  private notificationEl: HTMLElement;
  private trackingStatusEl: HTMLElement;
  private victoryModalEl: HTMLElement;
  private victoryTimeEl: HTMLElement;
  private victoryScoreEl: HTMLElement;

  private notifyTimer: number | null = null;
  private startTime = performance.now();
  private timerEl: HTMLElement;

  constructor() {
    this.speedEl = document.getElementById('hud-speed')!;
    this.altEl = document.getElementById('hud-altitude')!;
    this.scoreEl = document.getElementById('hud-score')!;
    this.comboEl = document.getElementById('hud-combo')!;
    this.ringProgressEl = document.getElementById('ring-progress-bar')!;
    this.ringCountEl = document.getElementById('hud-ring-count')!;
    this.compassArrowEl = document.getElementById('compass-arrow')!;
    this.notificationEl = document.getElementById('hud-notification')!;
    this.trackingStatusEl = document.getElementById('tracking-status-badge')!;
    this.victoryModalEl = document.getElementById('victory-modal')!;
    this.victoryTimeEl = document.getElementById('victory-time')!;
    this.victoryScoreEl = document.getElementById('victory-score')!;
    this.timerEl = document.getElementById('hud-timer')!;
  }

  public update(state: HUDState): void {
    // Airspeed (display in knots or km/h)
    const speedKmh = Math.round(state.speed * 3.6);
    this.speedEl.textContent = `${speedKmh}`;
    if (state.speed > 35) {
      this.speedEl.style.color = '#ff6b4a';
    } else if (state.speed > 24) {
      this.speedEl.style.color = '#00f0ff';
    } else {
      this.speedEl.style.color = '#ffffff';
    }

    // Altitude
    const altM = Math.max(0, Math.round(state.altitude + 20));
    this.altEl.textContent = `${altM}m`;

    // Score & Combo
    this.scoreEl.textContent = state.score.toLocaleString();
    if (state.combo > 1) {
      this.comboEl.textContent = `x${state.combo} COMBO!`;
      this.comboEl.style.display = 'block';
    } else {
      this.comboEl.style.display = 'none';
    }

    // Ring waypoint progression in endless mode
    const distM = state.distance !== undefined ? Math.round(state.distance) : 0;
    this.ringCountEl.textContent = `${state.currentRing} RINGS (${distM}m)`;
    const progressCycle = ((state.currentRing % 10) + 1) * 10;
    this.ringProgressEl.style.width = `${progressCycle}%`;

    // Compass arrow rotation pointing toward current waypoint
    const deg = (state.compassAngle * 180) / Math.PI;
    this.compassArrowEl.style.transform = `rotate(${deg}deg)`;

    // Timer
    const elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);
    const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const s = (elapsedSec % 60).toString().padStart(2, '0');
    this.timerEl.textContent = `${m}:${s}`;

    // Tracking status badge
    if (state.trackingStatus) {
      this.trackingStatusEl.textContent = state.trackingStatus;
    }
  }

  public showNotification(text: string, type: 'flap' | 'boost' | 'updraft' | 'ring' | 'clap'): void {
    if (this.notifyTimer) {
      window.clearTimeout(this.notifyTimer);
    }

    this.notificationEl.textContent = text;
    this.notificationEl.className = `hud-notification visible ${type}`;

    this.notifyTimer = window.setTimeout(() => {
      this.notificationEl.className = 'hud-notification';
    }, 1200);
  }

  public showVictory(score: number): void {
    const elapsedSec = Math.floor((performance.now() - this.startTime) / 1000);
    const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const s = (elapsedSec % 60).toString().padStart(2, '0');

    this.victoryTimeEl.textContent = `${m}:${s}`;
    this.victoryScoreEl.textContent = score.toLocaleString();
    this.victoryModalEl.classList.add('visible');
  }

  public resetTimer(): void {
    this.startTime = performance.now();
  }

  public reset(): void {
    this.startTime = performance.now();
    this.scoreEl.textContent = '0';
    this.comboEl.style.display = 'none';
    this.ringCountEl.textContent = '0 / 12';
    this.ringProgressEl.style.width = '0%';
    this.timerEl.textContent = '00:00';
    this.victoryModalEl.classList.remove('visible');
  }
}
