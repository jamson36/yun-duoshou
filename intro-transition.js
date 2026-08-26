const DEFAULT_DURATION = 3000;

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

export class RoomIntro {
  constructor({
    app,
    gate,
    canvas,
    status,
    lockup,
    enterButton,
    duration = DEFAULT_DURATION,
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
    this.duration = duration;
    this.reducedMotion = reducedMotion;
    this.onEnter = onEnter;
    this.onComplete = onComplete;
    this.started = false;
    this.finished = false;
    this.frame = null;
    this.lastFrameAt = 0;

    this.onResize = () => this.resize();
    this.onEnterClick = () => this.enter();
    window.addEventListener('resize', this.onResize);
    this.enterButton.addEventListener('click', this.onEnterClick);
    this.resize();
    this.draw(0);
  }

  setReducedMotion(value) {
    this.reducedMotion = Boolean(value);
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
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  tick(time) {
    const progress = clamp((time - this.startedAt) / this.duration, 0, 1);
    if (time - this.lastFrameAt >= 28 || progress >= 1) {
      this.draw(progress);
      this.lastFrameAt = time;
    }
    if (progress < 1) {
      this.frame = requestAnimationFrame((nextTime) => this.tick(nextTime));
      return;
    }
    this.finish();
  }

  draw(progress) {
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
    this.frame = null;
    this.draw(1);
    this.app.dataset.roomPhase = 'entry';
    this.gate.setAttribute('aria-busy', 'false');
    this.gate.classList.add('is-entry-ready');
    this.lockup.inert = false;
    this.lockup.setAttribute('aria-hidden', 'false');
    this.enterButton.disabled = false;
    this.setStatus('房间已经显现。现在可以进入。');
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
      this.app.dataset.roomPhase = 'room';
      this.gate.classList.add('is-complete');
      this.gate.setAttribute('aria-hidden', 'true');
      this.onComplete?.();
    }
  }
}
