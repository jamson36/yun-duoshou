const DEG_TO_RAD = Math.PI / 180;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function emptyResult() {
  return {
    valid: false,
    calibrated: false,
    recalibrated: false,
    yawDelta: 0,
    pitchDelta: 0,
  };
}

export function normalizeDegrees(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return ((number % 360) + 360) % 360;
}

export function shortestDegreeDelta(from, to) {
  const delta = normalizeDegrees(Number(to) - Number(from));
  return delta > 180 ? delta - 360 : delta;
}

export function normalizedScreenAngle(value) {
  const normalized = normalizeDegrees(value);
  return normalizeDegrees(Math.round(normalized / 90) * 90);
}

export function screenAdjustedPitch({ beta, gamma, screenAngle = 0 } = {}) {
  if (!finiteNumber(beta) || !finiteNumber(gamma)) return null;
  const radians = normalizedScreenAngle(screenAngle) * DEG_TO_RAD;
  return (beta * Math.cos(radians)) + (gamma * Math.sin(radians));
}

function readOrientationSample(value) {
  if (!value || !finiteNumber(value.alpha) || !finiteNumber(value.beta) || !finiteNumber(value.gamma)) {
    return null;
  }
  const screenAngle = normalizedScreenAngle(value.screenAngle);
  const pitch = screenAdjustedPitch({ ...value, screenAngle });
  if (!finiteNumber(pitch)) return null;
  return {
    yaw: normalizeDegrees(value.alpha),
    pitch,
    screenAngle,
  };
}

export class DeviceOrientationMapper {
  constructor({
    smoothing = null,
    smoothingMs = 105,
    deadZoneDegrees = 0.12,
    maxYawStepDegrees = 2.8,
    maxPitchStepDegrees = 1.8,
    sensorJumpDegrees = 48,
    yawGain = 0.92,
    pitchGain = 0.72,
  } = {}) {
    this.fixedSmoothing = finiteNumber(smoothing) ? clamp(smoothing, 0, 1) : null;
    this.smoothingMs = Math.max(16, Number(smoothingMs) || 105);
    this.deadZoneDegrees = Math.max(0, Number(deadZoneDegrees) || 0);
    this.maxYawStepDegrees = Math.max(0.1, Number(maxYawStepDegrees) || 2.8);
    this.maxPitchStepDegrees = Math.max(0.1, Number(maxPitchStepDegrees) || 1.8);
    this.sensorJumpDegrees = Math.max(10, Number(sensorJumpDegrees) || 48);
    this.yawGain = finiteNumber(yawGain) ? yawGain : 0.92;
    this.pitchGain = finiteNumber(pitchGain) ? pitchGain : 0.72;
    this.reset();
  }

  reset() {
    this.ready = false;
    this.screenAngle = 0;
    this.lastRawYaw = 0;
    this.lastRawPitch = 0;
    this.unwrappedYaw = 0;
    this.filteredYaw = 0;
    this.filteredPitch = 0;
    this.emittedYaw = 0;
    this.emittedPitch = 0;
    this.lastTimestamp = 0;
  }

  anchor(sample, now) {
    this.ready = true;
    this.screenAngle = sample.screenAngle;
    this.lastRawYaw = sample.yaw;
    this.lastRawPitch = sample.pitch;
    this.unwrappedYaw = sample.yaw;
    this.filteredYaw = sample.yaw;
    this.filteredPitch = sample.pitch;
    this.emittedYaw = sample.yaw * this.yawGain;
    this.emittedPitch = sample.pitch * this.pitchGain;
    this.lastTimestamp = Number.isFinite(Number(now)) ? Number(now) : 0;
  }

  update(value, { now = 0 } = {}) {
    const sample = readOrientationSample(value);
    if (!sample) return emptyResult();
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : this.lastTimestamp + 16;

    if (!this.ready) {
      this.anchor(sample, timestamp);
      return {
        valid: true,
        calibrated: true,
        recalibrated: false,
        yawDelta: 0,
        pitchDelta: 0,
      };
    }

    const rawYawDelta = shortestDegreeDelta(this.lastRawYaw, sample.yaw);
    const rawPitchDelta = sample.pitch - this.lastRawPitch;
    if (sample.screenAngle !== this.screenAngle
      || Math.abs(rawYawDelta) > this.sensorJumpDegrees
      || Math.abs(rawPitchDelta) > this.sensorJumpDegrees) {
      this.anchor(sample, timestamp);
      return {
        valid: true,
        calibrated: false,
        recalibrated: true,
        yawDelta: 0,
        pitchDelta: 0,
      };
    }

    this.unwrappedYaw += rawYawDelta;
    this.lastRawYaw = sample.yaw;
    this.lastRawPitch = sample.pitch;

    const elapsed = clamp(timestamp - this.lastTimestamp, 8, 120);
    const smoothing = this.fixedSmoothing ?? (1 - Math.exp(-elapsed / this.smoothingMs));
    this.filteredYaw += (this.unwrappedYaw - this.filteredYaw) * smoothing;
    this.filteredPitch += (sample.pitch - this.filteredPitch) * smoothing;
    this.lastTimestamp = timestamp;

    const wantedYawDelta = (this.filteredYaw * this.yawGain) - this.emittedYaw;
    const wantedPitchDelta = (this.filteredPitch * this.pitchGain) - this.emittedPitch;
    const yawStep = Math.abs(wantedYawDelta) < this.deadZoneDegrees
      ? 0
      : clamp(wantedYawDelta, -this.maxYawStepDegrees, this.maxYawStepDegrees);
    const pitchStep = Math.abs(wantedPitchDelta) < this.deadZoneDegrees
      ? 0
      : clamp(wantedPitchDelta, -this.maxPitchStepDegrees, this.maxPitchStepDegrees);

    this.emittedYaw += yawStep;
    this.emittedPitch += pitchStep;

    return {
      valid: true,
      calibrated: false,
      recalibrated: false,
      yawDelta: yawStep * DEG_TO_RAD,
      pitchDelta: pitchStep * DEG_TO_RAD,
    };
  }
}
