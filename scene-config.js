const degrees = (value) => (value * Math.PI) / 180;

export const SCENE_DEFAULT_VIEW = Object.freeze({
  // Start between the sofa hotspot and the Figma raccoon so its complete
  // seated pose and red stool remain visible before the user begins rotating.
  yaw: degrees(-18),
  pitch: degrees(-13),
  fov: degrees(86),
});

export const SCENE_MOBILE_DEFAULT_VIEW = Object.freeze({
  // A portrait viewport has a much narrower horizontal field of view. Center
  // the authored IP so the seated pose and red stool remain identifiable.
  yaw: degrees(-40),
  pitch: degrees(-16),
  fov: degrees(88),
});

export const SCENE_INTRO_VIEW = Object.freeze({
  yaw: degrees(-56),
  pitch: degrees(-8),
  fov: degrees(55),
});

// The four physical corners of the whiteboard in the equirectangular room image.
// Note positions are stored as normalized u/v values inside this surface so they
// remain attached to the board while the camera pans and zooms.
export const SCENE_WHITEBOARD_SURFACE = Object.freeze({
  topLeft: Object.freeze({ yaw: degrees(-110.8), pitch: degrees(28.1) }),
  topRight: Object.freeze({ yaw: degrees(-136.6), pitch: degrees(30.4) }),
  bottomRight: Object.freeze({ yaw: degrees(-146.6), pitch: degrees(-50.8) }),
  bottomLeft: Object.freeze({ yaw: degrees(-107.4), pitch: degrees(-50.9) }),
});

export const FEATURE_HOTSPOTS = Object.freeze([
  {
    id: 'gym-screen',
    kind: 'feature',
    panel: 'clinic',
    label: '消费习惯测试',
    eyebrow: '健身区 · 钱包体检屏',
    description: '总结、消费人格与分享海报',
    yaw: degrees(111),
    pitch: degrees(-5),
    focus: { yaw: degrees(102), pitch: degrees(-6), fov: degrees(39) },
    accent: '#7e5cff',
    index: '01',
    statusId: 'clinicStatus',
    asset: {
      src: './assets/figma-room-hotspot-clinic-4x.png',
      width: 190,
      height: 69,
      nodeId: '32:3637',
    },
  },
  {
    id: 'sofa-phone',
    kind: 'feature',
    panel: 'new',
    panels: ['new', 'orders'],
    label: '开始买吧',
    eyebrow: '沙发区 · 茶几手机',
    description: '模拟下单与订单管理',
    yaw: degrees(-2),
    pitch: degrees(-21),
    focus: { yaw: degrees(-11), pitch: degrees(-20), fov: degrees(35) },
    accent: '#ff6b4a',
    index: '02',
    statusId: 'computerStatus',
    badgeId: 'orderBadge',
    asset: {
      src: './assets/figma-room-hotspot-new-4x.png',
      width: 190,
      height: 79,
      nodeId: '32:3643',
    },
  },
  {
    id: 'whiteboard',
    kind: 'feature',
    panel: 'goals',
    label: '回血计划',
    eyebrow: '白板区 · 预算便签',
    description: '填写目标、预算和回血进度',
    yaw: degrees(-125),
    pitch: degrees(3),
    focus: { yaw: degrees(-134), pitch: degrees(1), fov: degrees(38) },
    accent: '#36d3c8',
    index: '03',
    statusId: 'goalStatus',
    asset: {
      src: './assets/figma-room-hotspot-goals-4x.png',
      width: 170,
      height: 71,
      nodeId: '32:3644',
    },
  },
]);

export const ACTIVITY_HOTSPOTS = Object.freeze([
  Object.freeze({
    id: 'desire-peel',
    kind: 'activity',
    activity: 'peel',
    label: '切一刀',
    eyebrow: '书桌 · 掌机',
    description: '划过蹦起来的商品，来一局切一刀',
    // The physical handheld on the desk in room-panorama-hd.webp.
    // Source anchor: approximately (6124, 2226) in the 8192×4096 image.
    yaw: degrees(-89.12),
    pitch: degrees(-7.82),
    focus: Object.freeze({ yaw: degrees(-89.12), pitch: degrees(-7.82), fov: degrees(34) }),
    bounds: Object.freeze({ width: 126, height: 88 }),
    accent: '#d7ff43',
    index: 'GAME',
  }),
]);

const PACKAGE_SLOTS = [
  { yaw: degrees(56), pitch: degrees(-14) },
  { yaw: degrees(59), pitch: degrees(-21) },
  { yaw: degrees(49), pitch: degrees(-22) },
  { yaw: degrees(56), pitch: degrees(-30) },
  { yaw: degrees(45), pitch: degrees(-34) },
];

const PACKAGE_THOUGHTS = [
  '拆快递那一刻，就是它的使用巅峰。',
  '买的时候觉得，它能改变人生。',
  '三分钟热度专用神器。',
  '为了凑满减，多花了八十。',
  '家里好像已经有一个了。',
  '等有空一定会用——但一直没空。',
  '不是需要，只是不想错过优惠。',
  '买过，从来没用，也舍不得扔。',
];

function shuffled(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function createPackageHotspots() {
  const thoughts = shuffled(PACKAGE_THOUGHTS);
  return PACKAGE_SLOTS.map((slot, index) => ({
    id: `package-${index + 1}`,
    group: 'packages',
    kind: 'thought',
    label: `快递箱 ${index + 1}`,
    thought: thoughts[index],
    yaw: slot.yaw,
    pitch: slot.pitch,
    focus: { yaw: degrees(52), pitch: degrees(-23), fov: degrees(49) },
    accent: '#ffd23f',
  }));
}

export const SCENE_GROUPS = Object.freeze({
  packages: {
    label: '看看快递',
    focus: { yaw: degrees(52), pitch: degrees(-23), fov: degrees(49) },
  },
});
