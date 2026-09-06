import * as THREE from 'three';

export interface FlightInput {
  rollInput: number;     // -1 (turn left) to +1 (turn right)
  rollAngleRad?: number; // Direct physical body roll angle in radians matching user's arms
  pitchInput: number;    // -1 (dive down) to +1 (climb up)
  isFlapping: boolean;   // Bird wing flap stroke
  isBraking?: boolean;   // Airbrake / flare (slows down to minSpeed, floats gently)
  flapIntensity?: number;// 0 to 1.5 intensity
}

export class FlightPhysics {
  // Position & Velocity in World Space
  public position = new THREE.Vector3(0, 25, 20);
  public velocity = new THREE.Vector3(0, 0, -16);
  public forwardSpeed = 16; // m/s forward airspeed (calm, controllable cruise)

  // Rotation Euler angles (Yaw, Pitch, Roll)
  public yaw = 0;   // Heading around Y (radians)
  public pitch = 0; // Pitch around X (radians, negative = nose down / dive)
  public roll = 0;  // Roll around Z (radians, positive = bank left)
  private currentTurnRate = 0; // Progressive turn velocity for smooth incremental turning

  // Wing lift vertical impulse from flapping (decays over time)
  private verticalImpulse = 0;

  // Physical parameters
  private minSpeed = 5.0;     // Low minimum speed so player can fly slowly to take rings easily
  private maxSpeed = 50.0;    // Maximum dive speed
  private cruiseSpeed = 16.0;  // Calm cruise speed (57 km/h)
  private gravity = 9.8;

  // Active state timers
  public flapTimer = 0;
  public boostTimer = 0;
  public inUpdraft = false;

  constructor() {}

  /**
   * Apply flight input and integrate physics step
   */
  public update(delta: number, input: FlightInput): void {
    const dt = Math.min(delta, 0.1);

    // 1. Handle Bird Wing Flap Impulse (Primary function: gain altitude / naik ke atas)
    if (input.isFlapping) {
      const intensity = Math.max(0.7, input.flapIntensity || 1.0);
      // Strong vertical lift force upward into the sky
      this.verticalImpulse = Math.max(this.verticalImpulse + 11 * intensity, 16 * intensity);
      // PURE ALTITUDE GAIN: Zero forward speed addition so player climbs without racing forward!
      this.flapTimer = 0.45;
    }

    // Handle Airbrake / Flare (when arms raised up or brake active)
    if (input.isBraking) {
      // Decelerate forward speed rapidly down to minSpeed
      this.forwardSpeed = THREE.MathUtils.lerp(this.forwardSpeed, this.minSpeed, dt * 4.5);
      // Gentle flare lift
      this.verticalImpulse = Math.min(8.0, this.verticalImpulse + 5.0 * dt);
    }

    // Decay wing flap impulse
    if (this.verticalImpulse > 0) {
      this.verticalImpulse = Math.max(0, this.verticalImpulse - 14 * dt);
    }

    if (this.flapTimer > 0) {
      this.flapTimer -= dt;
    }

    // Ring boost acceleration
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      this.forwardSpeed = Math.min(this.maxSpeed, this.forwardSpeed + 30 * dt);
    }

    // 2. Roll & Yaw Banking (Body tilting directly matches user's hand tilt!)
    let targetRoll = 0;
    if (input.rollAngleRad !== undefined) {
      // Direct body roll matching player's hand tilt angle (clamped to realistic max ~55° / 0.96 rad)
      targetRoll = THREE.MathUtils.clamp(-input.rollAngleRad, -0.96, 0.96);
    } else {
      targetRoll = -input.rollInput * 0.55;
    }
    // Smooth body banking roll with natural inertia
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll, 8.0, dt);

    // Incremental / Progressive Turn Rate:
    // When banking, turning rate starts slow and progressively accelerates into the turn.
    // This prevents sudden jarring turns and gives a smooth, natural carving curve!
    const targetTurnRate = this.roll * 2.3;
    const turnDampFactor = Math.abs(targetTurnRate) > Math.abs(this.currentTurnRate) ? 2.4 : 4.2;
    this.currentTurnRate = THREE.MathUtils.damp(this.currentTurnRate, targetTurnRate, turnDampFactor, dt);
    this.yaw += this.currentTurnRate * dt;

    // 3. Pitch (Going DOWN vs Going UP)
    // Convention:
    // input.pitchInput < 0 -> DIVE / SINK DOWN (targetPitch < 0, nose tilts down gently)
    // 3. Pitch (Going DOWN vs Going UP)
    // Convention:
    // input.pitchInput < 0 -> DIVE / SINK DOWN (targetPitch < 0, nose points down)
    // input.pitchInput > 0 -> CLIMB UP (targetPitch > 0, nose points up)
    let targetPitch = THREE.MathUtils.clamp(input.pitchInput, -0.60, 0.55);
    if (input.isBraking) {
      targetPitch = Math.max(targetPitch, 0.22); // Flare nose up slightly when braking
    }
    this.pitch = THREE.MathUtils.lerp(this.pitch, targetPitch, dt * 5.0);

    // 4. Airspeed dynamics:
    // Diving accelerates speed naturally with gravity (from cruise ~16 m/s up to ~22-24 m/s)
    if (this.pitch < 0) {
      const diveAccel = -Math.sin(this.pitch) * 8.5; // Natural gravitational forward component
      this.forwardSpeed = THREE.MathUtils.clamp(this.forwardSpeed + diveAccel * dt, this.cruiseSpeed, 24.0);
    } else if (!input.isBraking) {
      // Climbing nose up bleeds off excess speed
      const climbDrag = Math.sin(this.pitch) * this.gravity * 1.5;
      this.forwardSpeed -= climbDrag * dt;
    }

    // Drag gently pulls back towards cruise speed if cruising level
    if (!input.isBraking && this.pitch >= -0.05 && this.forwardSpeed > this.cruiseSpeed && this.boostTimer <= 0) {
      this.forwardSpeed -= 0.65 * (this.forwardSpeed - this.cruiseSpeed) * dt;
    } else if (!input.isBraking && this.forwardSpeed < this.cruiseSpeed) {
      // Return to cruise speed
      this.forwardSpeed = Math.min(this.cruiseSpeed, this.forwardSpeed + 3.0 * dt);
    }

    this.forwardSpeed = THREE.MathUtils.clamp(this.forwardSpeed, this.minSpeed, this.maxSpeed);

    // 5. 3D Flight Direction Vector (6-DOF) with Realistic Aerodynamic Glide
    const dirX = -Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirZ = -Math.cos(this.yaw) * Math.cos(this.pitch);

    // Aerodynamic Glide Lift & Gravity:
    // When pitching nose down (pitch < 0), wing lift is reduced proportionally
    // so the bird drops and dives naturally into the lower rings
    const speedRatio = this.forwardSpeed / this.cruiseSpeed;
    let dynamicLift = Math.min(1.4, speedRatio * speedRatio) * this.gravity;

    if (this.pitch < 0) {
      // Lowering arms / nose down cuts lift by up to 88%
      const sinkIntensity = Math.min(1.0, -this.pitch / 0.35);
      dynamicLift *= (1.0 - sinkIntensity * 0.88);
    }

    const gravityForce = -this.gravity;
    // Net vertical acceleration from wing lift vs gravity
    const aeroVerticalAcc = (dynamicLift + gravityForce) * 0.75;

    // Pitch guidance: nose angle directs the path of flight
    const targetNoseVelY = Math.sin(this.pitch) * this.forwardSpeed;

    // Total vertical target velocity combining pitch steering, aerodynamic lift, and flap lift
    const targetVelY = targetNoseVelY + aeroVerticalAcc + this.verticalImpulse;

    // Smooth vertical damping with inertia:
    // Diving gives solid downward velocity (-6 to -14 m/s)
    this.velocity.y = THREE.MathUtils.damp(this.velocity.y, targetVelY, 4.5, dt);
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -16.0, 22.0);

    this.velocity.x = dirX * this.forwardSpeed;
    this.velocity.z = dirZ * this.forwardSpeed;

    // Integrate position
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // Safe floor (cloud sea boundary) and ceiling bounds
    if (this.position.y < 4.0) {
      this.position.y = 4.0;
      this.velocity.y = Math.max(4.0, this.velocity.y);
    }
    if (this.position.y > 190) {
      this.position.y = 190;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
  }

  /**
   * Handle physical collision with islands, spires, or ground terrain
   */
  public handleTerrainCollision(safeY: number): void {
    if (this.position.y < safeY) {
      this.position.y = safeY;
    }
    // Only bounce if heading downwards
    if (this.velocity.y < 0) {
      this.velocity.y = Math.max(6.5, -this.velocity.y * 0.5);
    }
    // Only apply mild friction if flying fast
    if (this.forwardSpeed > 14.0) {
      this.forwardSpeed = Math.max(14.0, this.forwardSpeed * 0.94);
    }
  }

  /**
   * Reset flight physics to starting state
   */
  public reset(): void {
    this.position.set(0, 25, 20);
    this.velocity.set(0, 0, -16);
    this.forwardSpeed = this.cruiseSpeed;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.currentTurnRate = 0;
    this.verticalImpulse = 0;
    this.flapTimer = 0;
    this.boostTimer = 0;
    this.inUpdraft = false;
  }

  /**
   * Apply upward thermal draft force
   */
  public applyUpdraft(strength: number, dt: number): void {
    this.verticalImpulse = Math.min(22, this.verticalImpulse + strength * dt * 2.0);
    this.inUpdraft = true;
  }

  /**
   * Apply ring turbo booster
   */
  public triggerBoost(): void {
    this.boostTimer = 2.2;
    this.forwardSpeed = Math.min(this.maxSpeed, this.forwardSpeed + 16);
  }

  /**
   * Apply aerodynamic slipstream guidance towards active waypoint ring
   */
  public applySlipstream(ringPos: THREE.Vector3, dt: number): void {
    const dx = ringPos.x - this.position.x;
    const dy = ringPos.y - this.position.y;
    const dz = ringPos.z - this.position.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    // Active within 18 meters when approaching ring
    if (distSq < 324 && distSq > 2.0) {
      const dist = Math.sqrt(distSq);
      const pullFactor = THREE.MathUtils.clamp((18.0 - dist) / 18.0, 0, 1.0);
      const lateralAttraction = 6.0 * pullFactor * dt;

      this.position.x += dx * lateralAttraction;
      this.position.y += dy * lateralAttraction;
    }
  }

  /**
   * Update Three.js object transform from physics state
   */
  public applyTransform(object: THREE.Object3D): void {
    object.position.copy(this.position);

    // Apply rotation order YXZ: Yaw (heading), Pitch (climb/dive), Roll (banking)
    object.rotation.order = 'YXZ';
    object.rotation.y = this.yaw;
    object.rotation.x = this.pitch;
    object.rotation.z = this.roll;
  }
}
