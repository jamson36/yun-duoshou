const DEFAULT_OPTIONS = Object.freeze({
  minConfidence: 0.68,
  smoothing: 0.34,
  pointerSmoothing: 0.42,
  panDeadZone: 0.0035,
  panSensitivityX: 2.4,
  panSensitivityY: 1.2,
  maxPanPixelsX: 84,
  maxPanPixelsY: 42,
  pinchEnterRatio: 0.48,
  pinchReleaseRatio: 0.7,
  zoomSensitivity: 1.15,
  maxZoomDelta: 0.075,
  dwellMs: 800,
  cooldownMs: 1200,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function finitePoint(point) {
  return point
    && Number.isFinite(Number(point.x))
    && Number.isFinite(Number(point.y));
}

function idleCommand() {
  return {
    mode: 'idle',
    panX: 0,
    panY: 0,
    zoomDelta: 0,
    pointer: null,
    activation: null,
  };
}

function gestureKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function handCenter(landmarks) {
  if (!Array.isArray(landmarks)) return null;
  const anchors = [0, 5, 9, 13, 17]
    .map((index) => landmarks[index])
    .filter(finitePoint);
  if (anchors.length < 3) return null;
  return anchors.reduce((result, point) => ({
    x: result.x + Number(point.x) / anchors.length,
    y: result.y + Number(point.y) / anchors.length,
  }), { x: 0, y: 0 });
}

export function normalizedPinchDistance(landmarks) {
  if (!Array.isArray(landmarks)) return Number.POSITIVE_INFINITY;
  const palmWidth = distance(landmarks[5], landmarks[17]);
  if (!Number.isFinite(palmWidth) || palmWidth < 0.001) return Number.POSITIVE_INFINITY;
  return distance(landmarks[4], landmarks[8]) / palmWidth;
}

export class GestureCommandMapper {
  constructor(options = {}) {
    const normalizedOptions = { ...options };
    if (Object.hasOwn(options, 'panSensitivity')) {
      if (!Object.hasOwn(options, 'panSensitivityX')) {
        normalizedOptions.panSensitivityX = options.panSensitivity;
      }
      if (!Object.hasOwn(options, 'panSensitivityY')) {
        normalizedOptions.panSensitivityY = options.panSensitivity;
      }
    }
    if (Object.hasOwn(options, 'maxPanPixels')) {
      if (!Object.hasOwn(options, 'maxPanPixelsX')) {
        normalizedOptions.maxPanPixelsX = options.maxPanPixels;
      }
      if (!Object.hasOwn(options, 'maxPanPixelsY')) {
        normalizedOptions.maxPanPixelsY = options.maxPanPixels;
      }
    }
    this.options = { ...DEFAULT_OPTIONS, ...normalizedOptions };
    this.reset();
  }

  reset() {
    this.mode = 'idle';
    this.smoothedCenter = null;
    this.previousControlCenter = null;
    this.smoothedPointer = null;
    this.pinchActive = false;
    this.dwellHotspotId = null;
    this.dwellStartedAt = null;
    this.cooldownUntil = 0;
  }

  clearDwell() {
    this.dwellHotspotId = null;
    this.dwellStartedAt = null;
  }

  setMode(mode) {
    if (mode === this.mode) return false;
    this.mode = mode;
    this.previousControlCenter = null;
    if (mode !== 'point') {
      this.smoothedPointer = null;
      this.clearDwell();
    }
    return true;
  }

  smoothCenter(center) {
    if (!this.smoothedCenter) {
      this.smoothedCenter = { ...center };
      return this.smoothedCenter;
    }
    const alpha = clamp(Number(this.options.smoothing), 0, 1);
    this.smoothedCenter = {
      x: this.smoothedCenter.x + (center.x - this.smoothedCenter.x) * alpha,
      y: this.smoothedCenter.y + (center.y - this.smoothedCenter.y) * alpha,
    };
    return this.smoothedCenter;
  }

  smoothPointer(point) {
    if (!this.smoothedPointer) {
      this.smoothedPointer = { ...point };
      return this.smoothedPointer;
    }
    const alpha = clamp(Number(this.options.pointerSmoothing), 0, 1);
    this.smoothedPointer = {
      x: this.smoothedPointer.x + (point.x - this.smoothedPointer.x) * alpha,
      y: this.smoothedPointer.y + (point.y - this.smoothedPointer.y) * alpha,
    };
    return this.smoothedPointer;
  }

  update(frame, {
    now = performance.now(),
    width = 1,
    height = 1,
    hitTest = null,
  } = {}) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const confidence = Number(frame?.score);
    const center = handCenter(frame?.landmarks);
    if (!center || !Number.isFinite(confidence) || confidence < this.options.minConfidence) {
      this.reset();
      return idleCommand();
    }

    const smoothedCenter = this.smoothCenter(center);
    const gesture = gestureKey(frame.gesture);
    const pinchRatio = normalizedPinchDistance(frame.landmarks);
    this.pinchActive = this.pinchActive
      ? pinchRatio <= this.options.pinchReleaseRatio
      : pinchRatio <= this.options.pinchEnterRatio;

    const nextMode = gesture === 'closed_fist'
      ? 'pan'
      : gesture === 'pointing_up'
        ? 'point'
        : this.pinchActive
          ? 'zoom'
          : 'idle';
    const modeChanged = this.setMode(nextMode);
    const command = idleCommand();
    command.mode = nextMode;

    if (nextMode === 'pan') {
      if (modeChanged || !this.previousControlCenter) {
        this.previousControlCenter = { ...smoothedCenter };
        return command;
      }
      const deltaX = smoothedCenter.x - this.previousControlCenter.x;
      const deltaY = smoothedCenter.y - this.previousControlCenter.y;
      this.previousControlCenter = { ...smoothedCenter };
      const panX = Math.abs(deltaX) < this.options.panDeadZone
        ? 0
        : -deltaX * safeWidth * this.options.panSensitivityX;
      const panY = Math.abs(deltaY) < this.options.panDeadZone
        ? 0
        : deltaY * safeHeight * this.options.panSensitivityY;
      command.panX = clamp(panX, -this.options.maxPanPixelsX, this.options.maxPanPixelsX);
      command.panY = clamp(panY, -this.options.maxPanPixelsY, this.options.maxPanPixelsY);
      return command;
    }

    if (nextMode === 'zoom') {
      if (modeChanged || !this.previousControlCenter) {
        this.previousControlCenter = { ...smoothedCenter };
        return command;
      }
      const deltaY = smoothedCenter.y - this.previousControlCenter.y;
      this.previousControlCenter = { ...smoothedCenter };
      command.zoomDelta = clamp(
        deltaY * this.options.zoomSensitivity,
        -this.options.maxZoomDelta,
        this.options.maxZoomDelta,
      );
      return command;
    }

    if (nextMode !== 'point' || !finitePoint(frame.landmarks?.[8])) return command;

    const pointer = this.smoothPointer({
      x: clamp((1 - Number(frame.landmarks[8].x)) * safeWidth, 0, safeWidth),
      y: clamp(Number(frame.landmarks[8].y) * safeHeight, 0, safeHeight),
    });
    const hotspotId = typeof hitTest === 'function' ? hitTest(pointer) : null;
    let progress = 0;

    if (!hotspotId || now < this.cooldownUntil) {
      this.clearDwell();
    } else if (hotspotId !== this.dwellHotspotId) {
      this.dwellHotspotId = hotspotId;
      this.dwellStartedAt = now;
    } else {
      progress = clamp((now - this.dwellStartedAt) / this.options.dwellMs, 0, 1);
      if (progress >= 1) {
        command.activation = { hotspotId };
        this.cooldownUntil = now + this.options.cooldownMs;
        this.clearDwell();
        progress = 1;
      }
    }

    command.pointer = {
      ...pointer,
      progress,
      hotspotId: hotspotId || null,
    };
    return command;
  }
}
