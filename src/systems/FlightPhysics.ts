import * as THREE from 'three';
import { BirdProfile } from '../entities/BirdMesh';

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
  public forwardSpeed = 16; // m/s forward airspeed

  // Rotation Euler angles (Yaw, Pitch, Roll)
  public yaw = 0;   // Heading around Y (radians)
  public pitch = 0; // Pitch around X (radians, negative = nose down / dive)
  public roll = 0;  // Roll around Z (radians, positive = bank left)
  private currentTurnRate = 0; // Progressive turn velocity for smooth incremental turning

  // Wing lift vertical impulse from flapping (decays over time)
  private verticalImpulse = 0;

  // Lateral storm wind push, set externally each frame via setWind()
  private windX = 0;
  private windZ = 0;

  // Physical parameters (configurable via bird profiles)
  public minSpeed = 5.0;
  public maxSpeed = 50.0;
  public cruiseSpeed = 16.0;
  public turnRateMult = 1.0;
  public flapLiftMult = 1.0;
  public glideEfficiency = 1.0;
  public birdScale = 1.0;
  private gravity = 9.8;

  // Active state timers
  public flapTimer = 0;
  public boostTimer = 0;
  public inUpdraft = false;

  constructor() {}

  public setProfile(profile: BirdProfile): void {
    this.cruiseSpeed = profile.physics.cruiseSpeed;
    this.minSpeed = profile.physics.minSpeed;
    this.maxSpeed = profile.physics.maxSpeed;
    this.turnRateMult = profile.physics.turnRateMult;
    this.flapLiftMult = profile.physics.flapLift / 16.0;
    this.glideEfficiency = profile.physics.glideEfficiency;
    this.birdScale = profile.scale;
    this.forwardSpeed = this.cruiseSpeed;
  }

  /**
   * Apply flight input and integrate physics step
   */
  public update(delta: number, input: FlightInput): void {
    const dt = Math.min(delta, 0.1);

    // 1. Handle Bird Wing Flap Impulse
    if (input.isFlapping) {
      const intensity = Math.max(0.7, input.flapIntensity || 1.0);
      this.verticalImpulse = Math.max(
        this.verticalImpulse + 11 * intensity * this.flapLiftMult,
        16 * intensity * this.flapLiftMult
      );
      this.flapTimer = 0.45;
    }

    // Handle Airbrake / Flare (when arms raised up or brake active)
    if (input.isBraking) {
      // Decelerate forward speed rapidly down to minSpeed
      this.forwardSpeed = THREE.MathUtils.lerp(this.forwardSpeed, this.minSpeed, dt * 4.5);
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
    // Scaled by the active bird's agility profile
    const targetTurnRate = this.roll * 2.3 * this.turnRateMult;
    const turnDampFactor = Math.abs(targetTurnRate) > Math.abs(this.currentTurnRate) ? 2.4 : 4.2;
    this.currentTurnRate = THREE.MathUtils.damp(this.currentTurnRate, targetTurnRate, turnDampFactor, dt);
    this.yaw += this.currentTurnRate * dt;

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
    // Diving accelerates speed naturally with gravity (from cruise speed up to max dive)
    if (this.pitch < 0) {
      const diveAccel = -Math.sin(this.pitch) * 11.0;
      this.forwardSpeed = THREE.MathUtils.clamp(this.forwardSpeed + diveAccel * dt, this.cruiseSpeed, this.maxSpeed);
    } else if (!input.isBraking) {
      // Climbing nose up bleeds off excess speed naturally
      const climbDrag = Math.sin(this.pitch) * this.gravity * 1.6;
      this.forwardSpeed -= climbDrag * dt;
    }

    // Aerodynamic drag bleeds excess dive speed back to cruise speed smoothly
    if (!input.isBraking && this.pitch >= -0.05 && this.forwardSpeed > this.cruiseSpeed && this.boostTimer <= 0) {
      this.forwardSpeed -= 1.8 * (this.forwardSpeed - this.cruiseSpeed) * dt;
    } else if (!input.isBraking && this.forwardSpeed < this.cruiseSpeed) {
      // Return to cruise speed
      this.forwardSpeed = Math.min(this.cruiseSpeed, this.forwardSpeed + 3.0 * dt);
    }

    this.forwardSpeed = THREE.MathUtils.clamp(this.forwardSpeed, this.minSpeed, this.maxSpeed);

    // 5. 3D Flight Direction Vector with Continuous Gravity & Natural Glide Descent
    const dirX = -Math.sin(this.yaw) * Math.cos(this.pitch);
    const dirZ = -Math.cos(this.yaw) * Math.cos(this.pitch);

    // Continuous natural gliding sink rate:
    // An unpowered gliding bird ALWAYS gently sinks under gravity (-1.3 to -2.0 m/s depending on species).
    // Flapping (verticalImpulse) or thermals (updraft) are required to climb or sustain altitude!
    const baseSinkRate = -1.65 / Math.max(0.65, this.glideEfficiency);

    // Pitch guidance: nose angle directly directs the flight vector
    // Dive (pitch < 0): steep downward velocity (-5 to -16 m/s)
    // Climb (pitch > 0): upward velocity, converting forward speed into height
    const pitchVelY = Math.sin(this.pitch) * this.forwardSpeed;

    // Zoom-climb bonus from high airspeed ONLY when player actively points nose up (pitch > 0.05)
    let speedZoomClimb = 0;
    if (this.pitch > 0.05 && this.forwardSpeed > this.cruiseSpeed) {
      const excessSpeedRatio = (this.forwardSpeed - this.cruiseSpeed) / this.cruiseSpeed;
      speedZoomClimb = excessSpeedRatio * Math.sin(this.pitch) * 9.0;
    }

    // Target vertical velocity combining pitch steering, constant gravity sink, and flap impulse
    const targetVelY = pitchVelY + baseSinkRate + speedZoomClimb + this.verticalImpulse;

    // Smooth vertical damping with natural aerodynamic inertia
    this.velocity.y = THREE.MathUtils.damp(this.velocity.y, targetVelY, 4.5, dt);
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -18.0, 22.0);

    this.velocity.x = dirX * this.forwardSpeed + this.windX;
    this.velocity.z = dirZ * this.forwardSpeed + this.windZ;

    // Integrate position
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // Absolute bounds (subterranean void floor and sky ceiling)
    if (this.position.y < -40.0) {
      this.position.y = -40.0;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
    if (this.position.y > 220) {
      this.position.y = 220;
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
    this.windX = 0;
    this.windZ = 0;
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
   * Set current storm wind push, folded into velocity inside update().
   * Must be called BEFORE update() each frame — update() overwrites
   * velocity.x/z synchronously using these fields, so setting them after
   * update() has already run silently discards the wind for that frame.
   */
  public setWind(x: number, z: number): void {
    const maxWind = this.cruiseSpeed * 0.18;
    const mag = Math.hypot(x, z);
    if (mag > maxWind && mag > 0) {
      const scale = maxWind / mag;
      this.windX = x * scale;
      this.windZ = z * scale;
    } else {
      this.windX = x;
      this.windZ = z;
    }
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
      const pullRate = 6.0 * pullFactor;

      // Steer through velocity rather than teleporting position, so the assist
      // blends with (and decays through) the normal flight damping instead of snapping.
      const pullVelX = dx * pullRate;
      const pullVelY = dy * pullRate;

      this.velocity.x += pullVelX;
      this.velocity.y += pullVelY;

      this.position.x += pullVelX * dt;
      this.position.y += pullVelY * dt;
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
