import * as THREE from 'three';
import { AudioEngine } from './systems/AudioEngine';
import { BirdMesh, BirdProfile, BIRD_PROFILES } from './entities/BirdMesh';
import { World } from './entities/World';
import { WaypointManager } from './entities/Waypoints';
import { FlightPhysics, FlightInput } from './systems/FlightPhysics';
import { MotionTracker, MotionData } from './systems/MotionTracker';
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
  private feathersCollected = 0;
  private isGameOver = false;
  private cameraShakeTime = 0;
  private cameraShakeIntensity = 0;

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
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    // 2. Camera Setup (3rd-person follow)
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 3000);
    this.camera.position.set(0, 25, 32);

    // 3. Initialize Systems
    this.audio = new AudioEngine();
    this.physics = new FlightPhysics();
    this.world = new World(this.scene);
    this.waypoints = new WaypointManager(this.scene);

    this.bird = new BirdMesh();
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

    // Event Listeners
    this.setupWindowListeners();
    this.setupKeyboardListeners();
    this.setupTouchListeners();
    this.setupUIButtons();
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

  private setupWindowListeners(): void {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', () => {
      setTimeout(handleResize, 150);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

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
      if (e.code === 'KeyR') {
        this.restartGame();
        return;
      }
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keyState.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keyState.right = true;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keyState.up = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keyState.down = true;
      if (e.code === 'KeyB' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keyState.brake = true;
      if (e.code === 'Space') {
        if (!this.keyState.space) {
          // Trigger flap impulse on Space press
          this.audio.playClapBoom();
          this.bird.triggerClapBurst();
          this.hud.showNotification('⚡ FLAP BOOST! ⚡', 'clap');
        }
        this.keyState.space = true;
      }
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
      this.audio.playClapBoom();
      this.bird.triggerClapBurst();
      this.hud.showNotification('⚡ FLAP BOOST! ⚡', 'clap');
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
      this.touchControlsEl.classList.add('active');
      this.hud.showNotification('🦅 FLIGHT STARTED! (TOUCH & KEYS ACTIVE)', 'boost');
    });

    // Toggle Camera
    const btnToggleCam = document.getElementById('btn-toggle-camera')!;
    btnToggleCam.addEventListener('click', async () => {
      if (this.controlMode === 'camera') {
        this.controlMode = 'keyboard';
        document.getElementById('btn-camera-text')!.textContent = 'Keys/Touch';
        document.getElementById('pip-webcam-container')!.style.display = 'none';
        this.touchControlsEl.classList.add('active');
      } else {
        this.controlMode = 'camera';
        document.getElementById('btn-camera-text')!.textContent = 'Camera';
        document.getElementById('pip-webcam-container')!.style.display = 'block';
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
      document.getElementById('audio-text')!.textContent = isMuted ? 'Muted' : 'Audio ON';
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
      hangarModal.classList.add('visible');
    });

    btnCloseHangar?.addEventListener('click', () => {
      hangarModal.classList.remove('visible');
    });

    document.querySelectorAll('.hangar-bird-card .btn-select-bird').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget as HTMLElement;
        const type = targetBtn.dataset.bird as 'small' | 'medium' | 'large';
        if (type) {
          this.audio.init();
          this.selectBirdProfile(type);
          this.hud.showNotification(`🦅 Memilih ${BIRD_PROFILES[type].name}!`, 'boost');
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
      hangarModal.classList.add('visible');
    });
  }

  private selectBirdProfile(type: 'small' | 'medium' | 'large'): void {
    this.currentBirdType = type;
    const profile = BIRD_PROFILES[type];
    if (!profile) return;
    this.bird.setProfile(profile);
    this.physics.setProfile(profile);
    this.audio.playBirdSelectSound();
    this.hud.setBirdBadge(profile.name, profile.icon);

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
      { text: 'SOAR!', high: true }
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
        if (this.isTouchDevice || this.controlMode === 'keyboard') {
          this.touchControlsEl.classList.add('active');
        }
        this.hud.showNotification('🦅 TERBANG! KEPATKAN SAYAP UNTUK NAIK!', 'boost');
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
    this.feathersCollected = 0;
    this.cameraShakeTime = 0;

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

    // 2. Reset waypoints & rings
    this.waypoints.reset();

    // 3. Reset procedural chunks
    this.world.reset();

    // 4. Reset HUD & stats
    this.hud.reset();
    this.hud.setFeathers(0);
    this.hud.setBirdBadge(BIRD_PROFILES[this.currentBirdType].name, BIRD_PROFILES[this.currentBirdType].icon);
    this.lastMilestoneDistance = 0;

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
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    if (!this.isRunning) {
      // Process motion tracking & calibration during check phase
      if (this.inCalibration) {
        this.motionTracker.update();
        this.updateCalibrationUI();
      }
      this.world.update(delta);
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
      isFlapping = currentMotion.isFlapping;
      isBraking = currentMotion.isBraking || this.keyState.brake;
      flapIntensity = currentMotion.flapIntensity;
      trackingStatus = currentMotion.statusText;

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
      if (this.keyState.space) {
        isFlapping = true;
        flapIntensity = 1.0;
      }
    } else {
      // Keyboard & Touch mode
      if (this.keyState.left) rollInput = -1.0;   // Turn Left
      if (this.keyState.right) rollInput = 1.0;   // Turn Right
      if (this.keyState.down) pitchInput = -0.85; // Dive Down!
      if (this.keyState.up) pitchInput = 0.85;    // Climb Up!
      isFlapping = this.keyState.space;
      isBraking = this.keyState.brake;
      flapIntensity = isFlapping ? 1.0 : 0;
      trackingStatus = this.isTouchDevice
        ? 'Touch Controls (Stick=Steer/Pitch, 🪽=Flap, 🛑=Brake)'
        : 'Keyboard Mode (Space=Flap, B/Shift=Brake, A/D=Turn, S/W=Down/Up)';
    }

    // Touch controls input blend / override
    if (Math.abs(this.touchState.roll) > 0.05) {
      rollInput = this.touchState.roll;
      rollAngleRad = undefined;
    }
    if (Math.abs(this.touchState.pitch) > 0.05) {
      pitchInput = this.touchState.pitch * 0.85;
    }
    if (this.touchState.flap) {
      isFlapping = true;
      flapIntensity = 1.0;
    }
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
      this.audio.playClapBoom();
      this.bird.triggerFlapBurst();
      this.hud.showNotification('🪽 WING FLAP! 🪽', 'flap');
    }

    // 3. Update Flight Physics
    this.prevPos.copy(this.physics.position);
    this.physics.update(delta, flightInput);
    this.physics.applyTransform(this.bird.group);

    // 4. Check Updraft Thermals
    const updraft = this.world.checkUpdraft(this.physics.position);
    if (updraft) {
      this.physics.applyUpdraft(updraft.strength, delta);
      if (!this.physics.inUpdraft) {
        this.audio.playUpdraftEnter();
        this.hud.showNotification('🌀 UPDRAFT THERMAL!', 'updraft');
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
      this.hud.showNotification('🪶 +150 BULU EMAS!', 'feather');
    }

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
        const dist = Math.max(0, Math.round(-this.physics.position.z));
        this.hud.showGameOver(
          terrainHit.reason,
          dist,
          this.waypoints.totalScore,
          this.waypoints.collectedCount,
          profile.name
        );
        this.hud.showNotification(`💥 CRASH! ${terrainHit.reason}`, 'warning');
      } else if (!terrainHit.isFatal) {
        this.physics.handleTerrainCollision(terrainHit.safeY);
        this.audio.playFlap();
        this.hud.showNotification('⛰️ Memantul Naik dari Daratan!', 'flap');
      }
    }

    // 5. Check Waypoint Rings Pass-through (with magnetic slipstream assist)
    const ringResult = this.waypoints.checkPassThrough(this.prevPos, this.physics.position, this.physics, delta);
    if (ringResult.hit) {
      this.audio.playRingChime(this.waypoints.combo);

      if (ringResult.isBoost) {
        this.physics.triggerBoost();
        this.hud.showNotification('🚀 TURBO BOOST!', 'boost');
      } else {
        this.hud.showNotification(`+250 RING! (x${this.waypoints.combo})`, 'ring');
      }
    }

    // Distance Milestone Celebrations (every 1000m)
    const distanceTraveled = Math.max(0, Math.round(-this.physics.position.z));
    if (distanceTraveled >= this.lastMilestoneDistance + 1000) {
      this.lastMilestoneDistance = Math.floor(distanceTraveled / 1000) * 1000;
      this.audio.playVictoryFanfare();
      this.hud.showNotification(`🏆 ${this.lastMilestoneDistance}m DISTANCE!`, 'boost');
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

    // Procedural Endless World & Waypoints Update
    this.world.update(delta, this.physics.position);
    this.waypoints.update(delta);

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

    // 10. Update HUD & Compass
    let compassAngle = 0;
    const currentTarget = this.waypoints.getCurrentTarget();
    if (currentTarget) {
      const dx = currentTarget.x - this.physics.position.x;
      const dz = currentTarget.z - this.physics.position.z;
      const targetBearing = Math.atan2(dx, dz);
      // Relative to bird's heading (yaw)
      compassAngle = targetBearing - this.physics.yaw;
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
      birdName: `${BIRD_PROFILES[this.currentBirdType].icon} ${BIRD_PROFILES[this.currentBirdType].name}`,
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

  /**
   * Smooth 3rd-person follow camera with banking roll and speed FOV dilation
   */
  private updateCamera(delta: number): void {
    const birdPos = this.physics.position;
    const yaw = this.physics.yaw;
    const pitch = this.physics.pitch;
    const roll = this.physics.roll;

    // Follow offset behind and above bird
    const distanceBehind = 11.0;
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
    const dt = Math.min(delta, 0.1);
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
    const targetFOV = 62 + Math.max(0, (this.physics.forwardSpeed - 22) * 0.45);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, delta * 4.0);
    this.camera.updateProjectionMatrix();
  }
}

// Start Game Instance
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.start();
});
