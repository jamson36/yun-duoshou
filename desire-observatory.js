export const MAX_OBSERVATORY_DPR = 1.75;
export const MAX_OBSERVATORY_VISIBLE_PRODUCTS = 3;

const TAU = Math.PI * 2;
const CONTROLLERS = new WeakMap();

const SIGNAL_LIBRARY = Object.freeze({
  urgency: Object.freeze({ id: 'urgency', label: '今晚恢复', code: 'TIME' }),
  social: Object.freeze({ id: 'social', label: '都在抢', code: 'CROWD' }),
  bundle: Object.freeze({ id: 'bundle', label: '凑单更值', code: 'BUNDLE' }),
  installment: Object.freeze({ id: 'installment', label: '每天几块', code: 'SPLIT' }),
  upgrade: Object.freeze({ id: 'upgrade', label: '一步到位', code: 'UPGRADE' }),
  reward: Object.freeze({ id: 'reward', label: '辛苦奖励', code: 'REWARD' }),
  scarcity: Object.freeze({ id: 'scarcity', label: '只剩几件', code: 'STOCK' }),
  collection: Object.freeze({ id: 'collection', label: '就差这一只', code: 'SERIES' }),
  productivity: Object.freeze({ id: 'productivity', label: '效率装备', code: 'OUTPUT' }),
});

export const OBSERVATORY_PRODUCTS = Object.freeze([
  Object.freeze({
    id: 'headphones',
    commerceProductId: 'shop-headphones',
    name: '无线降噪耳机 Air',
    amount: 1299,
    category: '数码家居',
    model: 'headphones',
    code: 'AUDIO / 01',
    accent: Object.freeze([0.84, 1, 0.25]),
    signals: Object.freeze(['installment', 'social', 'upgrade']),
  }),
  Object.freeze({
    id: 'milk-tea',
    commerceProductId: 'food-milktea',
    name: '芝士芋泥啵啵奶茶',
    amount: 22,
    category: '餐饮饮品',
    model: 'milk-tea',
    code: 'DRINK / 02',
    accent: Object.freeze([1, 0.44, 0.19]),
    signals: Object.freeze(['reward', 'bundle', 'urgency']),
  }),
  Object.freeze({
    id: 'keyboard',
    commerceProductId: 'shop-keyboard',
    name: '客制化机械键盘',
    amount: 899,
    category: '数码家居',
    model: 'keyboard',
    code: 'DESK / 03',
    accent: Object.freeze([0.44, 0.91, 0.86]),
    signals: Object.freeze(['productivity', 'upgrade', 'urgency']),
  }),
  Object.freeze({
    id: 'sneakers',
    commerceProductId: 'shop-shoes',
    name: '城市跑步鞋 Flow',
    amount: 599,
    category: '服饰美妆',
    model: 'sneakers',
    code: 'MOVE / 04',
    accent: Object.freeze([1, 0.76, 0.28]),
    signals: Object.freeze(['upgrade', 'social', 'urgency']),
  }),
  Object.freeze({
    id: 'camera',
    commerceProductId: 'shop-camera',
    name: '复古胶片相机',
    amount: 2380,
    category: '数码家居',
    model: 'camera',
    code: 'IMAGE / 05',
    accent: Object.freeze([1, 0.38, 0.2]),
    signals: Object.freeze(['installment', 'productivity', 'social']),
  }),
  Object.freeze({
    id: 'blind-box',
    commerceProductId: 'shop-blindbox',
    name: '盲盒潮玩 · 星际系列',
    amount: 239,
    category: '娱乐社交',
    model: 'blind-box',
    code: 'SERIES / 06',
    accent: Object.freeze([0.84, 1, 0.25]),
    signals: Object.freeze(['collection', 'scarcity', 'social']),
  }),
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatCny(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return '¥0';
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

export function modelForOrder(order = {}) {
  const source = `${order.name || ''} ${order.category || ''}`.toLocaleLowerCase('zh-CN');
  if (/耳机|headphone|音响|audio/.test(source)) return 'headphones';
  if (/奶茶|咖啡|饮品|饮料|tea|coffee/.test(source)) return 'milk-tea';
  if (/键盘|电脑|数码|电子|keyboard/.test(source)) return 'keyboard';
  if (/鞋|跑步|运动|sneaker|shoe/.test(source)) return 'sneakers';
  if (/相机|摄影|camera/.test(source)) return 'camera';
  if (/盲盒|潮玩|手办|玩具|blind/.test(source)) return 'blind-box';
  return 'package';
}

function signalsForOrder(order = {}) {
  const candidates = [];
  const reason = String(order.reason || '');
  const decisions = Array.isArray(order.decisionSignals) ? order.decisionSignals : [];
  if (/限时|优惠|促销/.test(reason)) candidates.push('urgency');
  if (/种草|社交|朋友/.test(reason)) candidates.push('social');
  if (/提升|工作|学习/.test(reason)) candidates.push('productivity');
  if (/情绪|奖励|无聊|嘴馋/.test(reason)) candidates.push('reward');
  decisions.forEach((decision) => {
    const key = String(decision || '').toLowerCase();
    if (/deal|coupon|discount|wait/.test(key)) candidates.push('urgency');
    if (/compare|research/.test(key)) candidates.push('upgrade');
    if (/social|ask/.test(key)) candidates.push('social');
  });
  const fallback = ['urgency', 'social', 'bundle'];
  return [...new Set([...candidates, ...fallback])].slice(0, 3);
}

function productFromOrder(order) {
  const normalized = normalizedName(order.name);
  const preset = OBSERVATORY_PRODUCTS.find((product) => normalizedName(product.name) === normalized);
  return Object.freeze({
    id: preset?.id || `order-${String(order.id || stableHash(normalized)).replace(/[^a-zA-Z0-9_-]/g, '')}`,
    commerceProductId: preset?.commerceProductId || null,
    source: 'order',
    orderId: order.id,
    name: String(order.name || '未拆封的商品').trim() || '未拆封的商品',
    amount: Number(order.amount) || 0,
    category: String(order.category || '其他'),
    model: preset?.model || modelForOrder(order),
    code: preset?.code || 'YOUR ITEM / 00',
    accent: preset?.accent || Object.freeze([0.84, 1, 0.25]),
    signals: Object.freeze(signalsForOrder(order)),
  });
}

export function selectObservatoryProducts({ orders = [], seed = 'observatory' } = {}) {
  const coolingOrders = (Array.isArray(orders) ? orders : [])
    .filter((order) => order?.status === 'cooling' && !order.demo && String(order.name || '').trim())
    .sort((left, right) => {
      const leftAt = new Date(left.updatedAt || left.createdAt || 0).getTime() || 0;
      const rightAt = new Date(right.updatedAt || right.createdAt || 0).getTime() || 0;
      return rightAt - leftAt;
    });
  const offset = OBSERVATORY_PRODUCTS.length
    ? stableHash(seed) % OBSERVATORY_PRODUCTS.length
    : 0;
  const ordered = OBSERVATORY_PRODUCTS.map((_, index) => (
    OBSERVATORY_PRODUCTS[(index + offset) % OBSERVATORY_PRODUCTS.length]
  ));
  if (!coolingOrders.length) return ordered;

  const current = productFromOrder(coolingOrders[0]);
  return [
    current,
    ...ordered.filter((product) => normalizedName(product.name) !== normalizedName(current.name)),
  ].slice(0, OBSERVATORY_PRODUCTS.length + 1);
}

export function signalsForProduct(product = {}) {
  return (Array.isArray(product.signals) ? product.signals : [])
    .map((id) => SIGNAL_LIBRARY[id])
    .filter(Boolean)
    .slice(0, 3);
}

export function nextObservatoryIndex(index, direction, total) {
  const count = Math.max(0, Number(total) || 0);
  if (!count) return 0;
  const step = Number(direction) < 0 ? -1 : 1;
  return ((Number(index) || 0) + step + count) % count;
}

export function rotationDeltaForSegment(segment, { yaw = 4.6, pitch = 3.2 } = {}) {
  const fromX = Number(segment?.from?.x);
  const fromY = Number(segment?.from?.y);
  const toX = Number(segment?.to?.x);
  const toY = Number(segment?.to?.y);
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return { x: 0, y: 0 };
  return {
    x: clamp((toY - fromY) * pitch, -0.22, 0.22),
    y: clamp((toX - fromX) * yaw, -0.32, 0.32),
  };
}

function rgbMix(left, right, amount) {
  const t = clamp(amount, 0, 1);
  return left.map((value, index) => value + (right[index] - value) * t);
}

function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Multiply(left, right) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function mat4Translation(x, y, z) {
  const out = mat4Identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

function mat4Scale(x, y, z) {
  const out = mat4Identity();
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

function mat4RotationX(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    1, 0, 0, 0,
    0, cosine, sine, 0,
    0, -sine, cosine, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotationY(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    cosine, 0, -sine, 0,
    0, 1, 0, 0,
    sine, 0, cosine, 0,
    0, 0, 0, 1,
  ]);
}

function mat4RotationZ(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return new Float32Array([
    cosine, sine, 0, 0,
    -sine, cosine, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function mat4Perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / Math.max(0.01, aspect), 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, far * near * 2 * range, 0,
  ]);
}

function composeTransform({ position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}, parent = null) {
  let matrix = mat4Translation(position[0], position[1], position[2]);
  matrix = mat4Multiply(matrix, mat4RotationX(rotation[0]));
  matrix = mat4Multiply(matrix, mat4RotationY(rotation[1]));
  matrix = mat4Multiply(matrix, mat4RotationZ(rotation[2]));
  matrix = mat4Multiply(matrix, mat4Scale(scale[0], scale[1], scale[2]));
  return parent ? mat4Multiply(parent, matrix) : matrix;
}

function createBoxGeometry() {
  const faces = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [0, 0, 1]],
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1], [0, 0, -1]],
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1], [0, 1, 0]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [0, -1, 0]],
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, 0, 0]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, 0, 0]],
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, faceIndex) => {
    const normal = face[4];
    for (let index = 0; index < 4; index += 1) {
      positions.push(...face[index]);
      normals.push(...normal);
    }
    const offset = faceIndex * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  return { positions, normals, indices };
}

function createCylinderGeometry(segments = 24) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x, -1, z, x, 1, z);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let index = 0; index < segments; index += 1) {
    const offset = index * 2;
    indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }
  const sideCount = positions.length / 3;
  positions.push(0, 1, 0);
  normals.push(0, 1, 0);
  const topCenter = sideCount;
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    positions.push(Math.cos(angle), 1, Math.sin(angle));
    normals.push(0, 1, 0);
    if (index < segments) indices.push(topCenter, topCenter + index + 1, topCenter + index + 2);
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, -1, 0);
  normals.push(0, -1, 0);
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    positions.push(Math.cos(angle), -1, Math.sin(angle));
    normals.push(0, -1, 0);
    if (index < segments) indices.push(bottomCenter, bottomCenter + index + 2, bottomCenter + index + 1);
  }
  return { positions, normals, indices };
}

function createSphereGeometry(latitudeSegments = 12, longitudeSegments = 18) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const theta = (latitude / latitudeSegments) * Math.PI;
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const phi = (longitude / longitudeSegments) * TAU;
      const x = Math.sin(theta) * Math.cos(phi);
      const y = Math.cos(theta);
      const z = Math.sin(theta) * Math.sin(phi);
      positions.push(x, y, z);
      normals.push(x, y, z);
    }
  }
  const stride = longitudeSegments + 1;
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const offset = latitude * stride + longitude;
      indices.push(offset, offset + stride, offset + 1, offset + 1, offset + stride, offset + stride + 1);
    }
  }
  return { positions, normals, indices };
}

function createTorusGeometry({ arch = false, radialSegments = 28, tubeSegments = 10 } = {}) {
  const positions = [];
  const normals = [];
  const indices = [];
  const major = 0.78;
  const tube = 0.19;
  const radialLimit = arch ? Math.PI : TAU;
  for (let radial = 0; radial <= radialSegments; radial += 1) {
    const u = (radial / radialSegments) * radialLimit;
    for (let tubular = 0; tubular <= tubeSegments; tubular += 1) {
      const v = (tubular / tubeSegments) * TAU;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      if (arch) {
        positions.push((major + tube * cv) * Math.cos(u), (major + tube * cv) * Math.sin(u), tube * sv);
        normals.push(cv * Math.cos(u), cv * Math.sin(u), sv);
      } else {
        positions.push((major + tube * cv) * Math.cos(u), tube * sv, (major + tube * cv) * Math.sin(u));
        normals.push(cv * Math.cos(u), sv, cv * Math.sin(u));
      }
    }
  }
  const stride = tubeSegments + 1;
  for (let radial = 0; radial < radialSegments; radial += 1) {
    for (let tubular = 0; tubular < tubeSegments; tubular += 1) {
      const offset = radial * stride + tubular;
      indices.push(offset, offset + stride, offset + 1, offset + 1, offset + stride, offset + stride + 1);
    }
  }
  return { positions, normals, indices };
}

function part(mesh, position, scale, tone = 'base', rotation = [0, 0, 0], emissive = 0) {
  return { mesh, position, scale, tone, rotation, emissive };
}

function keyboardParts() {
  const parts = [part('box', [0, -0.12, 0], [1.5, 0.15, 0.72], 'dark')];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const isAccent = (row === 0 && column === 7) || (row === 3 && column > 5);
      parts.push(part(
        'box',
        [-1.19 + column * 0.34, 0.12, -0.47 + row * 0.31],
        [0.135, 0.075, 0.115],
        isAccent ? 'accent' : 'light',
      ));
    }
  }
  return parts;
}

const MODEL_PARTS = Object.freeze({
  headphones: Object.freeze([
    part('arch', [0, 0.08, 0], [1.38, 1.38, 1.15], 'light'),
    part('box', [-1.02, -0.48, 0], [0.28, 0.48, 0.42], 'dark', [0, 0, -0.05]),
    part('box', [1.02, -0.48, 0], [0.28, 0.48, 0.42], 'dark', [0, 0, 0.05]),
    part('box', [-1.02, -0.48, 0.43], [0.23, 0.34, 0.08], 'accent', [0, 0, -0.05], 0.08),
    part('box', [1.02, -0.48, 0.43], [0.23, 0.34, 0.08], 'accent', [0, 0, 0.05], 0.08),
  ]),
  'milk-tea': Object.freeze([
    part('cylinder', [0, -0.05, 0], [0.72, 1.02, 0.72], 'warm'),
    part('cylinder', [0, 1.02, 0], [0.78, 0.12, 0.78], 'light'),
    part('cylinder', [0.18, 1.65, 0], [0.08, 0.72, 0.08], 'accent', [0, 0, -0.12], 0.06),
    part('sphere', [-0.28, -0.56, 0.55], [0.12, 0.12, 0.12], 'dark'),
    part('sphere', [0.06, -0.69, 0.61], [0.12, 0.12, 0.12], 'dark'),
    part('sphere', [0.34, -0.45, 0.54], [0.11, 0.11, 0.11], 'dark'),
  ]),
  keyboard: Object.freeze(keyboardParts()),
  sneakers: Object.freeze([
    part('box', [0.1, -0.68, 0], [1.42, 0.18, 0.58], 'light', [0, 0, -0.05]),
    part('box', [-0.18, -0.22, 0], [0.92, 0.35, 0.52], 'warm', [0, 0, 0.12]),
    part('box', [-0.98, 0.06, 0], [0.38, 0.66, 0.5], 'warm', [0, 0, -0.2]),
    part('box', [0.86, -0.43, 0], [0.48, 0.2, 0.54], 'accent', [0, 0, -0.08], 0.05),
    part('box', [0.13, -0.2, 0.54], [0.68, 0.055, 0.035], 'accent', [0, 0, 0.08], 0.08),
  ]),
  camera: Object.freeze([
    part('box', [0, 0, 0], [1.32, 0.82, 0.48], 'dark'),
    part('box', [-0.62, 0.78, 0], [0.38, 0.22, 0.4], 'light'),
    part('box', [0.72, 0.75, 0], [0.24, 0.12, 0.34], 'accent', [0, 0, 0], 0.07),
    part('cylinder', [0.18, -0.02, 0.73], [0.65, 0.56, 0.65], 'warm', [Math.PI / 2, 0, 0]),
    part('cylinder', [0.18, -0.02, 1.06], [0.42, 0.24, 0.42], 'accent', [Math.PI / 2, 0, 0], 0.05),
    part('sphere', [0.18, -0.02, 1.25], [0.28, 0.13, 0.28], 'dark'),
  ]),
  'blind-box': Object.freeze([
    part('box', [0, -0.05, 0], [0.88, 1.05, 0.72], 'warm'),
    part('box', [0, 1.08, 0], [0.95, 0.11, 0.78], 'dark'),
    part('box', [0, -0.04, 0.74], [0.14, 1.08, 0.03], 'accent', [0, 0, 0], 0.08),
    part('box', [0, 0.18, 0.78], [0.9, 0.12, 0.035], 'accent', [0, 0, 0], 0.08),
    part('sphere', [0, 0.18, 0.87], [0.27, 0.27, 0.08], 'light'),
  ]),
  package: Object.freeze([
    part('box', [0, -0.08, 0], [1.05, 0.86, 0.8], 'warm'),
    part('box', [0, -0.08, 0.82], [0.17, 0.87, 0.025], 'accent', [0, 0, 0], 0.07),
    part('box', [0.34, 0.18, 0.85], [0.34, 0.2, 0.03], 'light'),
  ]),
});

const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uModel;
  uniform mat4 uViewProjection;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = uModel * vec4(aPosition, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normalize(mat3(uModel) * aNormal);
    gl_Position = uViewProjection * worldPosition;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  uniform vec3 uFogColor;
  uniform vec3 uViewPosition;
  uniform float uEmissive;
  uniform float uFogDensity;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDirection = normalize(vec3(-2.4, 4.8, 4.2) - vWorldPosition);
    vec3 viewDirection = normalize(uViewPosition - vWorldPosition);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float halfLambert = diffuse * 0.72 + 0.28;
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.2);
    float specular = pow(max(dot(reflect(-lightDirection, normal), viewDirection), 0.0), 24.0);
    vec3 color = uColor * (halfLambert + uEmissive) + uRimColor * rim * 0.46 + vec3(specular * 0.24);
    float distanceFromView = length(uViewPosition - vWorldPosition);
    float fog = clamp((distanceFromView - 4.8) * uFogDensity, 0.0, 0.72);
    gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || '着色器编译失败';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || '着色器链接失败';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function uploadGeometry(gl, geometry) {
  const position = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, position);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);
  const normal = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normal);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.normals), gl.STATIC_DRAW);
  const index = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);
  return { position, normal, index, count: geometry.indices.length };
}

function createObservatoryRenderer(canvas, { devicePixelRatio = globalThis.devicePixelRatio || 1 } = {}) {
  const gl = canvas?.getContext?.('webgl', {
    alpha: true,
    antialias: true,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  }) || canvas?.getContext?.('experimental-webgl');
  if (!gl) throw new Error('WebGL 不可用');

  const program = createProgram(gl);
  const locations = {
    position: gl.getAttribLocation(program, 'aPosition'),
    normal: gl.getAttribLocation(program, 'aNormal'),
    model: gl.getUniformLocation(program, 'uModel'),
    viewProjection: gl.getUniformLocation(program, 'uViewProjection'),
    color: gl.getUniformLocation(program, 'uColor'),
    rimColor: gl.getUniformLocation(program, 'uRimColor'),
    fogColor: gl.getUniformLocation(program, 'uFogColor'),
    viewPosition: gl.getUniformLocation(program, 'uViewPosition'),
    emissive: gl.getUniformLocation(program, 'uEmissive'),
    fogDensity: gl.getUniformLocation(program, 'uFogDensity'),
  };
  const geometries = {
    box: uploadGeometry(gl, createBoxGeometry()),
    cylinder: uploadGeometry(gl, createCylinderGeometry()),
    sphere: uploadGeometry(gl, createSphereGeometry()),
    torus: uploadGeometry(gl, createTorusGeometry()),
    arch: uploadGeometry(gl, createTorusGeometry({ arch: true })),
  };
  let quality = 'full';
  let dpr = 1;
  let width = 1;
  let height = 1;
  let destroyed = false;
  let drawCalls = 0;

  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  function setQuality(nextQuality) {
    quality = ['full', 'balanced', 'essential'].includes(nextQuality) ? nextQuality : 'full';
  }

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect?.() || { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    const ceiling = quality === 'full' ? MAX_OBSERVATORY_DPR : quality === 'balanced' ? 1.25 : 1;
    dpr = clamp(Number(devicePixelRatio) || 1, 1, ceiling);
    width = Math.max(1, Math.round((rect.width || 1) * dpr));
    height = Math.max(1, Math.round((rect.height || 1) * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  function paletteFor(product, dimmed = false) {
    const accent = product?.accent || [0.84, 1, 0.25];
    const amount = dimmed ? 0.72 : 0;
    return {
      accent: rgbMix(accent, [0.18, 0.19, 0.17], amount),
      base: rgbMix([0.72, 0.69, 0.62], accent, dimmed ? 0.04 : 0.13),
      light: rgbMix([0.92, 0.88, 0.78], accent, dimmed ? 0.02 : 0.08),
      dark: rgbMix([0.105, 0.11, 0.1], accent, dimmed ? 0.02 : 0.09),
      warm: rgbMix([0.57, 0.25, 0.14], accent, dimmed ? 0.08 : 0.19),
    };
  }

  function bindGeometry(geometry) {
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.position);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normal);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.index);
  }

  function drawPart(item, parent, palette, { fogColor, fogDensity, dimmed = false } = {}) {
    const geometry = geometries[item.mesh] || geometries.box;
    const model = composeTransform(item, parent);
    const color = palette[item.tone] || palette.base;
    bindGeometry(geometry);
    gl.uniformMatrix4fv(locations.model, false, model);
    gl.uniform3fv(locations.color, color);
    gl.uniform3fv(locations.rimColor, dimmed ? [0.2, 0.22, 0.2] : palette.accent);
    gl.uniform3fv(locations.fogColor, fogColor);
    gl.uniform1f(locations.fogDensity, fogDensity);
    gl.uniform1f(locations.emissive, dimmed ? 0 : Number(item.emissive) || 0);
    gl.drawElements(gl.TRIANGLES, geometry.count, gl.UNSIGNED_SHORT, 0);
    drawCalls += 1;
  }

  function drawProduct(product, parent, scene, { dimmed = false, partLimit = Infinity } = {}) {
    const palette = paletteFor(product, dimmed);
    const parts = MODEL_PARTS[product?.model] || MODEL_PARTS.package;
    parts.slice(0, partLimit).forEach((item) => drawPart(item, parent, palette, { ...scene, dimmed }));
  }

  function render({ products, selectedIndex, rotationX, rotationY, dismissedCount = 0, time = 0, reducedMotion = false } = {}) {
    if (destroyed) return { drawCalls: 0, dpr, quality };
    resize();
    drawCalls = 0;
    const product = products?.[selectedIndex] || OBSERVATORY_PRODUCTS[0];
    const calm = clamp(Number(dismissedCount) / 3, 0, 1);
    const fogColor = rgbMix([0.15, 0.038, 0.022], [0.035, 0.09, 0.082], calm);
    const background = rgbMix([0.045, 0.018, 0.012], [0.012, 0.025, 0.023], calm);
    gl.clearColor(background[0], background[1], background[2], 0.92);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    const aspect = width / Math.max(1, height);
    const projection = mat4Perspective((aspect < 0.82 ? 43 : 37) * Math.PI / 180, aspect, 0.1, 50);
    const view = mat4Translation(0, aspect < 0.82 ? -0.04 : 0.02, aspect < 0.82 ? -7.2 : -6.4);
    const viewProjection = mat4Multiply(projection, view);
    gl.uniformMatrix4fv(locations.viewProjection, false, viewProjection);
    gl.uniform3fv(locations.viewPosition, [0, 0, aspect < 0.82 ? 7.2 : 6.4]);

    const scene = { fogColor, fogDensity: quality === 'essential' ? 0.1 : 0.16 };
    const stageScale = aspect < 0.82 ? 0.86 : 1;
    const hover = reducedMotion ? 0 : Math.sin(time * 0.0013) * 0.055;
    const productParent = composeTransform({
      position: [0, -0.02 + hover, 0],
      rotation: [rotationX, rotationY, 0],
      scale: [stageScale, stageScale, stageScale],
    });
    drawProduct(product, productParent, scene);

    const platformPalette = paletteFor(product);
    drawPart(
      part('cylinder', [0, -1.48, 0], [1.48, 0.105, 1.48], 'dark'),
      null,
      platformPalette,
      scene,
    );
    drawPart(
      part('torus', [0, -1.32, 0], [1.56, 0.22, 1.56], 'accent', [0, 0, 0], 0.05 + calm * 0.04),
      null,
      platformPalette,
      scene,
    );

    const signals = signalsForProduct(product);
    signals.forEach((signal, index) => {
      if (index < dismissedCount || quality === 'essential') return;
      const angle = time * (reducedMotion ? 0 : 0.00018) + index * (TAU / 3);
      const radius = 2.08 + index * 0.08;
      const signalParent = composeTransform({
        position: [Math.cos(angle) * radius, 0.2 + Math.sin(angle * 1.7) * 0.22, Math.sin(angle) * 0.5],
        rotation: [0.55, angle, angle * 0.45],
        scale: [0.12, 0.12, 0.12],
      });
      drawPart(part('box', [0, 0, 0], [1, 1, 1], index === 1 ? 'accent' : 'warm', [0.4, 0.2, 0.3], 0.12), signalParent, platformPalette, scene);
    });

    if (quality === 'full' && aspect > 0.9 && products?.length > 1) {
      [-1, 1].forEach((direction) => {
        const neighborIndex = nextObservatoryIndex(selectedIndex, direction, products.length);
        const neighbor = products[neighborIndex];
        const parent = composeTransform({
          position: [direction * 3.45, -0.42, -0.65],
          rotation: [0, rotationY * 0.25 + direction * 0.4, 0],
          scale: [0.42, 0.42, 0.42],
        });
        drawProduct(neighbor, parent, scene, { dimmed: true, partLimit: 6 });
      });
    }

    return { drawCalls, dpr, quality };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    Object.values(geometries).forEach((geometry) => {
      gl.deleteBuffer(geometry.position);
      gl.deleteBuffer(geometry.normal);
      gl.deleteBuffer(geometry.index);
    });
    gl.deleteProgram(program);
  }

  resize();
  return { render, resize, setQuality, destroy, gl };
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return globalThis.setTimeout(() => callback(defaultNow()), 16);
}

function defaultCancelFrame(id) {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
  else globalThis.clearTimeout(id);
}

function queryElements(root) {
  const query = (id) => root.querySelector?.(`#${id}`) || null;
  return {
    title: query('observatoryTitle'),
    stage: query('observatoryStage'),
    canvas: query('observatoryCanvas'),
    fallback: query('observatoryFallback'),
    fallbackObject: query('observatoryFallbackObject'),
    productName: query('observatoryProductName'),
    productCategory: query('observatoryProductCategory'),
    productPrice: query('observatoryProductPrice'),
    productCode: query('observatoryProductCode'),
    productIndex: query('observatoryProductIndex'),
    previousButton: query('observatoryPreviousProduct'),
    nextButton: query('observatoryNextProduct'),
    gestureButton: query('observatoryGestureButton'),
    signals: query('observatorySignals'),
    signalCount: query('observatorySignalCount'),
    question: query('observatoryQuestion'),
    coolButton: query('observatoryCoolButton'),
    dismissButton: query('observatoryDismissButton'),
    liveStatus: query('observatoryLiveStatus'),
    pauseNotice: query('observatoryPauseNotice'),
    closeButtons: [...(root.querySelectorAll?.('[data-peel-close]') || [])],
  };
}

function visibleProductNumber(index, total) {
  return `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
}

export function createDesireObservatoryController({
  root,
  elements: providedElements,
  reducedMotion = false,
  onInputMode = () => true,
  onIntent = () => {},
  onClose = () => {},
  now = defaultNow,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  documentRef = root?.ownerDocument || globalThis.document || null,
} = {}) {
  if (!root) throw new TypeError('欲望观察舱需要根节点');
  if (CONTROLLERS.has(root)) return CONTROLLERS.get(root);

  const elements = { ...queryElements(root), ...(providedElements || {}) };
  const cleanupListeners = [];
  let products = [...OBSERVATORY_PRODUCTS];
  let selectedIndex = 0;
  let dismissedSignalIds = new Set();
  let rotation = { x: -0.08, y: 0.5 };
  let targetRotation = { ...rotation };
  let inputMode = 'pointer';
  let opened = false;
  let destroyed = false;
  let pausedReason = null;
  let hiddenByDocument = Boolean(documentRef?.hidden);
  let renderer = null;
  let renderMode = 'pending';
  let quality = 'full';
  let lastFrameAt = null;
  let rafId = null;
  let pointer = null;
  let slowFrameDebt = 0;
  let lastDiagnostics = { drawCalls: 0, dpr: 1, quality };
  let resizeObserver = null;
  let switchTimer = null;

  const motionIsReduced = () => (
    typeof reducedMotion === 'function' ? Boolean(reducedMotion()) : Boolean(reducedMotion)
  );

  function listen(element, type, listener, options) {
    if (!element?.addEventListener) return;
    element.addEventListener(type, listener, options);
    cleanupListeners.push(() => element.removeEventListener(type, listener, options));
  }

  function currentProduct() {
    return products[selectedIndex] || products[0] || OBSERVATORY_PRODUCTS[0];
  }

  function setPortalOrigin(origin) {
    const x = Number(origin?.x);
    const y = Number(origin?.y);
    root.style?.setProperty?.('--observatory-origin-x', `${(clamp(Number.isFinite(x) ? x : 0.66, 0, 1) * 100).toFixed(2)}%`);
    root.style?.setProperty?.('--observatory-origin-y', `${(clamp(Number.isFinite(y) ? y : 0.58, 0, 1) * 100).toFixed(2)}%`);
  }

  function announce(message) {
    if (elements.liveStatus) elements.liveStatus.textContent = message;
  }

  function createSignalButton(signal, index) {
    if (!documentRef?.createElement) return null;
    const button = documentRef.createElement('button');
    const dismissed = dismissedSignalIds.has(signal.id);
    button.type = 'button';
    button.dataset.observatorySignal = signal.id;
    button.dataset.dismissed = String(dismissed);
    button.setAttribute('aria-pressed', String(dismissed));
    button.setAttribute('aria-label', dismissed ? `已关掉催促信号：${signal.label}` : `关掉催促信号：${signal.label}`);
    const number = documentRef.createElement('small');
    number.textContent = `0${index + 1}`;
    const label = documentRef.createElement('b');
    label.textContent = signal.label;
    const state = documentRef.createElement('span');
    state.textContent = dismissed ? '已安静' : signal.code;
    button.append(number, label, state);
    button.addEventListener('click', () => dismissSignal(signal.id));
    return button;
  }

  function renderSignals() {
    const signals = signalsForProduct(currentProduct());
    const buttons = signals.map(createSignalButton).filter(Boolean);
    elements.signals?.replaceChildren?.(...buttons);
    const remaining = signals.filter((signal) => !dismissedSignalIds.has(signal.id)).length;
    if (elements.signalCount) elements.signalCount.textContent = String(remaining);
    if (elements.question) elements.question.hidden = dismissedSignalIds.size < 2;
    if (root.dataset) root.dataset.calmLevel = String(Math.min(3, dismissedSignalIds.size));
  }

  function renderProduct({ announceSelection = false } = {}) {
    const product = currentProduct();
    if (elements.productName) elements.productName.textContent = product.name;
    if (elements.productCategory) elements.productCategory.textContent = product.category;
    if (elements.productPrice) elements.productPrice.textContent = formatCny(product.amount);
    if (elements.productCode) elements.productCode.textContent = product.code;
    if (elements.productIndex) elements.productIndex.textContent = visibleProductNumber(selectedIndex, products.length);
    if (elements.fallbackObject?.dataset) elements.fallbackObject.dataset.model = product.model;
    if (elements.fallbackObject) elements.fallbackObject.textContent = product.code.split('/')[0].trim();
    if (elements.stage) elements.stage.setAttribute('aria-label', `查看${product.name}。拖动旋转，方向键切换或调整角度。`);
    if (elements.coolButton) {
      elements.coolButton.textContent = product.source === 'order' ? '查看这笔冷静单' : '放进冷静单';
    }
    renderSignals();
    if (announceSelection) announce(`正在观察${product.name}，${formatCny(product.amount)}。`);
  }

  function drawStaticFrame() {
    if (!renderer || renderMode !== 'webgl') return;
    lastDiagnostics = renderer.render({
      products,
      selectedIndex,
      rotationX: rotation.x,
      rotationY: rotation.y,
      dismissedCount: dismissedSignalIds.size,
      time: now(),
      reducedMotion: motionIsReduced(),
    });
  }

  function setRenderMode(nextMode) {
    renderMode = nextMode;
    if (root.dataset) root.dataset.renderMode = nextMode;
    if (elements.canvas) elements.canvas.hidden = nextMode !== 'webgl';
    if (elements.fallback) elements.fallback.hidden = nextMode === 'webgl';
  }

  function setQuality(nextQuality) {
    if (!['full', 'balanced', 'essential'].includes(nextQuality) || quality === nextQuality) return;
    quality = nextQuality;
    if (root.dataset) root.dataset.quality = nextQuality;
    renderer?.setQuality(nextQuality);
    renderer?.resize();
  }

  function updateQuality(deltaMs) {
    if (motionIsReduced()) {
      setQuality('essential');
      return;
    }
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 180) return;
    slowFrameDebt = clamp(slowFrameDebt + (deltaMs > 28 ? 1.35 : -0.22), 0, 42);
    if (slowFrameDebt >= 28) setQuality('essential');
    else if (slowFrameDebt >= 12) setQuality('balanced');
    else if (slowFrameDebt <= 3) setQuality('full');
  }

  function canAnimate() {
    return opened && !destroyed && !pausedReason && !hiddenByDocument && renderMode === 'webgl';
  }

  function stopAnimation() {
    if (rafId !== null) cancelFrame(rafId);
    rafId = null;
    lastFrameAt = null;
  }

  function frame(at) {
    rafId = null;
    if (!canAnimate()) return;
    const deltaMs = lastFrameAt === null ? 16 : clamp(at - lastFrameAt, 0, 80);
    lastFrameAt = at;
    updateQuality(deltaMs);
    const direct = motionIsReduced() || pointer;
    const response = direct ? 1 : 1 - Math.exp(-deltaMs / (inputMode === 'gesture' ? 42 : 76));
    rotation.x += (targetRotation.x - rotation.x) * response;
    rotation.y += (targetRotation.y - rotation.y) * response;
    if (!motionIsReduced() && !pointer && inputMode !== 'gesture') targetRotation.y += deltaMs * 0.00016;
    lastDiagnostics = renderer.render({
      products,
      selectedIndex,
      rotationX: rotation.x,
      rotationY: rotation.y,
      dismissedCount: dismissedSignalIds.size,
      time: at,
      reducedMotion: motionIsReduced(),
    });
    rafId = requestFrame(frame);
  }

  function startAnimation() {
    if (rafId !== null || !canAnimate()) return;
    lastFrameAt = null;
    rafId = requestFrame(frame);
  }

  function initializeRenderer() {
    if (!elements.canvas) {
      setRenderMode('fallback');
      return;
    }
    try {
      renderer?.destroy?.();
      renderer = createObservatoryRenderer(elements.canvas, { devicePixelRatio });
      renderer.setQuality(motionIsReduced() ? 'essential' : 'full');
      setRenderMode('webgl');
      drawStaticFrame();
      startAnimation();
    } catch {
      renderer = null;
      setRenderMode('fallback');
      announce('3D 展示暂不可用，已切换为静态商品视图。所有操作仍可继续。');
    }
  }

  function selectProduct(direction) {
    if (!opened || products.length < 2) return false;
    selectedIndex = nextObservatoryIndex(selectedIndex, direction, products.length);
    dismissedSignalIds = new Set();
    rotation = { x: -0.08, y: direction < 0 ? -0.46 : 0.46 };
    targetRotation = { x: -0.08, y: 0 };
    if (root.dataset) root.dataset.switching = 'true';
    if (switchTimer !== null) globalThis.clearTimeout(switchTimer);
    switchTimer = globalThis.setTimeout(() => {
      if (root.dataset) delete root.dataset.switching;
      switchTimer = null;
    }, motionIsReduced() ? 0 : 320);
    renderProduct({ announceSelection: true });
    drawStaticFrame();
    startAnimation();
    return true;
  }

  function dismissSignal(signalId) {
    const signal = signalsForProduct(currentProduct()).find((item) => item.id === signalId);
    if (!signal || dismissedSignalIds.has(signal.id)) return false;
    dismissedSignalIds.add(signal.id);
    renderSignals();
    const remaining = Math.max(0, signalsForProduct(currentProduct()).length - dismissedSignalIds.size);
    announce(`已关掉“${signal.label}”，还剩 ${remaining} 个催促信号。`);
    drawStaticFrame();
    return true;
  }

  function rotateBy(deltaX, deltaY, { direct = false } = {}) {
    targetRotation.x = clamp(targetRotation.x + deltaX, -0.7, 0.7);
    targetRotation.y += deltaY;
    if (direct || motionIsReduced()) rotation = { ...targetRotation };
    drawStaticFrame();
    startAnimation();
  }

  function pointerDown(event) {
    if (!opened || event.button > 0) return;
    pointer = { id: event.pointerId, x: Number(event.clientX), y: Number(event.clientY) };
    elements.stage?.setPointerCapture?.(event.pointerId);
    if (root.dataset) root.dataset.dragging = 'true';
    if (inputMode !== 'pointer') {
      inputMode = 'pointer';
      onInputMode('pointer');
      renderInputMode();
    }
    event.preventDefault?.();
  }

  function pointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const rect = elements.stage?.getBoundingClientRect?.() || { width: 1, height: 1 };
    const dx = (Number(event.clientX) - pointer.x) / Math.max(1, rect.width);
    const dy = (Number(event.clientY) - pointer.y) / Math.max(1, rect.height);
    pointer.x = Number(event.clientX);
    pointer.y = Number(event.clientY);
    rotateBy(dy * 3.8, dx * 5.4, { direct: true });
    event.preventDefault?.();
  }

  function pointerUp(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    elements.stage?.releasePointerCapture?.(event.pointerId);
    pointer = null;
    if (root.dataset) delete root.dataset.dragging;
  }

  function stageKeydown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectProduct(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      rotateBy(event.key === 'ArrowUp' ? -0.14 : 0.14, 0, { direct: true });
      announce(`已从${event.key === 'ArrowUp' ? '较高' : '较低'}角度查看${currentProduct().name}。`);
      return;
    }
    if (event.key.toLowerCase() === 'a' || event.key.toLowerCase() === 'd') {
      event.preventDefault();
      rotateBy(0, event.key.toLowerCase() === 'a' ? -0.22 : 0.22, { direct: true });
    }
  }

  function renderInputMode() {
    if (!elements.gestureButton) return;
    const active = inputMode === 'gesture';
    elements.gestureButton.dataset.active = String(active);
    elements.gestureButton.setAttribute('aria-pressed', String(active));
    const label = elements.gestureButton.querySelector?.('b');
    if (label) label.textContent = active ? '手势已接管' : '手势旋转';
    const state = elements.gestureButton.querySelector?.('small');
    if (state) state.textContent = active ? '再次点击退出' : '可选 · 本地识别';
  }

  function toggleGesture() {
    const nextMode = inputMode === 'gesture' ? 'pointer' : 'gesture';
    if (onInputMode(nextMode) === false) return;
    inputMode = nextMode;
    pausedReason = null;
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    renderInputMode();
    announce(nextMode === 'gesture'
      ? '手势旋转已开启。伸出食指，左右移动查看商品。'
      : '已切换为触摸、鼠标和键盘操作。');
    startAnimation();
  }

  function handleVisibilityChange() {
    hiddenByDocument = Boolean(documentRef?.hidden);
    if (hiddenByDocument) stopAnimation();
    else startAnimation();
  }

  function applySegment(segment) {
    if (!opened || destroyed) return false;
    const delta = rotationDeltaForSegment(segment);
    inputMode = 'gesture';
    pausedReason = null;
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    renderInputMode();
    rotateBy(delta.x, delta.y);
    return Boolean(delta.x || delta.y);
  }

  function pause(reason = 'paused') {
    if (!opened || destroyed) return false;
    pausedReason = reason;
    stopAnimation();
    if (elements.pauseNotice) {
      elements.pauseNotice.hidden = false;
      elements.pauseNotice.textContent = reason === 'hand-lost'
        ? '暂时没看到手，商品停在原处。重新伸出食指即可继续。'
        : '观察舱已暂停。';
    }
    if (root.dataset) root.dataset.paused = 'true';
    return true;
  }

  function resume() {
    if (!opened || destroyed) return false;
    pausedReason = null;
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    if (root.dataset) delete root.dataset.paused;
    announce('手势已恢复，商品保持原角度继续响应。');
    startAnimation();
    return true;
  }

  async function open(config = {}) {
    if (destroyed) return false;
    products = selectObservatoryProducts(config);
    selectedIndex = 0;
    dismissedSignalIds = new Set();
    rotation = { x: -0.08, y: 0.5 };
    targetRotation = { x: -0.08, y: 0 };
    inputMode = config.inputMode === 'gesture' ? 'gesture' : 'pointer';
    pausedReason = null;
    hiddenByDocument = Boolean(documentRef?.hidden);
    slowFrameDebt = 0;
    quality = motionIsReduced() ? 'essential' : 'full';
    setPortalOrigin(config.portalOrigin);
    root.hidden = false;
    if (root.dataset) {
      root.dataset.quality = quality;
      root.dataset.calmLevel = '0';
    }
    opened = true;
    renderProduct();
    renderInputMode();
    if (elements.pauseNotice) elements.pauseNotice.hidden = true;
    setRenderMode('pending');
    requestFrame(() => {
      if (!opened || destroyed) return;
      initializeRenderer();
      elements.title?.focus?.({ preventScroll: true });
    });
    announce(`欲望观察舱已打开。正在观察${currentProduct().name}，没有倒计时。`);
    return true;
  }

  function close() {
    if (!opened || destroyed) return false;
    opened = false;
    pointer = null;
    stopAnimation();
    root.hidden = true;
    if (root.dataset) {
      delete root.dataset.dragging;
      delete root.dataset.paused;
      delete root.dataset.switching;
    }
    onClose();
    return true;
  }

  function destroy() {
    if (destroyed) return;
    opened = false;
    destroyed = true;
    stopAnimation();
    if (switchTimer !== null) globalThis.clearTimeout(switchTimer);
    resizeObserver?.disconnect?.();
    cleanupListeners.splice(0).forEach((cleanup) => cleanup());
    renderer?.destroy?.();
    renderer = null;
    CONTROLLERS.delete(root);
  }

  function snapshot() {
    return {
      open: opened,
      selectedIndex,
      selectedProductId: currentProduct()?.id || null,
      productCount: products.length,
      dismissedSignalIds: [...dismissedSignalIds],
      inputMode,
      renderMode,
      pausedReason,
      rotation: { ...rotation },
      quality,
    };
  }

  listen(elements.previousButton, 'click', () => selectProduct(-1));
  listen(elements.nextButton, 'click', () => selectProduct(1));
  listen(elements.gestureButton, 'click', toggleGesture);
  listen(elements.stage, 'pointerdown', pointerDown);
  listen(elements.stage, 'pointermove', pointerMove);
  listen(elements.stage, 'pointerup', pointerUp);
  listen(elements.stage, 'pointercancel', pointerUp);
  listen(elements.stage, 'keydown', stageKeydown);
  listen(elements.coolButton, 'click', () => onIntent({ type: 'cool', focusItem: currentProduct() }));
  listen(elements.dismissButton, 'click', () => onIntent({ type: 'dismiss', focusItem: currentProduct() }));
  elements.closeButtons.forEach((button) => listen(button, 'click', close));
  listen(documentRef, 'visibilitychange', handleVisibilityChange);
  listen(elements.canvas, 'webglcontextlost', (event) => {
    event.preventDefault?.();
    stopAnimation();
    renderer?.destroy?.();
    renderer = null;
    setRenderMode('fallback');
    announce('3D 展示已暂停，静态商品视图仍可继续操作。');
  });

  if (typeof globalThis.ResizeObserver === 'function' && elements.stage) {
    resizeObserver = new globalThis.ResizeObserver(() => {
      renderer?.resize?.();
      drawStaticFrame();
    });
    resizeObserver.observe(elements.stage);
  } else {
    listen(globalThis, 'resize', () => {
      renderer?.resize?.();
      drawStaticFrame();
    });
  }

  const controller = {
    open,
    close,
    destroy,
    applySegment,
    pause,
    resume,
    selectProduct,
    dismissSignal,
    getState: snapshot,
    getDiagnostics: () => ({
      ...lastDiagnostics,
      renderMode,
      quality,
      rafActive: rafId !== null,
      visibleProducts: Math.min(products.length, quality === 'full' ? MAX_OBSERVATORY_VISIBLE_PRODUCTS : 1),
    }),
  };
  CONTROLLERS.set(root, controller);
  return controller;
}
