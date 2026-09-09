export const PEEL_GALLERY_VISUAL_VERSION = 'slice-stickers-v1';

const PRODUCT_VISUALS = Object.freeze({
  'milk-tea': Object.freeze({ kind: 'milk-tea', label: '商品本体' }),
  'cold-brew': Object.freeze({ kind: 'coffee', label: '商品本体' }),
  'sparkling-drink': Object.freeze({ kind: 'sparkling-drink', label: '商品本体' }),
  headphones: Object.freeze({ kind: 'headphones', label: '商品本体' }),
  keyboard: Object.freeze({ kind: 'keyboard', label: '商品本体' }),
  camera: Object.freeze({ kind: 'camera', label: '商品本体' }),
  sneakers: Object.freeze({ kind: 'sneaker', label: '商品本体' }),
  'shoulder-bag': Object.freeze({ kind: 'bag', label: '商品本体' }),
  'blind-box': Object.freeze({ kind: 'box', label: '商品本体' }),
  'aroma-candle': Object.freeze({ kind: 'candle', label: '商品本体' }),
  'camping-lamp': Object.freeze({ kind: 'lamp', label: '商品本体' }),
});

const CATEGORY_VISUALS = Object.freeze({
  digital: Object.freeze({ kind: 'device', label: '商品本体' }),
  food: Object.freeze({ kind: 'vessel', label: '商品本体' }),
  fashion: Object.freeze({ kind: 'wearable', label: '商品本体' }),
  home: Object.freeze({ kind: 'home-object', label: '商品本体' }),
  interest: Object.freeze({ kind: 'object', label: '商品本体' }),
});

const DEFAULT_VISUAL = Object.freeze({ kind: 'object', label: '商品本体' });

export function resolvePeelProductVisual(item = {}) {
  return PRODUCT_VISUALS[String(item.id || '')]
    || CATEGORY_VISUALS[String(item.category || '')]
    || DEFAULT_VISUAL;
}

function roundedRectPath(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function fillAndStroke(context, fill = context.fillStyle) {
  context.fillStyle = fill;
  context.fill();
  context.stroke();
}

function line(context, points) {
  context.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}

function drawVessel(context, kind) {
  context.beginPath();
  context.moveTo(-21, -19);
  context.lineTo(19, -19);
  context.lineTo(14, 29);
  context.quadraticCurveTo(0, 35, -14, 29);
  context.closePath();
  fillAndStroke(context);
  line(context, [[-24, -19], [22, -19]]);
  if (kind === 'milk-tea') {
    line(context, [[6, -21], [14, -42]]);
    for (const [x, y] of [[-8, 17], [1, 23], [9, 14], [-2, 8]]) {
      context.beginPath();
      context.arc(x, y, 2.4, 0, Math.PI * 2);
      context.fill();
    }
  } else if (kind === 'coffee') {
    context.beginPath();
    context.arc(21, 1, 9, -Math.PI / 2, Math.PI / 2);
    context.stroke();
    line(context, [[-11, -7], [10, -7]]);
  } else {
    line(context, [[-9, 8], [8, 3], [-3, -3], [11, -8]]);
    line(context, [[7, -21], [11, -39]]);
  }
}

function drawHeadphones(context) {
  context.beginPath();
  context.arc(0, 2, 29, Math.PI, Math.PI * 2);
  context.stroke();
  roundedRectPath(context, -32, -1, 12, 30, 6);
  fillAndStroke(context);
  roundedRectPath(context, 20, -1, 12, 30, 6);
  fillAndStroke(context);
  line(context, [[-20, 23], [-12, 29], [12, 29], [20, 23]]);
}

function drawKeyboard(context) {
  roundedRectPath(context, -36, -22, 72, 45, 7);
  fillAndStroke(context);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const width = row === 2 && column === 2 ? 18 : 6;
      if (row === 2 && column > 2 && column < 5) continue;
      context.fillRect(-29 + column * 9, -14 + row * 11, width, 5);
    }
  }
}

function drawCamera(context) {
  roundedRectPath(context, -34, -23, 68, 47, 9);
  fillAndStroke(context);
  roundedRectPath(context, -18, -31, 24, 10, 4);
  fillAndStroke(context);
  context.beginPath();
  context.arc(6, 1, 16, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(6, 1, 8, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(25, -13, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawSneaker(context) {
  context.beginPath();
  context.moveTo(-34, 7);
  context.quadraticCurveTo(-18, 2, -13, -22);
  context.quadraticCurveTo(-4, -14, 4, -2);
  context.quadraticCurveTo(16, 7, 34, 11);
  context.lineTo(33, 22);
  context.quadraticCurveTo(4, 27, -28, 23);
  context.quadraticCurveTo(-37, 20, -34, 7);
  context.closePath();
  fillAndStroke(context);
  line(context, [[-23, 13], [26, 16]]);
  line(context, [[-10, -8], [5, 2], [-5, 4], [10, 9]]);
}

function drawBag(context) {
  roundedRectPath(context, -29, -15, 58, 43, 10);
  fillAndStroke(context);
  context.beginPath();
  context.arc(0, -13, 18, Math.PI, Math.PI * 2);
  context.stroke();
  line(context, [[-24, 2], [24, 2]]);
  context.beginPath();
  context.arc(0, 8, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawBox(context) {
  context.beginPath();
  context.moveTo(0, -32);
  context.lineTo(31, -15);
  context.lineTo(31, 20);
  context.lineTo(0, 35);
  context.lineTo(-31, 20);
  context.lineTo(-31, -15);
  context.closePath();
  fillAndStroke(context);
  line(context, [[-31, -15], [0, 2], [31, -15]]);
  line(context, [[0, 2], [0, 35]]);
  line(context, [[-13, -24], [17, -7]]);
}

function drawCandle(context) {
  roundedRectPath(context, -22, -9, 44, 38, 8);
  fillAndStroke(context);
  context.beginPath();
  context.moveTo(0, -12);
  context.quadraticCurveTo(-11, -22, 0, -36);
  context.quadraticCurveTo(11, -22, 0, -12);
  context.closePath();
  fillAndStroke(context, '#ee743d');
  line(context, [[-15, 8], [15, 8]]);
}

function drawLamp(context) {
  context.beginPath();
  context.arc(0, -5, 25, Math.PI, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(-27, 12);
  context.quadraticCurveTo(-21, -18, 0, -21);
  context.quadraticCurveTo(21, -18, 27, 12);
  context.lineTo(20, 27);
  context.lineTo(-20, 27);
  context.closePath();
  fillAndStroke(context, '#f4c34d');
  line(context, [[-18, 10], [18, 10]]);
  line(context, [[0, -17], [0, 23]]);
}

function drawDevice(context) {
  roundedRectPath(context, -24, -35, 48, 70, 10);
  fillAndStroke(context);
  line(context, [[-13, -25], [13, -25]]);
  context.beginPath();
  context.arc(0, 26, 2.5, 0, Math.PI * 2);
  context.fill();
}

function drawGenericObject(context) {
  context.beginPath();
  context.moveTo(0, -35);
  context.quadraticCurveTo(29, -25, 33, 2);
  context.quadraticCurveTo(28, 30, 0, 35);
  context.quadraticCurveTo(-29, 29, -33, 2);
  context.quadraticCurveTo(-29, -26, 0, -35);
  context.closePath();
  fillAndStroke(context);
  line(context, [[-15, 1], [0, -13], [15, 1], [0, 15], [-15, 1]]);
}

const DRAWERS = Object.freeze({
  'milk-tea': (context) => drawVessel(context, 'milk-tea'),
  coffee: (context) => drawVessel(context, 'coffee'),
  'sparkling-drink': (context) => drawVessel(context, 'sparkling-drink'),
  vessel: (context) => drawVessel(context, 'vessel'),
  headphones: drawHeadphones,
  keyboard: drawKeyboard,
  camera: drawCamera,
  sneaker: drawSneaker,
  wearable: drawBag,
  bag: drawBag,
  box: drawBox,
  candle: drawCandle,
  'home-object': drawCandle,
  lamp: drawLamp,
  device: drawDevice,
  object: drawGenericObject,
});

export function drawPeelProductVisual(context, item = {}, {
  scale = 1,
  revealed = false,
  color = '#4d3c32',
  accent = '#efb940',
} = {}) {
  const visual = resolvePeelProductVisual(item);
  if (!context?.save) return visual;
  const safeScale = Math.max(0.1, Number(scale) || 1);

  context.save();
  context.scale(safeScale, safeScale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const palette = {
    food: '#f1b541', digital: '#71a393', fashion: '#ee947f',
    interest: '#a7b875', home: '#d9a2bd',
  };
  context.lineWidth = 3;
  context.strokeStyle = color;
  context.fillStyle = palette[item.category] || accent;
  context.shadowColor = '#75472e38';
  context.shadowBlur = 5;
  context.shadowOffsetY = 4;
  const drawer = DRAWERS[visual.kind] || drawGenericObject;
  // A broad cream contour gives every silhouette its own die-cut sticker edge.
  context.save();
  context.strokeStyle = '#fffaf0';
  context.lineWidth = 12;
  drawer(context);
  context.restore();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  drawer(context);
  context.restore();
  return visual;
}
