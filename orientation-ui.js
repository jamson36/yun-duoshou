import { DeviceOrientationMapper } from './orientation-controls.js?v=20260901-device-orientation-1';

function namedError(name, message) {
  if (typeof DOMException === 'function') return new DOMException(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
}

export function shouldOfferOrientationControl({
  hasOrientationEvent = false,
  coarsePointer = false,
  maxTouchPoints = 0,
  viewportWidth = 1024,
} = {}) {
  if (!hasOrientationEvent) return false;
  return Boolean(coarsePointer) || (Number(maxTouchPoints) > 0 && Number(viewportWidth) <= 1024);
}

export async function requestOrientationPermission(OrientationEventType) {
  if (typeof OrientationEventType?.requestPermission !== 'function') return true;
  const result = await OrientationEventType.requestPermission();
  if (result === 'granted') return true;
  throw namedError('NotAllowedError', 'Device orientation permission was not granted.');
}

export function orientationErrorMessage(error) {
  switch (error?.name) {
    case 'InsecureContextError':
      return '当前页面不是安全连接，无法开启体感。请使用 HTTPS 或本机地址。';
    case 'NotAllowedError':
    case 'SecurityError':
      return '需要允许方向与动作权限才能使用体感；触摸拖拽仍可继续使用。';
    case 'SensorTimeoutError':
      return '设备没有返回方向数据；请确认浏览器允许动作与方向访问。';
    default:
      return '当前设备暂时无法开启体感；触摸拖拽仍可继续使用。';
  }
}

function currentScreenAngle() {
  const screenAngle = globalThis.screen?.orientation?.angle;
  if (typeof screenAngle === 'number' && Number.isFinite(screenAngle)) return screenAngle;
  const legacyAngle = globalThis.window?.orientation;
  return typeof legacyAngle === 'number' && Number.isFinite(legacyAngle) ? legacyAngle : 0;
}

export class RoomOrientationController {
  constructor({
    panorama,
    elements,
    onToast = () => {},
    onBeforeStart = () => {},
    isRoomAvailable = () => true,
    isReducedMotion = () => false,
  }) {
    this.panorama = panorama;
    this.elements = elements;
    this.onToast = onToast;
    this.onBeforeStart = onBeforeStart;
    this.isRoomAvailable = isRoomAvailable;
    this.isReducedMotion = isReducedMotion;
    this.mapper = new DeviceOrientationMapper();
    this.available = shouldOfferOrientationControl({
      hasOrientationEvent: typeof window.DeviceOrientationEvent === 'function',
      coarsePointer: window.matchMedia?.('(pointer: coarse)').matches,
      maxTouchPoints: navigator.maxTouchPoints,
      viewportWidth: window.innerWidth,
    });
    this.starting = false;
    this.listening = false;
    this.active = false;
    this.session = 0;
    this.sensorTimer = 0;

    this.onOpen = () => this.openDialog();
    this.onClose = () => this.closeDialog();
    this.onStart = () => this.start();
    this.onStop = () => {
      this.stop('user');
      this.closeDialog();
    };
    this.onRecalibrate = () => this.recalibrate();
    this.onDialogClick = (event) => {
      if (event.target === this.elements.dialog) this.closeDialog();
    };
    this.onDialogCancel = (event) => {
      event.preventDefault();
      this.closeDialog();
    };
    this.onOrientation = (event) => this.handleOrientation(event);
    this.onVisibilityChange = () => {
      if (document.hidden) this.stop('hidden');
    };

    elements.root.hidden = !this.available;
    document.documentElement.classList.toggle('has-orientation-control', this.available);
    elements.openButton.addEventListener('click', this.onOpen);
    elements.closeButton.addEventListener('click', this.onClose);
    elements.startButton.addEventListener('click', this.onStart);
    elements.stopButton.addEventListener('click', this.onStop);
    elements.recalibrateButton.addEventListener('click', this.onRecalibrate);
    elements.dialog.addEventListener('click', this.onDialogClick);
    elements.dialog.addEventListener('cancel', this.onDialogCancel);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.setState('idle', this.available ? '体感尚未开启。' : '当前设备不支持体感环视。');
  }

  setState(state, message) {
    const { root, dialog, openButton, startButton, stopButton, recalibrateButton, status } = this.elements;
    root.dataset.state = state;
    dialog.dataset.state = state;
    openButton.setAttribute('aria-pressed', String(state === 'active'));
    const isListening = state === 'calibrating' || state === 'active';
    startButton.hidden = isListening;
    recalibrateButton.hidden = state !== 'active';
    stopButton.hidden = !isListening;
    startButton.disabled = state === 'requesting' || this.isReducedMotion();
    if (message) status.textContent = message;
  }

  openDialog() {
    if (!this.available) {
      this.onToast('当前设备不支持体感环视，请继续使用触摸拖拽。');
      return;
    }
    if (!this.isRoomAvailable()) {
      this.onToast('进入房间后才能开启体感环视。');
      return;
    }
    if (this.isReducedMotion() && !this.active) {
      this.setState('idle', '已开启减少动态效果。恢复动态效果后可使用体感。');
    }
    if (!this.elements.dialog.open) this.elements.dialog.showModal();
    window.requestAnimationFrame(() => {
      const target = this.active ? this.elements.recalibrateButton : this.elements.startButton;
      target.focus({ preventScroll: true });
    });
  }

  closeDialog() {
    if (this.starting) this.stop('user');
    if (this.elements.dialog.open) this.elements.dialog.close();
    this.elements.openButton.focus({ preventScroll: true });
  }

  handleReducedMotionChange(shouldReduce) {
    if (shouldReduce) {
      this.stop('reduced-motion');
      this.elements.startButton.disabled = true;
      return;
    }
    this.elements.startButton.disabled = false;
    if (!this.active && !this.starting) this.setState('idle', '体感尚未开启。');
  }

  async start() {
    if (!this.available || this.active || this.starting || this.listening) return;
    if (!this.isRoomAvailable()) {
      this.setState('error', '进入房间后才能开启体感环视。');
      return;
    }
    if (this.isReducedMotion()) {
      this.setState('error', '已开启减少动态效果。恢复动态效果后可使用体感。');
      return;
    }
    if (!window.isSecureContext) {
      this.setState('error', orientationErrorMessage({ name: 'InsecureContextError' }));
      return;
    }

    const session = ++this.session;
    this.starting = true;
    this.setState('requesting', '正在请求方向与动作权限…');
    try {
      this.onBeforeStart();
      await requestOrientationPermission(window.DeviceOrientationEvent);
      if (!this.starting || this.session !== session) return;
      this.starting = false;
      this.listening = true;
      this.mapper.reset();
      window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
      this.setState('calibrating', '请把手机自然地举在面前，保持片刻完成校准。');
      this.startSensorTimer();
    } catch (error) {
      if (this.session !== session) return;
      this.starting = false;
      this.setState('error', orientationErrorMessage(error));
    }
  }

  startSensorTimer() {
    window.clearTimeout(this.sensorTimer);
    this.sensorTimer = window.setTimeout(() => {
      if (!this.listening || this.active) return;
      this.stopListening();
      this.setState('error', orientationErrorMessage({ name: 'SensorTimeoutError' }));
    }, 4500);
  }

  handleOrientation(event) {
    if (!this.listening || this.isReducedMotion() || !this.isRoomAvailable()) return;
    const result = this.mapper.update({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      screenAngle: currentScreenAngle(),
    }, { now: performance.now() });
    if (!result.valid) return;

    if (result.calibrated) {
      const wasActive = this.active;
      this.active = true;
      window.clearTimeout(this.sensorTimer);
      this.sensorTimer = 0;
      this.setState('active', '体感已开启。转动手机环视，触摸拖拽仍可使用。');
      if (!wasActive) {
        this.closeDialog();
        this.onToast('体感环视已开启：转动手机看房间，双指可以缩放。');
      }
      return;
    }

    if (result.recalibrated) {
      this.elements.status.textContent = '设备姿态变化较大，已自动重新校准。';
      return;
    }

    if (result.yawDelta || result.pitchDelta) {
      this.panorama.applyAngularInputDelta({
        yawDelta: result.yawDelta,
        pitchDelta: result.pitchDelta,
      });
    }
  }

  recalibrate() {
    if (!this.listening) return false;
    this.active = false;
    this.mapper.reset();
    this.setState('calibrating', '已重置中心，请把手机自然举在面前。');
    this.startSensorTimer();
    this.onToast('体感中心已重置。');
    return true;
  }

  stopListening() {
    window.clearTimeout(this.sensorTimer);
    this.sensorTimer = 0;
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.listening = false;
    this.active = false;
    this.mapper.reset();
  }

  stop(reason = 'user') {
    const wasRunning = this.starting || this.listening || this.active;
    if (!wasRunning && ['panel', 'hidden', 'destroy'].includes(reason)) return false;
    this.session += 1;
    this.starting = false;
    this.stopListening();

    const copy = {
      user: '体感环视已关闭。',
      panel: '已进入功能页，体感环视已自动关闭。',
      hidden: '页面离开前台，体感环视已自动关闭。',
      'reduced-motion': '已开启减少动态效果，体感环视已自动关闭。',
    }[reason] || '体感环视已关闭。';
    this.setState('idle', copy);
    if (reason === 'panel' && this.elements.dialog.open) this.elements.dialog.close();
    if (wasRunning && ['user', 'panel', 'reduced-motion'].includes(reason)) this.onToast(copy);
    return wasRunning;
  }

  destroy() {
    this.stop('destroy');
    const { elements } = this;
    elements.openButton.removeEventListener('click', this.onOpen);
    elements.closeButton.removeEventListener('click', this.onClose);
    elements.startButton.removeEventListener('click', this.onStart);
    elements.stopButton.removeEventListener('click', this.onStop);
    elements.recalibrateButton.removeEventListener('click', this.onRecalibrate);
    elements.dialog.removeEventListener('click', this.onDialogClick);
    elements.dialog.removeEventListener('cancel', this.onDialogCancel);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.documentElement.classList.remove('has-orientation-control');
  }
}
