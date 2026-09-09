import { GestureCommandMapper, GestureMotionInterpolator } from './gesture-controls.js?v=20260903-gesture-smooth-1';

const HAND_CONNECTIONS = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
]);

const MODE_COPY = Object.freeze({
  idle: '张开手掌，准备控制',
  pan: '握拳移动 · 环视房间',
  zoom: '捏合上下移动 · 缩放房间',
  point: '食指指向 · 停留打开热点',
  activity: '食指移动 · 切开话术外壳',
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class GestureFrameGate {
  constructor(intervalMs = 66) {
    this.intervalMs = Math.max(16, Number(intervalMs) || 66);
    this.reset();
  }

  tryAcquire(now = performance.now()) {
    const timestamp = Number(now);
    if (this.busy || !Number.isFinite(timestamp)) return false;
    if (timestamp - this.lastCaptureAt < this.intervalMs) return false;
    this.busy = true;
    this.lastCaptureAt = timestamp;
    return true;
  }

  release() {
    this.busy = false;
  }

  reset() {
    this.busy = false;
    this.lastCaptureAt = Number.NEGATIVE_INFINITY;
  }
}

export function gestureFrameInterval({ width = 1024, hardwareConcurrency = 4 } = {}) {
  if (Number(hardwareConcurrency) <= 2) return 100;
  if (Number(width) <= 480) return 83;
  return 66;
}

export function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'InsecureContextError':
      return '当前页面不是安全连接，无法开启摄像头。请使用 HTTPS 或本机地址。';
    case 'NotAllowedError':
    case 'SecurityError':
      return '需要允许摄像头权限才能使用手势；你仍可继续用触摸、鼠标和键盘。';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '没有找到可用摄像头；你仍可继续用触摸、鼠标和键盘。';
    case 'NotReadableError':
    case 'TrackStartError':
      return '摄像头可能正被其他应用占用，请关闭占用后再试。';
    case 'OverconstrainedError':
      return '当前摄像头不支持所需画面规格，请换一个摄像头再试。';
    default:
      return '暂时无法启动手势控制；触摸、鼠标和键盘不受影响。';
  }
}

function waitForVideo(video, sessionIsCurrent) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('video-timeout')), 8000);
    const finish = (error = null) => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
      if (!sessionIsCurrent()) reject(new DOMException('Gesture session stopped', 'AbortError'));
      else if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error('video-error'));
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function waitForWorker(worker, onStatus = () => {}) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('runtime-timeout')), 90_000);
    const finish = (error = null) => {
      window.clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (event) => {
      if (event.data?.type === 'ready') finish();
      if (event.data?.type === 'error') finish(new Error(event.data.code || 'runtime-error'));
      if (event.data?.type === 'load-progress') {
        const loadedBytes = Number(event.data.loadedBytes) || 0;
        const totalBytes = Number(event.data.totalBytes) || 0;
        const percent = totalBytes > 0 ? Math.round(clamp(loadedBytes / totalBytes, 0, 1) * 100) : null;
        onStatus(percent === null
          ? '正在下载本地识别资源…'
          : `正在下载本地识别资源 ${percent}%…`);
      }
      if (event.data?.type === 'runtime-loading') onStatus('正在启动本地手势识别…');
    };
    const onError = () => finish(new Error('runtime-error'));
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'init' });
  });
}

export class RoomGestureController {
  constructor({
    stage,
    panorama,
    elements,
    onToast = () => {},
    isRoomAvailable = () => true,
    isActivityAvailable = () => false,
    isReducedMotion = () => false,
  }) {
    this.stage = stage;
    this.panorama = panorama;
    this.elements = elements;
    this.onToast = onToast;
    this.isRoomAvailable = isRoomAvailable;
    this.isActivityAvailable = isActivityAvailable;
    this.isReducedMotion = isReducedMotion;
    this.mapper = new GestureCommandMapper();
    this.motionInterpolator = new GestureMotionInterpolator();
    this.frameGate = new GestureFrameGate(gestureFrameInterval({
      width: window.innerWidth,
      hardwareConcurrency: navigator.hardwareConcurrency,
    }));
    this.session = 0;
    this.active = false;
    this.starting = false;
    this.stream = null;
    this.worker = null;
    this.workerReady = false;
    this.frameRequest = 0;
    this.stableSince = null;
    this.calibrated = false;
    this.consecutiveFrameErrors = 0;
    this.currentTarget = null;
    this.panelResumePending = false;
    this.inputContext = 'none';
    this.activityFrameConsumer = null;
    this.activityReturnToRoom = false;
    this.resumePolicy = 'manual';

    this.onOpen = () => this.openDialog();
    this.onClose = () => this.closeDialog();
    this.onStart = () => this.start();
    this.onStop = () => {
      this.stop('user');
      this.closeDialog();
    };
    this.onDialogClick = (event) => {
      if (event.target === this.elements.dialog) this.closeDialog();
    };
    this.onDialogCancel = (event) => {
      event.preventDefault();
      this.closeDialog();
    };
    this.onVisibilityChange = () => {
      if (document.hidden) this.stop('hidden');
    };

    elements.openButton.addEventListener('click', this.onOpen);
    elements.closeButton.addEventListener('click', this.onClose);
    elements.startButton.addEventListener('click', this.onStart);
    elements.stopButton.addEventListener('click', this.onStop);
    elements.dialog.addEventListener('click', this.onDialogClick);
    elements.dialog.addEventListener('cancel', this.onDialogCancel);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.setState('idle', '摄像头尚未开启。');
  }

  setState(state, message) {
    const { root, openButton, startButton, stopButton, status } = this.elements;
    root.dataset.state = state;
    this.elements.dialog.dataset.state = state;
    openButton.dataset.state = state;
    openButton.setAttribute('aria-pressed', String(state === 'active'));
    startButton.hidden = state === 'active';
    stopButton.hidden = state !== 'active';
    startButton.disabled = state === 'loading' || this.isReducedMotion();
    if (message) status.textContent = message;
  }

  openDialog() {
    if (!this.isRoomAvailable()) {
      this.onToast('进入房间后才能开启手势控制。');
      return;
    }
    if (this.isReducedMotion() && !this.active) {
      this.setState('idle', '已开启减少动态效果。恢复动态效果后可使用手势控制。');
    }
    if (!this.elements.dialog.open) this.elements.dialog.showModal();
    window.requestAnimationFrame(() => {
      const target = this.active ? this.elements.stopButton : this.elements.startButton;
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
    if (!this.active && !this.starting) this.setState('idle', '摄像头尚未开启。');
  }

  async start({ resume = false, context = 'room' } = {}) {
    if (this.active || this.starting) return;
    const requestedContext = context === 'activity' ? 'activity' : 'room';
    const contextAvailable = requestedContext === 'activity'
      ? this.isActivityAvailable()
      : this.isRoomAvailable();
    if (!contextAvailable) {
      this.setState('error', requestedContext === 'activity'
        ? '打开欲望追踪任务后才能开启手势。'
        : '进入房间后才能开启手势控制。');
      return;
    }
    if (this.isReducedMotion()) {
      this.setState('error', '已开启减少动态效果。恢复动态效果后可使用手势控制。');
      return;
    }
    if (!window.isSecureContext) {
      this.setState('error', cameraErrorMessage({ name: 'InsecureContextError' }));
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof Worker !== 'function' || typeof createImageBitmap !== 'function') {
      this.setState('error', '当前浏览器不支持本地手势识别；触摸、鼠标和键盘不受影响。');
      return;
    }

    const session = ++this.session;
    const sessionIsCurrent = () => this.session === session;
    this.starting = true;
    this.calibrated = false;
    this.stableSince = null;
    this.setState('loading', resume ? '正在恢复手势控制…' : '正在请求摄像头权限…');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640, max: 960 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (!sessionIsCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      stream.getTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (this.active || this.starting) this.stop('stream-ended');
        }, { once: true });
      });
      this.elements.video.srcObject = stream;
      await waitForVideo(this.elements.video, sessionIsCurrent);
      await this.elements.video.play();
      if (!sessionIsCurrent()) return;

      let worker = this.worker;
      if (!worker || !this.workerReady) {
        this.setState('loading', '正在载入本地手势识别…');
        worker = new Worker(new URL('./gesture-recognizer.worker.js?v=20260901-gesture-runtime-2', import.meta.url));
        this.worker = worker;
        this.workerReady = false;
        await waitForWorker(worker, (message) => {
          if (sessionIsCurrent() && this.worker === worker) this.setState('loading', message);
        });
        if (!sessionIsCurrent()) {
          worker.terminate();
          if (this.worker === worker) {
            this.worker = null;
            this.workerReady = false;
          }
          return;
        }

        worker.addEventListener('message', (event) => {
          if (this.worker !== worker) return;
          if (!this.active) {
            if (event.data?.type === 'result' || event.data?.type === 'frame-error') this.frameGate.release();
            return;
          }
          this.handleWorkerMessage(event.data);
        });
        worker.addEventListener('error', () => {
          if (this.worker === worker) this.stop('runtime-error');
        });
        this.workerReady = true;
      } else {
        this.setState('loading', '正在恢复本地手势识别…');
      }

      this.starting = false;
      this.active = true;
      this.inputContext = requestedContext;
      this.frameGate.reset();
      this.mapper.reset();
      this.motionInterpolator?.reset?.();
      this.setState('active', requestedContext === 'activity'
        ? '手势已开启：指向物件，捏合抓取，松开放下。'
        : '举起一只手，保持在预览框中。');
      this.frameRequest = window.requestAnimationFrame((now) => this.captureLoop(now, session));
    } catch (error) {
      if (!sessionIsCurrent()) return;
      this.starting = false;
      this.inputContext = 'none';
      this.releaseResources();
      this.setState('error', cameraErrorMessage(error));
    }
  }

  async captureLoop(now, session) {
    if (!this.active || this.session !== session) return;
    this.frameRequest = window.requestAnimationFrame((nextNow) => this.captureLoop(nextNow, session));
    this.flushGestureMotion(now);
    if (this.elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (!this.frameGate.tryAcquire(now)) return;

    try {
      const bitmap = await createImageBitmap(this.elements.video);
      if (!this.active || this.session !== session || !this.worker) {
        bitmap.close();
        this.frameGate.release();
        return;
      }
      this.worker.postMessage({ type: 'frame', bitmap, timestampMs: now }, [bitmap]);
    } catch {
      this.frameGate.release();
      this.consecutiveFrameErrors += 1;
      if (this.consecutiveFrameErrors >= 3) this.stop('runtime-error');
    }
  }

  handleWorkerMessage(data) {
    if (data?.type === 'frame-error') {
      this.frameGate.release();
      this.consecutiveFrameErrors += 1;
      if (this.consecutiveFrameErrors >= 3) this.stop('runtime-error');
      return;
    }
    if (data?.type !== 'result') return;

    this.frameGate.release();
    this.consecutiveFrameErrors = 0;
    const landmarks = Array.isArray(data.landmarks) ? data.landmarks : [];
    const score = Number(data.confidence) || 0;
    const handledAt = performance.now();
    if (this.elements.dialog?.open) this.drawLandmarks(landmarks, score);

    if (this.inputContext === 'activity') {
      this.elements.mode.textContent = MODE_COPY.activity;
      this.activityFrameConsumer?.({
        gesture: data.gesture,
        score,
        landmarks,
        at: handledAt,
      });
      return;
    }

    this.updateCalibration(landmarks, score);

    const rect = this.stage.getBoundingClientRect();
    const command = this.mapper.update({
      gesture: data.gesture,
      score,
      landmarks,
    }, {
      now: handledAt,
      width: rect.width,
      height: rect.height,
      hitTest: (point) => this.panorama.hotspotAtPoint?.(point) || null,
    });

    this.motionInterpolator?.setMode(command.mode);
    if (command.panX || command.panY || command.zoomDelta) {
      this.motionInterpolator?.push(command, handledAt);
    }
    this.updatePointer(command.pointer);
    this.elements.mode.textContent = MODE_COPY[command.mode] || MODE_COPY.idle;

    if (command.activation?.hotspotId) {
      this.panorama.activateHotspot?.(command.activation.hotspotId);
    }
  }

  flushGestureMotion(now) {
    if (!this.active || this.inputContext !== 'room') return false;
    const delta = this.motionInterpolator?.sample(now);
    if (!delta || (!delta.panX && !delta.panY && !delta.zoomDelta)) return false;
    return this.panorama.applyInputDelta(delta);
  }

  updateCalibration(landmarks, score) {
    const now = performance.now();
    if (landmarks.length >= 21 && score >= 0.68) {
      if (this.stableSince === null) this.stableSince = now;
      if (!this.calibrated && now - this.stableSince >= 900) {
        this.calibrated = true;
        this.elements.root.dataset.calibrated = 'true';
        this.elements.status.textContent = '识别已稳定，可以开始环视。';
        const shouldRestoreDialogFocus = this.elements.dialog.open;
        if (shouldRestoreDialogFocus) {
          this.elements.dialog.close();
          this.elements.openButton.focus({ preventScroll: true });
        }
        this.onToast('手势控制已开启：握拳环视，捏合缩放，指向热点停留打开。');
      }
      return;
    }
    this.stableSince = null;
  }

  drawLandmarks(landmarks, score) {
    const { canvas, video } = this.elements;
    const width = Math.max(1, video.videoWidth || 640);
    const height = Math.max(1, video.videoHeight || 480);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    if (landmarks.length < 21 || score < 0.4) return;

    context.lineWidth = Math.max(2, width / 260);
    context.lineCap = 'round';
    context.strokeStyle = 'rgba(215, 255, 67, 0.76)';
    context.beginPath();
    HAND_CONNECTIONS.forEach(([from, to]) => {
      const a = landmarks[from];
      const b = landmarks[to];
      if (!a || !b) return;
      context.moveTo((1 - a.x) * width, a.y * height);
      context.lineTo((1 - b.x) * width, b.y * height);
    });
    context.stroke();

    context.fillStyle = '#ffffff';
    landmarks.forEach((point, index) => {
      context.beginPath();
      context.arc((1 - point.x) * width, point.y * height, index === 8 ? 6 : 3.2, 0, Math.PI * 2);
      context.fill();
    });
  }

  updatePointer(pointer) {
    const element = this.elements.pointer;
    if (!pointer || !this.active) {
      element.hidden = true;
      this.setGestureTarget(null);
      return;
    }
    element.hidden = false;
    element.style.left = `${pointer.x}px`;
    element.style.top = `${pointer.y}px`;
    element.style.setProperty('--gesture-progress', `${Math.round(clamp(pointer.progress, 0, 1) * 360)}deg`);
    element.classList.toggle('is-dwelling', Boolean(pointer.hotspotId));
    this.setGestureTarget(pointer.hotspotId);
  }

  setGestureTarget(hotspotId) {
    if (this.currentTarget === hotspotId) return;
    this.currentTarget = hotspotId || null;
    this.stage.querySelectorAll('[data-hotspot-id]').forEach((element) => {
      element.classList.toggle('is-gesture-target', element.dataset.hotspotId === this.currentTarget);
    });
  }

  pauseForPanel() {
    if (this.panelResumePending && !this.active && !this.starting) return true;
    const wasRunning = this.active || this.starting || Boolean(this.stream) || Boolean(this.worker);
    if (!wasRunning) return false;
    this.panelResumePending = true;
    return this.stop('panel');
  }

  resumeFromPanel() {
    if (!this.panelResumePending) return false;
    const canResume = this.isRoomAvailable()
      && !this.isReducedMotion()
      && (typeof document === 'undefined' || !document.hidden);
    this.panelResumePending = false;
    if (!canResume) return false;
    void this.start({ resume: true });
    return true;
  }

  canContinueIntoActivity() {
    return Boolean(this.active && this.stream && this.worker && this.workerReady);
  }

  continueIntoActivity(frameConsumer) {
    if (!this.canContinueIntoActivity()) return false;
    this.activityReturnToRoom = this.activityReturnToRoom || this.inputContext === 'room';
    this.resumePolicy = this.activityReturnToRoom ? 'automatic' : 'manual';
    this.activityFrameConsumer = typeof frameConsumer === 'function' ? frameConsumer : null;
    this.inputContext = 'activity';
    this.mapper.reset();
    this.motionInterpolator?.reset?.();
    this.updatePointer(null);
    this.setState('active', '手势已接入欲望追踪任务：指向物件，捏合抓取，松开放下。');
    return true;
  }

  async startForActivity(frameConsumer) {
    if (this.canContinueIntoActivity()) return this.continueIntoActivity(frameConsumer);
    if (this.active || this.starting) return false;
    const shouldReturnToRoom = this.activityReturnToRoom && this.resumePolicy === 'automatic';
    this.activityFrameConsumer = typeof frameConsumer === 'function' ? frameConsumer : null;
    this.activityReturnToRoom = shouldReturnToRoom;
    this.resumePolicy = shouldReturnToRoom ? 'automatic' : 'manual';
    this.inputContext = 'activity';
    await this.start({ context: 'activity' });
    const started = this.active && this.inputContext === 'activity';
    if (!started) {
      this.activityFrameConsumer = null;
      this.inputContext = 'none';
    }
    return started;
  }

  pauseActivityForPointer() {
    const wasRunning = this.active || this.starting || Boolean(this.stream) || Boolean(this.worker);
    if (!wasRunning) {
      this.activityFrameConsumer = null;
      this.inputContext = 'none';
      return false;
    }
    if (this.inputContext === 'room') {
      this.activityReturnToRoom = true;
      this.resumePolicy = 'automatic';
    }
    this.activityFrameConsumer = null;
    this.inputContext = 'none';
    return this.stop('activity-pointer');
  }

  finishActivityForSummary() {
    const wasRunning = this.active || this.starting || Boolean(this.stream);
    this.activityFrameConsumer = null;
    this.inputContext = 'none';
    if (!wasRunning) return false;
    return this.stop('activity-summary');
  }

  returnToRoomFromActivity() {
    const shouldResume = this.activityReturnToRoom && this.resumePolicy === 'automatic';
    const activityIsRunning = this.active || this.starting || Boolean(this.stream);
    const canResume = this.isRoomAvailable()
      && !this.isReducedMotion()
      && (typeof document === 'undefined' || !document.hidden);
    if (shouldResume && this.active && this.stream && canResume) {
      this.activityFrameConsumer = null;
      this.activityReturnToRoom = false;
      this.resumePolicy = 'manual';
      this.inputContext = 'room';
      this.mapper.reset();
      this.motionInterpolator?.reset?.();
      this.updatePointer(null);
      this.setState('active', '举起一只手，保持在预览框中。');
      return true;
    }
    this.activityFrameConsumer = null;
    this.activityReturnToRoom = false;
    this.resumePolicy = 'manual';
    this.inputContext = 'none';
    if (activityIsRunning) this.stop('activity-return');
    if (!shouldResume) return activityIsRunning;
    if (!canResume) return false;
    void this.start({ resume: true, context: 'room' });
    return true;
  }

  handoffActivityToPanel() {
    const shouldResume = this.activityReturnToRoom && this.resumePolicy === 'automatic';
    this.activityFrameConsumer = null;
    this.activityReturnToRoom = false;
    this.resumePolicy = 'manual';
    this.inputContext = 'none';
    if (!shouldResume) return this.stop('user');
    this.panelResumePending = true;
    this.stop('panel');
    this.panelResumePending = true;
    return true;
  }

  stopActivityByUser() {
    this.activityFrameConsumer = null;
    this.activityReturnToRoom = false;
    this.resumePolicy = 'manual';
    this.inputContext = 'none';
    return this.stop('user');
  }

  stop(reason = 'user') {
    const wasRunning = this.active || this.starting || Boolean(this.stream) || Boolean(this.worker);
    const keepsWarmWorker = ['panel', 'activity-pointer', 'activity-summary', 'activity-return'].includes(reason);
    const keepWorker = keepsWarmWorker && this.workerReady;
    if (reason !== 'panel') this.panelResumePending = false;
    if (['user', 'hidden', 'reduced-motion', 'destroy'].includes(reason)) {
      this.activityFrameConsumer = null;
      this.activityReturnToRoom = false;
      this.resumePolicy = 'manual';
    }
    if (!wasRunning) return false;
    this.session += 1;
    this.active = false;
    this.starting = false;
    this.inputContext = 'none';
    this.releaseResources({ keepWorker });
    this.mapper.reset();
    this.motionInterpolator?.reset?.();
    this.updatePointer(null);
    this.elements.root.removeAttribute('data-calibrated');

    const copy = {
      user: '手势控制已停止。',
      panel: '已暂停手势控制，回到房间将自动恢复。',
      'activity-pointer': '已切换为触摸、鼠标或键盘，摄像头已关闭。',
      'activity-summary': '本局已结算，摄像头已关闭。',
      'activity-return': '已退出欲望追踪任务。',
      hidden: '页面离开前台，摄像头已自动关闭。',
      'reduced-motion': '已开启减少动态效果，手势控制已自动关闭。',
      'stream-ended': '摄像头已停止，请重新开启手势控制。',
      'runtime-error': '本地手势识别暂时中断；触摸、鼠标和键盘不受影响。',
    }[reason] || '手势控制已停止。';
    this.setState(reason === 'runtime-error' ? 'error' : 'idle', copy);
    if (reason === 'panel' && this.elements.dialog.open) this.elements.dialog.close();
    if (wasRunning && ['user', 'panel', 'reduced-motion', 'stream-ended', 'runtime-error'].includes(reason)) {
      this.onToast(copy);
    }
    return wasRunning;
  }

  releaseResources({ keepWorker = false } = {}) {
    window.cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.frameGate.reset();
    if (this.worker && !keepWorker) {
      try {
        this.worker.postMessage({ type: 'stop' });
      } catch {
      }
      this.worker.terminate();
      this.worker = null;
    }
    if (!keepWorker) this.workerReady = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.elements.video.pause();
    this.elements.video.srcObject = null;
    const context = this.elements.canvas.getContext('2d');
    context?.clearRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
  }

  destroy() {
    this.stop('destroy');
    const { elements } = this;
    elements.openButton.removeEventListener('click', this.onOpen);
    elements.closeButton.removeEventListener('click', this.onClose);
    elements.startButton.removeEventListener('click', this.onStart);
    elements.stopButton.removeEventListener('click', this.onStop);
    elements.dialog.removeEventListener('click', this.onDialogClick);
    elements.dialog.removeEventListener('cancel', this.onDialogCancel);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
