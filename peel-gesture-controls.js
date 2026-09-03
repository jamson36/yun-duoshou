import { mirroredLandmarkPoint } from './gesture-controls.js?v=20260903-gesture-smooth-1';

const DEFAULT_OPTIONS = Object.freeze({
  minConfidence: 0.68,
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
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y));
}

function gestureKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
    this.anchor = null;
    this.smoothedPoint = null;
    this.smoothedAt = null;
    this.lastSeenAt = null;
    this.pausedForLoss = false;
    this.hitTimes = new Map();
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
      this.anchor = null;
      this.smoothedPoint = null;
      this.smoothedAt = null;
      this.pausedForLoss = true;
      return { type: 'pause', reason: 'hand-lost' };
    }
    return null;
  }

  update(result, now = 0) {
    const at = Number(now) || 0;
    const confidence = Number(result?.score);
    const landmark = result?.landmarks?.[8];
    const hasHand = finitePoint(landmark)
      && Number.isFinite(confidence)
      && confidence >= this.options.minConfidence;

    if (!hasHand) return this.handLostEvent(at);

    this.lastSeenAt = at;
    const point = mirroredLandmarkPoint(landmark);
    point.x = clamp(point.x, 0, 1);
    point.y = clamp(point.y, 0, 1);

    if (this.pausedForLoss) {
      this.pausedForLoss = false;
      this.smoothedPoint = { ...point };
      this.smoothedAt = at;
      this.anchor = { ...point };
      return { type: 'resume' };
    }

    if (gestureKey(result.gesture) !== 'pointing_up') {
      this.anchor = null;
      this.smoothedPoint = null;
      this.smoothedAt = null;
      return null;
    }

    const smoothed = this.smooth(point, at);
    if (!this.anchor) {
      this.anchor = { ...smoothed };
      return null;
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
