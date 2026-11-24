import * as THREE from 'three';
import { AudioEngine } from './systems/AudioEngine';
import { HazardManager } from './entities/Hazards';
import { awardReward, computeReward, getProgress, getSkin, markIntroSeen, buySkin, equipSkin, SKINS, COIN_RULES } from './systems/Progress';
import { BirdMesh, BirdProfile, BIRD_PROFILES } from './entities/BirdMesh';
import { World } from './entities/World';
import { WaypointManager } from './entities/Waypoints';
import { FlightPhysics, FlightInput } from './systems/FlightPhysics';
import { MotionTracker, MotionData } from './systems/MotionTracker';
import { recordRun } from './systems/ScoreStore';
import { HUD } from './ui/HUD';

class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  // Game Systems
  private audio: AudioEngine;
  private bird: BirdMesh;
  private world: World;
  private waypoints: WaypointManager;
  private hazards: HazardManager;
  private physics: FlightPhysics;
  private motionTracker: MotionTracker;
  private hud: HUD;

  // State
  private isRunning = false;
  private inCalibration = false;
  private countdownActive = false;
  private lastTime = performance.now();
  private controlMode: 'camera' | 'keyboard' = 'camera';
  private currentBirdType: 'small' | 'medium' | 'large' = 'medium';
  private hits = 0;
  private feathersCollected = 0;
  private isGameOver = false;
  private cameraShakeTime = 0;
  private cameraShakeIntensity = 0;
  private flapCooldown = 0;
  private spaceWasDown = false;
  private touchFlapWasDown = false;
  private frameTimes: number[] = [];
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  private sizeKey = '';

  // Keyboard / Mouse input states
  private keyState = {
    left: false,
    right: false,
    up: false,
    down: false,
    space: false,
    brake: false
  };
  private prevPos = new THREE.Vector3();

  // Touch / Mobile Input states
  private isTouchDevice = false;
  private touchState = {
    roll: 0,
    pitch: 0,
    flap: false,
    brake: false
  };
  private touchControlsEl: HTMLElement;
  private touchStickKnobEl: HTMLElement;

  // Screen Wake Lock & Milestones
  private wakeLock: any = null;
  private lastMilestoneDistance = 0;
  private totalDistanceTraveled = 0;
  private wasInStorm = false;
  private wasTooCloseToCam = false;

  // Speed lines overlay
  private speedLinesEl: HTMLElement;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.speedLinesEl = document.getElementById('speed-lines-overlay')!;
    this.touchControlsEl = document.getElementById('touch-controls-layer')!;
    this.touchStickKnobEl = document.getElementById('touch-stick-knob')!;
    this.isTouchDevice = Boolean('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
    if (this.isTouchDevice) {
      document.body.classList.add('has-touch');
    }

    // 1. Scene & Renderer
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // 2. Camera Setup (3rd-person follow); real aspect is applied by resize()
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 3000);
    this.camera.position.set(0, 25, 32);

    // 3. Initialize Systems
    this.audio = new AudioEngine();
    this.physics = new FlightPhysics();
    this.world = new World(this.scene);
    this.waypoints = new WaypointManager(this.scene);
    this.hazards = new HazardManager(this.scene);
    this.waypoints.clearSpot = (pos, radius) => this.world.clearRingSpot(pos, radius);

    this.bird = new BirdMesh();
    this.bird.setSkin(getSkin(getProgress().skin).colors);
    this.scene.add(this.bird.group);

    // Add contrail lines to scene
    const trails = this.bird.getTrails();
    this.scene.add(trails.left);
    this.scene.add(trails.right);

    // Camera Motion Tracker
    const video = document.getElementById('webcam-video') as HTMLVideoElement;
    const previewCanvas = document.getElementById('webcam-overlay') as HTMLCanvasElement;
    this.motionTracker = new MotionTracker(video, previewCanvas);

    // HUD
    this.hud = new HUD();
    this.hud.refreshBestScores();

    // Event Listeners
    this.setupWindowListeners();
    this.resize();
    this.setupKeyboardListeners();
    this.setupTouchListeners();
    this.setupUIButtons();
    this.setupIntro();
    this.refreshCoinViews();
  }

  private async requestWakeLock(): Promise<void> {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        console.log('🔆 Screen Wake Lock active - screen will not sleep during game');
      } catch (err) {
        console.warn('Wake Lock request notice:', err);
      }
    }
  }

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  /**
   * Size the drawing buffer from the canvas' CSS box (never the other way round). iOS Safari reports
   * stale window sizes for a moment after rotation, so we re-measure on several signals and dedupe.
   */
  private resize = (): void => {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const key = `${w}x${h}@${this.pixelRatio}`;
    if (key === this.sizeKey) return;
    this.sizeKey = key;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical FOV so the wings and the next ring stay in view
    this.baseFov = w < h ? 74 : 62;
    this.camera.updateProjectionMatrix();
  };
  private baseFov = 62;

  private setupWindowListeners(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', () => {
      this.resize();
      setTimeout(this.resize, 250);
      setTimeout(this.resize, 600);
    });
    window.visualViewport?.addEventListener('resize', this.resize);
    if ('ResizeObserver' in window) new ResizeObserver(this.resize).observe(this.canvas);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (this.isRunning || this.inCalibration)) {
        this.requestWakeLock();
      }
    });
  }

  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyB'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'KeyR' && (this.isRunning || this.isGameOver)) {
        this.restartGame();
        return;
      }
      if (e.code === 'Escape') {
        this.closeOverlays();
        return;
      }
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keyState.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keyState.right = true;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keyState.up = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keyState.down = true;
      if (e.code === 'KeyB' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keyState.brake = true;
      if (e.code === 'Space') this.keyState.space = true;
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keyState.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keyState.right = false;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keyState.up = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keyState.down = false;
      if (e.code === 'KeyB' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keyState.brake = false;
      if (e.code === 'Space') this.keyState.space = false;
    });
  }

  private setupTouchListeners(): void {
    const stickZone = document.getElementById('touch-stick-zone');
    const stickBase = document.getElementById('touch-stick-base');
    const btnFlap = document.getElementById('btn-touch-flap');
    const btnBrake = document.getElementById('btn-touch-brake');

    if (!stickZone || !stickBase || !btnFlap || !btnBrake) return;

    let touchId: number | null = null;
    let baseRect: DOMRect | null = null;
    const maxRadius = 38;

    const onStickMove = (clientX: number, clientY: number) => {
      if (!baseRect) baseRect = stickBase.getBoundingClientRect();
      const centerX = baseRect.left + baseRect.width / 2;
      const centerY = baseRect.top + baseRect.height / 2;

      let dx = clientX - centerX;
      let dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      this.touchStickKnobEl.style.transform = `translate(${dx}px, ${dy}px)`;

      // Normalized roll: left (-1) to right (+1)
      this.touchState.roll = dx / maxRadius;
      // Normalized pitch: pulling down (positive dy) pitches nose UP (+0.85), pushing up dives nose DOWN (-0.85)
      this.touchState.pitch = -dy / maxRadius;
    };

    const onStickEnd = () => {
      touchId = null;
      baseRect = null;
      this.touchStickKnobEl.style.transform = 'translate(0px, 0px)';
      this.touchState.roll = 0;
      this.touchState.pitch = 0;
    };

    stickZone.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      if (touchId === null && e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        touchId = touch.identifier;
        baseRect = stickBase.getBoundingClientRect();
        onStickMove(touch.clientX, touch.clientY);
      }
    }, { passive: false });

    stickZone.addEventListener('touchmove', (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === touchId) {
          onStickMove(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: false });

    stickZone.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          onStickEnd();
          break;
        }
      }
    }, { passive: false });

    stickZone.addEventListener('touchcancel', () => {
      onStickEnd();
    });

    // Flap Button
    btnFlap.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      this.touchState.flap = true;
    }, { passive: false });

    btnFlap.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      this.touchState.flap = false;
    }, { passive: false });

    btnFlap.addEventListener('touchcancel', () => {
      this.touchState.flap = false;
    });

    // Brake Button
    btnBrake.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      this.touchState.brake = true;
    }, { passive: false });

    btnBrake.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      this.touchState.brake = false;
    }, { passive: false });

    btnBrake.addEventListener('touchcancel', () => {
      this.touchState.brake = false;
    });
  }

  private setupUIButtons(): void {
    // Start with Camera & Pre-Flight Check
    const btnStart = document.getElementById('btn-start-game')!;
    btnStart.addEventListener('click', () => {
      this.audio.init();
      document.getElementById('welcome-modal')!.classList.remove('visible');
      this.controlMode = 'camera';
      if (this.isTouchDevice) {
        this.touchControlsEl.classList.add('active');
      }
      this.startCalibrationFlow();
    });

    // Start with Keyboard / Touch Controls
    const btnKeyboard = document.getElementById('btn-start-keyboard')!;
    btnKeyboard.addEventListener('click', () => {
      this.audio.init();
      document.getElementById('welcome-modal')!.classList.remove('visible');
      this.hud.resetTimer();
      this.isRunning = true;
      this.controlMode = 'keyboard';
      document.getElementById('pip-webcam-container')!.style.display = 'none';
      document.body.classList.remove('cam-mode');
      document.getElementById('btn-camera-text')!.textContent = 'Tombol';
      this.touchControlsEl.classList.toggle('active', this.isTouchDevice);
      this.requestWakeLock();
      this.restartGame();
    });

    // Toggle Camera
    const btnToggleCam = document.getElementById('btn-toggle-camera')!;
    btnToggleCam.addEventListener('click', async () => {
      if (this.controlMode === 'camera') {
        this.controlMode = 'keyboard';
        document.getElementById('btn-camera-text')!.textContent = 'Tombol';
        document.getElementById('pip-webcam-container')!.style.display = 'none';
        document.body.classList.remove('cam-mode');
        this.touchControlsEl.classList.toggle('active', this.isTouchDevice);
        this.motionTracker.stop();
      } else {
        this.controlMode = 'camera';
        document.getElementById('btn-camera-text')!.textContent = 'Kamera';
        document.getElementById('pip-webcam-container')!.style.display = 'block';
        document.body.classList.add('cam-mode');
        if (!this.isTouchDevice) {
          this.touchControlsEl.classList.remove('active');
        }
        await this.motionTracker.start();
      }
    });

    // Toggle Audio Mute
    const btnAudio = document.getElementById('btn-toggle-audio')!;
    btnAudio.addEventListener('click', () => {
      const isMuted = this.audio.toggleMute();
      document.getElementById('audio-icon')!.textContent = isMuted ? '🔇' : '🔊';
      document.getElementById('audio-text')!.textContent = isMuted ? 'Senyap' : 'Suara';
    });

    // Help Modal
    const btnHelp = document.getElementById('btn-open-help')!;
    const helpModal = document.getElementById('help-modal')!;
    const btnCloseHelp = document.getElementById('btn-close-help')!;

    btnHelp.addEventListener('click', () => helpModal.classList.add('visible'));
    btnCloseHelp.addEventListener('click', () => helpModal.classList.remove('visible'));

    // Minimize PIP
    const btnMinPip = document.getElementById('btn-minimize-pip')!;
    const pipViewport = document.querySelector('.pip-viewport') as HTMLElement;
    let pipMinimized = false;
    btnMinPip.addEventListener('click', () => {
      pipMinimized = !pipMinimized;
      pipViewport.style.display = pipMinimized ? 'none' : 'block';
      btnMinPip.textContent = pipMinimized ? '□' : '_';
    });

    // Restart Flight Button
    const btnRestart = document.getElementById('btn-restart-flight');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        this.restartGame();
      });
    }

    // Play Again
    const btnPlayAgain = document.getElementById('btn-play-again')!;
    btnPlayAgain.addEventListener('click', () => {
      this.restartGame();
    });

    // Bird Selection in Welcome Modal
    document.querySelectorAll('.bird-card-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.bird as 'small' | 'medium' | 'large';
        if (type) {
          this.audio.init();
          this.selectBirdProfile(type);
        }
      });
    });

    // Hangar Modal (Species Selection)
    const btnOpenHangar = document.getElementById('btn-open-hangar');
    const hangarModal = document.getElementById('hangar-modal')!;
    const btnCloseHangar = document.getElementById('btn-close-hangar')!;

    btnOpenHangar?.addEventListener('click', () => {
      this.audio.init();
      this.hud.refreshBestScores();
      this.renderSkins();
      hangarModal.classList.add('visible');
    });

    btnCloseHangar?.addEventListener('click', () => {
      hangarModal.classList.remove('visible');
      // Came here from the crash screen: closing the hangar starts the next flight
      if (this.isGameOver) this.restartGame();
    });

    document.querySelectorAll('.hangar-bird-card .btn-select-bird').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget as HTMLElement;
        const type = targetBtn.dataset.bird as 'small' | 'medium' | 'large';
        if (type) {
          this.audio.init();
          this.selectBirdProfile(type);
          this.hud.showNotification(`${BIRD_PROFILES[type].icon} ${shortName(BIRD_PROFILES[type].name)} siap!`, 'boost');
        }
      });
    });

    // Game Over Crash Modal Buttons
    const btnRetryCrash = document.getElementById('btn-retry-crash');
    btnRetryCrash?.addEventListener('click', () => {
      this.hud.hideGameOver();
      this.restartGame();
    });

    const btnChangeBirdCrash = document.getElementById('btn-change-bird-crash');
    btnChangeBirdCrash?.addEventListener('click', () => {
      this.hud.hideGameOver();
      this.renderSkins();
      hangarModal.classList.add('visible');
    });
  }


  // ---------- Intro, rewards, skins ----------
  private introStep = 0;

  private showIntro(): void {
    this.introStep = 0;
    this.renderIntro();
    document.getElementById('welcome-modal')!.classList.remove('visible');
    document.getElementById('intro-modal')!.classList.add('visible');
  }

  private renderIntro(): void {
    const steps = document.querySelectorAll<HTMLElement>('#intro-modal .intro-step');
    steps.forEach((el, i) => (el.hidden = i !== this.introStep));
    document.querySelectorAll('#intro-dots i').forEach((d, i) => d.classList.toggle('on', i === this.introStep));
    document.getElementById('intro-badge')!.textContent = `LANGKAH ${this.introStep + 1} / ${steps.length}`;
    document.querySelector('#btn-intro-next span')!.textContent = this.introStep === steps.length - 1 ? 'Mengerti, ayo terbang!' : 'Lanjut';
  }

  private closeIntro(): void {
    markIntroSeen();
    document.getElementById('intro-modal')!.classList.remove('visible');
    document.getElementById('welcome-modal')!.classList.add('visible');
    this.refreshCoinViews();
  }

  private setupIntro(): void {
    document.getElementById('btn-intro-next')!.addEventListener('click', () => {
      if (this.introStep >= document.querySelectorAll('#intro-modal .intro-step').length - 1) {
        this.closeIntro();
      } else {
        this.introStep += 1;
        this.renderIntro();
      }
    });
    document.getElementById('btn-intro-skip')!.addEventListener('click', () => this.closeIntro());
    document.getElementById('btn-replay-intro')!.addEventListener('click', () => this.showIntro());
    if (!getProgress().seenIntro) this.showIntro();
  }

  private refreshCoinViews(): void {
    const p = getProgress();
    const w = document.getElementById('welcome-coins');
    if (w) w.textContent = `🪙 ${p.coins} koin`;
    const h = document.getElementById('hangar-coins');
    if (h) h.textContent = `🪙 ${p.coins}`;
  }

  private renderSkins(): void {
    const list = document.getElementById('skin-list');
    if (!list) return;
    const p = getProgress();
    this.refreshCoinViews();
    list.innerHTML = '';
    for (const skin of SKINS) {
      const owned = p.unlocked.includes(skin.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.skin = skin.id;
      btn.className = 'skin-btn' + (p.skin === skin.id ? ' active' : '') + (owned ? '' : ' locked');
      const swatch = skin.colors
        ? [skin.colors.bodyColor, skin.colors.wingColor, skin.colors.tipColor].map((c) => `<i style="background:#${c.toString(16).padStart(6, '0')}"></i>`).join('')
        : '<i style="background:#7aa7ff"></i><i style="background:#ffc93c"></i><i style="background:#1fb08c"></i>';
      const label = p.skin === skin.id ? 'Dipakai' : owned ? 'Pakai' : p.coins >= skin.price ? `Beli 🪙${skin.price}` : `🔒 🪙${skin.price}`;
      btn.innerHTML = `<span class="sk-ico">${skin.icon}</span><span class="sk-sw">${swatch}</span><span class="sk-name">${skin.name}</span><span class="sk-price">${label}</span>`;
      btn.addEventListener('click', () => {
        this.audio.init();
        if (owned) {
          equipSkin(skin.id);
        } else {
          const r = buySkin(skin.id);
          if (!r.ok) {
            this.hud.showNotification(`🪙 Koin kurang, butuh ${skin.price}`, 'warning');
            return;
          }
          this.hud.showNotification(`${skin.icon} Skin ${skin.name} terbuka!`, 'boost');
        }
        this.bird.setSkin(skin.colors);
        this.audio.playBirdSelectSound();
        this.renderSkins();
      });
      list.appendChild(btn);
    }
  }

  private showRewardSummary(reward: ReturnType<typeof computeReward>, before: number, after: number, next?: { name: string; price: number }): void {
    const lines: string[] = [];
    lines.push(`<div><span>Skor ${this.waypoints.totalScore.toLocaleString()} ÷ ${COIN_RULES.scorePerCoin}</span><b>+${reward.fromScore}</b></div>`);
    lines.push(`<div><span>🪶 ${this.feathersCollected} bulu emas × ${COIN_RULES.perFeather}</span><b>+${reward.fromFeathers}</b></div>`);
    if (reward.newBestBonus) lines.push(`<div><span>🏆 Rekor baru</span><b>+${reward.newBestBonus}</b></div>`);
    document.getElementById('reward-lines')!.innerHTML = lines.join('');
    document.getElementById('reward-total')!.textContent = `+${reward.total}`;
    document.getElementById('reward-balance')!.textContent = `${after}`;
    const nextEl = document.getElementById('reward-next')!;
    nextEl.textContent = next
      ? after >= next.price
        ? `✨ Cukup untuk skin ${next.name}! Buka Ganti burung.`
        : `Skin ${next.name}: kurang ${next.price - after} koin lagi`
      : 'Semua skin sudah terbuka 🎉';
    void before;
  }

  private selectBirdProfile(type: 'small' | 'medium' | 'large'): void {
    this.currentBirdType = type;
    const profile = BIRD_PROFILES[type];
    if (!profile) return;
    this.bird.setProfile(profile);
    this.physics.setProfile(profile);
    this.audio.playBirdSelectSound();
    this.hud.setBirdBadge(shortName(profile.name), profile.icon);
    this.hud.refreshBestScores();

    // Update active state in Welcome modal buttons
    document.querySelectorAll('.bird-card-btn').forEach((btn) => {
      const bType = (btn as HTMLElement).dataset.bird;
      if (bType === type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update active state in Hangar modal cards
    document.querySelectorAll('.hangar-bird-card').forEach((card) => {
      const bType = (card as HTMLElement).dataset.bird;
      const btn = card.querySelector('.btn-select-bird') as HTMLButtonElement;
      if (bType === type) {
        card.classList.add('selected');
        if (btn) btn.textContent = 'Sedang Digunakan';
      } else {
        card.classList.remove('selected');
        if (btn) btn.textContent = 'Pilih Burung Ini';
      }
    });
  }

  /**
   * Pre-Flight Controller Check flow
   */
  private startCalibrationFlow(): void {
    this.inCalibration = true;
    const calibModal = document.getElementById('calibration-modal')!;
    calibModal.classList.add('visible');

    // Make sure PIP container is displayed so camera video stream runs
    const pipContainer = document.getElementById('pip-webcam-container')!;
    pipContainer.style.display = 'block';
    document.body.classList.add('cam-mode');

    this.requestWakeLock();
    this.motionTracker.start().catch((err) => {
      console.warn('Webcam initialization notice:', err);
    });

    // Skip button for experienced players
    const btnSkip = document.getElementById('btn-skip-calibration')!;
    btnSkip.onclick = () => {
      this.motionTracker.skipCalibration();
      this.startCountdownAndFly();
    };
  }

  /**
   * Update calibration modal UI during pre-flight check
   */
  private updateCalibrationUI(): void {
    if (!this.inCalibration || this.countdownActive) return;

    const state = this.motionTracker.getCalibrationState();

    // Step 1: Body Detection
    const step1El = document.getElementById('calib-step-1');
    const badge1El = document.getElementById('calib-badge-1');
    if (step1El && badge1El) {
      if (state.bodyDetected) {
        step1El.className = 'calib-item complete';
        badge1El.className = 'calib-badge done';
        badge1El.textContent = '✅ Terdeteksi';
      } else {
        step1El.className = 'calib-item active';
        badge1El.className = 'calib-badge active';
        badge1El.textContent = 'Menunggu...';
      }
    }

    // Step 2: Horizontal Glide Wings
    const step2El = document.getElementById('calib-step-2');
    const badge2El = document.getElementById('calib-badge-2');
    const prog2El = document.getElementById('calib-progress-horizontal');
    if (step2El && badge2El && prog2El) {
      prog2El.style.width = Math.round(state.horizontalProgress * 100) + '%';
      if (state.horizontalCalibrated) {
        step2El.className = 'calib-item complete';
        badge2El.className = 'calib-badge done';
        badge2El.textContent = '✅ Selesai';
      } else if (state.bodyDetected) {
        step2El.className = 'calib-item active';
        badge2El.className = 'calib-badge active';
        badge2El.textContent = `${Math.round(state.horizontalProgress * 100)}%`;
      }
    }

    // Step 3: Bank / Tilt Turn Test
    const step3El = document.getElementById('calib-step-3');
    const badge3El = document.getElementById('calib-badge-3');
    const subLeft = document.getElementById('subcheck-roll-left');
    const subRight = document.getElementById('subcheck-roll-right');
    if (step3El && badge3El && subLeft && subRight) {
      if (state.rollTestedLeft) {
        subLeft.className = 'subcheck-badge checked';
        subLeft.textContent = 'Belok Kiri [✅]';
      }
      if (state.rollTestedRight) {
        subRight.className = 'subcheck-badge checked';
        subRight.textContent = 'Belok Kanan [✅]';
      }
      if (state.rollTestedLeft && state.rollTestedRight) {
        step3El.className = 'calib-item complete';
        badge3El.className = 'calib-badge done';
        badge3El.textContent = '✅ Sukses';
      } else if (state.horizontalCalibrated) {
        step3El.className = 'calib-item active';
        badge3El.className = 'calib-badge active';
        badge3El.textContent = 'Miringkan';
      }
    }

    // Step 4: Flap Test
    const step4El = document.getElementById('calib-step-4');
    const badge4El = document.getElementById('calib-badge-4');
    if (step4El && badge4El) {
      if (state.flapTested) {
        step4El.className = 'calib-item complete';
        badge4El.className = 'calib-badge done';
        badge4El.textContent = '✅ Terbaca';
      } else if (state.rollTestedLeft && state.rollTestedRight) {
        step4El.className = 'calib-item active';
        badge4El.className = 'calib-badge active';
        badge4El.textContent = 'Ayunkan';
      }
    }

    // Live status message
    const msgEl = document.getElementById('calib-status-msg');
    if (msgEl) {
      msgEl.textContent = state.statusMessage;
    }

    // Low-light hint (empty when lighting is fine)
    const lightEl = document.getElementById('calib-light-hint');
    if (lightEl) {
      const hint = this.motionTracker.getMotionData().lightHint;
      if (lightEl.textContent !== hint) lightEl.textContent = hint;
      lightEl.hidden = !hint;
    }

    // Too Close warning — highlight the feedback box while it blocks progress
    document.getElementById('calib-feedback')?.classList.toggle('warning', state.tooClose);

    // Transition when calibration complete
    if (state.isComplete) {
      this.inCalibration = false;
      setTimeout(() => {
        this.startCountdownAndFly();
      }, 500);
    }
  }

  /**
   * Dramatic 3... 2... 1... SOAR! transition
   */
  private startCountdownAndFly(): void {
    if (this.countdownActive) return;
    this.countdownActive = true;
    this.inCalibration = false;

    // Hide calibration modal
    document.getElementById('calibration-modal')?.classList.remove('visible');

    const overlay = document.getElementById('countdown-overlay')!;
    const numEl = document.getElementById('countdown-number')!;
    overlay.classList.add('visible');

    const steps = [
      { text: '3', high: false },
      { text: '2', high: false },
      { text: '1', high: false },
      { text: 'TERBANG!', high: true }
    ];

    let idx = 0;
    const nextStep = () => {
      if (idx < steps.length) {
        const item = steps[idx];
        numEl.textContent = item.text;
        numEl.className = 'countdown-number pop';
        this.audio.playCountdownBeep(item.high);

        setTimeout(() => {
          numEl.className = 'countdown-number';
        }, 500);

        idx++;
        setTimeout(nextStep, 750);
      } else {
        // Countdown completed!
        overlay.classList.remove('visible');
        this.audio.playClapBoom();
        this.hud.resetTimer();
        this.isRunning = true;
        this.countdownActive = false;
        this.touchControlsEl.classList.toggle('active', this.isTouchDevice);
        this.hud.showNotification('🦅 TERBANG! KEJAR CINCIN EMAS!', 'boost');
      }
    };

    nextStep();
  }

  /**
   * Quick restart without reloading page or recalibrating
   */
  public restartGame(): void {
    console.log('🔄 Restarting flight course...');
    this.audio.init();

    this.isGameOver = false;
    this.isRunning = false; // Freeze physics/world until the countdown finishes
    this.feathersCollected = 0;
    this.cameraShakeTime = 0;
    this.flapCooldown = 0;
    this.speedLinesEl.classList.remove('active');
    if (this.gameOverTimer) window.clearTimeout(this.gameOverTimer);

    // 1. Reset flight physics & bird
    this.physics.reset();
    this.physics.setProfile(BIRD_PROFILES[this.currentBirdType]);
    this.bird.update(
      0.016,
      this.physics.forwardSpeed,
      this.physics.pitch,
      this.physics.roll,
      false,
      {
        leftAngleRad: 0,
        rightAngleRad: 0,
        flapAngleRad: 0,
        isCameraMode: this.controlMode === 'camera'
      }
    );

    // Show the bird on its perch during the countdown, camera snapped behind it
    this.physics.applyTransform(this.bird.group);
    this.updateCamera(10);

    // 2. Reset waypoints & rings
    this.waypoints.reset();

    // 3. Reset procedural chunks
    this.world.reset();
    this.hazards.reset();
    this.hits = 0;

    // 4. Reset HUD & stats
    this.hud.reset();
    this.hud.setFeathers(0);
    this.hud.setBirdBadge(shortName(BIRD_PROFILES[this.currentBirdType].name), BIRD_PROFILES[this.currentBirdType].icon);
    this.hud.refreshBestScores();
    this.lastMilestoneDistance = 0;
    this.totalDistanceTraveled = 0;
    this.wasInStorm = false;

    // 5. Hide modals if any
    document.getElementById('welcome-modal')?.classList.remove('visible');
    document.getElementById('calibration-modal')?.classList.remove('visible');
    document.getElementById('victory-modal')?.classList.remove('visible');
    document.getElementById('help-modal')?.classList.remove('visible');
    document.getElementById('hangar-modal')?.classList.remove('visible');
    document.getElementById('game-over-modal')?.classList.remove('visible');

    // 6. Launch countdown and fly
    this.countdownActive = false;
    this.startCountdownAndFly();
  }

  public start(): void {
    this.lastTime = performance.now();
    this.animate();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const now = performance.now();
    const rawDelta = (now - this.lastTime) / 1000;
    const delta = Math.min(rawDelta, 0.1);
    this.lastTime = now;
    this.adaptQuality(rawDelta);

    // Help / hangar opened mid-flight: freeze the simulation, keep drawing
    if (this.isRunning && !this.isGameOver && this.overlayOpen()) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (!this.isRunning) {
      // Process motion tracking & calibration during check phase
      if (this.inCalibration) {
        this.motionTracker.update();
        this.updateCalibrationUI();
      }
      this.world.update(delta);
      this.waypoints.update(delta);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.isGameOver) {
      this.updateCamera(delta);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 1. Gather Flight Input (Motion Tracking or Keyboard)
    let currentMotion: MotionData | null = null;
    let rollInput = 0;
    let rollAngleRad: number | undefined = undefined;
    let pitchInput = 0;
    let isFlapping = false;
    let isBraking = false;
    let flapIntensity = 0;
    let trackingStatus = '';

    if (this.controlMode === 'camera') {
      currentMotion = this.motionTracker.update();
      rollInput = currentMotion.rollInput;
      rollAngleRad = currentMotion.rollAngleRad;
      pitchInput = currentMotion.pitchInput;
      isFlapping = currentMotion.isFlapping && this.flapCooldown <= 0;
      isBraking = currentMotion.isBraking || this.keyState.brake;
      flapIntensity = currentMotion.flapIntensity;
      trackingStatus = currentMotion.lightHint || currentMotion.statusText;

      if (currentMotion.tooClose && !this.wasTooCloseToCam) {
        this.hud.showNotification('⚠️ MUNDUR SEDIKIT DARI KAMERA', 'warning');
      }
      this.wasTooCloseToCam = currentMotion.tooClose;

      // Allow keyboard override / assistance in camera mode
      if (this.keyState.left) {
        rollInput = -1.0;
        rollAngleRad = undefined;
      }
      if (this.keyState.right) {
        rollInput = 1.0;
        rollAngleRad = undefined;
      }
      if (this.keyState.down) pitchInput = -0.85; // Dive Down!
      if (this.keyState.up) pitchInput = 0.85;    // Climb Up!
    } else {
      // Keyboard & Touch mode
      if (this.keyState.left) rollInput = -1.0;   // Turn Left
      if (this.keyState.right) rollInput = 1.0;   // Turn Right
      if (this.keyState.down) pitchInput = -0.85; // Dive Down!
      if (this.keyState.up) pitchInput = 0.85;    // Climb Up!
      isBraking = this.keyState.brake;
      trackingStatus = this.isTouchDevice
        ? 'Stik = belok/naik-turun · 🪽 = kepak · 🛑 = rem'
        : 'Spasi = kepak · A/D = belok · W/S = naik/turun · Shift = rem';
    }

    // Touch controls input blend / override
    if (Math.abs(this.touchState.roll) > 0.05) {
      rollInput = this.touchState.roll;
      rollAngleRad = undefined;
    }
    if (Math.abs(this.touchState.pitch) > 0.05) {
      pitchInput = this.touchState.pitch * 0.85;
    }
    // Space / FLAP button: flap on press, then keep flapping at a steady wingbeat while held
    const holdFlap = this.keyState.space || this.touchState.flap;
    const pressed = (this.keyState.space && !this.spaceWasDown) || (this.touchState.flap && !this.touchFlapWasDown);
    this.spaceWasDown = this.keyState.space;
    this.touchFlapWasDown = this.touchState.flap;
    this.flapCooldown -= delta;
    if (holdFlap && (pressed || this.flapCooldown <= 0)) {
      isFlapping = true;
      flapIntensity = 1.0;
    }
    if (isFlapping) this.flapCooldown = 0.32;
    if (this.touchState.brake) {
      isBraking = true;
    }

    const flightInput: FlightInput = {
      rollInput,
      rollAngleRad,
      pitchInput,
      isFlapping,
      isBraking,
      flapIntensity
    };

    // 2. Audio & Visuals on Wing Flap
    if (isFlapping) {
      this.audio.playFlap();
      this.bird.triggerFlapBurst();
    }

    // 3. Update Flight Physics
    this.prevPos.copy(this.physics.position);
    const wind = this.world.getWindVector(this.physics.position);
    this.physics.setWind(wind.x, wind.z);
    this.physics.update(delta, flightInput);
    this.physics.applyTransform(this.bird.group);

    // 4. Check Updraft Thermals
    const updraft = this.world.checkUpdraft(this.physics.position);
    if (updraft) {
      const wasIn = this.physics.inUpdraft;
      const top = updraft.center.y + updraft.height / 2;
      const fade = THREE.MathUtils.clamp((top - this.physics.position.y) / (updraft.height * 0.5), 0, 1);
      this.physics.applyUpdraft(updraft.strength, delta, fade);
      if (!wasIn) {
        this.audio.playUpdraftEnter();
        this.hud.showNotification('🌀 ANGIN NAIK!', 'updraft');
      }
    } else {
      this.physics.inUpdraft = false;
    }

    // 4.3 Check Golden Feather Collectibles (+150 Score)
    const featherCollected = this.world.checkFeatherCollection(this.physics.position);
    if (featherCollected) {
      this.feathersCollected += 1;
      this.waypoints.totalScore += 150;
      this.audio.playFeatherCollectSound();
      this.hud.setFeathers(this.feathersCollected);
      this.hud.showNotification('🪶 +150 BULU EMAS', 'feather');
    }

    // Calculate true 360-degree distance traveled
    const stepDist = this.physics.position.distanceTo(this.prevPos);
    if (stepDist < 100) {
      this.totalDistanceTraveled += stepDist;
    }
    const distanceTraveled = Math.round(this.totalDistanceTraveled);

    // 4.5 Check Terrain & Island Collision (prevents penetrating ground, handles fatal crash)
    const terrainHit = this.world.checkTerrainCollision(this.physics.position);
    if (terrainHit.hasCollision) {
      if (terrainHit.isFatal && !this.isGameOver) {
        this.isGameOver = true;
        this.physics.forwardSpeed = 0;
        this.physics.velocity.set(0, -2, 0);
        this.audio.playCrashSound();
        this.cameraShakeTime = 0.85;
        this.cameraShakeIntensity = 2.4;
        const profile = BIRD_PROFILES[this.currentBirdType];
        const dist = distanceTraveled;
        const { isNewBest, best } = recordRun(this.currentBirdType, {
          distance: dist,
          score: this.waypoints.totalScore,
          rings: this.waypoints.collectedCount
        });
        const score = this.waypoints.totalScore;
        const rings = this.waypoints.collectedCount;
        const reward = computeReward(score, this.feathersCollected, isNewBest && score > 0);
        const before = getProgress();
        const after = awardReward(reward);
        const cheapestLocked = SKINS.filter((k) => !after.unlocked.includes(k.id)).sort((a, b) => a.price - b.price)[0];
        this.speedLinesEl.classList.remove('active');
        this.hud.showNotification('💥 BRAK!', 'warning');
        this.gameOverTimer = window.setTimeout(() => {
          this.hud.showGameOver(terrainHit.reason, dist, score, rings, shortName(profile.name), best.distance, isNewBest);
          this.showRewardSummary(reward, before.coins, after.coins, cheapestLocked);
        }, 900);
      } else if (!terrainHit.isFatal) {
        this.physics.handleTerrainCollision(terrainHit.safeY);
        this.audio.playFlap();
      }
    }

    // 5. Check Waypoint Rings Pass-through (with magnetic slipstream assist)
    const ringResult = this.waypoints.checkPassThrough(this.prevPos, this.physics.position, this.physics, delta);
    if (ringResult.hit) {
      this.audio.playRingChime(this.waypoints.combo);

      if (ringResult.isBoost) {
        this.physics.triggerBoost();
        this.hud.showNotification('🚀 TURBO!', 'boost');
      } else {
        this.hud.showNotification(`⭕ +${250 * Math.max(1, this.waypoints.combo - 1)}${this.waypoints.combo > 2 ? `  ×${this.waypoints.combo - 1}` : ''}`, 'ring');
      }
    }

    // 5.5 Flying obstacles: crows and balloons bump you, they never end the flight
    const hz = this.hazards.update(delta, this.physics.position, this.physics.yaw, this.totalDistanceTraveled, 1.6 * this.physics.birdScale, !this.isGameOver);
    if (hz.hit) {
      this.hits += 1;
      this.physics.knock(hz.awayX, hz.awayZ);
      this.waypoints.combo = 1;
      this.audio.playCrashSound();
      this.cameraShakeTime = 0.35;
      this.cameraShakeIntensity = 1.2;
      this.hud.showNotification(hz.hit === 'gagak' ? '🐦‍⬛ AWAS GAGAK! Combo hilang' : '🎈 NABRAK BALON! Combo hilang', 'warning');
    } else if (hz.nearMiss) {
      this.waypoints.totalScore += 50;
      this.hud.showNotification('😎 LOLOS TIPIS +50', 'feather');
    }

    // Distance Milestone Celebrations (every 1000m)
    if (distanceTraveled >= this.lastMilestoneDistance + 1000) {
      this.lastMilestoneDistance = Math.floor(distanceTraveled / 1000) * 1000;
      this.audio.playVictoryFanfare();
      this.hud.showNotification(`🏆 ${this.lastMilestoneDistance} METER!`, 'boost');
    }

    // 6. Update Entities & Animations (1:1 Arm Tracking & Kinematics)
    const motion = currentMotion || this.motionTracker.getMotionData();
    this.bird.update(
      delta,
      this.physics.forwardSpeed,
      this.physics.pitch,
      this.physics.roll,
      this.physics.flapTimer > 0,
      {
        leftAngleRad: motion.leftArmAngleRad,
        rightAngleRad: motion.rightArmAngleRad,
        flapAngleRad: motion.flapAngleRad,
        isCameraMode: this.controlMode === 'camera'
      }
    );

    // Procedural Endless World & Waypoints Update in 360 degrees
    this.world.update(delta, this.physics.position, this.totalDistanceTraveled);
    this.waypoints.update(delta, this.physics.position, this.physics.yaw);

    // Storm weather notifications on transition only
    const inStorm = this.world.stormIntensity > 0.4;
    if (inStorm && !this.wasInStorm) {
      this.hud.showNotification('⛈️ ANGIN KENCANG! TAHAN!', 'warning');
    } else if (!inStorm && this.wasInStorm) {
      this.hud.showNotification('☀️ CUACA CERAH LAGI', 'boost');
    }
    this.wasInStorm = inStorm;

    // 7. Dynamic Camera Follow
    this.updateCamera(delta);

    // 8. Update Procedural Audio Airspeed
    this.audio.updateAirspeed(this.physics.forwardSpeed / 22);

    // 9. Speed Lines VFX
    if (this.physics.forwardSpeed > 34) {
      this.speedLinesEl.classList.add('active');
    } else {
      this.speedLinesEl.classList.remove('active');
    }

    // 10. Update HUD & Compass (Accurate 360° relative bearing)
    let compassAngle = 0;
    const currentTarget = this.waypoints.getCurrentTarget();
    if (currentTarget) {
      const dx = currentTarget.x - this.physics.position.x;
      const dz = currentTarget.z - this.physics.position.z;
      const fwdX = -Math.sin(this.physics.yaw);
      const fwdZ = -Math.cos(this.physics.yaw);
      const rightX = Math.cos(this.physics.yaw);
      const rightZ = -Math.sin(this.physics.yaw);
      const dotFwd = dx * fwdX + dz * fwdZ;
      const dotRight = dx * rightX + dz * rightZ;
      compassAngle = Math.atan2(dotRight, dotFwd);
    }

    this.hud.update({
      speed: this.physics.forwardSpeed,
      altitude: this.physics.position.y,
      score: this.waypoints.totalScore,
      combo: this.waypoints.combo,
      currentRing: this.waypoints.collectedCount,
      totalRings: this.waypoints.rings.length,
      distance: distanceTraveled,
      feathersCollected: this.feathersCollected,
      birdName: `${BIRD_PROFILES[this.currentBirdType].icon} ${shortName(BIRD_PROFILES[this.currentBirdType].name)}`,
      isFlapping,
      inUpdraft: this.physics.inUpdraft,
      isBoost: this.physics.boostTimer > 0,
      compassAngle,
      controlMode: this.controlMode,
      trackingStatus
    });

    // 11. Render 3D Scene
    this.renderer.render(this.scene, this.camera);
  };

  private gameOverTimer: number | null = null;

  private overlayOpen(): boolean {
    return !!document.querySelector('#help-modal.visible, #hangar-modal.visible');
  }

  private closeOverlays(): void {
    document.getElementById('help-modal')?.classList.remove('visible');
    document.getElementById('hangar-modal')?.classList.remove('visible');
  }

  /** Drop resolution, then shadows, when frames are consistently slow (phones, old laptops). */
  private adaptQuality(rawDelta: number): void {
    if (!this.isRunning || this.isGameOver || rawDelta > 0.25) return;
    this.frameTimes.push(rawDelta);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg <= 0.022) return;
    if (this.pixelRatio > 1) {
      this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
      this.resize();
    } else if (this.pixelRatio > 0.75) {
      this.pixelRatio = 0.75;
      this.resize();
    } else if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    }
  }

  /**
   * Smooth 3rd-person follow camera with banking roll and speed FOV dilation
   */
  private updateCamera(delta: number): void {
    const birdPos = this.physics.position;
    const yaw = this.physics.yaw;
    const pitch = this.physics.pitch;
    const roll = this.physics.roll;

    // Follow offset behind and above bird
    const distanceBehind = this.baseFov > 62 ? 13.5 : 11.0; // portrait: pull back so both wingtips fit
    const heightAbove = 3.6;

    // Target position calculated in bird's local forward orientation
    const offsetX = Math.sin(yaw) * distanceBehind;
    const offsetZ = Math.cos(yaw) * distanceBehind;
    const offsetY = heightAbove - Math.sin(pitch) * 2.5;

    const targetCamPos = new THREE.Vector3(
      birdPos.x + offsetX,
      birdPos.y + offsetY,
      birdPos.z + offsetZ
    );

    // Smooth camera position interpolation with frame-rate independent damping
    const dt = delta >= 10 ? 10 : Math.min(delta, 0.1); // delta >= 10 snaps the camera into place
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, targetCamPos.x, 8.5, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, targetCamPos.y, 8.5, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, targetCamPos.z, 8.5, dt);

    // Apply crash impact camera shake if active
    if (this.cameraShakeTime > 0) {
      this.cameraShakeTime -= delta;
      const shakeAmt = this.cameraShakeIntensity * Math.max(0, this.cameraShakeTime / 0.85);
      this.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.7;
      this.camera.position.z += (Math.random() - 0.5) * shakeAmt;
    }

    // Look at a focal point ahead of the bird
    const lookAheadDist = 18;
    const lookTarget = new THREE.Vector3(
      birdPos.x - Math.sin(yaw) * lookAheadDist,
      birdPos.y + Math.sin(pitch) * 4.0,
      birdPos.z - Math.cos(yaw) * lookAheadDist
    );

    this.camera.lookAt(lookTarget);

    // Dynamic FOV widening during high speeds
    const targetFOV = this.baseFov + Math.max(0, (this.physics.forwardSpeed - 22) * 0.45);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, Math.min(1, delta * 4.0));
    this.camera.updateProjectionMatrix();
  }
}

/** "Elang Langit (Golden Falcon)" -> "Elang Langit" */
function shortName(name: string): string {
  return name.split(' (')[0];
}

// Start Game Instance
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.start();
  if (location.search.includes('debug')) (window as unknown as { __game: Game }).__game = game;
});
