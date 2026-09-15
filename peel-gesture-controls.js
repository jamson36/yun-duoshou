import { mirroredLandmarkPoint } from './gesture-controls.js?v=20260903-gesture-smooth-1';

const DEFAULT_OPTIONS = Object.freeze({
  minConfidence: 0.68,
  poseGraceMs: 150,
  smoothing: null,
  responseMs: 58,
  maxJump: 0.3,
  minTravel: 0.006,
  hitCooldownMs: 120,
  handLostMs: 600,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finitePoint(point) {
  return point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y);
}

function gestureKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function indexStillExtended(landmarks) {
  const [wrist, base, middle, joint, tip] = [0, 5, 6, 7, 8].map((index) => landmarks[index]);
  const fingerLength = distance(base, middle) + distance(middle, joint) + distance(joint, tip);
  // Only support a briefly uncertain pose when the observed finger is still extended.
  return fingerLength > 0.001
    && distance(base, tip) >= fingerLength * 0.85
    && distance(wrist, tip) > distance(wrist, middle) * 1.08;
}

function smoothingAlpha(fixedAlpha, responseMs, elapsedMs) {
  if (fixedAlpha !== null && fixedAlpha !== undefined && fixedAlpha !== '') {
    return clamp(Number(fixedAlpha) || 0, 0, 1);
  }
  const response = Math.max(1, Number(responseMs) || 1);
  const elapsed = clamp(Number(elapsedMs) || 0, 0, 250);
  return 1 - Math.exp(-elapsed / response);
}

class PeelGestureMapper {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.reset();
  }

  reset() {
    this.resetStroke();
    this.lastSeenAt = null;
    this.pausedForLoss = false;
    this.hitTimes = new Map();
  }

  resetStroke() {
    this.anchor = null;
    this.smoothedPoint = null;
    this.smoothedAt = null;
    this.lastPointingAt = null;
    this.lastRawPoint = null;
  }

  smooth(point, now) {
    if (!this.smoothedPoint) {
      this.smoothedPoint = { ...point };
      this.smoothedAt = now;
      return this.smoothedPoint;
    }
    const alpha = smoothingAlpha(
      this.options.smoothing,
      this.options.responseMs,
      now - this.smoothedAt,
    );
    this.smoothedAt = now;
    this.smoothedPoint = {
      x: this.smoothedPoint.x + (point.x - this.smoothedPoint.x) * alpha,
      y: this.smoothedPoint.y + (point.y - this.smoothedPoint.y) * alpha,
    };
    return this.smoothedPoint;
  }

  handLostEvent(now) {
    if (
      this.lastSeenAt !== null
      && !this.pausedForLoss
      && now - this.lastSeenAt >= this.options.handLostMs
    ) {
      this.resetStroke();
      this.pausedForLoss = true;
      return { type: 'pause', reason: 'hand-lost' };
    }
    return null;
  }

  update(result, now = 0) {
    const at = Number(now) || 0;
    const confidence = Number(result?.score);
    const landmarks = result?.landmarks;
    // The category score describes the pose, not whether the hand is being tracked.
    const hasHand = Array.isArray(landmarks)
      && landmarks.length === 21
      && Array.from(landmarks).every(finitePoint);

    if (!hasHand) {
      this.resetStroke();
      return this.handLostEvent(at);
    }

    if (this.lastSeenAt !== null && at - this.lastSeenAt >= this.options.handLostMs) {
      this.resetStroke();
    }
    this.lastSeenAt = at;
    const point = mirroredLandmarkPoint(landmarks[8]);
    point.x = clamp(point.x, 0, 1);
    point.y = clamp(point.y, 0, 1);

    const resumed = this.pausedForLoss;
    this.pausedForLoss = false;
    if (this.lastRawPoint && distance(this.lastRawPoint, point) > this.options.maxJump) {
      // Check the observed position before smoothing can hide a tracking jump.
      this.resetStroke();
    }

    const gesture = gestureKey(result.gesture);
    const confirmedPointing = gesture === 'pointing_up'
      && Number.isFinite(confidence)
      && confidence >= this.options.minConfidence;
    const uncertainPose = ['pointing_up', 'none', ''].includes(gesture);
    const continuingPointing = uncertainPose
      && this.lastPointingAt !== null
      && at - this.lastPointingAt >= 0
      && at - this.lastPointingAt <= this.options.poseGraceMs
      && indexStillExtended(landmarks);

    if (!confirmedPointing && !continuingPointing) {
      this.resetStroke();
      return resumed ? { type: 'resume' } : null;
    }
    if (confirmedPointing) this.lastPointingAt = at;
    this.lastRawPoint = { ...point };

    const smoothed = this.smooth(point, at);
    if (!this.anchor) {
      this.anchor = { ...smoothed };
      return resumed ? { type: 'resume' } : null;
    }

    const travel = distance(this.anchor, smoothed);
    if (travel > this.options.maxJump) {
      this.anchor = { ...smoothed };
      return null;
    }
    if (travel < this.options.minTravel) return null;

    const segment = {
      type: 'segment',
      from: { ...this.anchor },
      to: { ...smoothed },
      at,
    };
    this.anchor = { ...smoothed };
    return segment;
  }

  registerHit(targetId, now = 0) {
    const id = String(targetId || '');
    if (!id) return false;
    const at = Number(now) || 0;
    const lastHitAt = this.hitTimes.get(id);
    if (Number.isFinite(lastHitAt) && at - lastHitAt < this.options.hitCooldownMs) return false;
    this.hitTimes.set(id, at);
    return true;
  }
}

export function createPeelGestureMapper(options = {}) {
  return new PeelGestureMapper(options);
}
