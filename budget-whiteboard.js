const NOTE_COLORS = Object.freeze(['yellow', 'cyan', 'coral', 'acid']);

const DEFAULT_NOTE = Object.freeze({
  x: 0.52,
  y: 0.48,
  color: 'yellow',
  rotation: -2,
});

const NOTE_BOUNDS = Object.freeze({ minX: 0.12, maxX: 0.88, minY: 0.12, maxY: 0.86 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, value) => from + (to - from) * value;

export function normalizeGoalNote(note = {}) {
  const x = Number(note?.x);
  const y = Number(note?.y);
  const rotation = Number(note?.rotation);
  return {
    x: Number.isFinite(x) ? clamp(x, 0, 1) : DEFAULT_NOTE.x,
    y: Number.isFinite(y) ? clamp(y, 0, 1) : DEFAULT_NOTE.y,
    color: NOTE_COLORS.includes(note?.color) ? note.color : DEFAULT_NOTE.color,
    rotation: Number.isFinite(rotation) ? clamp(rotation, -4, 4) : DEFAULT_NOTE.rotation,
  };
}

export function constrainGoalNote(note = {}) {
  const normalized = normalizeGoalNote(note);
  return {
    ...normalized,
    x: clamp(normalized.x, NOTE_BOUNDS.minX, NOTE_BOUNDS.maxX),
    y: clamp(normalized.y, NOTE_BOUNDS.minY, NOTE_BOUNDS.maxY),
  };
}

export function keyboardNotePosition(note, key, largeStep = false) {
  const current = normalizeGoalNote(note);
  const step = largeStep ? 0.06 : 0.02;
  const movement = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }[key];
  if (!movement) return current;
  return normalizeGoalNote({ ...current, x: current.x + movement[0], y: current.y + movement[1] });
}

export function surfacePoint(surface, x, y) {
  const u = clamp(Number(x) || 0, 0, 1);
  const v = clamp(Number(y) || 0, 0, 1);
  const top = {
    yaw: lerp(surface.topLeft.yaw, surface.topRight.yaw, u),
    pitch: lerp(surface.topLeft.pitch, surface.topRight.pitch, u),
  };
  const bottom = {
    yaw: lerp(surface.bottomLeft.yaw, surface.bottomRight.yaw, u),
    pitch: lerp(surface.bottomLeft.pitch, surface.bottomRight.pitch, u),
  };
  return {
    yaw: lerp(top.yaw, bottom.yaw, v),
    pitch: lerp(top.pitch, bottom.pitch, v),
  };
}

export function invertSurfacePoint(surface, target) {
  let x = 0.5;
  let y = 0.5;
  const p00 = surface.topLeft;
  const p10 = surface.topRight;
  const p01 = surface.bottomLeft;
  const p11 = surface.bottomRight;
  const crossTerm = {
    yaw: p00.yaw - p10.yaw - p01.yaw + p11.yaw,
    pitch: p00.pitch - p10.pitch - p01.pitch + p11.pitch,
  };

  for (let index = 0; index < 10; index += 1) {
    const point = surfacePoint(surface, x, y);
    const errorYaw = point.yaw - target.yaw;
    const errorPitch = point.pitch - target.pitch;
    const dx = {
      yaw: p10.yaw - p00.yaw + crossTerm.yaw * y,
      pitch: p10.pitch - p00.pitch + crossTerm.pitch * y,
    };
    const dy = {
      yaw: p01.yaw - p00.yaw + crossTerm.yaw * x,
      pitch: p01.pitch - p00.pitch + crossTerm.pitch * x,
    };
    const determinant = dx.yaw * dy.pitch - dx.pitch * dy.yaw;
    if (Math.abs(determinant) < 1e-9) break;
    x -= (errorYaw * dy.pitch - errorPitch * dy.yaw) / determinant;
    y -= (dx.yaw * errorPitch - dx.pitch * errorYaw) / determinant;
    x = clamp(x, -0.5, 1.5);
    y = clamp(y, -0.5, 1.5);
  }

  return { x, y };
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function distance(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

export class SceneBudgetWhiteboard {
  constructor({ layer, status, panorama, surface, onMove, onEdit }) {
    this.layer = layer;
    this.status = status;
    this.panorama = panorama;
    this.surface = surface;
    this.onMove = onMove;
    this.onEdit = onEdit;
    this.note = null;
    this.notes = new Map();
    this.drag = null;

    this.layer.addEventListener('pointerdown', (event) => this.startDrag(event));
    this.layer.addEventListener('pointermove', (event) => this.dragNote(event));
    this.layer.addEventListener('pointerup', (event) => this.finishDrag(event));
    this.layer.addEventListener('pointercancel', (event) => this.finishDrag(event));
    this.layer.addEventListener('keydown', (event) => this.handleKeydown(event));
    this.removeProjectionObserver = this.panorama.addProjectionObserver(() => this.updateProjection());
  }

  announce(message) {
    if (!this.status) return;
    this.status.textContent = '';
    window.requestAnimationFrame(() => {
      this.status.textContent = message;
    });
  }

  render({ items = [], activeGoalId = null, selectedGoalId = null, active = false }) {
    this.layer.replaceChildren();
    this.note = null;
    this.notes.clear();
    this.layer.classList.toggle('is-active', Boolean(active));
    this.layer.hidden = !items.length;
    items.forEach((item) => this.createNote(item, activeGoalId, selectedGoalId));
    this.note = this.notes.get(selectedGoalId)?.element || this.notes.get(activeGoalId)?.element || this.notes.values().next().value?.element || null;
    this.updateProjection();
  }

  createNote({ goal, saved = 0, percent = 0 }, activeGoalId, selectedGoalId) {
    const noteMeta = constrainGoalNote(goal.note);
    const note = document.createElement('article');
    note.className = `scene-budget-note is-${noteMeta.color}`;
    note.classList.toggle('is-current', goal.id === activeGoalId);
    note.classList.toggle('is-selected', goal.id === selectedGoalId);
    note.dataset.goalId = goal.id;
    note.tabIndex = 0;
    note.setAttribute('role', 'button');
    note.setAttribute('aria-roledescription', '全景白板上的可拖动预算便签');
    note.setAttribute('aria-label', `${goal.name}${goal.demo ? '，演示目标' : ''}，预算 ${goal.amount} 元，已完成 ${percent}%${goal.id === activeGoalId ? '，当前目标' : ''}。拖动或使用方向键移动，按 Enter 编辑。`);
    note.style.setProperty('--scene-note-rotate', `${noteMeta.rotation}deg`);

    const tape = document.createElement('span');
    tape.className = 'scene-note-tape';
    tape.setAttribute('aria-hidden', 'true');
    const kicker = document.createElement('small');
    kicker.textContent = `${goal.id === activeGoalId ? 'CURRENT GOAL / 当前目标' : 'NEXT BIG YES / 候选目标'}${goal.demo ? ' · 演示' : ''}`;
    const title = document.createElement('strong');
    title.textContent = goal.name;
    const amount = document.createElement('b');
    amount.textContent = `¥${formatAmount(goal.amount)}`;
    const reminder = document.createElement('p');
    reminder.textContent = goal.noteText || '把零散冲动，留给真正想要的。';
    const progress = document.createElement('span');
    progress.className = 'scene-note-progress';
    progress.style.setProperty('--scene-note-progress', `${percent}%`);
    progress.textContent = `${percent}% · 已确认 ¥${formatAmount(saved)}`;
    const deadline = document.createElement('time');
    deadline.textContent = goal.deadline ? `${goal.deadline.replaceAll('-', '.')} 前` : '慢慢来，也算计划';
    if (goal.deadline) deadline.dateTime = goal.deadline;
    const hint = document.createElement('span');
    hint.className = 'scene-note-drag-hint';
    hint.textContent = 'DRAG / ENTER TO EDIT';

    note.append(tape, kicker, title, amount, reminder, progress, deadline, hint);
    this.layer.appendChild(note);
    this.notes.set(goal.id, { element: note, meta: noteMeta });
  }

  applyPosition(goalId, noteMeta) {
    const record = this.notes.get(goalId);
    if (!record) return;
    record.meta = constrainGoalNote(noteMeta);
    this.updateNoteProjection(record);
  }

  updateProjection() {
    this.notes.forEach((record) => this.updateNoteProjection(record));
  }

  updateNoteProjection(record) {
    const { element, meta } = record;
    const center = surfacePoint(this.surface, meta.x, meta.y);
    const point = this.panorama.projectPoint(center.yaw, center.pitch);
    const horizontalDelta = 0.08;
    const verticalDelta = 0.08;
    const leftSurface = surfacePoint(this.surface, clamp(meta.x - horizontalDelta, 0, 1), meta.y);
    const rightSurface = surfacePoint(this.surface, clamp(meta.x + horizontalDelta, 0, 1), meta.y);
    const topSurface = surfacePoint(this.surface, meta.x, clamp(meta.y - verticalDelta, 0, 1));
    const bottomSurface = surfacePoint(this.surface, meta.x, clamp(meta.y + verticalDelta, 0, 1));
    const left = this.panorama.projectPoint(leftSurface.yaw, leftSurface.pitch);
    const right = this.panorama.projectPoint(rightSurface.yaw, rightSurface.pitch);
    const top = this.panorama.projectPoint(topSurface.yaw, topSurface.pitch);
    const bottom = this.panorama.projectPoint(bottomSurface.yaw, bottomSurface.pitch);
    const localBoardWidth = distance(left, right) / (horizontalDelta * 2);
    const localBoardHeight = distance(top, bottom) / (verticalDelta * 2);
    const noteWidth = clamp(Math.min(localBoardWidth * 0.22, localBoardHeight * 0.24), 72, 226);
    const boardAngle = Math.atan2(right.y - left.y, right.x - left.x) * (180 / Math.PI);
    const stageWidth = this.layer.clientWidth || 1;
    const stageHeight = this.layer.clientHeight || 1;
    const visible = point.localZ > 0.05
      && point.x > -noteWidth
      && point.x < stageWidth + noteWidth
      && point.y > -noteWidth
      && point.y < stageHeight + noteWidth;

    element.hidden = !visible;
    if (!visible) return;
    element.classList.toggle('is-compact', noteWidth < 126);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    element.style.setProperty('--scene-note-width', `${noteWidth}px`);
    element.style.setProperty('--scene-board-rotate', `${boardAngle}deg`);
  }

  pointerPosition(event) {
    const spherical = this.panorama.unprojectPoint(event.clientX, event.clientY);
    return invertSurfacePoint(this.surface, spherical);
  }

  startDrag(event) {
    const note = event.target.closest('.scene-budget-note');
    if (!note || event.button !== 0) return;
    const record = this.notes.get(note.dataset.goalId);
    if (!record) return;
    const pointer = this.pointerPosition(event);
    this.drag = {
      goalId: note.dataset.goalId,
      pointerId: event.pointerId,
      offsetX: record.meta.x - pointer.x,
      offsetY: record.meta.y - pointer.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    note.setPointerCapture(event.pointerId);
    note.classList.add('is-dragging');
    note.setAttribute('aria-grabbed', 'true');
    event.stopPropagation();
    event.preventDefault();
  }

  dragNote(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const pointer = this.pointerPosition(event);
    const record = this.notes.get(this.drag.goalId);
    if (!record) return;
    if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 4) this.drag.moved = true;
    this.applyPosition(this.drag.goalId, {
      ...record.meta,
      x: pointer.x + this.drag.offsetX,
      y: pointer.y + this.drag.offsetY,
    });
    event.stopPropagation();
    event.preventDefault();
  }

  finishDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    const record = this.notes.get(drag.goalId);
    if (!record) return;
    record.element.classList.remove('is-dragging');
    record.element.setAttribute('aria-grabbed', 'false');
    if (record.element.hasPointerCapture(event.pointerId)) record.element.releasePointerCapture(event.pointerId);
    this.drag = null;
    if (event.type === 'pointercancel') {
      this.applyPosition(drag.goalId, record.meta);
    } else if (drag.moved) {
      const persisted = this.onMove?.(drag.goalId, record.meta);
      this.announce(persisted === false
        ? '便签位置仅在本次会话更新，刷新后可能丢失。'
        : '便签在全景白板上的位置已保存。');
    } else {
      this.onEdit?.(drag.goalId, record.element);
    }
    event.stopPropagation();
  }

  handleKeydown(event) {
    const note = event.target.closest('.scene-budget-note');
    if (!note) return;
    const goalId = note.dataset.goalId;
    const record = this.notes.get(goalId);
    if (!record) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.onEdit?.(goalId, note);
      return;
    }
    if (!event.key.startsWith('Arrow')) return;
    event.preventDefault();
    event.stopPropagation();
    const next = constrainGoalNote(keyboardNotePosition(record.meta, event.key, event.shiftKey));
    this.applyPosition(goalId, next);
    const persisted = this.onMove?.(goalId, next);
    const direction = { ArrowLeft: '左', ArrowRight: '右', ArrowUp: '上', ArrowDown: '下' }[event.key];
    this.announce(persisted === false
      ? `便签已向${direction}移动，但刷新后可能丢失。`
      : `便签已向${direction}移动。`);
  }

  flashPinned(goalId) {
    const note = this.notes.get(goalId)?.element || this.note;
    if (!note) return;
    note.classList.remove('is-pinning');
    void note.offsetWidth;
    note.classList.add('is-pinning');
    window.setTimeout(() => note.classList.remove('is-pinning'), 760);
  }

  getNote(goalId) {
    return this.notes.get(goalId)?.element || null;
  }
}
