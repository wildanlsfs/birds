export interface HUDState {
  speed: number;
  altitude: number;
  score: number;
  combo: number;
  currentRing: number;
  totalRings: number;
  distance?: number;
  feathersCollected?: number;
  birdName?: string;
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
  private timerEl: HTMLElement;

  // Victory Modal
  private victoryModalEl: HTMLElement;
  private victoryTimeEl: HTMLElement;
  private victoryScoreEl: HTMLElement;

  // Game Over Modal
  private gameOverModalEl: HTMLElement;
  private gameOverReasonEl: HTMLElement;
  private gameOverDistEl: HTMLElement;
  private gameOverScoreEl: HTMLElement;
  private gameOverRingsEl: HTMLElement;
  private gameOverBirdEl: HTMLElement;

  // Optional Feathers and Bird Badge Elements
  private feathersCountEl: HTMLElement | null;
  private hudBirdBadgeEl: HTMLElement | null;

  private notifyTimer: number | null = null;
  private startTime = performance.now();

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
    this.timerEl = document.getElementById('hud-timer')!;

    // Victory
    this.victoryModalEl = document.getElementById('victory-modal')!;
    this.victoryTimeEl = document.getElementById('victory-time')!;
    this.victoryScoreEl = document.getElementById('victory-score')!;

    // Game Over
    this.gameOverModalEl = document.getElementById('game-over-modal')!;
    this.gameOverReasonEl = document.getElementById('game-over-reason')!;
    this.gameOverDistEl = document.getElementById('game-over-distance')!;
    this.gameOverScoreEl = document.getElementById('game-over-score')!;
    this.gameOverRingsEl = document.getElementById('game-over-rings')!;
    this.gameOverBirdEl = document.getElementById('game-over-bird')!;

    this.feathersCountEl = document.getElementById('hud-feather-count');
    this.hudBirdBadgeEl = document.getElementById('hud-bird-badge');
  }

  public update(state: HUDState): void {
    // Airspeed (display in km/h)
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

    // Feathers Collected
    if (this.feathersCountEl && state.feathersCollected !== undefined) {
      this.feathersCountEl.textContent = `${state.feathersCollected}`;
    }

    // Active Bird Badge
    if (this.hudBirdBadgeEl && state.birdName) {
      this.hudBirdBadgeEl.textContent = state.birdName;
    }
  }

  public showNotification(text: string, type: 'flap' | 'boost' | 'updraft' | 'ring' | 'clap' | 'feather' | 'warning'): void {
    if (this.notifyTimer) {
      window.clearTimeout(this.notifyTimer);
    }

    this.notificationEl.textContent = text;
    this.notificationEl.className = `hud-notification visible ${type}`;

    this.notifyTimer = window.setTimeout(() => {
      this.notificationEl.className = 'hud-notification';
    }, 1300);
  }

  public showGameOver(reason: string, distance: number, score: number, rings: number, birdName: string): void {
    if (this.gameOverReasonEl) this.gameOverReasonEl.textContent = reason;
    if (this.gameOverDistEl) this.gameOverDistEl.textContent = `${Math.round(distance)}m`;
    if (this.gameOverScoreEl) this.gameOverScoreEl.textContent = score.toLocaleString();
    if (this.gameOverRingsEl) this.gameOverRingsEl.textContent = `${rings}`;
    if (this.gameOverBirdEl) this.gameOverBirdEl.textContent = birdName;

    this.gameOverModalEl?.classList.add('visible');
  }

  public hideGameOver(): void {
    this.gameOverModalEl?.classList.remove('visible');
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
    if (this.feathersCountEl) this.feathersCountEl.textContent = '0';
    this.victoryModalEl?.classList.remove('visible');
    this.gameOverModalEl?.classList.remove('visible');
  }

  public setFeathers(count: number): void {
    if (this.feathersCountEl) {
      this.feathersCountEl.textContent = `${count}`;
    }
  }

  public setBirdBadge(name: string, icon: string): void {
    if (this.hudBirdBadgeEl) {
      this.hudBirdBadgeEl.textContent = `${icon} ${name}`;
    }
  }
}
