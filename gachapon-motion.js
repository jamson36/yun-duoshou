const CANONICAL_WIDTH = 560;
const CANONICAL_HEIGHT = 684;
const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.05;
const POSITION_EPSILON = 0.001;
const COAST_DURATION = 0.65;
const AMBIENT_DRIVE_STRENGTH = 0.1;
const AMBIENT_MAXIMUM_SPEED = 82;
const AMBIENT_INITIAL_VELOCITY_SCALE = 0.28;

export const DEFAULT_GACHAPON_CHAMBER = Object.freeze({
  cx: 280,
  cy: 318,
  rx: 196,
  ry: 196,
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function numericSeed(seed) {
  if (Number.isFinite(seed)) return seed >>> 0;
  let hash = 2166136261;
  for (const character of String(seed ?? 'spree-gachapon')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A small deterministic PRNG, useful for repeatable initial ball placement. */
export function createSeededRandom(seed = 'spree-gachapon') {
  let state = numericSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isInsideEllipse(x, y, radius, chamber) {
  const allowedRx = Math.max(POSITION_EPSILON, chamber.rx - radius);
  const allowedRy = Math.max(POSITION_EPSILON, chamber.ry - radius);
  const dx = (x - chamber.cx) / allowedRx;
  const dy = (y - chamber.cy) / allowedRy;
  return (dx * dx) + (dy * dy) <= 1;
}

function bodiesOverlap(x, y, radius, bodies) {
  for (let index = 0; index < bodies.length; index += 1) {
    const other = bodies[index];
    const dx = x - other.x;
    const dy = y - other.y;
    const minimumDistance = radius + other.radius + 2;
    if ((dx * dx) + (dy * dy) < minimumDistance * minimumDistance) return true;
  }
  return false;
}

/**
 * Builds stable, non-overlapping bodies inside the machine chamber.
 * Coordinates use the current Figma artwork's canonical 560 x 684 pixel space.
 */
export function createInitialGachaponBodies({
  count = 6,
  seed = 'spree-gachapon',
  radius = 38,
  chamber = DEFAULT_GACHAPON_CHAMBER,
} = {}) {
  const random = createSeededRandom(seed);
  const bodies = [];
  const safeCount = Math.max(0, Math.floor(count));
  const safeRadius = clamp(radius, 8, Math.min(chamber.rx, chamber.ry) * 0.28);

  for (let index = 0; index < safeCount; index += 1) {
    let x = chamber.cx;
    let y = chamber.cy;
    let placed = false;

    for (let attempt = 0; attempt < 240; attempt += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 0.78;
      x = chamber.cx + Math.cos(angle) * (chamber.rx - safeRadius) * distance;
      y = chamber.cy + Math.sin(angle) * (chamber.ry - safeRadius) * distance;
      if (isInsideEllipse(x, y, safeRadius, chamber)
        && !bodiesOverlap(x, y, safeRadius, bodies)) {
        placed = true;
        break;
      }
    }

    if (!placed) {
      const angle = ((index / Math.max(1, safeCount)) * Math.PI * 2) - (Math.PI / 2);
      const ring = Math.min(chamber.rx, chamber.ry) * (index % 2 === 0 ? 0.47 : 0.2);
      x = chamber.cx + Math.cos(angle) * ring;
      y = chamber.cy + Math.sin(angle) * ring;
    }

    const speed = 42 + random() * 38;
    const direction = random() * Math.PI * 2;
    bodies.push({
      x,
      y,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed,
      radius: safeRadius,
      angle: (random() * 32) - 16,
      angularVelocity: (random() * 2 - 1) * 2.4,
    });
  }

  return bodies;
}

/** Keeps one body inside a circular or elliptical chamber and reflects velocity. */
export function resolveEllipseBoundary(body, chamber = DEFAULT_GACHAPON_CHAMBER, restitution = 0.84) {
  const allowedRx = Math.max(POSITION_EPSILON, chamber.rx - body.radius);
  const allowedRy = Math.max(POSITION_EPSILON, chamber.ry - body.radius);
  const normalizedX = (body.x - chamber.cx) / allowedRx;
  const normalizedY = (body.y - chamber.cy) / allowedRy;
  const distanceSquared = (normalizedX * normalizedX) + (normalizedY * normalizedY);
  if (distanceSquared <= 1) return false;

  const scale = 1 / Math.sqrt(distanceSquared);
  body.x = chamber.cx + normalizedX * scale * allowedRx;
  body.y = chamber.cy + normalizedY * scale * allowedRy;

  // The gradient of the ellipse gives the outward collision normal.
  let normalX = (body.x - chamber.cx) / (allowedRx * allowedRx);
  let normalY = (body.y - chamber.cy) / (allowedRy * allowedRy);
  const normalLength = Math.hypot(normalX, normalY) || 1;
  normalX /= normalLength;
  normalY /= normalLength;
  const outwardSpeed = (body.vx * normalX) + (body.vy * normalY);

  if (outwardSpeed > 0) {
    body.vx -= (1 + restitution) * outwardSpeed * normalX;
    body.vy -= (1 + restitution) * outwardSpeed * normalY;
  }

  const tangentX = -normalY;
  const tangentY = normalX;
  const tangentialSpeed = (body.vx * tangentX) + (body.vy * tangentY);
  body.angularVelocity += (tangentialSpeed / Math.max(body.radius, 1)) * 0.22;
  return true;
}

/** Separates and resolves an equal-mass, frictional collision between two balls. */
export function resolveBallCollision(first, second, restitution = 0.9) {
  let dx = second.x - first.x;
  let dy = second.y - first.y;
  let distance = Math.hypot(dx, dy);
  const minimumDistance = first.radius + second.radius;
  if (distance >= minimumDistance) return false;

  if (distance < POSITION_EPSILON) {
    // Deterministic fallback avoids an undefined normal for coincident centres.
    dx = 1;
    dy = 0;
    distance = 1;
  }

  const normalX = dx / distance;
  const normalY = dy / distance;
  const overlap = minimumDistance - distance;
  const correction = overlap * 0.5 + POSITION_EPSILON;
  first.x -= normalX * correction;
  first.y -= normalY * correction;
  second.x += normalX * correction;
  second.y += normalY * correction;

  const relativeVelocityX = second.vx - first.vx;
  const relativeVelocityY = second.vy - first.vy;
  const normalSpeed = (relativeVelocityX * normalX) + (relativeVelocityY * normalY);
  if (normalSpeed < 0) {
    // Equal masses: impulse denominator is 1/m + 1/m = 2.
    const impulse = -((1 + restitution) * normalSpeed) / 2;
    first.vx -= impulse * normalX;
    first.vy -= impulse * normalY;
    second.vx += impulse * normalX;
    second.vy += impulse * normalY;

    const tangentX = -normalY;
    const tangentY = normalX;
    const tangentialSpeed = (relativeVelocityX * tangentX) + (relativeVelocityY * tangentY);
    const spinImpulse = tangentialSpeed * 0.035;
    first.angularVelocity += spinImpulse / Math.max(first.radius, 1);
    second.angularVelocity -= spinImpulse / Math.max(second.radius, 1);
  }

  return true;
}

function capVelocity(body, maximumSpeed) {
  const speedSquared = (body.vx * body.vx) + (body.vy * body.vy);
  if (speedSquared <= maximumSpeed * maximumSpeed) return;
  const scale = maximumSpeed / Math.sqrt(speedSquared);
  body.vx *= scale;
  body.vy *= scale;
}

/**
 * Advances the machine by one deterministic physics step. This mutates `bodies`
 * so the animation loop can run without allocating a new body collection.
 */
export function stepGachaponPhysics(bodies, {
  dt = FIXED_STEP,
  chamber = DEFAULT_GACHAPON_CHAMBER,
  spinning = true,
  driveStrength = spinning ? 1 : 0,
  elapsed = 0,
  maximumSpeed = 430,
} = {}) {
  const safeDt = clamp(dt, 0, MAX_FRAME_DELTA);
  const drive = clamp(driveStrength, 0, 1);
  const isDriven = drive > 0;
  const dampingPerStep = isDriven ? 0.974 + (0.02 * drive) : 0.91;
  const angularDampingPerStep = isDriven ? 0.956 + (0.036 * drive) : 0.9;
  const damping = Math.pow(dampingPerStep, safeDt / FIXED_STEP);

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const offsetX = body.x - chamber.cx;
    const offsetY = body.y - chamber.cy;
    const phase = elapsed * 5.2 + index * 1.71;

    // Gravity and a rotating impeller-like force keep the contents tumbling.
    body.vx += ((-offsetY * 2.05) + Math.cos(phase) * 210) * drive * safeDt;
    body.vy += ((offsetX * 1.75) + 185 + Math.sin(phase * 0.83) * 170) * drive * safeDt;
    body.vx *= damping;
    body.vy *= damping;
    capVelocity(body, maximumSpeed);
    body.x += body.vx * safeDt;
    body.y += body.vy * safeDt;
    body.angle += body.angularVelocity * safeDt * (180 / Math.PI);
    body.angularVelocity *= Math.pow(angularDampingPerStep, safeDt / FIXED_STEP);
    resolveEllipseBoundary(body, chamber);
  }

  // Two inexpensive solver passes reduce visible overlap in dense moments.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let firstIndex = 0; firstIndex < bodies.length - 1; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
        resolveBallCollision(bodies[firstIndex], bodies[secondIndex]);
      }
    }
    for (let index = 0; index < bodies.length; index += 1) {
      resolveEllipseBoundary(bodies[index], chamber);
      capVelocity(bodies[index], maximumSpeed);
    }
  }

  return bodies;
}

function defaultWindow() {
  return typeof window === 'undefined' ? null : window;
}

function defaultDocument() {
  return typeof document === 'undefined' ? null : document;
}

/**
 * Connects the deterministic physics model to existing DOM tokens.
 * Layout is read only initially and from ResizeObserver callbacks; animation
 * frames only advance numbers and write styles.
 */
export function createGachaponMotion({
  machine,
  tokens,
  seed = 'spree-gachapon',
  reducedMotion,
  active = true,
  requestFrame,
  cancelFrame,
  documentRef = defaultDocument(),
  windowRef = defaultWindow(),
  ResizeObserverClass = globalThis.ResizeObserver,
} = {}) {
  if (!machine) throw new TypeError('createGachaponMotion requires a machine element.');
  const tokenList = Array.from(tokens ?? []);
  if (tokenList.length === 0) throw new TypeError('createGachaponMotion requires at least one token.');

  const raf = requestFrame ?? windowRef?.requestAnimationFrame?.bind(windowRef);
  const caf = cancelFrame ?? windowRef?.cancelAnimationFrame?.bind(windowRef);
  if (typeof raf !== 'function' || typeof caf !== 'function') {
    throw new TypeError('createGachaponMotion requires requestAnimationFrame and cancelAnimationFrame.');
  }

  const mediaQuery = reducedMotion === undefined
    ? windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    : null;
  let prefersReducedMotion = reducedMotion ?? mediaQuery?.matches ?? false;
  let isActive = Boolean(active);
  let state = 'ready';
  let destroyed = false;
  let rafId = null;
  let previousTimestamp = null;
  let accumulator = 0;
  let elapsed = 0;
  let coastRemaining = 0;
  let radius = 38;
  let bodies = createInitialGachaponBodies({ count: tokenList.length, seed, radius });
  for (let index = 0; index < bodies.length; index += 1) {
    bodies[index].vx *= AMBIENT_INITIAL_VELOCITY_SCALE;
    bodies[index].vy *= AMBIENT_INITIAL_VELOCITY_SCALE;
    bodies[index].angularVelocity *= AMBIENT_INITIAL_VELOCITY_SCALE;
  }

  function canAnimate() {
    return !destroyed
      && isActive
      && !prefersReducedMotion
      && !documentRef?.hidden;
  }

  function shouldRun() {
    return canAnimate() && (state === 'ready' || state === 'locked' || state === 'spinning' || coastRemaining > 0);
  }

  function motionMode() {
    if (destroyed) return 'idle';
    if (state === 'spinning') return 'spinning';
    if (state === 'ready' || state === 'locked') return 'ambient';
    if (coastRemaining > 0) return 'coasting';
    return 'idle';
  }

  function syncMachineMotionMode() {
    const nextMode = motionMode();
    if (machine.dataset && machine.dataset.gachaponMotion !== nextMode) {
      machine.dataset.gachaponMotion = nextMode;
    }
  }

  function writeBodies() {
    for (let index = 0; index < tokenList.length; index += 1) {
      const token = tokenList[index];
      const body = bodies[index];
      const x = (body.x / CANONICAL_WIDTH) * 100;
      const y = (body.y / CANONICAL_HEIGHT) * 100;
      token.style.setProperty('--gachapon-x', `${x.toFixed(3)}%`);
      token.style.setProperty('--gachapon-y', `${y.toFixed(3)}%`);
      token.style.setProperty('--gachapon-angle', `${body.angle.toFixed(2)}deg`);
      token.style.left = `${x.toFixed(3)}%`;
      token.style.top = `${y.toFixed(3)}%`;
      token.style.transform = `translate(-50%, -50%) rotate(${body.angle.toFixed(2)}deg)`;
    }
  }

  function stop({ clearCoast = false } = {}) {
    if (rafId !== null) caf(rafId);
    rafId = null;
    previousTimestamp = null;
    accumulator = 0;
    if (clearCoast) coastRemaining = 0;
  }

  function schedule() {
    if (rafId === null && shouldRun()) rafId = raf(frame);
  }

  function frame(timestamp) {
    rafId = null;
    if (!shouldRun()) {
      stop();
      return;
    }

    if (previousTimestamp === null) previousTimestamp = timestamp;
    const frameDelta = Math.min(MAX_FRAME_DELTA, Math.max(0, (timestamp - previousTimestamp) / 1000));
    previousTimestamp = timestamp;
    accumulator += frameDelta;

    while (accumulator >= FIXED_STEP) {
      elapsed += FIXED_STEP;
      const isSpinning = state === 'spinning';
      const isAmbient = state === 'ready' || state === 'locked';
      const isDriven = isSpinning || isAmbient;
      stepGachaponPhysics(bodies, {
        dt: FIXED_STEP,
        elapsed,
        spinning: isDriven,
        driveStrength: isSpinning ? 1 : (isAmbient ? AMBIENT_DRIVE_STRENGTH : 0),
        maximumSpeed: isAmbient ? AMBIENT_MAXIMUM_SPEED : 430,
      });
      if (!isDriven) coastRemaining = Math.max(0, coastRemaining - FIXED_STEP);
      accumulator -= FIXED_STEP;
    }

    if (state !== 'ready' && state !== 'locked' && state !== 'spinning' && coastRemaining === 0) {
      for (let index = 0; index < bodies.length; index += 1) {
        bodies[index].vx = 0;
        bodies[index].vy = 0;
        bodies[index].angularVelocity = 0;
      }
    }

    syncMachineMotionMode();
    writeBodies();
    schedule();
  }

  function measure() {
    if (destroyed) return;
    const machineRect = machine.getBoundingClientRect?.();
    const tokenRect = tokenList[0]?.getBoundingClientRect?.();
    if (machineRect?.width > 0 && tokenRect?.width > 0) {
      radius = clamp((tokenRect.width / machineRect.width) * CANONICAL_WIDTH * 0.5, 18, 44);
      for (let index = 0; index < bodies.length; index += 1) bodies[index].radius = radius;
      for (let index = 0; index < bodies.length; index += 1) resolveEllipseBoundary(bodies[index]);
      for (let firstIndex = 0; firstIndex < bodies.length - 1; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
          resolveBallCollision(bodies[firstIndex], bodies[secondIndex]);
        }
      }
    }
    writeBodies();
  }

  function syncRunState() {
    syncMachineMotionMode();
    if (shouldRun()) schedule();
    else stop();
  }

  function handleVisibilityChange() {
    if (documentRef?.hidden) coastRemaining = 0;
    syncRunState();
  }

  function handleMediaChange(event) {
    prefersReducedMotion = event.matches;
    if (prefersReducedMotion) coastRemaining = 0;
    syncRunState();
  }

  const resizeObserver = typeof ResizeObserverClass === 'function'
    ? new ResizeObserverClass(() => measure())
    : null;
  resizeObserver?.observe(machine);
  documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);
  mediaQuery?.addEventListener?.('change', handleMediaChange);
  measure();
  syncRunState();

  return {
    setState(nextState) {
      const normalizedState = String(nextState ?? 'ready');
      if (normalizedState === state) {
        syncRunState();
        return;
      }
      const wasSpinning = state === 'spinning';
      state = normalizedState;
      if (state === 'ready' || state === 'locked' || state === 'spinning') coastRemaining = 0;
      else if (wasSpinning && canAnimate()) coastRemaining = COAST_DURATION;
      syncRunState();
    },
    setReducedMotion(nextReducedMotion) {
      prefersReducedMotion = Boolean(nextReducedMotion);
      if (prefersReducedMotion) coastRemaining = 0;
      syncRunState();
    },
    setActive(nextActive) {
      isActive = Boolean(nextActive);
      if (!isActive) coastRemaining = 0;
      syncRunState();
    },
    resize: measure,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop({ clearCoast: true });
      syncMachineMotionMode();
      resizeObserver?.disconnect();
      documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
      mediaQuery?.removeEventListener?.('change', handleMediaChange);
    },
    // Exposed as a read-only snapshot for diagnostics and focused tests.
    getSnapshot() {
      return {
        active: isActive,
        coasting: coastRemaining > 0,
        reducedMotion: prefersReducedMotion,
        running: rafId !== null,
        mode: motionMode(),
        state,
        bodies: bodies.map((body) => ({ ...body })),
      };
    },
  };
}
