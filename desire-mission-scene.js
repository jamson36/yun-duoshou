import * as THREE from './assets/vendor/three/three.module.min.js';
import { TRACK_NODES, stepMissionMovement, reachableMissionNode } from './desire-mission.js?v=20260905-mission-wasd-2';

// Original street kit. Reference mechanisms are documented in the mission design.
export function createMissionScene({ canvas, onFrame = () => {}, onArrive = () => {}, onApproach = () => {}, onFailure = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#09151e');
  scene.fog = new THREE.FogExp2('#09151e', 0.019);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 145);
  scene.add(new THREE.HemisphereLight('#b3d1da', '#141524', 2.4));
  const moon = new THREE.DirectionalLight('#d1eff8', 3.2);
  moon.position.set(-12, 30, 14); scene.add(moon);
  const materials = new Map(); const textures = new Set(); const batches = new Map();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  let disposed = false, state = null, frameId = null, lastAt = 0, elapsed = 0;
  let reduced = false, suspended = false, quality = 1.5, slowFrames = 0;
  let moving = false, moveProgress = 0, arrivalNode = null;
  let movement = { strafe: 0, forward: 0 }, viewYaw = 0, viewPitch = 0.77;
  const position = new THREE.Vector3(0, 0, 8), start = position.clone(), destination = position.clone();
  const cameraAim = new THREE.Vector3(0, 0, 4), desiredAim = cameraAim.clone();
  const cameraTarget = new THREE.Vector3();
  camera.position.set(0, 22, 28);

  function material(color, emissive = false) {
    const key = `${color}:${emissive}`;
    if (!materials.has(key)) materials.set(key, emissive
      ? new THREE.MeshBasicMaterial({ color, toneMapped: false })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.35 }));
    return materials.get(key);
  }
  function block(x, y, z, w, h, d, color, glow = false, group = null) {
    const mat = material(color, glow);
    if (!group) {
      const items = batches.get(mat) || []; items.push({ x, y, z, w, h, d }); batches.set(mat, items);
      return null;
    }
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); group.add(mesh); return mesh;
  }
  function label(text, sub, color = '#ffae68', w = 3.4, h = 1.5) {
    const surface = document.createElement('canvas'); surface.width = 768; surface.height = 320;
    const ctx = surface.getContext('2d');
    ctx.fillStyle = '#10232a'; ctx.fillRect(0, 0, 768, 320);
    ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.strokeRect(10, 10, 748, 300);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = '700 82px sans-serif'; ctx.fillText(text, 384, 148);
    ctx.fillStyle = '#bfd2d7'; ctx.font = '26px monospace'; ctx.fillText(sub, 384, 229);
    const texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const mat = new THREE.MeshBasicMaterial({ map: texture }); materials.set(texture.uuid, mat);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }
  function ring(x, z, radius, color, y = 0.065) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 0.055, radius, 56), material(color, true));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); scene.add(mesh); return mesh;
  }
  function line(points, color, radius = 0.045) {
    const path = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, 32, radius, 5, false), material(color, true));
    scene.add(mesh); return mesh;
  }

  block(0, -0.6, -10, 36, 1, 67, '#111f28');
  block(0, -0.025, -9, 7, 0.08, 61, '#1a303a');
  block(0, -0.018, -6, 34, 0.085, 6, '#1a303a');
  for (let z = 17; z > -37; z -= 2.8) {
    block(0, 0.025, z, 0.06, 0.015, 1.2, '#829391');
    block(-3.6, 0.02, z, 0.1, 0.08, 2.3, '#748c8e');
    block(3.6, 0.02, z, 0.1, 0.08, 2.3, '#748c8e');
  }
  for (let x = -2.8; x <= 2.8; x += 0.75) block(x, 0.035, -2, 0.45, 0.025, 2.1, '#667e83');
  const litWindows = ['#9b623f', '#55a5a5', '#bea174', '#355363'];
  for (let row = 0; row < 8; row++) {
    for (const side of [-1, 1]) {
      const z = 14 - row * 7.2;
      const height = 3.7 + ((row * 7 + (side + 1) * 3) % 9) * 0.58;
      const x = side * (7.4 + (row % 2) * 0.4);
      const color = side < 0 ? '#30434b' : '#243944';
      block(x, height / 2, z, 5.2, height, 5.6, color);
      block(x, height + 0.16, z, 5.5, 0.32, 5.9, '#192b33');
      block(x + side * 0.6, height + 0.58, z + 0.2, 1.4, 0.8, 1.3, '#465a61');
      block(x - 0.9, height + 0.9, z - 1.1, 0.05, 1.8, 0.05, '#879793');
      block(x - side * 2.67, 0.85, z, 0.2, 1.7, 5.8, '#152b33');
      block(x, 2.05, z + 2.84, 4.8, 0.14, 0.15, row % 3 ? '#73c7ca' : '#ffc086', true);
      for (let floor = 2.8; floor < height - 0.3; floor += 1.1) {
        for (let window = 0; window < 5; window++) {
          const shade = litWindows[(row * 3 + window + Math.round(floor)) % 4];
          block(x - 1.7 + window * 0.85, floor, z + 2.82, 0.43, 0.48, 0.03, shade, true);
          block(x - side * 2.62, floor, z - 1.8 + window * 0.85, 0.03, 0.48, 0.4, shade, true);
        }
      }
      const names = side < 0 ? ['夜间补给', '慢一点', '声 巷', '明日仓库', '冷静中转'] : ['欲望百货', 'OPEN LATE', '试听所', '七日轨道', '先放一放'];
      if (row < 5) {
        const sign = label(names[row], `DISTRICT ${String(row + 1).padStart(2, '0')} / 让你花个爽！`, row % 2 ? '#82dfd9' : '#ffd19a');
        sign.position.set(x, 1.18, z + 2.88); scene.add(sign);
      }
    }
  }
  // Distant skyline, repeated as instances rather than individual draw calls.
  for (let i = 0; i < 24; i++) {
    const x = (i % 2 ? -1 : 1) * (13 + (i % 3) * 3.1), z = 10 - Math.floor(i / 2) * 5;
    const h = 8 + (i * 7 % 13);
    block(x, h / 2, z, 3, h, 4, '#18303e');
    block(x, h + 0.1, z, 3.05, 0.15, 4.05, '#376574', true);
  }
  for (let z = 11; z > -30; z -= 8) {
    for (const x of [-3.8, 3.8]) {
      block(x, 1.4, z, 0.08, 2.8, 0.08, '#708388');
      block(x, 2.85, z, 0.8, 0.1, 0.24, '#ffe3aa', true);
    }
    line([[-5, 6, z], [0, 5.2, z], [5, 6, z]], '#364e58', 0.02);
  }
  const route = line(TRACK_NODES.map((p) => [p.x + 1.1, 0.13, p.z]), '#ffac61', 0.055);
  const calmRoute = line([[1.1, 0.13, -11], [1.1, 0.13, -18], [1.1, 0.13, -26]], '#548b91', 0.055);
  const nodeRings = TRACK_NODES.slice(1).map((p) => ring(p.x, p.z, 0.62, '#ffb36d'));
  ring(0, -11, 2.5, '#d1a16b'); ring(0, -18, 2.9, '#569caa'); ring(0, -25, 2.5, '#59aca5');
  const gantry = new THREE.Group(); scene.add(gantry);
  block(-2.5, 2.5, -11.5, 0.2, 5, 0.2, '#607781', false, gantry);
  block(2.5, 2.5, -11.5, 0.2, 5, 0.2, '#607781', false, gantry);
  block(0, 5, -11.5, 5.2, 0.25, 0.25, '#ffa769', true, gantry);
  const audioSign = label('声 音 以 外', 'AUDIO / SIGNAL SOURCE', '#ffd29c', 4, 1.3);
  audioSign.position.set(0, 5.95, -11.5); scene.add(audioSign);
  const billboard = new THREE.Group(); billboard.position.set(-5.5, 5, -9.3); scene.add(billboard);
  block(0, 0, 0, 3.8, 4.1, 0.3, '#667d83', false, billboard);
  const loader = new THREE.TextureLoader();
  function imagePlane(url, group, width, height, y, z) {
    const tex = loader.load(url, () => { if (!disposed) { resize(); draw(); } }, undefined, () => {});
    tex.colorSpace = THREE.SRGBColorSpace; textures.add(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex }); materials.set(tex.uuid, mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    plane.position.set(0, y, z); group.add(plane); return plane;
  }
  imagePlane('./assets/figma-commerce-20260901/shop-30-977/raw-image-12.jpeg', billboard, 3.45, 3.7, 0, 0.17);
  const conveyor = new THREE.Group(); scene.add(conveyor);
  block(0, 0.4, -25, 3.4, 0.7, 5, '#2a505a', false, conveyor);
  for (let z = -27.2; z <= -22.8; z += 0.43) block(0, 0.79, z, 3, 0.13, 0.27, '#7a9798', false, conveyor);
  block(-1.8, 1, -25, 0.14, 0.14, 5.2, '#8bf2d4', true, conveyor);
  block(1.8, 1, -25, 0.14, 0.14, 5.2, '#8bf2d4', true, conveyor);
  const transit = label('冷 静 中 转', 'TAKE YOUR TIME', '#9aecd1', 3.4, 1.3);
  transit.position.set(0, 3.6, -27.3); scene.add(transit);
  block(0, 0.4, -18, 4.8, 0.7, 3, '#344d58');
  for (let i = 0; i < 7; i++) block(-1.9 + i * 0.64, 0.8, -18, 0.44, 0.07, 2.7, '#62bcc4', true);

  const probe = new THREE.Group(); scene.add(probe);
  const probeLight = new THREE.PointLight('#94f4d5', 18, 7, 2); probeLight.position.set(0, 1.6, 0); probe.add(probeLight);
  const signalLight = new THREE.PointLight('#ffb46b', 35, 14, 2); signalLight.position.set(0, 3.5, -11); scene.add(signalLight);
  block(0, 0.52, 0, 0.66, 0.48, 0.85, '#c3d0cb', false, probe);
  block(0, 0.9, -0.02, 0.5, 0.38, 0.43, '#e3e4ce', false, probe);
  imagePlane('./assets/phone-raccoon.webp', probe, 0.43, 0.32, 0.91, 0.22);
  for (const x of [-0.37, 0.37]) for (const z of [-0.24, 0.24]) {
    block(x, 0.25, z, 0.13, 0.28, 0.22, '#11252d', false, probe);
    block(x * 0.8, 0.62, z, 0.055, 0.08, 0.16, '#8df6dc', true, probe);
  }
  block(0, 1.25, -0.12, 0.035, 0.25, 0.035, '#bad2cf', false, probe);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), material('#9efadc', true));
  beacon.position.set(0, 1.42, -0.12); probe.add(beacon);
  const drone = new THREE.Group(); scene.add(drone);
  block(0, 0, 0, 0.65, 0.2, 0.4, '#ffb76c', true, drone);
  for (const x of [-0.5, 0.5]) block(x, 0.06, 0, 0.5, 0.03, 0.38, '#4c747c', false, drone);
  const halo = ring(0, 8, 0.52, '#9afde1');
  const matrix = new THREE.Matrix4();
  for (const [mat, items] of batches) {
    const mesh = new THREE.InstancedMesh(boxGeometry, mat, items.length);
    items.forEach((b, index) => {
      matrix.makeScale(b.w, b.h, b.d); matrix.setPosition(b.x, b.y, b.z); mesh.setMatrixAt(index, matrix);
    });
    scene.add(mesh);
  }

  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, quality));
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = rect.width / Math.max(1, rect.height); camera.updateProjectionMatrix();
  }
  function project(x, y, z) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return { x: (p.x + 1) * 0.5, y: (1 - p.y) * 0.5 };
  }
  function draw() {
    if (disposed) return;
    probe.position.copy(position); halo.position.set(position.x, 0.09, position.z);
    const next = TRACK_NODES[Math.min((state?.node || 0) + 1, 3)];
    drone.position.set(next.x, 2.25 + (reduced ? 0 : Math.sin(elapsed * 1.8) * 0.13), next.z);
    drone.visible = state?.phase === 'track';
    camera.lookAt(cameraAim);
    try { renderer.render(scene, camera); } catch { stop(); onFailure(); return; }
    onFrame({ waypoint: project(next.x, 2.45, next.z), probe: project(position.x, 1.1, position.z),
      position: { x: position.x, z: position.z }, viewYaw, viewPitch, moving,
      manual: Boolean(movement.strafe || movement.forward), drawCalls: renderer.info.render.calls, quality });
  }
  function stop() { if (frameId !== null) cancelAnimationFrame(frameId); frameId = null; }
  function tick(at) {
    frameId = null; if (disposed || suspended) return;
    const delta = lastAt ? Math.min((at - lastAt) / 1000, 0.06) : 0.016;
    if (lastAt && at - lastAt > 38) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && quality > 1) { quality = 1; resize(); }
    lastAt = at; elapsed += delta;
    if (state?.phase === 'track' && !reduced && (movement.strafe || movement.forward)) {
      const next = stepMissionMovement(position, movement, viewYaw, delta);
      const dx = next.x - position.x, dz = next.z - position.z;
      if (Math.hypot(dx, dz) > 0.0001) probe.rotation.y = Math.atan2(dx, dz);
      position.set(next.x, 0, next.z);
      if (reachableMissionNode(state, next) !== null) onApproach(next);
    } else if (moving) {
      moveProgress = reduced ? 1 : Math.min(1, moveProgress + delta / 1.15);
      const smooth = moveProgress * moveProgress * (3 - 2 * moveProgress);
      position.lerpVectors(start, destination, smooth);
      if (moveProgress >= 1) {
        moving = false;
        const arrived = arrivalNode; arrivalNode = null;
        if (arrived !== null) onArrive(arrived);
      }
    }
    desiredAim.set(position.x, 0.65, position.z - 2.5);
    const aspect = camera.aspect;
    const distance = aspect < 0.85 ? 1.45 : 1;
    const radius = 31.5 * distance, horizontal = Math.cos(viewPitch) * radius;
    cameraTarget.set(desiredAim.x + Math.sin(viewYaw) * horizontal,
      desiredAim.y + Math.sin(viewPitch) * radius, desiredAim.z + Math.cos(viewYaw) * horizontal);
    const blend = reduced ? 1 : 1 - Math.exp(-delta * 4.5);
    camera.position.lerp(cameraTarget, blend); cameraAim.lerp(desiredAim, blend);
    draw();
    if (!disposed && (!reduced || moving)) frameId = requestAnimationFrame(tick);
  }
  function wake() {
    if (!disposed && !suspended && frameId === null) { lastAt = 0; frameId = requestAnimationFrame(tick); }
  }
  function setState(next, { reducedMotion = false } = {}) {
    const previous = state; state = next; reduced = reducedMotion;
    let target = null;
    if (state.phase === 'track') {
      if (!previous || previous.phase !== 'track') {
        const anchor = TRACK_NODES[state.node]; position.set(anchor.x, 0, anchor.z);
        moving = false; arrivalNode = null; movement = { strafe: 0, forward: 0 }; viewYaw = 0; viewPitch = 0.77;
      }
      if (state.destination !== null && previous?.destination !== state.destination) {
        target = TRACK_NODES[state.destination]; arrivalNode = state.destination;
        movement = { strafe: 0, forward: 0 };
      } else if (state.destination === null) {
        moving = false; arrivalNode = null;
      }
    } else if (!previous || previous.phase !== state.phase) {
      target = { x: 0, z: state.phase === 'peel' ? -11 : state.phase === 'trial' ? -18 : -25 };
      arrivalNode = null; movement = { strafe: 0, forward: 0 }; viewYaw = 0.35; viewPitch = 0.77; probe.rotation.y = 0;
    }
    if (target) {
      start.copy(position); destination.set(target.x, 0, target.z); moveProgress = 0;
      moving = start.distanceTo(destination) > 0.01 || arrivalNode !== null;
      if (reduced) { position.copy(destination); }
    }
    const calm = state.phase === 'done';
    route.material = material(calm ? '#6bd9c5' : '#ffac61', true);
    calmRoute.material = material(calm ? '#9bf7d9' : '#548b91', true);
    billboard.visible = !calm;
    nodeRings.forEach((mesh, i) => { mesh.material = material(i < state.node || calm ? '#84e8d1' : '#ffb36d', true); });
    quality = reduced ? 1 : quality; resize(); wake();
  }
  function setMovement(input = {}) {
    if (disposed || reduced || state?.phase !== 'track') return false;
    movement = { strafe: input.strafe || 0, forward: input.forward || 0 };
    if (movement.strafe || movement.forward) { moving = false; arrivalNode = null; }
    wake(); return true;
  }
  function lookBy(dx, dy) {
    if (disposed || reduced || state?.phase !== 'track' || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;
    viewYaw = Math.max(-1.25, Math.min(1.25, viewYaw - dx * 0.004));
    viewPitch = Math.max(0.66, Math.min(1.1, viewPitch + dy * 0.003));
    wake(); return true;
  }
  function setPaused(value) { suspended = value; if (value) { movement = { strafe: 0, forward: 0 }; stop(); } else wake(); }
  function destroy() {
    disposed = true; stop();
    const geometries = new Set(); scene.traverse((o) => { if (o.geometry) geometries.add(o.geometry); });
    geometries.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose());
    // This canvas is reused on re-entry. Clear unpack flags before a new renderer
    // allocates its fallback textures on the same WebGL context.
    const context = renderer.getContext();
    if (!context.isContextLost()) {
      context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
      context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    renderer.dispose();
  }
  resize();
  return { setState, setPaused, setMovement, lookBy, resize: () => { resize(); wake(); }, destroy,
    getDiagnostics: () => ({ rafActive: frameId !== null, moving, movement: { ...movement },
      position: { x: position.x, z: position.z }, viewYaw, viewPitch, quality, drawCalls: renderer.info.render.calls }) };
}
