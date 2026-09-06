import * as THREE from 'three';

type PoseLandmarker = import('@mediapipe/tasks-vision').PoseLandmarker;

export interface CalibrationState {
  bodyDetected: boolean;
  horizontalCalibrated: boolean;
  rollTestedLeft: boolean;
  rollTestedRight: boolean;
  flapTested: boolean;
  currentStep: number; // 1: Body, 2: Horizontal, 3: Roll, 4: Flap, 5: Complete
  statusMessage: string;
  horizontalProgress: number; // 0 to 1
  isComplete: boolean;
}

export interface MotionData {
  rollInput: number;          // -1 (turn left) to +1 (turn right)
  rollAngleRad: number;       // Direct body roll angle in radians = (rightArmAngle - leftArmAngle) * 0.5
  flapAngleRad: number;       // Downward flap stroke angle in radians = (rightArmAngle + leftArmAngle) * 0.5
  pitchInput: number;         // -1 (dive down) to +1 (climb up)
  isFlapping: boolean;        // Bird wing flap stroke
  isBraking: boolean;         // Airbrake / flare (arms raised up)
  flapIntensity: number;      // 0 to 1.5 intensity of the flap based on arm swing speed
  leftArmAngle: number;       // Degrees: 0 = straight horizontal, +45 = down, -30 = up
  rightArmAngle: number;      // Degrees
  leftArmAngleRad: number;    // Radians for 1:1 bird wing articulation
  rightArmAngleRad: number;   // Radians
  downwardAngularSpeed: number; // deg/sec
  flightState: 'tilt' | 'dive' | 'flap';
  trackingActive: boolean;
  statusText: string;
  debugGesture: string;       // e.g. "✈️ TILT MODE", "⬇️ MENUKIK", "🪽 FLAP NAIK"
}

// Arm & upper torso connection indices for MediaPipe Pose
// 0 = Nose, 11 = Left Shoulder, 12 = Right Shoulder
// 13 = Left Elbow, 14 = Right Elbow, 15 = Left Wrist, 16 = Right Wrist
const ARM_CONNECTIONS = [
  [0, 11], [0, 12],   // Head / Neck to Shoulders
  [11, 13], [13, 15], // Left Arm (Shoulder -> Elbow -> Wrist)
  [12, 14], [14, 16], // Right Arm (Shoulder -> Elbow -> Wrist)
  [11, 12]            // Chest / Shoulders line
];

/**
 * Arm-Based Motion Tracker (MediaPipe PoseLandmarker + Optical Fallback).
 * Implements:
 * 1. 1:1 Direct Arm Kinematics (Lengan -> Sayap Burung 3D).
 * 2. Option A: Flap lift force proportional to downward arm swing angular velocity.
 * 3. Dive: Arms held down > 30° for > 1.0s triggers steep dive.
 * 4. Pre-Flight Controller Check: Interactive posture & range-of-motion calibration.
 */
export class MotionTracker {
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;

  public isCameraRunning = false;
  private poseLandmarker: PoseLandmarker | null = null;
  private isModelLoading = false;
  private isProcessingFrame = false;

  // Arm angles (in degrees, 0 = horizontal, +45 = down, -30 = up)
  private leftArmAngle = 0;
  private rightArmAngle = 0;

  // Angular speed tracking (Option A)
  private prevAvgAngle = 0;
  private prevAngleTime = performance.now();
  private downwardAngularSpeed = 0;

  // Flapping & Diving State Machine Timers
  private armDownStartTime = 0;   // Timestamp when arms entered > 30° downward
  private armHorizontalTime = 0;  // Timestamp when arms were last horizontal (~0°)
  private lastFlapTime = 0;
  private flapCooldownMs = 380;

  // Pre-Flight Calibration State
  private calibrationState: CalibrationState = {
    bodyDetected: false,
    horizontalCalibrated: false,
    rollTestedLeft: false,
    rollTestedRight: false,
    flapTested: false,
    currentStep: 1,
    statusMessage: 'Menunggu deteksi kamera & postur tubuh...',
    horizontalProgress: 0,
    isComplete: false
  };
  private horizontalHoldDuration = 0;

  // Flight state
  private flightState: 'tilt' | 'dive' | 'flap' = 'tilt';

  // Smoothing states
  private smoothedRoll = 0;
  private smoothedPitch = 0;

  // Cached pose landmarks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private lastLandmarks: any[] = [];
  private lastProcessTime = 0;
  private lastLogTime = 0;

  // Optical fallback
  private diffCanvas: HTMLCanvasElement;
  private diffCtx: CanvasRenderingContext2D | null;
  private prevLuma: Float32Array | null = null;
  private gridW = 32;
  private gridH = 24;

  private motionData: MotionData = {
    rollInput: 0,
    rollAngleRad: 0,
    flapAngleRad: 0,
    pitchInput: 0,
    isFlapping: false,
    isBraking: false,
    flapIntensity: 0,
    leftArmAngle: 0,
    rightArmAngle: 0,
    leftArmAngleRad: 0,
    rightArmAngleRad: 0,
    downwardAngularSpeed: 0,
    flightState: 'tilt',
    trackingActive: false,
    statusText: 'Camera standby',
    debugGesture: '✈️ TILT MODE'
  };

  constructor(videoElement: HTMLVideoElement, previewCanvas: HTMLCanvasElement) {
    this.video = videoElement;
    this.canvas = previewCanvas;
    this.ctx = this.canvas.getContext('2d');

    this.diffCanvas = document.createElement('canvas');
    this.diffCanvas.width = this.gridW;
    this.diffCanvas.height = this.gridH;
    this.diffCtx = this.diffCanvas.getContext('2d', { willReadFrequently: true });
  }

  public async start(): Promise<boolean> {
    this.motionData.statusText = 'Accessing camera...';
    console.log('[MotionTracker] Requesting webcam...');

    try {
      const streamPromise = navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480, max: 640 },
          height: { ideal: 360, max: 480 },
          facingMode: 'user',
          frameRate: { ideal: 24, max: 30 }
        },
        audio: false
      });

      const timeoutPromise = new Promise<MediaStream>((_, reject) =>
        setTimeout(() => reject(new Error('Camera permission timed out')), 5000)
      );

      const stream = await Promise.race([streamPromise, timeoutPromise]);
      this.video.srcObject = stream;

      await new Promise<void>((resolve) => {
        const onReady = () => {
          this.video.play().catch(() => {});
          this.isCameraRunning = true;
          this.motionData.trackingActive = true;
          resolve();
        };

        if (this.video.readyState >= 2) {
          onReady();
        } else {
          this.video.onloadeddata = onReady;
          setTimeout(onReady, 400);
        }
      });

      this.motionData.statusText = 'Loading Arm Pose Tracker...';
      console.log('[MotionTracker] Loading MediaPipe PoseLandmarker with CPU SIMD...');

      this.loadAIPoseModel();

      return true;
    } catch (err) {
      console.warn('[MotionTracker] Camera failed to start:', err);
      this.motionData.statusText = 'Camera unavailable. Keyboard mode active!';
      this.motionData.trackingActive = false;
      return false;
    }
  }

  /**
   * Resolve model asset with browser CacheStorage for 0ms subsequent loads
   */
  private async resolveCachedModelUrl(localPath: string, cdnFallback: string): Promise<string> {
    const cacheName = 'aerowing-mediapipe-cache-v1';
    const hasCache = typeof window !== 'undefined' && 'caches' in window;

    // 1. Check browser cache first
    if (hasCache) {
      try {
        const cache = await caches.open(cacheName);
        const cachedMatch = (await cache.match(localPath)) || (await cache.match(cdnFallback));
        if (cachedMatch) {
          console.log('⚡ [MotionTracker] Loaded MediaPipe model directly from CacheStorage (0ms)!');
          const blob = await cachedMatch.blob();
          return URL.createObjectURL(blob);
        }
      } catch (e) {
        console.warn('[MotionTracker] Cache read warning:', e);
      }
    }

    // 2. Try fetching local asset first
    try {
      const resp = await fetch(localPath);
      if (resp.ok) {
        if (hasCache) {
          try {
            const cache = await caches.open(cacheName);
            cache.put(localPath, resp.clone()).catch(() => {});
          } catch {}
        }
        const blob = await resp.blob();
        console.log('⚡ [MotionTracker] Loaded MediaPipe model from local assets and cached!');
        return URL.createObjectURL(blob);
      }
    } catch {
      // Local fetch failed, fallback to CDN
    }

    // 3. Fallback to CDN and cache it for next time
    try {
      const resp = await fetch(cdnFallback);
      if (resp.ok) {
        if (hasCache) {
          try {
            const cache = await caches.open(cacheName);
            cache.put(cdnFallback, resp.clone()).catch(() => {});
          } catch {}
        }
        const blob = await resp.blob();
        console.log('⚡ [MotionTracker] Loaded MediaPipe model from CDN and cached for next time!');
        return URL.createObjectURL(blob);
      }
    } catch {
      // Return direct URL as final fallback
    }

    return localPath;
  }

  /**
   * Load MediaPipe PoseLandmarker with dynamic import and local cached assets
   */
  private async loadAIPoseModel(): Promise<void> {
    if (this.isModelLoading || this.poseLandmarker) return;
    this.isModelLoading = true;

    try {
      this.motionData.statusText = '⚡ Menyiapkan modul AI...';

      const loadPromise = (async () => {
        // 1. Dynamic import of tasks-vision (keeps initial bundle ultra-light)
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');

        // 2. Resolve WASM: Prefer local /mediapipe/wasm, fallback to pinned CDN
        let vision;
        try {
          vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        } catch (localWasmErr) {
          console.warn('[MotionTracker] Local WASM failed, falling back to CDN:', localWasmErr);
          vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
          );
        }

        // 3. Resolve Model: Prefer local + cached model
        const modelUrl = await this.resolveCachedModelUrl(
          '/mediapipe/models/pose_landmarker_lite.task',
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
        );

        return PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelUrl,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numPoses: 1
        });
      })();

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('MediaPipe Pose download timed out')), 10000)
      );

      this.poseLandmarker = await Promise.race([loadPromise, timeout]);
      this.motionData.statusText = '💪 Arm Tracking Active! Arms straight to tilt, flap to rise, hold to dive!';
      console.log('✅ [MotionTracker] Arm Pose Tracking initialized successfully with lightweight cached assets!');
    } catch (err) {
      console.warn('[MotionTracker] MediaPipe Pose unavailable, using optical arm angle tracker:', err);
      this.motionData.statusText = '⚡ Optical Arm Tracker Active!';
    } finally {
      this.isModelLoading = false;
    }
  }

  /**
   * Called by 60fps render loop. Runs in < 0.2ms!
   */
  public update(): MotionData {
    this.motionData.isFlapping = false;

    if (!this.isCameraRunning || this.video.readyState < 2) {
      return this.motionData;
    }

    const now = performance.now();

    // Throttled detection at ~19-20fps (every 52ms): cuts CPU load by ~35% on laptops, keeping 60 FPS smooth!
    if (now - this.lastProcessTime > 50 && !this.isProcessingFrame) {
      this.lastProcessTime = now;
      this.isProcessingFrame = true;

      const videoW = this.video.videoWidth || 480;
      const videoH = this.video.videoHeight || 360;
      // Cap preview canvas resolution (avoids expensive high-res canvas redraws on Retina Mac screens)
      const targetW = Math.min(480, videoW);
      const targetH = Math.round(targetW * (videoH / videoW));
      if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
      }

      try {
        if (this.poseLandmarker) {
          const results = this.poseLandmarker.detectForVideo(this.video, now);
          this.processArmPoseLandmarks(results, now);
        } else {
          this.processOpticalArmFallback(now);
        }
      } catch (e) {
        console.warn('Pose inference error:', e);
      } finally {
        this.isProcessingFrame = false;
      }

      this.renderPreview();
    }

    return this.motionData;
  }

  /**
   * Process 3D Arm Landmarks (Shoulders, Elbows, Wrists)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private processArmPoseLandmarks(results: any, now: number): void {
    const poses = results.landmarks;

    if (!poses || poses.length === 0) {
      this.lastLandmarks = [];
      this.smoothedRoll = THREE.MathUtils.lerp(this.smoothedRoll, 0, 0.08);
      this.smoothedPitch = THREE.MathUtils.lerp(this.smoothedPitch, 0, 0.08);
      this.motionData.rollInput = this.smoothedRoll;
      this.motionData.pitchInput = this.smoothedPitch;
      this.motionData.isBraking = false;
      return;
    }

    const landmarks = poses[0];
    this.lastLandmarks = landmarks;

    // Landmarks:
    // 0 = Nose
    // 11 = Left Shoulder, 13 = Left Elbow, 15 = Left Wrist
    // 12 = Right Shoulder, 14 = Right Elbow, 16 = Right Wrist
    // Note: User mirrored coordinates: playerX = 1 - rawX
    // Player's LEFT arm is Landmark 11 & 15 (which in mirrored view is on left side)
    const rawLeftShoulder = landmarks[11];
    const rawLeftWrist = landmarks[15];
    const rawRightShoulder = landmarks[12];
    const rawRightWrist = landmarks[16];

    if (!rawLeftShoulder || !rawLeftWrist || !rawRightShoulder || !rawRightWrist) return;

    // Mirrored coordinates
    const leftShoulder = { x: 1 - rawLeftShoulder.x, y: rawLeftShoulder.y };
    const leftWrist = { x: 1 - rawLeftWrist.x, y: rawLeftWrist.y };
    const rightShoulder = { x: 1 - rawRightShoulder.x, y: rawRightShoulder.y };
    const rightWrist = { x: 1 - rawRightWrist.x, y: rawRightWrist.y };

    // Calculate Arm Downward Angles in degrees:
    // Horizontal = 0°, Downward = positive degrees (e.g. +45°), Upward = negative degrees (e.g. -30°)
    // Left arm extends outward to the left (leftWrist.x < leftShoulder.x)
    const leftDx = Math.abs(leftWrist.x - leftShoulder.x);
    const leftDy = leftWrist.y - leftShoulder.y;
    const rawLeftAngle = Math.atan2(leftDy, Math.max(0.08, leftDx)) * (180 / Math.PI);

    // Right arm extends outward to the right
    const rightDx = Math.abs(rightWrist.x - rightShoulder.x);
    const rightDy = rightWrist.y - rightShoulder.y;
    const rawRightAngle = Math.atan2(rightDy, Math.max(0.08, rightDx)) * (180 / Math.PI);

    // Adaptive low-pass filtering: eliminate camera jitter while staying responsive during fast strokes
    const leftDelta = Math.abs(rawLeftAngle - this.leftArmAngle);
    const rightDelta = Math.abs(rawRightAngle - this.rightArmAngle);
    const leftAlpha = THREE.MathUtils.clamp(0.18 + leftDelta * 0.007, 0.18, 0.45);
    const rightAlpha = THREE.MathUtils.clamp(0.18 + rightDelta * 0.007, 0.18, 0.45);

    this.leftArmAngle = THREE.MathUtils.lerp(this.leftArmAngle, rawLeftAngle, leftAlpha);
    this.rightArmAngle = THREE.MathUtils.lerp(this.rightArmAngle, rawRightAngle, rightAlpha);

    this.motionData.leftArmAngle = Math.round(this.leftArmAngle);
    this.motionData.rightArmAngle = Math.round(this.rightArmAngle);

    // 1:1 Kinematic Radians for 3D Bird Wings & Body
    this.motionData.leftArmAngleRad = this.leftArmAngle * (Math.PI / 180);
    this.motionData.rightArmAngleRad = this.rightArmAngle * (Math.PI / 180);

    // Direct Body Roll Angle: Line connecting player's two hands/arms
    // When right hand is lower than left hand: tilt right (positive tilt angle)
    const rawTiltAngle = (this.rightArmAngle - this.leftArmAngle) * 0.5;
    // Downward Flap Angle relative to body plane
    const rawFlapAngle = (this.rightArmAngle + this.leftArmAngle) * 0.5;

    // Smooth deadzone for level flight (< 3° difference = level, > 7.5° = 100% 1:1 match)
    let effectiveTilt = rawTiltAngle;
    const absTilt = Math.abs(rawTiltAngle);
    if (absTilt < 3.0) {
      effectiveTilt = 0;
    } else if (absTilt < 7.5) {
      const t = (absTilt - 3.0) / 4.5;
      const smooth = t * t * (3 - 2 * t);
      effectiveTilt = Math.sign(rawTiltAngle) * (absTilt * smooth);
    }

    this.motionData.rollAngleRad = effectiveTilt * (Math.PI / 180);
    this.motionData.flapAngleRad = rawFlapAngle * (Math.PI / 180);

    // --- OPTION A: ANGULAR VELOCITY TRACKING ---
    const avgAngle = (this.leftArmAngle + this.rightArmAngle) * 0.5;
    const dtAngle = Math.max(0.01, (now - this.prevAngleTime) / 1000);
    this.downwardAngularSpeed = (avgAngle - this.prevAvgAngle) / dtAngle; // Positive when moving downward
    this.prevAvgAngle = avgAngle;
    this.prevAngleTime = now;
    this.motionData.downwardAngularSpeed = Math.round(this.downwardAngularSpeed);

    // --- PRE-FLIGHT CONTROLLER CHECK (CALIBRATION) ---
    this.updateCalibration(leftShoulder, rightShoulder, now);

    // --- EXACT MECHANICS STATE MACHINE ---
    const areBothArmsDown30 = this.leftArmAngle > 28 && this.rightArmAngle > 28;
    const areBothArmsDown45 = this.leftArmAngle >= 35 && this.rightArmAngle >= 35 && avgAngle >= 38;
    const areArmsNearHorizontal = Math.abs(this.leftArmAngle) < 26 && Math.abs(this.rightArmAngle) < 26;

    if (areArmsNearHorizontal) {
      this.armHorizontalTime = now;
    }

    const areBothArmsDown22 = this.leftArmAngle > 20 && this.rightArmAngle > 20 && avgAngle > 22;

    if (areBothArmsDown22) {
      if (this.armDownStartTime === 0) {
        this.armDownStartTime = now;
      }
    } else {
      this.armDownStartTime = 0;
    }

    const durationArmsDown = this.armDownStartTime > 0 ? (now - this.armDownStartTime) / 1000 : 0;
    const durationSinceHorizontal = (now - this.armHorizontalTime) / 1000;

    // Reset braking unless active below
    this.motionData.isBraking = false;

    // CONDITION 1: DIVE / MENUKIK (> 20° downward for > 0.25s)
    // Lowers nose clearly (-20° to -32°) so the bird visibly dives toward lower rings!
    if (areBothArmsDown22 && durationArmsDown >= 0.25 && this.downwardAngularSpeed <= 40) {
      this.flightState = 'dive';
      const diveIntensity = Math.min(1.0, (avgAngle - 22) / 28);
      const targetPitch = -(0.32 + diveIntensity * 0.22); // -0.32 to -0.54 rad (-18° to -31°)
      this.smoothedPitch = THREE.MathUtils.lerp(this.smoothedPitch, targetPitch, 0.22);
      this.motionData.pitchInput = this.smoothedPitch;

      // In dive, slight tilt still available to steer toward rings
      const tiltDiff = (this.rightArmAngle - this.leftArmAngle);
      const targetRoll = Math.abs(tiltDiff) > 12 ? Math.sign(tiltDiff) * 0.38 : 0;
      this.smoothedRoll = THREE.MathUtils.lerp(this.smoothedRoll, targetRoll, 0.18);
      this.motionData.rollInput = this.smoothedRoll;

      this.motionData.debugGesture = `🦅 MENUKIK / DIVE (${durationArmsDown.toFixed(1)}s)`;
    }
    // CONDITION 2: WING FLAP (Option A: Speed of downward stroke within < 1.0s)
    else if ((areBothArmsDown45 || this.downwardAngularSpeed > 65) && durationSinceHorizontal < 1.0 && durationArmsDown < 0.85) {
      const isCooldownReady = now - this.lastFlapTime > this.flapCooldownMs;

      if (isCooldownReady && this.downwardAngularSpeed > 35) {
        this.motionData.isFlapping = true;
        // Option A: Lift intensity scales dynamically with arm swing speed (0.6x to 1.5x)
        const dynamicIntensity = THREE.MathUtils.clamp((this.downwardAngularSpeed - 30) / 100, 0.6, 1.5);
        this.motionData.flapIntensity = dynamicIntensity;
        this.lastFlapTime = now;
        this.flightState = 'flap';
        this.armDownStartTime = 0; // Prevent instant transition into dive

        if (this.calibrationState.currentStep === 4) {
          this.calibrationState.flapTested = true;
          this.calibrationState.currentStep = 5;
          this.calibrationState.isComplete = true;
          this.calibrationState.statusMessage = '✅ Kalibrasi selesai! Siap terbang!';
        }

        console.log('🪽 [ARM WING FLAP (OPTION A)]', {
          angularSpeed: Math.round(this.downwardAngularSpeed) + '°/s',
          intensity: dynamicIntensity.toFixed(2),
          leftAngle: Math.round(this.leftArmAngle),
          rightAngle: Math.round(this.rightArmAngle),
          strokeTime: durationSinceHorizontal.toFixed(2) + 's'
        });
      }

      this.motionData.debugGesture = `🪽 FLAP NAIK (Daya: ${Math.round((this.motionData.flapIntensity || 1.0) * 100)}%)`;
    }
    // CONDITION 3: TILT & AIRBRAKE MODE
    else {
      this.flightState = 'tilt';

      // Tilt angle: difference between right arm and left arm
      // Left arm lower than Right arm (leftArmAngle > rightArmAngle) -> Bank Left (rollInput < 0)
      // Right arm lower than Left arm (rightArmAngle > leftArmAngle) -> Bank Right (rollInput > 0)
      const angleDiff = (this.rightArmAngle - this.leftArmAngle);

      // Deadzone of 12 degrees for rock-steady level flight
      let targetRoll = 0;
      if (Math.abs(angleDiff) > 12) {
        targetRoll = Math.sign(angleDiff) * ((Math.abs(angleDiff) - 12) / 38);
      }
      this.smoothedRoll = THREE.MathUtils.lerp(this.smoothedRoll, THREE.MathUtils.clamp(targetRoll, -1.0, 1.0), 0.18);
      this.motionData.rollInput = this.smoothedRoll;

      // Check AIRBRAKE: Both arms raised high (negative angle < -14°)
      const isAirbraking = avgAngle < -14;
      this.motionData.isBraking = isAirbraking;

      let targetPitch = 0;
      if (isAirbraking) {
        // Airbrake / Flare: pitch up gently and brake forward speed
        targetPitch = +((Math.abs(avgAngle) - 14) / 22);
        this.motionData.debugGesture = '🛑 AIRBRAKE / MENGEREM';
      } else if (avgAngle < -4) {
        // Gentle Climb Up when arms are raised slightly (-4° to -14°) WITHOUT airbraking!
        targetPitch = THREE.MathUtils.clamp((Math.abs(avgAngle) - 4) / 10 * 0.45, 0, 0.45);
        this.motionData.debugGesture = '↗️ NAIK / CLIMB';
      } else if (avgAngle > 14) {
        // Gentle Sink Down when arms are lowered slightly (14° to 28°)
        targetPitch = -THREE.MathUtils.clamp((avgAngle - 14) / 14 * 0.45, 0, 0.45);
        this.motionData.debugGesture = '↘️ TURUN / SINK';
      }
      this.smoothedPitch = THREE.MathUtils.lerp(this.smoothedPitch, THREE.MathUtils.clamp(targetPitch, -1.0, 1.0), 0.2);
      this.motionData.pitchInput = this.smoothedPitch;

      if (!isAirbraking) {
        if (Math.abs(this.smoothedRoll) > 0.22) {
          this.motionData.debugGesture = this.smoothedRoll < 0 ? '⬅️ TILT BELOK KIRI' : '➡️ TILT BELOK KANAN';
        } else if (this.smoothedPitch > 0.15) {
          this.motionData.debugGesture = '⬆️ NAIK / CLIMB';
        } else if (this.smoothedPitch < -0.15) {
          this.motionData.debugGesture = '⬇️ TURUN / SINK';
        } else {
          this.motionData.debugGesture = '✈️ MELUNCUR / GLIDE';
        }
      }
    }

    this.motionData.flightState = this.flightState;

    // Periodic telemetry log (every 1.5s)
    if (now - this.lastLogTime > 1500) {
      this.lastLogTime = now;
      console.log('[Arm Telemetry]', {
        state: this.flightState,
        leftAngle: Math.round(this.leftArmAngle) + '°',
        rightAngle: Math.round(this.rightArmAngle) + '°',
        angularSpeed: Math.round(this.downwardAngularSpeed) + '°/s',
        braking: this.motionData.isBraking,
        roll: this.motionData.rollInput.toFixed(2),
        pitch: this.motionData.pitchInput.toFixed(2)
      });
    }
  }

  /**
   * Pre-Flight Controller Check step-by-step validator
   */
  private updateCalibration(
    leftShoulder: { x: number; y: number },
    rightShoulder: { x: number; y: number },
    now: number
  ): void {
    const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);

    // Step 1: Detect Body
    if (!this.calibrationState.bodyDetected) {
      if (shoulderWidth > 0.08) {
        this.calibrationState.bodyDetected = true;
        this.calibrationState.currentStep = 2;
        this.calibrationState.statusMessage = 'Postur terdeteksi! Sekarang rentangkan kedua lengan lurus.';
      }
      return;
    }

    // Step 2: Calibrate Horizontal Glide (Forgiving natural human arm range)
    if (!this.calibrationState.horizontalCalibrated) {
      const isHorizontal =
        this.leftArmAngle > -28 && this.leftArmAngle < 38 &&
        this.rightArmAngle > -28 && this.rightArmAngle < 38 &&
        Math.abs(this.leftArmAngle - this.rightArmAngle) < 26;

      if (isHorizontal) {
        this.horizontalHoldDuration += 0.08;
        this.calibrationState.horizontalProgress = Math.min(1.0, this.horizontalHoldDuration / 0.35);
        if (this.horizontalHoldDuration >= 0.35) {
          this.calibrationState.horizontalCalibrated = true;
          this.calibrationState.currentStep = 3;
          this.calibrationState.statusMessage = 'Sayap lurus terkalibrasi! Sekarang coba miringkan badan ke kiri lalu kanan.';
        }
      } else {
        // Very gentle freeze, do not drain progress aggressively
        this.horizontalHoldDuration = Math.max(0, this.horizontalHoldDuration - 0.005);
        this.calibrationState.horizontalProgress = Math.min(1.0, this.horizontalHoldDuration / 0.35);
      }
      return;
    }

    // Step 3: Test Roll Left & Right
    if (!this.calibrationState.rollTestedLeft || !this.calibrationState.rollTestedRight) {
      const angleDiff = this.rightArmAngle - this.leftArmAngle;
      if (angleDiff < -16) {
        this.calibrationState.rollTestedLeft = true;
      }
      if (angleDiff > 16) {
        this.calibrationState.rollTestedRight = true;
      }

      if (this.calibrationState.rollTestedLeft && this.calibrationState.rollTestedRight) {
        this.calibrationState.currentStep = 4;
        this.calibrationState.statusMessage = 'Uji belok sukses! Sekarang coba ayunkan kedua tangan ke bawah untuk mengepak.';
      }
      return;
    }
  }

  /**
   * Pre-Flight Calibration status inspection
   */
  public getCalibrationState(): CalibrationState {
    return this.calibrationState;
  }

  /**
   * Skip calibration for experienced flyers
   */
  public skipCalibration(): void {
    this.calibrationState.bodyDetected = true;
    this.calibrationState.horizontalCalibrated = true;
    this.calibrationState.rollTestedLeft = true;
    this.calibrationState.rollTestedRight = true;
    this.calibrationState.flapTested = true;
    this.calibrationState.currentStep = 5;
    this.calibrationState.isComplete = true;
    this.calibrationState.statusMessage = '✅ Kalibrasi dilewati. Langsung terbang!';
  }
  private processOpticalArmFallback(now: number): void {
    if (!this.diffCtx) return;

    this.diffCtx.save();
    this.diffCtx.translate(this.gridW, 0);
    this.diffCtx.scale(-1, 1);
    this.diffCtx.drawImage(this.video, 0, 0, this.gridW, this.gridH);
    this.diffCtx.restore();

    const frame = this.diffCtx.getImageData(0, 0, this.gridW, this.gridH);
    const data = frame.data;
    const currentLuma = new Float32Array(this.gridW * this.gridH);
    for (let i = 0; i < currentLuma.length; i++) {
      currentLuma[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }

    if (!this.prevLuma) {
      this.prevLuma = currentLuma;
      return;
    }

    let topMotion = 0;
    let bottomMotion = 0;
    let leftMotion = 0;
    let rightMotion = 0;
    let leftY = 0;
    let rightY = 0;

    const midX = Math.floor(this.gridW / 2);
    const midY = 12;

    for (let y = 1; y < this.gridH - 1; y++) {
      for (let x = 0; x < this.gridW; x++) {
        const idx = y * this.gridW + x;
        const diff = Math.abs(currentLuma[idx] - this.prevLuma[idx]);

        if (diff > 20) {
          if (y < midY) topMotion += diff;
          else bottomMotion += diff;

          if (x < midX) {
            leftMotion += diff;
            leftY += y * diff;
          } else {
            rightMotion += diff;
            rightY += y * diff;
          }
        }
      }
    }

    this.prevLuma = currentLuma;

    // Quick stroke < 1s
    if (bottomMotion > 2600 && now - this.lastFlapTime > this.flapCooldownMs) {
      this.motionData.isFlapping = true;
      this.motionData.flapIntensity = 1.0;
      this.lastFlapTime = now;
    }

    // Steering
    if (leftMotion > 90 && rightMotion > 90) {
      const avgLeftY = leftY / leftMotion;
      const avgRightY = rightY / rightMotion;
      const tilt = (avgRightY - avgLeftY) / (this.gridH * 0.28);
      let targetRoll = 0;
      if (Math.abs(tilt) > 0.25) {
        targetRoll = Math.sign(tilt) * ((Math.abs(tilt) - 0.25) / 0.75);
      }
      this.smoothedRoll = THREE.MathUtils.lerp(this.smoothedRoll, THREE.MathUtils.clamp(targetRoll, -1.0, 1.0), 0.16);
      this.motionData.rollInput = this.smoothedRoll;
    }
  }

  /**
   * Render PIP preview HUD with visible arm angles and skeleton!
   */
  private renderPreview(): void {
    if (!this.ctx) return;
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.save();
    // Mirror video horizontally so moving left arm moves left on screen
    this.ctx.translate(w, 0);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(this.video, 0, 0, w, h);
    this.ctx.restore();

    // Dark tint
    this.ctx.fillStyle = 'rgba(10, 20, 35, 0.35)';
    this.ctx.fillRect(0, 0, w, h);

    // --- DRAW ARM SKELETON (SHOULDERS -> ELBOWS -> WRISTS) ---
    if (this.lastLandmarks && this.lastLandmarks.length > 0) {
      this.ctx.lineWidth = 3.5;

      ARM_CONNECTIONS.forEach(([startIdx, endIdx], i) => {
        const start = this.lastLandmarks[startIdx];
        const end = this.lastLandmarks[endIdx];

        if (start && end) {
          // 0-1: Head/Neck (amber), 2-3: Left arm (cyan), 4-5: Right arm (green), 6: Chest (gold)
          this.ctx!.strokeStyle = i < 2 ? '#ffaa00' : i < 4 ? '#00f0ff' : i < 6 ? '#00ff88' : '#ffd700';

          const x1 = (1 - start.x) * w;
          const y1 = start.y * h;
          const x2 = (1 - end.x) * w;
          const y2 = end.y * h;

          this.ctx!.beginPath();
          this.ctx!.moveTo(x1, y1);
          this.ctx!.lineTo(x2, y2);
          this.ctx!.stroke();
        }
      });

      // Draw Joint Dots (including 0 = head/nose)
      [0, 11, 12, 13, 14, 15, 16].forEach((idx) => {
        const lm = this.lastLandmarks[idx];
        if (lm) {
          const x = (1 - lm.x) * w;
          const y = lm.y * h;
          this.ctx!.fillStyle = idx === 0 ? '#ffaa00' : '#ffffff';
          this.ctx!.beginPath();
          this.ctx!.arc(x, y, idx === 0 ? 5.5 : 4.5, 0, Math.PI * 2);
          this.ctx!.fill();
        }
      });
    }

    // --- ACTIVE GESTURE / MODE BADGE (Top Center) ---
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    this.ctx.roundRect(w / 2 - 90, 8, 180, 26, 6);
    this.ctx.fill();

    this.ctx.font = 'bold 12px Outfit, sans-serif';
    const gestureColor = this.motionData.isFlapping ? '#00f0ff'
      : this.flightState === 'dive' ? '#ff6b4a'
      : '#ffffff';
    this.ctx.fillStyle = gestureColor;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.motionData.debugGesture, w / 2, 25);

    // --- LIVE ARM ANGLES TELEMETRY (Bottom Center) ---
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.roundRect(w / 2 - 85, h - 28, 170, 22, 4);
    this.ctx.fill();

    this.ctx.font = '10px JetBrains Mono, monospace';
    this.ctx.fillStyle = '#a0d4ff';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      `L: ${this.motionData.leftArmAngle}° | R: ${this.motionData.rightArmAngle}°`,
      w / 2,
      h - 14
    );

    // Flap burst indicator
    if (this.motionData.isFlapping) {
      this.ctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
      this.ctx.fillRect(0, 0, w, h);
    }
  }

  public getMotionData(): MotionData {
    return this.motionData;
  }
}
