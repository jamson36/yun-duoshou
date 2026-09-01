export const INTRO_DURATION_MS = 3000;
export const ENTRY_TRANSITION_MS = 420;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeInOut(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function cellNoise(column, row) {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

export function pixelBoundary({ column, columns, rows, progress }) {
  const normalizedX = column / Math.max(1, columns - 1);
  const wave = Math.sin(normalizedX * Math.PI * 3.2 + progress * 4.8) * 2.4
    + Math.sin(normalizedX * Math.PI * 8.5 - progress * 2.3) * 1.1;
  return easeInOut(progress) * (rows + 11) - 5 + wave;
}

export function introProgress({ startedAt, now, duration = INTRO_DURATION_MS }) {
  return clamp((now - startedAt) / Math.max(1, duration), 0, 1);
}

export class RoomIntro {
  constructor({
    app,
    gate,
    canvas,
    status,
    lockup,
    enterButton,
    video = null,
    entryVideo = null,
    duration = INTRO_DURATION_MS,
    reducedMotion = false,
    onEnter,
    onComplete,
  }) {
    this.app = app;
    this.gate = gate;
    this.canvas = canvas;
    this.status = status;
    this.lockup = lockup;
    this.enterButton = enterButton;
    this.video = video;
    this.entryVideo = entryVideo;
    this.duration = duration;
    this.reducedMotion = reducedMotion;
    this.onEnter = onEnter;
    this.onComplete = onComplete;
    this.started = false;
    this.finished = false;
    this.frame = null;
    this.finishTimer = null;
    this.lastFrameAt = 0;
    this.renderProgress = 0;
    this.videoPlaying = false;
    this.videoFailed = false;
    this.entryVideoPlaying = false;
    this.entryVideoFailed = false;

    this.onResize = () => this.resize();
    this.onEnterClick = () => this.enter();
    this.onVideoPlaying = () => this.activateVideo();
    this.onVideoFailure = () => this.fallbackFromVideo();
    this.onEntryVideoPlaying = () => this.activateEntryVideo();
    this.onEntryVideoFailure = () => this.fallbackFromEntryVideo();
    window.addEventListener('resize', this.onResize);
    this.enterButton.addEventListener('click', this.onEnterClick);
    this.video?.addEventListener('playing', this.onVideoPlaying);
    this.video?.addEventListener('error', this.onVideoFailure);
    this.video?.addEventListener('stalled', this.onVideoFailure);
    this.entryVideo?.addEventListener('playing', this.onEntryVideoPlaying);
    this.entryVideo?.addEventListener('error', this.onEntryVideoFailure);
    this.entryVideo?.addEventListener('stalled', this.onEntryVideoFailure);
    this.resize();
    this.draw(0);
  }

  activateVideo() {
    if (!this.started || this.finished || this.reducedMotion || this.videoFailed) return;
    this.videoPlaying = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.gate.classList.add('is-video-playing');
  }

  activateEntryVideo() {
    if (!this.started || !this.finished || this.reducedMotion || this.entryVideoFailed) return;
    this.entryVideoPlaying = true;
    this.gate.classList.add('is-entry-video-playing');
  }

  stopOpeningVideo() {
    this.video?.pause?.();
    if (!this.videoPlaying) return;
    this.videoPlaying = false;
    this.gate.classList.remove('is-video-playing');
  }

  stopEntryVideo() {
    this.entryVideo?.pause?.();
    if (!this.entryVideoPlaying) return;
    this.entryVideoPlaying = false;
    this.gate.classList.remove('is-entry-video-playing');
  }

  stopVideo() {
    this.stopOpeningVideo();
    this.stopEntryVideo();
  }

  fallbackFromVideo() {
    if (!this.started || this.finished) return;
    this.videoFailed = true;
    if (this.videoPlaying) {
      const progress = introProgress({
        startedAt: this.startedAt,
        now: performance.now(),
        duration: this.duration,
      });
      this.draw(progress);
    }
    this.stopOpeningVideo();
    if (!this.reducedMotion && this.frame === null) {
      this.frame = requestAnimationFrame((time) => this.tick(time));
    }
  }

  fallbackFromEntryVideo() {
    if (!this.started || !this.finished) return;
    this.entryVideoFailed = true;
    this.stopEntryVideo();
  }

  startVideo() {
    if (!this.video || this.videoFailed || this.reducedMotion) return;
    this.video.muted = true;
    this.video.playsInline = true;
    try {
      this.video.currentTime = 0;
    } catch {
      // A browser may reject seeking before metadata exists; playback can
      // still begin from the initial poster and the Canvas remains available.
    }
    try {
      const playback = this.video.play();
      playback?.catch?.(() => this.fallbackFromVideo());
    } catch {
      this.fallbackFromVideo();
    }
  }

  startEntryVideo() {
    if (!this.entryVideo || this.entryVideoFailed || this.reducedMotion) return;
    this.entryVideo.muted = true;
    this.entryVideo.playsInline = true;
    this.entryVideo.loop = true;
    try {
      this.entryVideo.currentTime = 0;
    } catch {
      // Seeking can fail until metadata is available; loop playback can still start.
    }
    try {
      const playback = this.entryVideo.play();
      playback?.catch?.(() => this.fallbackFromEntryVideo());
    } catch {
      this.fallbackFromEntryVideo();
    }
  }

  setReducedMotion(value) {
    const nextValue = Boolean(value);
    if (nextValue === this.reducedMotion) return;
    this.reducedMotion = nextValue;
    if (this.reducedMotion) this.stopVideo();
    if (!this.started) return;
    if (this.finished) {
      if (!this.reducedMotion && this.app.dataset.roomPhase === 'entry') this.startEntryVideo();
      return;
    }
    if (this.reducedMotion) {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      this.frame = null;
      // Reveal the room without animation, but keep the fixed three-second
      // entrance gate. Never redraw progress zero after the reveal began.
      this.draw(1);
      return;
    }
    if (this.frame === null) this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  setStatus(message) {
    this.status.textContent = message;
  }

  resize() {
    const rect = this.gate.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.app.dataset.roomPhase = 'intro';
    this.gate.setAttribute('aria-busy', 'true');
    this.setStatus('房间正在显现，进入按钮会在动画结束后出现。');
    this.startedAt = performance.now();
    // The reveal clock starts independently from the panorama asset request.
    // The timeout is the duration authority when animation frames are delayed.
    this.finishTimer = window.setTimeout(() => this.finish(), this.duration);
    if (this.reducedMotion) this.draw(1);
    else {
      this.frame = requestAnimationFrame((time) => this.tick(time));
      this.startVideo();
    }
  }

  tick(time) {
    if (this.finished) return;
    const progress = introProgress({ startedAt: this.startedAt, now: time, duration: this.duration });
    const renderProgress = Math.max(this.renderProgress, progress);
    if (time - this.lastFrameAt >= 28 || progress >= 1) {
      this.draw(renderProgress);
      this.lastFrameAt = time;
    }
    if (progress < 1) {
      this.frame = requestAnimationFrame((nextTime) => this.tick(nextTime));
      return;
    }
    this.finish();
  }

  draw(progress) {
    this.renderProgress = Math.max(this.renderProgress, clamp(progress, 0, 1));
    progress = this.renderProgress;
    const context = this.canvas.getContext('2d');
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);

    if (this.reducedMotion) {
      context.fillStyle = `rgba(12, 10, 9, ${1 - easeInOut(progress)})`;
      context.fillRect(0, 0, this.width, this.height);
      const cell = Math.max(16, Math.round(this.width / 72));
      context.fillStyle = `rgba(255, 128, 27, ${(1 - progress) * 0.72})`;
      for (let x = 0; x < this.width; x += cell * 3) {
        const y = (cellNoise(x, 2) * this.height) | 0;
        context.fillRect(x, y, cell, cell);
      }
      return;
    }

    const cell = clamp(Math.round(this.width / 92), 10, 17);
    const columns = Math.ceil(this.width / cell);
    const rows = Math.ceil(this.height / cell);
    const palette = ['#0b0a09', '#ff7a1a', '#ffad32', '#ffe4aa', '#d7ff43'];
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${Math.max(7, cell - 4)}px ui-monospace, monospace`;

    for (let column = 0; column < columns; column += 1) {
      const boundary = pixelBoundary({ column, columns, rows, progress });
      for (let row = 0; row < rows; row += 1) {
        const noise = cellNoise(column, row);
        const threshold = boundary + (noise - 0.5) * 4.5;
        if (row < threshold - 4.5) continue;
        const x = column * cell;
        const y = row * cell;
        if (row > threshold) {
          context.fillStyle = noise > 0.94 ? '#17120e' : '#0b0a09';
          context.fillRect(x, y, cell + 0.7, cell + 0.7);
          continue;
        }

        const edgeDepth = clamp(Math.round(threshold - row), 0, palette.length - 1);
        context.fillStyle = palette[(edgeDepth + Math.floor(noise * 3)) % palette.length];
        const inset = noise > 0.72 ? 1.4 : 0;
        context.fillRect(x + inset, y + inset, cell - inset * 2 + 0.7, cell - inset * 2 + 0.7);
        if (noise > 0.82 && cell >= 12) {
          context.fillStyle = noise > 0.93 ? '#fff2d4' : '#2a160a';
          context.fillText(noise > 0.93 ? '爽' : '¥', x + cell / 2, y + cell / 2 + 0.5);
        }
      }
    }
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.finishTimer !== null) window.clearTimeout(this.finishTimer);
    this.frame = null;
    this.finishTimer = null;
    // The three-second room reveal is a one-shot gate. The separate Figma 4:5
    // entry composition owns the waiting loop after the gate completes.
    this.stopOpeningVideo();
    this.draw(1);
    this.app.dataset.roomPhase = 'entry';
    this.gate.setAttribute('aria-busy', 'false');
    this.gate.classList.add('is-entry-ready');
    this.lockup.inert = false;
    this.lockup.setAttribute('aria-hidden', 'false');
    this.enterButton.disabled = false;
    this.setStatus('房间已经显现。现在可以进入。');
    this.startEntryVideo();
  }

  async enter() {
    if (!this.finished || this.enterButton.disabled) return;
    this.enterButton.disabled = true;
    this.lockup.inert = true;
    this.gate.classList.add('is-entering');
    this.app.dataset.roomPhase = 'entering';
    this.setStatus('正在拉远镜头，打开完整房间。');
    try {
      await this.onEnter?.();
    } finally {
      this.stopVideo();
      this.app.dataset.roomPhase = 'room';
      this.gate.classList.add('is-complete');
      this.gate.setAttribute('aria-hidden', 'true');
      this.onComplete?.();
    }
  }
}
