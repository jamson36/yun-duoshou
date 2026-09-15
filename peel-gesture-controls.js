import { mirroredLandmarkPoint } from './gesture-controls.js?v=20260903-gesture-smooth-1';

const DEFAULT_OPTIONS = Object.freeze({
  minConfidence: 0.68,
  poseGraceMs: 150,
  smoothing: null,
  responseMs: 58,
  fastResponseMs: 20,
  controlGain: 1,
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

function controlPoint(point, gain) {
  return {
    x: clamp(0.5 + (point.x - 0.5) * gain, 0, 1),
    y: clamp(0.5 + (point.y - 0.5) * gain, 0, 1),
  };
}

function indexStillExtended(landmarks) {
  const [wrist, base, middle, joint, tip] = [0, 5, 6, 7, 8].map((index) => landmarks[index]);
  const fingerLength = distance(base, middle) + distance(middle, joint) + distance(joint, tip);
  // Only support a briefly uncertain pose when the observed finger is still extended.
  return fingerLength > 0.001
    && distance(base, tip) >= fingerLength * 0.85
    && distance(wrist, tip) > distance(wrist, middle) * 1.08;
}

function handMovesWithTip(previous, current) {
  if (!indexStillExtended(previous) || !indexStillExtended(current)) return false;
  const movement = {
    x: current[8].x - previous[8].x,
    y: current[8].y - previous[8].y,
  };
  const tolerance = Math.max(0.04, Math.hypot(movement.x, movement.y) * 0.35);
  // A fast swipe should move the palm too; an isolated fingertip jump must not cut.
  const supportingPoints = [0, 5, 9, 13, 17].filter((index) => Math.hypot(
    current[index].x - previous[index].x - movement.x,
    current[index].y - previous[index].y - movement.y,
  ) <= tolerance);
  return supportingPoints.length >= 4;
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
    this.lastLandmarks = null;
    this.lastCapturedAt = null;
  }

  isTrackingJump(point, landmarks, capturedAt) {
    if (!this.lastRawPoint) return false;
    const travel = distance(this.lastRawPoint, point);
    if (travel <= this.options.maxJump) return false;
    const elapsed = capturedAt - this.lastCapturedAt;
    // Scale the old per-frame guard to the sampling interval, with a 2x hard cap.
    // Longer gaps still re-anchor instead of joining an unobserved swipe.
    const allowance = this.options.maxJump * clamp(elapsed / (1000 / 60), 1, 2);
    return elapsed <= 0 || elapsed > 150 || travel > allowance
      || !handMovesWithTip(this.lastLandmarks, landmarks);
  }

  smooth(point, now) {
    if (!this.smoothedPoint) {
      this.smoothedPoint = { ...point };
      this.smoothedAt = now;
      return this.smoothedPoint;
    }
    const elapsed = now - this.smoothedAt;
    const speed = this.lastRawPoint && elapsed > 0
      ? distance(this.lastRawPoint, point) * 1000 / elapsed
      : 0;
    // Keep small movements steady, but let accepted fast swipes catch up sooner.
    const fastWeight = clamp((speed - 0.6) / (2.4 - 0.6), 0, 1);
    const responseMs = this.options.responseMs
      + (Math.min(this.options.responseMs, this.options.fastResponseMs) - this.options.responseMs) * fastWeight;
    const alpha = smoothingAlpha(
      this.options.smoothing,
      responseMs,
      elapsed,
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
    const capturedAt = Number.isFinite(result?.capturedAt) ? result.capturedAt : at;
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
    const trackingJump = this.isTrackingJump(point, landmarks, capturedAt);
    if (trackingJump) {
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
    // Filter observed motion on the capture clock, independent of inference delays.
    const smoothed = this.smooth(point, capturedAt);
    this.lastRawPoint = { ...point };
    this.lastLandmarks = landmarks.map(({ x, y }) => ({ x, y }));
    this.lastCapturedAt = capturedAt;

    if (!this.anchor) {
      this.anchor = { ...smoothed };
      if (trackingJump) return null;
      // A newly confirmed hand can reposition the blade without bridging a lost stroke.
      return {
        type: resumed ? 'resume' : 'cursor',
        to: controlPoint(smoothed, this.options.controlGain),
        at,
      };
    }

    const travel = distance(this.anchor, smoothed);
    // Accepted observed motion must not be rejected again while smoothing catches up.
    if (travel < this.options.minTravel) return null;

    // Keep jump protection, smoothing and the dead zone in camera coordinates.
    // Only map accepted motion into the game's larger control range.
    const from = controlPoint(this.anchor, this.options.controlGain);
    const to = controlPoint(smoothed, this.options.controlGain);
    this.anchor = { ...smoothed };
    if (distance(from, to) <= Number.EPSILON) return null;

    return {
      type: 'segment',
      from,
      to,
      at,
    };
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
