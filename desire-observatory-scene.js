import * as THREE from './assets/vendor/three/three.module.min.js';

const QUALITY_DPR = Object.freeze({ full: 1.6, balanced: 1.2, essential: 1 });
const ACTIVE_EXHIBIT_RANGE = Object.freeze({ full: 1, balanced: 1, essential: 0 });
const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function signedRelativeIndex(index, selectedIndex, total) {
  if (total <= 1) return 0;
  let difference = index - selectedIndex;
  const half = total / 2;
  if (difference > half) difference -= total;
  if (difference < -half) difference += total;
  return difference;
}

function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRadialTexture({ center = '#fff6dd', middle = '#ff6238', edge = 'rgba(255,98,56,0)' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 126);
  gradient.addColorStop(0, center);
  gradient.addColorStop(0.16, middle);
  gradient.addColorStop(1, edge);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createLineTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#090708';
  context.fillRect(0, 0, 512, 512);
  context.strokeStyle = 'rgba(255, 117, 70, .24)';
  context.lineWidth = 2;
  for (let line = -512; line < 1024; line += 52) {
    context.beginPath();
    context.moveTo(line, 512);
    context.lineTo(line + 512, 0);
    context.stroke();
  }
  context.strokeStyle = 'rgba(255, 234, 203, .07)';
  context.lineWidth = 1;
  for (let line = 0; line <= 512; line += 64) {
    context.beginPath();
    context.moveTo(0, line);
    context.lineTo(512, line);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSignalLabelTexture(signal, index) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 240;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(9, 8, 11, .92)';
  context.fillRect(6, 6, canvas.width - 12, canvas.height - 12);
  context.strokeStyle = 'rgba(255, 133, 73, .9)';
  context.lineWidth = 5;
  context.strokeRect(8.5, 8.5, canvas.width - 17, canvas.height - 17);
  context.strokeStyle = 'rgba(255, 190, 111, .22)';
  context.lineWidth = 1;
  for (let x = 36; x < canvas.width; x += 52) {
    context.beginPath();
    context.moveTo(x, 12);
    context.lineTo(x, canvas.height - 12);
    context.stroke();
  }
  context.fillStyle = '#ffb15e';
  context.font = '600 28px ui-monospace, monospace';
  context.letterSpacing = '4px';
  context.fillText(`0${index + 1} / ${String(signal?.code || 'SIGNAL')}`, 34, 58);
  context.fillStyle = '#fff3df';
  context.font = '700 76px "Songti SC", "STSong", serif';
  context.fillText(String(signal?.label || '催促声').slice(0, 6), 34, 158);
  context.fillStyle = 'rgba(255, 232, 200, .48)';
  context.font = '500 22px ui-monospace, monospace';
  context.fillText('TOUCH TO POWER DOWN', 36, 207);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function setMaterialOpacity(material, opacity) {
  if (!material || material.userData.ignoreFade) return;
  const baseOpacity = Number.isFinite(material.userData.baseOpacity)
    ? material.userData.baseOpacity
    : (Number.isFinite(material.opacity) ? material.opacity : 1);
  material.userData.baseOpacity = baseOpacity;
  material.transparent = true;
  material.opacity = baseOpacity * opacity;
  material.depthWrite = material.opacity > 0.72;
}

function disposeObject(root) {
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => material.dispose?.());
  });
}

function createPortalArc(radius, color, opacity, z, rotation = 0) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius * 0.72, 0, Math.PI, false, 0);
  const points = curve.getPoints(96).map((point) => new THREE.Vector3(point.x, point.y, 0));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending });
  material.userData.baseOpacity = opacity;
  const line = new THREE.Line(geometry, material);
  line.position.set(0, -1.86, z);
  line.rotation.z = rotation;
  return line;
}

function createArchitecture() {
  const root = new THREE.Group();
  root.name = 'original-desire-arcade';

  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x0b090a });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(34, 18), wallMaterial);
  wall.position.set(0, 2.5, -8.5);
  root.add(wall);

  const floorTexture = createLineTexture();
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: 0x171014,
    map: floorTexture,
    metalness: 0.72,
    roughness: 0.28,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(38, 24), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -2.13, -2.5);
  root.add(floor);

  const railMaterial = new THREE.MeshBasicMaterial({ color: 0xff6d43, transparent: true, opacity: 0.3 });
  railMaterial.userData.baseOpacity = 0.3;
  [-5.4, -4.8, 4.8, 5.4].forEach((x, index) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(index % 2 ? 0.025 : 0.055, 8.6, 0.025), railMaterial.clone());
    rail.position.set(x, 1.25, -5.8 + (index % 2) * 0.2);
    root.add(rail);
  });

  const coolingPortal = new THREE.Group();
  coolingPortal.name = 'cooling-portal';
  const warningArc = createPortalArc(4.2, 0xff6d43, 0.52, -4.8);
  const guideArc = createPortalArc(4.95, 0xffc36a, 0.22, -5.3, 0.025);
  const calmArc = createPortalArc(5.65, 0x70ded4, 0.08, -5.8, -0.018);
  const gateMaterial = new THREE.MeshBasicMaterial({
    color: 0x70ded4,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  gateMaterial.userData.baseOpacity = 0.16;
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(7.1, 4.6), gateMaterial);
  gate.position.set(0, 0.22, -6.15);
  const gateGlowTexture = createRadialTexture({ center: '#efffff', middle: '#70ded4', edge: 'rgba(112,222,212,0)' });
  const gateGlowMaterial = new THREE.SpriteMaterial({
    map: gateGlowTexture,
    color: 0x70ded4,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  gateGlowMaterial.userData.baseOpacity = 0.5;
  const gateGlow = new THREE.Sprite(gateGlowMaterial);
  gateGlow.position.set(0, 0.1, -5.95);
  gateGlow.scale.set(9.5, 5.4, 1);
  const pylonMaterial = new THREE.MeshStandardMaterial({
    color: 0x17191a,
    emissive: 0x163735,
    emissiveIntensity: 0.15,
    metalness: 0.88,
    roughness: 0.22,
  });
  [-3.9, 3.9].forEach((x) => {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.13, 7.1, 0.18), pylonMaterial.clone());
    pylon.position.set(x, 0.72, -5.7);
    coolingPortal.add(pylon);
  });
  coolingPortal.add(warningArc, guideArc, calmArc, gate, gateGlow);
  root.add(coolingPortal);

  const canopyMaterial = new THREE.MeshBasicMaterial({ color: 0xff7549, transparent: true, opacity: 0.12 });
  canopyMaterial.userData.baseOpacity = 0.12;
  for (let index = -5; index <= 5; index += 1) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 18), canopyMaterial.clone());
    strip.position.set(index * 1.2, 4.65, -2.5);
    strip.rotation.x = 0.06;
    root.add(strip);
  }

  const random = seededRandom(9031);
  const particleCount = 220;
  const positions = new Float32Array(particleCount * 3);
  for (let index = 0; index < particleCount; index += 1) {
    positions[index * 3] = (random() - 0.5) * 22;
    positions[index * 3 + 1] = random() * 9 - 2;
    positions[index * 3 + 2] = random() * -13 + 2;
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMaterial = new THREE.PointsMaterial({
    color: 0xffa56b,
    size: 0.035,
    transparent: true,
    opacity: 0.52,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  particleMaterial.userData.baseOpacity = 0.52;
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.name = 'ambient-particles';
  root.add(particles);

  const glowTexture = createRadialTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xff6940,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  glowMaterial.userData.baseOpacity = 0.24;
  const horizonGlow = new THREE.Sprite(glowMaterial);
  horizonGlow.position.set(0, -0.35, -6.8);
  horizonGlow.scale.set(14, 8, 1);
  root.add(horizonGlow);

  return {
    root,
    floorTexture,
    particles,
    horizonGlow,
    coolingPortal: { root: coolingPortal, warningArc, guideArc, calmArc, gate, gateGlow, gateGlowTexture },
  };
}

function createNoiseBands() {
  const root = new THREE.Group();
  const bands = [];
  const random = seededRandom(6227);
  const colors = [0xff4f38, 0xff9c55, 0x7de6dc];
  for (let bandIndex = 0; bandIndex < 3; bandIndex += 1) {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: colors[bandIndex],
      transparent: true,
      opacity: 0.56 - bandIndex * 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    material.userData.baseOpacity = material.opacity;
    for (let index = 0; index < 12; index += 1) {
      const shard = new THREE.Mesh(
        new THREE.PlaneGeometry(0.08 + random() * 0.4, 0.01 + random() * 0.035),
        material,
      );
      const angle = random() * TAU;
      const radius = 2.2 + random() * 4.8;
      shard.position.set(Math.cos(angle) * radius, random() * 5.2 - 1.8, -0.4 - random() * 4.6);
      shard.rotation.z = angle + random() * 0.4;
      shard.userData.phase = random() * TAU;
      shard.userData.speed = 0.45 + random() * 0.8;
      group.add(shard);
    }
    bands.push({ group, material });
    root.add(group);
  }
  return { root, bands };
}

function createSignalTower(signal, index) {
  const root = new THREE.Group();
  root.name = `signal-tower-${signal?.id || index}`;

  const warning = new THREE.Color(index === 1 ? 0xffa14f : 0xff6844);
  const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d1517,
    emissive: warning,
    emissiveIntensity: 0.08,
    metalness: 0.9,
    roughness: 0.2,
    transparent: true,
  });
  metalMaterial.userData.baseOpacity = 0.98;
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: warning,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  glowMaterial.userData.baseOpacity = 0.9;

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 1.55, 8), metalMaterial.clone());
  mast.position.y = -0.56;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.08, 20), metalMaterial.clone());
  foot.position.y = -1.34;
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), glowMaterial.clone());
  core.position.y = -0.02;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.018, 6, 48), glowMaterial.clone());
  ring.position.y = -0.02;
  ring.rotation.x = Math.PI / 2;

  const labelTexture = createSignalLabelTexture(signal, index);
  const labelMaterial = new THREE.SpriteMaterial({
    map: labelTexture,
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: false,
  });
  labelMaterial.userData.baseOpacity = 1;
  const labelFrame = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.72, 0.06), metalMaterial.clone());
  labelFrame.position.y = 0.56;
  const label = new THREE.Sprite(labelMaterial);
  label.position.set(0, 0.56, 0.075);
  label.scale.set(1.62, 0.61, 1);
  label.renderOrder = 20;

  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    colorWrite: false,
  });
  const hitTarget = new THREE.Mesh(new THREE.PlaneGeometry(2.05, 1.35), hitMaterial);
  hitTarget.position.set(0, 0.25, 0.09);
  hitTarget.userData.signalId = signal?.id || '';
  hitTarget.name = `signal-hit-${signal?.id || index}`;

  const beaconTexture = createRadialTexture({ center: '#fff8dc', middle: `#${warning.getHexString()}` });
  const beaconMaterial = new THREE.SpriteMaterial({
    map: beaconTexture,
    color: warning,
    transparent: true,
    opacity: 0.56,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  beaconMaterial.userData.baseOpacity = 0.56;
  const beacon = new THREE.Sprite(beaconMaterial);
  beacon.position.y = -0.02;
  beacon.scale.set(1.18, 1.18, 1);

  root.add(mast, foot, core, ring, labelFrame, label, hitTarget, beacon);
  const materials = [];
  root.traverse((object) => {
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter((material) => material && material !== hitMaterial).forEach((material) => materials.push(material));
  });
  root.userData = {
    signalId: signal?.id || '',
    signal,
    index,
    label,
    core,
    ring,
    beacon,
    hitTarget,
    materials,
    ownedTextures: [labelTexture, beaconTexture],
    dismissed: false,
  };
  return root;
}

function signalTowerLayout(index, aspect) {
  const desktop = [
    [-3.15, 1.48, 0.55],
    [3.18, 1.02, 0.22],
    [2.82, -1.2, 0.58],
  ];
  const tablet = [
    [-2.5, 1.55, 0.62],
    [2.52, 1.28, 0.5],
    [2.35, -1.22, 0.72],
  ];
  const mobile = [
    [-1.48, 1.65, 0.72],
    [1.5, 1.35, 0.68],
    [1.43, -1.38, 0.84],
  ];
  const layout = aspect < 0.95 ? mobile : (aspect < 1.3 ? tablet : desktop);
  return layout[index] || [0, 0, 0];
}

function resolveImageUrl(value) {
  try {
    return new URL(String(value || ''), globalThis.document?.baseURI || globalThis.location?.href || import.meta.url).href;
  } catch {
    return '';
  }
}

function createExhibit(product, textureLoader, textureCache, maxAnisotropy) {
  const root = new THREE.Group();
  const panel = new THREE.Group();
  root.add(panel);

  const accent = Array.isArray(product?.accent) ? product.accent : [1, 0.43, 0.25];
  const accentColor = new THREE.Color(accent[0], accent[1], accent[2]);
  const frameMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x211717,
    metalness: 0.78,
    roughness: 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.34, 3.52, 0.2), frameMaterial);
  frame.position.y = 0.06;
  panel.add(frame);

  const imageMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
  imageMaterial.userData.baseOpacity = 1;
  const image = new THREE.Mesh(new THREE.PlaneGeometry(3.08, 3.08), imageMaterial);
  image.position.set(0, 0.1, 0.112);
  panel.add(image);

  const imageUrl = resolveImageUrl(product?.image);
  let productTexture = null;
  if (imageUrl) {
    let texture = textureCache.get(imageUrl);
    if (!texture) {
      texture = textureLoader.load(imageUrl, (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.anisotropy = maxAnisotropy;
        loaded.needsUpdate = true;
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      textureCache.set(imageUrl, texture);
    }
    imageMaterial.map = texture;
    productTexture = texture;
  } else {
    imageMaterial.color.copy(accentColor);
  }

  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffeee0,
    transparent: true,
    opacity: 0.075,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  glassMaterial.userData.baseOpacity = 0.075;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.14, 3.14), glassMaterial);
  glass.position.set(0, 0.1, 0.125);
  panel.add(glass);

  const edgeMaterial = new THREE.LineBasicMaterial({ color: accentColor, transparent: true, opacity: 0.72 });
  edgeMaterial.userData.baseOpacity = 0.72;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(frame.geometry), edgeMaterial);
  edges.position.copy(frame.position);
  panel.add(edges);

  const haloTexture = createRadialTexture({ center: '#fff7e4', middle: `#${accentColor.getHexString()}` });
  const haloMaterial = new THREE.SpriteMaterial({
    map: haloTexture,
    color: accentColor,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  haloMaterial.userData.baseOpacity = 0.42;
  const halo = new THREE.Sprite(haloMaterial);
  halo.position.set(0, 0.08, -0.28);
  halo.scale.set(5.6, 5.6, 1);
  panel.add(halo);

  const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x2a1718, metalness: 0.82, roughness: 0.2 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.68, 0.22, 64), plinthMaterial);
  plinth.position.set(0, -1.96, 0.05);
  root.add(plinth);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    transparent: true,
    opacity: 0.62,
    blending: THREE.AdditiveBlending,
  });
  ringMaterial.userData.baseOpacity = 0.62;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.022, 8, 96), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, -1.83, 0.05);
  root.add(ring);

  const reflectionMaterial = new THREE.MeshBasicMaterial({
    color: accentColor,
    map: productTexture,
    transparent: true,
    opacity: productTexture ? 0.11 : 0.035,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  reflectionMaterial.userData.baseOpacity = reflectionMaterial.opacity;
  const reflection = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 3.6), reflectionMaterial);
  reflection.rotation.x = -Math.PI / 2;
  reflection.rotation.z = Math.PI;
  reflection.position.set(0, -2.115, -0.2);
  root.add(reflection);

  root.userData = { productId: product?.id, product, panel, halo, ring, reflection, materials: [], ownedTextures: [haloTexture] };
  root.traverse((object) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => root.userData.materials.push(material));
  });
  return root;
}

export function createObservatoryScene(canvas, { devicePixelRatio = globalThis.devicePixelRatio || 1 } = {}) {
  if (!canvas) throw new TypeError('观察橱窗需要 Canvas');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  const noisyColor = new THREE.Color(0x110708);
  const calmColor = new THREE.Color(0x06100f);
  scene.background = noisyColor.clone();
  scene.fog = new THREE.FogExp2(0x10090a, 0.082);

  const camera = new THREE.PerspectiveCamera(41, 1, 0.1, 60);
  camera.position.set(0, 0.72, 8.7);

  const hemisphere = new THREE.HemisphereLight(0xffdfbd, 0x13060a, 2.4);
  const keyLight = new THREE.PointLight(0xff7748, 48, 18, 1.7);
  keyLight.position.set(-4.6, 3.8, 4.5);
  const rimLight = new THREE.PointLight(0x68dcd2, 34, 18, 1.8);
  rimLight.position.set(4.8, 1.6, 0.4);
  scene.add(hemisphere, keyLight, rimLight);

  const architecture = createArchitecture();
  scene.add(architecture.root);
  const noise = createNoiseBands();
  scene.add(noise.root);

  const exhibitRail = new THREE.Group();
  exhibitRail.name = 'product-exhibit-rail';
  scene.add(exhibitRail);

  const signalRail = new THREE.Group();
  signalRail.name = 'interactive-signal-towers';
  scene.add(signalRail);

  const textureLoader = new THREE.TextureLoader();
  const textureCache = new Map();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let exhibits = [];
  let signalTowers = [];
  let productsSignature = '';
  let signalsSignature = '';
  let selectedIndex = 0;
  let lastSelectedIndex = 0;
  let hoveredSignalId = null;
  let cameraKick = 0;
  let lastFrameAt = 0;
  let quality = 'full';
  let width = 1;
  let height = 1;
  let dpr = 1;
  let destroyed = false;

  function rebuildExhibits(products = []) {
    const nextSignature = products.map((product) => `${product?.id}:${product?.image || ''}`).join('|');
    if (nextSignature === productsSignature) return;
    exhibits.forEach((exhibit) => {
      exhibitRail.remove(exhibit);
      exhibit.userData.ownedTextures?.forEach((texture) => texture.dispose?.());
      disposeObject(exhibit);
    });
    exhibits = products.map((product) => createExhibit(product, textureLoader, textureCache, maxAnisotropy));
    exhibits.forEach((exhibit) => exhibitRail.add(exhibit));
    productsSignature = nextSignature;
  }

  function rebuildSignalTowers(signals = []) {
    const nextSignature = signals.map((signal) => `${signal?.id}:${signal?.label}:${signal?.code}`).join('|');
    if (nextSignature === signalsSignature) return;
    signalTowers.forEach((tower) => {
      signalRail.remove(tower);
      tower.userData.ownedTextures?.forEach((texture) => texture.dispose?.());
      disposeObject(tower);
    });
    signalTowers = signals.map((signal, index) => createSignalTower(signal, index));
    signalTowers.forEach((tower) => signalRail.add(tower));
    signalsSignature = nextSignature;
    hoveredSignalId = null;
  }

  function setQuality(nextQuality) {
    quality = Object.hasOwn(QUALITY_DPR, nextQuality) ? nextQuality : 'full';
    architecture.particles.visible = quality !== 'essential';
    renderer.setPixelRatio(1);
    resize();
  }

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect?.() || { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    const nextWidth = Math.max(1, Math.round(rect.width || 1));
    const nextHeight = Math.max(1, Math.round(rect.height || 1));
    dpr = clamp(Number(devicePixelRatio) || 1, 1, QUALITY_DPR[quality]);
    if (nextWidth !== width || nextHeight !== height || canvas.width !== Math.round(nextWidth * dpr)) {
      width = nextWidth;
      height = nextHeight;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.fov = camera.aspect < 0.75 ? 50 : 41;
      camera.updateProjectionMatrix();
    }
  }

  function animateNoise(time, dismissedCount, reducedMotion) {
    noise.bands.forEach((band, index) => {
      const active = index >= dismissedCount;
      const targetOpacity = active ? (0.54 - index * 0.08) : 0.025;
      band.material.opacity += (targetOpacity - band.material.opacity) * 0.1;
      band.group.children.forEach((shard) => {
        if (reducedMotion) return;
        const phase = shard.userData.phase + time * shard.userData.speed;
        shard.position.x += Math.sin(phase) * 0.0018 * (3 - dismissedCount);
        shard.position.y += Math.cos(phase * 0.7) * 0.0012 * (3 - dismissedCount);
        shard.scale.x = 0.7 + Math.sin(phase * 1.4) * 0.28;
      });
    });
  }

  function animateExhibits({ products, time, delta, reducedMotion }) {
    const range = ACTIVE_EXHIBIT_RANGE[quality];
    const count = products.length;
    const response = reducedMotion ? 1 : 1 - Math.exp(-delta * 8.5);
    exhibits.forEach((exhibit, index) => {
      const relative = signedRelativeIndex(index, selectedIndex, count);
      const distance = Math.abs(relative);
      const visible = distance <= range;
      exhibit.visible = visible;
      if (!visible) return;
      const targetX = relative * (camera.aspect < 0.75 ? 3.55 : 4.9);
      const targetY = relative === 0 ? 0.12 : -0.18;
      const targetZ = relative === 0 ? 0 : -2.8 - Math.min(1, distance - 1) * 1.5;
      exhibit.position.x = THREE.MathUtils.lerp(exhibit.position.x, targetX, response);
      exhibit.position.y = THREE.MathUtils.lerp(exhibit.position.y, targetY, response);
      exhibit.position.z = THREE.MathUtils.lerp(exhibit.position.z, targetZ, response);
      const targetScale = relative === 0 ? 1 : 0.68;
      const nextScale = THREE.MathUtils.lerp(exhibit.scale.x, targetScale, response);
      exhibit.scale.setScalar(nextScale);
      exhibit.rotation.y = THREE.MathUtils.lerp(exhibit.rotation.y, -relative * 0.43, response);
      const opacity = relative === 0 ? 1 : 0.26;
      exhibit.userData.materials.forEach((material) => setMaterialOpacity(material, opacity));

      const panel = exhibit.userData.panel;
      if (relative === 0) {
        panel.rotation.x = THREE.MathUtils.lerp(panel.rotation.x, 0, response);
        panel.rotation.y = THREE.MathUtils.lerp(panel.rotation.y, 0, response);
        panel.position.y = 0;
        exhibit.userData.ring.rotation.z = reducedMotion ? 0 : time * 0.08;
      } else {
        panel.rotation.x = THREE.MathUtils.lerp(panel.rotation.x, 0, response);
        panel.rotation.y = THREE.MathUtils.lerp(panel.rotation.y, 0, response);
        panel.position.y = 0;
      }
    });
  }

  function animateSignalTowers({ dismissedSignalIds, time, delta, reducedMotion }) {
    const dismissed = new Set(Array.isArray(dismissedSignalIds) ? dismissedSignalIds : []);
    const compact = camera.aspect < 0.95;
    const response = reducedMotion ? 1 : 1 - Math.exp(-delta * 9.5);
    signalTowers.forEach((tower, index) => {
      const layout = signalTowerLayout(index, camera.aspect);
      const isDismissed = dismissed.has(tower.userData.signalId);
      const isHovered = !isDismissed && hoveredSignalId === tower.userData.signalId;
      tower.userData.dismissed = isDismissed;
      tower.userData.hitTarget.visible = !isDismissed;
      tower.position.x = THREE.MathUtils.lerp(tower.position.x, layout[0], response);
      tower.position.y = THREE.MathUtils.lerp(
        tower.position.y,
        layout[1] + (isDismissed ? -0.22 : (!reducedMotion ? Math.sin(time * 0.9 + index * 1.7) * 0.035 : 0)),
        response,
      );
      tower.position.z = THREE.MathUtils.lerp(tower.position.z, layout[2], response);
      const baseScale = compact ? 0.64 : 0.82;
      const targetScale = baseScale * (isDismissed ? 0.72 : (isHovered ? 1.08 : 1));
      const nextScale = THREE.MathUtils.lerp(tower.scale.x, targetScale, response);
      tower.scale.setScalar(nextScale);
      const facingYaw = Math.atan2(
        camera.position.x - tower.position.x,
        camera.position.z - tower.position.z,
      );
      tower.rotation.y = THREE.MathUtils.lerp(tower.rotation.y, facingYaw, response);
      tower.userData.ring.rotation.z = reducedMotion ? 0 : time * (isDismissed ? 0.04 : 0.55 + index * 0.08);
      tower.userData.core.rotation.x = reducedMotion ? 0 : time * 0.65;
      tower.userData.core.rotation.y = reducedMotion ? 0 : time * 0.82;
      tower.userData.materials.forEach((material) => {
        const baseOpacity = Number.isFinite(material.userData.baseOpacity) ? material.userData.baseOpacity : 1;
        const targetOpacity = baseOpacity * (isDismissed ? 0.08 : (isHovered ? 1 : 0.82));
        material.transparent = true;
        material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, response);
      });
    });
  }

  function animateCoolingPortal(calm, time, delta, reducedMotion) {
    const portalReady = calm >= 2 / 3;
    const response = reducedMotion ? 1 : 1 - Math.exp(-delta * 5.5);
    const portal = architecture.coolingPortal;
    portal.warningArc.material.opacity = THREE.MathUtils.lerp(
      portal.warningArc.material.opacity,
      portalReady ? 0.08 : 0.52,
      response,
    );
    portal.guideArc.material.opacity = THREE.MathUtils.lerp(
      portal.guideArc.material.opacity,
      portalReady ? 0.12 : 0.22,
      response,
    );
    portal.calmArc.material.opacity = THREE.MathUtils.lerp(
      portal.calmArc.material.opacity,
      portalReady ? 0.82 : 0.08,
      response,
    );
    portal.gate.material.opacity = THREE.MathUtils.lerp(
      portal.gate.material.opacity,
      portalReady ? 0.13 : 0,
      response,
    );
    portal.gateGlow.material.opacity = THREE.MathUtils.lerp(
      portal.gateGlow.material.opacity,
      portalReady ? (reducedMotion ? 0.38 : 0.34 + Math.sin(time * 1.4) * 0.06) : 0,
      response,
    );
    portal.root.position.z = THREE.MathUtils.lerp(portal.root.position.z, portalReady ? 0.38 : 0, response);
  }

  function render({
    products = [],
    selectedIndex: nextSelectedIndex = 0,
    signals = [],
    dismissedSignalIds = [],
    cameraOffsetX = 0,
    cameraOffsetY = 0,
    dismissedCount = 0,
    time = 0,
    reducedMotion = false,
  } = {}) {
    if (destroyed) return { drawCalls: 0, dpr, quality };
    resize();
    rebuildExhibits(products);
    rebuildSignalTowers(signals);
    selectedIndex = clamp(Number(nextSelectedIndex) || 0, 0, Math.max(0, products.length - 1));
    if (selectedIndex !== lastSelectedIndex) {
      const directDifference = selectedIndex - lastSelectedIndex;
      cameraKick = clamp(directDifference, -1, 1) * -0.85;
      lastSelectedIndex = selectedIndex;
    }

    const seconds = Number(time) > 1000 ? Number(time) / 1000 : Number(time) || 0;
    const delta = lastFrameAt ? clamp(seconds - lastFrameAt, 0, 0.08) : 1 / 60;
    lastFrameAt = seconds;
    const calm = clamp(Number(dismissedCount) / 3, 0, 1);
    scene.background.copy(noisyColor).lerp(calmColor, calm);
    scene.fog.color.copy(scene.background);
    scene.fog.density = THREE.MathUtils.lerp(0.086, 0.066, calm);
    keyLight.intensity = THREE.MathUtils.lerp(50, 29, calm);
    rimLight.intensity = THREE.MathUtils.lerp(25, 44, calm);
    architecture.horizonGlow.material.opacity = THREE.MathUtils.lerp(0.31, 0.14, calm);
    architecture.floorTexture.offset.x = reducedMotion ? 0 : (seconds * 0.006) % 1;
    if (!reducedMotion) architecture.particles.rotation.y = seconds * 0.008;

    animateNoise(seconds, dismissedCount, reducedMotion);
    animateExhibits({ products, time: seconds, delta, reducedMotion });
    animateSignalTowers({ dismissedSignalIds, time: seconds, delta, reducedMotion });
    animateCoolingPortal(calm, seconds, delta, reducedMotion);

    const response = reducedMotion ? 1 : 1 - Math.exp(-delta * 7.5);
    cameraKick = THREE.MathUtils.lerp(cameraKick, 0, response);
    const parallaxX = clamp(Number(cameraOffsetY) || 0, -0.92, 0.92) * 0.92;
    const parallaxY = clamp(Number(cameraOffsetX) || 0, -0.52, 0.52) * -0.72;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, cameraKick + parallaxX, response);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.72 + parallaxY, response);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, calm >= 2 / 3 ? 8.35 : 8.7, response);
    camera.lookAt(parallaxX * 0.18, 0.05 + parallaxY * 0.12, -0.65);

    renderer.render(scene, camera);
    return {
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      dpr,
      quality,
    };
  }

  function pickSignal(clientX, clientY) {
    if (destroyed || !Number.isFinite(Number(clientX)) || !Number.isFinite(Number(clientY))) return null;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    pointerNdc.set(
      ((Number(clientX) - rect.left) / rect.width) * 2 - 1,
      -(((Number(clientY) - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const targets = signalTowers
      .filter((tower) => tower.visible && !tower.userData.dismissed && tower.userData.hitTarget.visible)
      .map((tower) => tower.userData.hitTarget);
    const hit = raycaster.intersectObjects(targets, false)[0];
    return hit?.object?.userData?.signalId || null;
  }

  function setHoveredSignal(signalId) {
    hoveredSignalId = signalTowers.some((tower) => (
      tower.userData.signalId === signalId && !tower.userData.dismissed
    )) ? signalId : null;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    exhibits.forEach((exhibit) => exhibit.userData.ownedTextures?.forEach((texture) => texture.dispose?.()));
    signalTowers.forEach((tower) => tower.userData.ownedTextures?.forEach((texture) => texture.dispose?.()));
    disposeObject(scene);
    textureCache.forEach((texture) => texture.dispose?.());
    architecture.floorTexture.dispose?.();
    architecture.horizonGlow.material.map?.dispose?.();
    architecture.coolingPortal.gateGlowTexture.dispose?.();
    renderer.dispose();
    textureCache.clear();
    exhibits = [];
    signalTowers = [];
  }

  resize();
  return {
    render,
    resize,
    setQuality,
    pickSignal,
    setHoveredSignal,
    destroy,
    gl: renderer.getContext(),
  };
}
