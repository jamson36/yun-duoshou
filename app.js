import { ENTRY_TRANSITION_MS, RoomIntro } from './intro-transition.js?v=20260901-flow-alignment-3';
import { PanoramaRoom } from './panorama.js?v=20260902-desire-peel-1';
import { ACTIVITY_HOTSPOTS, FEATURE_HOTSPOTS, SCENE_DEFAULT_VIEW, SCENE_INTRO_VIEW, SCENE_MOBILE_DEFAULT_VIEW, SCENE_WHITEBOARD_SURFACE, createPackageHotspots } from './scene-config.js?v=20260902-desire-peel-1';
import { AXIS_META, buildDiagnosisRequest, calculateGoalProgress, scorePersonality } from './personality-scoring.js?v=20260830-persona-hybrid-3';
import { SceneBudgetWhiteboard, normalizeGoalNote } from './budget-whiteboard.js?v=20260830-persistence-2';
import { GoalDatePicker, isDateOnOrAfter, normalizeDateValue } from './goal-date-picker.js?v=20260830-date-picker-3';
import { MAX_BUDGET_GOAL_AMOUNT, activeBudgetGoal, goalForSavedOrder, migrateBudgetState, nextGoalNote, normalizeBudgetGoal, validateBudgetGoalAmount } from './budget-goals.js?v=20260831-goal-limit-1';
import { isFigmaPersonaCardId, resolvePersonaPresentation } from './persona-presentations.js?v=20260830-persona-hybrid-3';
import { buildSharePosterModel, downloadSharePoster, renderSharePoster } from './share-poster.js?v=20260831-figma-card-2';
import { createGachaponMotion } from './gachapon-motion.js?v=20260901-visual-anchor-4';
import { buildClinicHash, buildNewHash, buildRoomHash, createRouteSyncScheduler, panelNameFromHash, parseClinicHashState, parseNewHashState, parseRoomHashState, routeSignature } from './route-sync.js?v=20260902-desire-peel-1';
import { ANALYSIS_STAGES, createAnalysisStageController } from './analysis-stages.js?v=20260830-figma-stages-2';
import { RoomGestureController } from './gesture-ui.js?v=20260902-desire-peel-1';
import { RoomOrientationController } from './orientation-ui.js?v=20260901-device-orientation-1';
import { createPeelGestureMapper } from './peel-gesture-controls.js?v=20260902-desire-peel-1';
import { createPeelGameController } from './peel-game-ui.js?v=20260902-desire-peel-2';

const STORAGE_KEY = 'rang-ni-hua-ge-shuang-room-v1';
const LEGACY_STORAGE_KEYS = ['yun-duoshou-room-v1'];
const SESSION_AI_REVOCATION_KEY = 'spree-ai-consent-revoked';
const SESSION_AI_CONSENT_KEY = 'spree-ai-consent-granted';
const SESSION_AI_DIAGNOSIS_INVALIDATED_KEY = 'spree-ai-diagnosis-invalidated';
const AI_REVOCATION_STORAGE_KEY = 'spree-ai-consent-revoked-at';
const AI_DIAGNOSIS_STORAGE_KEY = 'spree-ai-diagnosis-v1';
const TEST_HISTORY_STORAGE_KEY = 'spree-test-history-v1';
const RETURN_TO_ROOM_ON_LOAD_KEY = 'spree-return-room-on-load';
const AI_REVOCATION_COOKIE = 'spree_ai_revoked';
const PERSONA_ART_VERSION = '20260831-figma-4x';

function personaArtUrl(path) {
  const value = String(path || '').replace(/^\.\//, '');
  if (!value) return './assets/phone-raccoon.webp';
  return `./${value}${value.includes('?') ? '&' : '?'}v=${PERSONA_ART_VERSION}`;
}

const PANEL_META = {
  new: {
    index: '02',
    speech: '手机只是模拟界面。先把想买的记下来，别急着真付款。',
  },
  orders: {
    index: '02B',
    speech: '手机里还有一些决定没做完，先看看哪些还在冷静中。',
  },
  clinic: {
    index: '01',
    speech: '健身屏看的不是体重，是最近的钱包习惯。结果只来自你的记录。',
  },
  goals: {
    index: '03',
    speech: '把真正想要的写到白板上，零散冲动才有一个比较对象。',
  },
};

const STATUS_LABELS = {
  cooling: '冷静中',
  saved: '幸好没买',
  purchased: '最终购买',
};

const STATUS_TAG_LABELS = {
  cooling: '欲望冷却中',
  saved: '回血中',
  purchased: '已剁手',
};

const ORDER_STATUS_TRANSITIONS = Object.freeze({
  cooling: Object.freeze(['saved', 'purchased']),
  saved: Object.freeze(['purchased']),
  purchased: Object.freeze(['saved']),
});

const ORDER_TIME_FILTER_LABELS = Object.freeze({
  all: '全部时间',
  week: '本周',
  month: '本月',
  year: '年度',
});

function allowedOrderStatusActions(status) {
  return ORDER_STATUS_TRANSITIONS[status] || [];
}

function applyOrderStatusTransition(order, nextStatus, changedAt) {
  if (!allowedOrderStatusActions(order?.status).includes(nextStatus)) return false;
  const previousStatus = order.status;
  order.status = nextStatus;
  order.updatedAt = changedAt;
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({ from: previousStatus, to: nextStatus, at: changedAt });
  order.decidedAt ||= changedAt;
  return true;
}

function localOrderPeriod(filter, now = new Date()) {
  const anchor = new Date(now);
  if (Number.isNaN(anchor.getTime()) || filter === 'all') return null;
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (filter === 'week') {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (filter === 'month') {
    start.setDate(1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
  } else if (filter === 'year') {
    start.setMonth(0, 1);
    end.setFullYear(start.getFullYear() + 1, 0, 1);
  } else {
    return null;
  }
  return { start, end };
}

function orderMatchesTimeFilter(order, filter, now = new Date()) {
  if (filter === 'all') return true;
  const period = localOrderPeriod(filter, now);
  const createdAt = new Date(order?.createdAt);
  if (!period || Number.isNaN(createdAt.getTime())) return false;
  return createdAt >= period.start && createdAt < period.end;
}

const COMMERCE_TYPE_BY_CATEGORY = {
  学习成长: 'interest',
  服饰美妆: 'shop',
  餐饮饮品: 'food',
};

const COMMERCE_CATALOGS = {
  shop: {
    title: '商  城',
    label: '购物',
    searchPlaceholder: '搜索想放进冷静单的东西',
    filters: ['推荐', '数码', '箱包', '鞋靴', '美妆', '潮玩'],
    products: [
      { id: 'shop-headphones', name: '无线降噪耳机 Air', price: 1299, originalPrice: 1819, heat: 92, badge: '热销', filter: '数码', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-12.jpeg', category: '数码家居', reason: '被种草', detail: '沉浸式降噪，续航 30 小时。买它，你的通勤从此有了 BGM。', pitch: '分 12 期，换算到每天就是 3.6666 元', rating: 80, regret: '偏高' },
      { id: 'shop-bag', name: '复古真皮托特包', price: 799, heat: 88, badge: '限量', filter: '箱包', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-06.jpeg', category: '服饰美妆', reason: '限时优惠', detail: '复古轮廓配高饱和红色，通勤和周末都能装。', pitch: '限量两个字一出现，手就比脑子快', rating: 86, regret: '偏高' },
      { id: 'shop-shoes', name: '城市跑步鞋 Flow', price: 599, heat: 76, badge: '新品', filter: '鞋靴', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-02.jpeg', category: '服饰美妆', reason: '被种草', detail: '轻量缓震，适合把每一次出门都想象成城市慢跑。', pitch: '买了鞋，或许就会开始跑步', rating: 76, regret: '中等' },
      { id: 'shop-keyboard', name: '客制化机械键盘', price: 899, heat: 81, badge: '手感党', filter: '数码', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-03.jpeg', category: '数码家居', reason: '自我提升', detail: '清脆段落感和干净配色，桌面氛围一次到位。', pitch: '生产力装备，也可以先从手感开始', rating: 81, regret: '中等' },
      { id: 'shop-perfume', name: '沉香木质香水', price: 459, heat: 69, filter: '美妆', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-15.jpeg', category: '服饰美妆', reason: '情绪不好', detail: '清冷木质调，像把独处的房间调暗一格。', pitch: '今天值得拥有一点只属于自己的气味', rating: 69, regret: '中等' },
      { id: 'shop-knit', name: '极简羊毛针织衫', price: 369, heat: 64, filter: '推荐', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-09.jpeg', category: '服饰美妆', reason: '被种草', detail: '柔软基础款，简单到很容易说服自己“总会穿”。', pitch: '基础款不会过时，所以现在买也不早', rating: 64, regret: '中等' },
      { id: 'shop-camera', name: '复古胶片相机', price: 2380, heat: 90, badge: '文艺', filter: '数码', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-16.jpeg', category: '数码家居', reason: '被种草', detail: '把普通日常变成颗粒感故事，顺便多一个出门理由。', pitch: '有了相机，就会认真记录生活', rating: 90, regret: '偏高' },
      { id: 'shop-blindbox', name: '盲盒潮玩 · 星际系列', price: 239, heat: 95, badge: '🔥', filter: '潮玩', image: './assets/figma-commerce-20260901/shop-30-977/raw-image-14.jpeg', category: '娱乐社交', reason: '无聊', detail: '未知款式带来的短暂兴奋，拆开前永远最好玩。', pitch: '就差这一只，也许下一盒就是隐藏款', rating: 95, regret: '偏高' },
    ],
  },
  food: {
    title: '外  卖',
    label: '外卖',
    searchPlaceholder: '搜索现在最馋的那一口',
    filters: ['附近', '奶茶', '炸鸡', '火锅', '烧烤', '咖啡', '甜品'],
    products: [
      { id: 'food-milktea', name: '芝士芋泥啵啵奶茶', price: 22, heat: 93, badge: '招牌', filter: '奶茶', image: './assets/figma-commerce-20260901/food-30-1334/product-milk-tea.jpg', category: '餐饮饮品', reason: '嘴馋', detail: '三分糖去冰加芋泥，快乐是可以量产的。', pitch: '除了快乐，也可以收获一点脂肪，一点体重', rating: 75, regret: '偏高' },
      { id: 'food-chicken', name: '香辣炸鸡全家桶', price: 68, heat: 89, badge: '深夜限定', filter: '炸鸡', image: './assets/figma-commerce-20260901/food-30-1334/product-fried-chicken.jpg', category: '餐饮饮品', reason: '嘴馋', detail: '外酥里嫩，深夜的救赎，第二天的悔恨。', pitch: '一人吃不完，但可以先假装朋友马上到', rating: 89, regret: '偏高' },
      { id: 'food-hotpot', name: '麻辣牛油火锅套餐', price: 128, heat: 84, badge: '两人份', filter: '火锅', image: './assets/figma-commerce-20260901/food-30-1334/product-hotpot.jpg', category: '餐饮饮品', reason: '情绪不好', detail: '毛肚七上八下，情绪一涮就好。', pitch: '今天的烦恼需要一锅红汤来处理', rating: 84, regret: '中等' },
      { id: 'food-bbq', name: '深夜烧烤拼盘', price: 88, heat: 87, badge: '🔥', filter: '烧烤', image: './assets/figma-commerce-20260901/food-30-1334/product-bbq.jpg', category: '餐饮饮品', reason: '嘴馋', detail: '烤串配啤酒，人间不值得也得吃。', pitch: '都这么晚了，明天再自律也来得及', rating: 87, regret: '偏高' },
      { id: 'food-coffee', name: '手冲精品咖啡', price: 32, heat: 72, filter: '咖啡', image: './assets/figma-commerce-20260901/food-30-1334/product-coffee.jpg', category: '餐饮饮品', reason: '自我提升', detail: '续命神器，一杯抵三杯浓缩的清醒。', pitch: '这是工作需要，不算冲动消费', rating: 72, regret: '偏低' },
      { id: 'food-tiramisu', name: '提拉米苏甜品盒', price: 39, heat: 78, badge: '甜心', filter: '甜品', image: './assets/figma-commerce-20260901/food-30-1334/product-tiramisu.jpg', category: '餐饮饮品', reason: '情绪不好', detail: '带我走，Tiramisu 的意思你懂的。', pitch: '今天已经够累了，甜点是一种补偿', rating: 78, regret: '中等' },
    ],
  },
  interest: {
    title: '云兴趣',
    label: '兴趣',
    searchPlaceholder: '搜索你想虚拟拥有的东西',
    filters: ['精选', '摄影', '手作', '音乐', '运动', '体验'],
    products: [
      { id: 'interest-photography', name: '胶片摄影入门课', price: 499, heat: 82, badge: '6 节课', filter: '摄影', image: './assets/figma-commerce-20260901/interest-30-1936/product-film-photography.jpeg', category: '学习成长', reason: '自我提升', detail: '从曝光到构图，用六次练习留下真正属于你的画面。', pitch: '学习是第一生产力，行走江湖一技可傍身', rating: 82, regret: '偏低' },
      { id: 'interest-flower', name: '周末插花手作', price: 299, heat: 74, badge: '含花材', filter: '手作', image: './assets/figma-commerce-20260901/interest-30-1936/product-weekend-flower.png', category: '学习成长', reason: '情绪不好', detail: '用一束花把周末从工作日里完整地切出来。', pitch: '成品能带回家，体验就不算只花一次', rating: 74, regret: '偏低' },
      { id: 'interest-pottery', name: '陶艺拉坯体验', price: 388, heat: 80, badge: '🔥', filter: '体验', image: './assets/figma-commerce-20260901/interest-30-1936/product-pottery.jpeg', category: '学习成长', reason: '自我提升', detail: '让泥土在手里慢下来，做一只不那么完美的杯子。', pitch: '亲手做的东西，比买现成的更有意义', rating: 80, regret: '偏低' },
      { id: 'interest-guitar', name: '民谣吉他 21 天', price: 599, heat: 77, badge: '含教材', filter: '音乐', image: './assets/figma-commerce-20260901/interest-30-1936/product-guitar.jpeg', category: '学习成长', reason: '自我提升', detail: '从第一个和弦开始，二十一天后弹一首完整的歌。', pitch: '也许这次真的能把新爱好坚持下来', rating: 77, regret: '中等' },
      { id: 'interest-diving', name: '自由潜水初体验', price: 1280, heat: 85, badge: '含装备', filter: '运动', image: './assets/figma-commerce-20260901/interest-30-1936/product-free-diving.jpeg', category: '学习成长', reason: '自我提升', detail: '在水下听见自己的呼吸，完成一次全新的体验。', pitch: '人生清单上早晚要有这一项', rating: 85, regret: '偏高' },
      { id: 'interest-game', name: '剧本桌游之夜', price: 168, heat: 70, filter: '体验', image: './assets/figma-commerce-20260901/interest-30-1936/product-boardgame-night.jpeg', category: '娱乐社交', reason: '社交需要', detail: '一晚沉浸式故事，和朋友一起把日常暂时放下。', pitch: '大家都去，少我一个就不完整了', rating: 70, regret: '中等' },
    ],
  },
};

function commerceTypeForOrder(order = {}) {
  if (order.category === '餐饮饮品') return 'food';
  if (order.category === '学习成长' || order.category === '旅行交通') return 'interest';
  return 'shop';
}

function stableCommerceProductSuffix(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function staticCommerceProduct(productId) {
  return Object.values(COMMERCE_CATALOGS)
    .flatMap((catalog) => catalog.products)
    .find((product) => product.id === productId) || null;
}

function derivedCommerceProducts(type, orders = []) {
  const catalog = COMMERCE_CATALOGS[type] || COMMERCE_CATALOGS.shop;
  const groups = new Map();
  orders.filter((order) => commerceTypeForOrder(order) === type).forEach((order) => {
    const normalizedName = String(order?.name || '').trim().toLocaleLowerCase('zh-CN');
    if (!normalizedName) return;
    const timestamp = new Date(order.updatedAt || order.createdAt).getTime() || 0;
    const current = groups.get(normalizedName);
    if (!current || timestamp >= current.timestamp) {
      groups.set(normalizedName, {
        latestOrder: order,
        timestamp,
        count: (current?.count || 0) + 1,
      });
    } else {
      current.count += 1;
    }
  });

  return [...groups.entries()].map(([normalizedName, group]) => {
    const order = group.latestOrder;
    const preset = catalog.products.find((product) => product.name.trim().toLocaleLowerCase('zh-CN') === normalizedName);
    const fallback = staticCommerceProduct(ORDER_FALLBACK_PRODUCT_BY_CATEGORY[order.category]);
    const stableValue = Number.parseInt(stableCommerceProductSuffix(`${type}:${normalizedName}`), 36) || 0;
    return {
      ...(fallback || {}),
      ...(preset || {}),
      id: `order-product-${type}-${stableCommerceProductSuffix(normalizedName)}`,
      name: String(order.name).trim(),
      price: Number(order.amount) || 0,
      category: order.category || preset?.category || fallback?.category || '其他',
      reason: order.reason || preset?.reason || fallback?.reason || '其他',
      image: preset?.image || fallback?.image || './assets/phone-raccoon.webp',
      filter: '我的商品',
      badge: order.demo ? '我的商品 · 演示' : '我的商品',
      detail: preset?.detail || `已在订单中记录 ${group.count} 次，状态会与订单页同步。`,
      pitch: preset?.pitch || '它已经进入订单记录，先回订单页看看现在处于哪个状态。',
      heat: preset?.heat || 60 + (stableValue % 39),
      rating: preset?.rating || 60 + (stableValue % 31),
      regret: preset?.regret || '待观察',
      isOwned: true,
      orderCount: group.count,
      latestOrderId: order.id,
      timestamp: group.timestamp,
    };
  }).sort((a, b) => b.timestamp - a.timestamp || a.name.localeCompare(b.name, 'zh-CN'));
}

const ORDER_FALLBACK_PRODUCT_BY_CATEGORY = {
  餐饮饮品: 'food-milktea',
  服饰美妆: 'shop-bag',
  数码家居: 'shop-headphones',
  娱乐社交: 'shop-blindbox',
  学习成长: 'interest-photography',
  旅行交通: 'interest-diving',
};

const PEEL_COMMERCE_PRODUCT_BY_ID = Object.freeze({
  'milk-tea': 'food-milktea',
  'cold-brew': 'food-coffee',
  'sparkling-drink': 'food-milktea',
  headphones: 'shop-headphones',
  keyboard: 'shop-keyboard',
  camera: 'shop-camera',
  sneakers: 'shop-shoes',
  'shoulder-bag': 'shop-bag',
  'blind-box': 'shop-blindbox',
  'aroma-candle': 'shop-perfume',
  'camping-lamp': 'interest-diving',
});

const app = document.querySelector('#app');
const sceneFrame = document.querySelector('#sceneFrame');
const focusPanel = document.querySelector('#focusPanel');
const panelInner = focusPanel.querySelector('.panel-inner');
const panelClose = document.querySelector('#panelClose');
const panelCloseLabel = panelClose.querySelector('.panel-close-label');
const panelIndex = document.querySelector('#panelIndex');
const mascotBubble = document.querySelector('#mascotBubble');
const toast = document.querySelector('#toast');
const orderForm = document.querySelector('#orderForm');
const orderReceipt = document.querySelector('#orderReceipt');
const orderComposerModal = document.querySelector('#orderComposerModal');
const orderComposerCloseButton = document.querySelector('#orderComposerCloseButton');
const categoryCarousel = document.querySelector('#categoryCarousel');
const categoryCards = [...document.querySelectorAll('[data-category-shortcut]')];
const categoryDots = [...document.querySelectorAll('[data-category-dot]')];
const categoryCarouselStatus = document.querySelector('#categoryCarouselStatus');
const newPhoneScreen = document.querySelector('#newPhoneScreen');
const shoppingIntroView = document.querySelector('#shoppingIntroView');
const shoppingIntroTitle = document.querySelector('#shoppingIntroTitle');
const enterShoppingPhoneButton = document.querySelector('#enterShoppingPhoneButton');
const phoneHomeView = document.querySelector('#phoneHomeView');
const phoneCommerce = document.querySelector('#phoneCommerce');
const openMallButton = document.querySelector('#openMallButton');
const openMallButtonLabel = document.querySelector('#openMallButtonLabel');
const commerceTitle = document.querySelector('#commerceTitle');
const commerceBackButton = document.querySelector('#commerceBackButton');
const commerceOrdersButton = document.querySelector('#commerceOrdersButton');
const commerceCoolingBadge = document.querySelector('#commerceCoolingBadge');
const commerceSearchInput = document.querySelector('#commerceSearchInput');
const commerceFilters = document.querySelector('#commerceFilters');
const commerceProducts = document.querySelector('#commerceProducts');
const commerceCatalogView = document.querySelector('#commerceCatalogView');
const commerceDetailView = document.querySelector('#commerceDetailView');
const commerceDetailContent = document.querySelector('#commerceDetailContent');
const commercePrefillButton = document.querySelector('#commercePrefillButton');
const commerceBuyButton = document.querySelector('#commerceBuyButton');
const mallSuccessModal = document.querySelector('#mallSuccessModal');
const mallSuccessTitle = document.querySelector('#mallSuccessTitle');
const mallMoodIcon = document.querySelector('#mallMoodIcon');
const mallConfettiGif = document.querySelector('#mallConfettiGif');
const mallHornGif = document.querySelector('#mallHornGif');
const mallSuccessAdviceTitle = document.querySelector('#mallSuccessAdviceTitle');
const mallSuccessAdviceList = document.querySelector('#mallSuccessAdviceList');
const mallSuccessBackButton = document.querySelector('#mallSuccessBackButton');
const mallSuccessContinueButton = document.querySelector('#mallSuccessContinueButton');
const cancelOrderEditButton = document.querySelector('#cancelOrderEditButton');
const continueOrderButton = document.querySelector('#continueOrderButton');
const viewOrdersButton = document.querySelector('#viewOrdersButton');
const goalForm = document.querySelector('#goalForm');
const deleteGoalButton = document.querySelector('#deleteGoalButton');
const setActiveGoalButton = document.querySelector('#setActiveGoalButton');
const newGoalButton = document.querySelector('#newGoalButton');
const goalList = document.querySelector('#goalList');
const goalTargetAmount = document.querySelector('#goalTargetAmount');
const goalCurrentSaved = document.querySelector('#goalCurrentSaved');
const goalCurrentName = document.querySelector('#goalCurrentName');
const goalAmountInput = document.querySelector('#goalAmountInput');
const goalAmountError = document.querySelector('#goalAmountError');
const goalAmountBeads = [...document.querySelectorAll('[data-goal-amount]')];
const goalTabViews = [...document.querySelectorAll('[data-goals-panel]')];
const recoveryTabButtons = [...document.querySelectorAll('.recovery-tabs [data-recovery-view]')];
const desireBudgetRange = document.querySelector('#desireBudgetRange');
const controllerBudgetAmount = document.querySelector('#controllerBudgetAmount');
const controllerStateBadge = document.querySelector('#controllerStateBadge');
const controllerQuote = document.querySelector('#controllerQuote');
const controllerVerdict = document.querySelector('#controllerVerdict');
const controllerAdvice = document.querySelector('#controllerAdvice');
const controllerRaccoonImage = document.querySelector('#controllerRaccoonImage');
const sceneWhiteboardLayer = document.querySelector('#sceneWhiteboardLayer');
const mobileDock = document.querySelector('.mobile-dock');
const orderList = document.querySelector('#orderList');
const orderTimeFilter = document.querySelector('#orderTimeFilter');
const orderTimeFilterButton = document.querySelector('#orderTimeFilterButton');
const orderTimeFilterMenu = document.querySelector('#orderTimeFilterMenu');
const aiCard = document.querySelector('#aiCard');
const clinicPanel = document.querySelector('.panel-view[data-panel="clinic"]');
const clinicStartView = document.querySelector('#clinicStartView');
const clinicReportView = document.querySelector('#clinicReportView');
const clinicReportBackButton = document.querySelector('#clinicReportBackButton');
const clinicReportTitle = document.querySelector('#clinicReportTitle');
const analyzeButton = document.querySelector('#analyzeButton');
const gachaponTitle = document.querySelector('#gachaponTitle');
const gachaponHint = document.querySelector('#gachaponHint');
const gachaponPrize = document.querySelector('#gachaponPrize');
const gachaponMachine = document.querySelector('.gachapon-machine');
const gachaponTokens = [...document.querySelectorAll('.gachapon-token')];
const posterButton = document.querySelector('#posterButton');
const posterShare = document.querySelector('#posterShare');
const posterReturnButton = document.querySelector('#posterReturnButton');
const posterPreview = document.querySelector('#posterPreview');
const posterShareStatus = document.querySelector('#posterShareStatus');
const downloadPosterButton = document.querySelector('#downloadPosterButton');
const aiConsentPanel = document.querySelector('#aiConsentPanel');
const aiConsentSummary = document.querySelector('#aiConsentSummary');
const aiConsentCheckbox = document.querySelector('#aiConsentCheckbox');
const aiConsentMessage = document.querySelector('#aiConsentMessage');
const localOnlyButton = document.querySelector('#localOnlyButton');
const revokeAiConsentButton = document.querySelector('#revokeAiConsentButton');
const gachaponResultModal = document.querySelector('#gachaponResultModal');
const gachaponResultArt = document.querySelector('#gachaponResultArt');
const gachaponResultFlair = document.querySelector('#gachaponResultFlair');
const gachaponResultTags = document.querySelector('#gachaponResultTags');
const gachaponResultTitle = document.querySelector('#gachaponResultTitle');
const gachaponResultDescription = document.querySelector('#gachaponResultDescription');
const gachaponResultCloseButton = document.querySelector('#gachaponResultCloseButton');
const gachaponResultRetryButton = document.querySelector('#gachaponResultRetryButton');
const gachaponResultOpenButton = document.querySelector('#gachaponResultOpenButton');
const sceneStatus = document.querySelector('#sceneStatus');
const roomIntroGate = document.querySelector('#roomIntroGate');
const roomEntryLockup = document.querySelector('#roomEntryLockup');
const enterRoomButton = document.querySelector('#enterRoomButton');
const roomHelpDialog = document.querySelector('#roomHelpDialog');
const roomHelpButton = document.querySelector('#roomHelpButton');
const roomHelpCloseButton = document.querySelector('#roomHelpCloseButton');
const resetRoomViewButton = document.querySelector('#resetRoomViewButton');
const peelGameRoot = document.querySelector('#peelGameDialog');
const gestureControlElements = {
  root: document.querySelector('#gestureControl'),
  openButton: document.querySelector('#gestureControlButton'),
  dialog: document.querySelector('#gestureDialog'),
  closeButton: document.querySelector('#gestureDialogCloseButton'),
  startButton: document.querySelector('#gestureStartButton'),
  stopButton: document.querySelector('#gestureStopButton'),
  video: document.querySelector('#gestureVideo'),
  canvas: document.querySelector('#gestureOverlay'),
  status: document.querySelector('#gestureStatus'),
  mode: document.querySelector('#gestureLiveMode'),
  pointer: document.querySelector('#gestureCursor'),
};
const orientationControlElements = {
  root: document.querySelector('#orientationControl'),
  openButton: document.querySelector('#orientationControlButton'),
  dialog: document.querySelector('#orientationDialog'),
  closeButton: document.querySelector('#orientationDialogCloseButton'),
  startButton: document.querySelector('#orientationStartButton'),
  stopButton: document.querySelector('#orientationStopButton'),
  recalibrateButton: document.querySelector('#orientationRecalibrateButton'),
  status: document.querySelector('#orientationStatus'),
};
const monthlyGoalButtons = [...document.querySelectorAll('[data-monthly-goal]')];
const testHistoryList = document.querySelector('#testHistoryList');
const goalDatePicker = new GoalDatePicker(document.querySelector('#goalDateField'));

let activePanel = null;
let activeTrigger = null;
let activeFilter = 'all';
let activeTimeFilter = 'all';
let editingOrderId = null;
let activeClinicPeriod = 30;
let clinicView = 'start';
let activeGoalsView = 'goal';
let currentAssessment = null;
let personalityProfileRenderSignature = '';
let aiRequestController = null;
let aiRequestSequence = 0;
let aiUiState = { status: 'idle', message: '' };
let toastTimer = null;
let businessStateStorageDirty = false;
let state = loadState();
let testHistory = loadTestHistory();
let restoredTestHistory = null;
let aiConsentChannel = null;
try {
  if (typeof BroadcastChannel === 'function') aiConsentChannel = new BroadcastChannel('spree-ai-consent');
} catch {
}
let selectedGoalId = state.activeGoalId || state.goals[0]?.id || null;
let goalFormMode = selectedGoalId ? 'edit' : 'new';
let renderedGoalId = null;
let posterBlob = null;
let posterUrl = null;
let posterFingerprint = '';
let posterGenerating = false;
let posterShareReturnFocus = null;
let gachaponResultReturnFocus = null;
let clinicRenderPending = false;
let localGachaponSpinTimer = null;
let localGachaponSpinSequence = 0;
let localGachaponSpinning = false;
let gachaponResultSource = 'hybrid';
let clockDateSignature = '';
let clockClinicAssessmentFingerprint = '';
let roomEntered = false;
let pendingPanel = null;
let pendingActivity = null;
let activeActivity = null;
let peelActivityReturnFocus = null;
let peelCloseOptions = null;
let peelGameController = null;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let analysisStageState = {
  active: false,
  reducedMotion: false,
  index: 0,
  outcome: null,
  stage: ANALYSIS_STAGES[0],
};
const analysisStageController = createAnalysisStageController({
  onChange: (snapshot) => {
    analysisStageState = snapshot;
    updateAnalysisStageView();
  },
});
const gachaponMotion = createGachaponMotion({
  machine: gachaponMachine,
  tokens: gachaponTokens,
  reducedMotion: state.settings.reduceMotion || reducedMotionQuery.matches,
  active: false,
});
let activeCategoryCardIndex = Math.max(0, categoryCards.findIndex((button) => button.dataset.cardState === 'active'));
let categoryPointerStart = null;
let suppressCategoryShortcutClick = false;
let phoneView = 'intro';
let phoneViewFocusTimer = null;
let phoneViewFocusSequence = 0;
let orderComposerReturnFocus = null;
let activeCommerceType = COMMERCE_TYPE_BY_CATEGORY[categoryCards[activeCategoryCardIndex]?.dataset.categoryShortcut] || 'shop';
let activeCommerceFilter = COMMERCE_CATALOGS[activeCommerceType].filters[0];
let activeCommerceProductId = null;
let lastCommerceProduct = null;

const sceneHotspots = [...FEATURE_HOTSPOTS, ...ACTIVITY_HOTSPOTS, ...createPackageHotspots()];
const sceneViewportMedia = window.matchMedia('(max-width: 820px)');
const currentSceneDefaultView = () => (
  sceneViewportMedia.matches ? SCENE_MOBILE_DEFAULT_VIEW : SCENE_DEFAULT_VIEW
);
const ROOM_RACCOON_POINT = Object.freeze({
  yaw: (-42 * Math.PI) / 180,
  pitch: (-24 * Math.PI) / 180,
});
focusPanel.append(orderComposerModal);
const panorama = new PanoramaRoom({
  stage: sceneFrame,
  canvas: document.querySelector('#panoramaCanvas'),
  hotspotLayer: document.querySelector('#hotspotLayer'),
  imageUrl: './assets/room-panorama-hd.webp',
  hotspots: sceneHotspots,
  defaultView: currentSceneDefaultView(),
  initialView: SCENE_INTRO_VIEW,
  projection: 'spherical',
  interactionEnabled: false,
  onActivate: (hotspot, trigger) => {
    if (hotspot.activity === 'peel') {
      openPeelActivity(trigger);
      return;
    }
    openPanel(hotspot.panel, trigger);
  },
  onThought: () => {},
});

const gestureController = new RoomGestureController({
  stage: sceneFrame,
  panorama,
  elements: gestureControlElements,
  onToast: showToast,
  isRoomAvailable: () => roomEntered && !activePanel,
  isActivityAvailable: () => activeActivity === 'peel',
  isReducedMotion: () => document.body.classList.contains('reduce-motion'),
});
const orientationController = new RoomOrientationController({
  panorama,
  elements: orientationControlElements,
  onToast: showToast,
  onBeforeStart: () => gestureController.stop('user'),
  isRoomAvailable: () => roomEntered && !activePanel,
  isReducedMotion: () => document.body.classList.contains('reduce-motion'),
});
const peelGestureMapper = createPeelGestureMapper();
peelGameController = createPeelGameController({
  root: peelGameRoot,
  reducedMotion: () => document.body.classList.contains('reduce-motion'),
  onInputMode: handlePeelInputMode,
  onSummary: () => gestureController.finishActivityForSummary(),
  onIntent: handlePeelGameIntent,
  onClose: finalizePeelActivityClose,
});

function syncSceneDefaultView() {
  const nextView = currentSceneDefaultView();
  panorama.defaultView = { ...nextView };
  panorama.idleView = { ...nextView };
  if (!roomEntered || activePanel) return;
  panorama.animateToView(nextView, {
    duration: document.body.classList.contains('reduce-motion') ? 0 : 320,
    updateIdle: true,
  });
}

sceneViewportMedia.addEventListener('change', syncSceneDefaultView);

panorama.addProjectionObserver(() => {
  if (!mascotBubble) return;
  const point = panorama.projectPoint(ROOM_RACCOON_POINT.yaw, ROOM_RACCOON_POINT.pitch);
  mascotBubble.hidden = !point.visible;
  if (!point.visible) return;
  mascotBubble.style.left = `${point.x}px`;
  mascotBubble.style.top = `${point.y}px`;
  mascotBubble.style.setProperty('--raccoon-depth-scale', point.depthScale.toFixed(3));
});

const roomUiLayers = [...document.querySelectorAll('.topbar, .hotspot-layer, .scene-whiteboard-layer, .mobile-dock')];
const mobileDockButtons = [...document.querySelectorAll('.mobile-dock button')];
const roomBackgroundRegions = [
  document.querySelector('.topbar'),
  document.querySelector('.room-shell'),
].filter(Boolean);

function panelForMobileDockButton(button) {
  if (button.dataset.open === 'orders') return 'orders';
  return {
    'gym-screen': 'clinic',
    'sofa-phone': 'new',
    whiteboard: 'goals',
  }[button.dataset.sceneTarget] || null;
}

function syncMobileDock(panel) {
  const activePanel = panel === 'orders' ? 'new' : panel;
  mobileDockButtons.forEach((button) => {
    const isActive = panelForMobileDockButton(button) === activePanel;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function setClinicView(view, { focus = false, scroll = true } = {}) {
  const nextView = view === 'report' ? 'report' : 'start';
  const leavingHistoricalReport = nextView === 'start' && Boolean(restoredTestHistory);
  if (leavingHistoricalReport) {
    restoredTestHistory = null;
    personalityProfileRenderSignature = '';
  }
  clinicView = nextView;
  if (clinicPanel) clinicPanel.dataset.clinicView = nextView;
  if (clinicStartView) clinicStartView.hidden = nextView !== 'start';
  if (clinicReportView) clinicReportView.hidden = nextView !== 'report';
  if (activePanel === 'clinic' && scroll) panelInner.scrollTo({ top: 0, behavior: 'auto' });
  if (leavingHistoricalReport && activePanel === 'clinic') renderClinic();
  if (!focus || activePanel !== 'clinic') return;
  window.requestAnimationFrame(() => {
    const target = nextView === 'report' ? clinicReportTitle : gachaponTitle;
    target?.focus({ preventScroll: true });
  });
}

function setRoomUiInteractive(value) {
  roomUiLayers.forEach((element) => {
    element.inert = !value;
  });
  sceneFrame.tabIndex = value ? 0 : -1;
}

function setRoomBackgroundSuppressed(suppressed) {
  roomBackgroundRegions.forEach((element) => {
    element.inert = suppressed;
    if (suppressed) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
  });
}

function consumePeelGestureFrame(frame) {
  if (activeActivity !== 'peel' || !peelGameController) return;
  const command = peelGestureMapper.update(frame, frame?.at);
  if (command?.type === 'segment') peelGameController.applySegment(command);
  else if (command?.type === 'pause') peelGameController.pause('hand-lost');
  else if (command?.type === 'resume') peelGameController.resume();
}

function handlePeelInputMode(mode) {
  peelGestureMapper.reset();
  if (mode !== 'gesture') {
    gestureController.pauseActivityForPointer();
    return true;
  }
  void gestureController.startForActivity(consumePeelGestureFrame).then((started) => {
    if (!started && activeActivity === 'peel') {
      showToast('体感暂时没有开启，触摸、鼠标和键盘仍可继续。');
    }
  });
  return true;
}

function peelRoundSeed() {
  const orderSignature = state.orders
    .map((order) => `${order.id}:${order.status}:${order.updatedAt || order.createdAt || ''}`)
    .sort()
    .join('|');
  return `peel:${state.dataRevision}:${orderSignature}`;
}

function openPeelActivity(trigger = null, { updateHistory = true } = {}) {
  if (!roomEntered || activePanel || activeActivity === 'peel') return false;
  activeActivity = 'peel';
  peelActivityReturnFocus = trigger || document.querySelector('[data-hotspot-id="desire-peel"]');
  app.dataset.activity = 'peel';
  setRoomUiInteractive(false);
  setRoomBackgroundSuppressed(true);
  panorama.focusHotspot('desire-peel');
  panorama.setInteractionEnabled(false);
  orientationController.stop('panel');
  document.body.style.overflow = 'hidden';
  setMascotSpeech('商品不用碎，先把催你立刻买的话术剥开看看。');
  peelGestureMapper.reset();
  if (gestureController.canContinueIntoActivity()) {
    gestureController.continueIntoActivity(consumePeelGestureFrame);
  }
  if (updateHistory) {
    history.pushState({ panel: null, activity: 'peel', openedByApp: true }, '', buildRoomHash({ activity: 'peel' }));
  }
  void peelGameController.open({
    seed: peelRoundSeed(),
    orders: state.orders,
    tutorialCompleted: false,
  });
  return true;
}

function finalizePeelActivityClose() {
  if (activeActivity !== 'peel') return false;
  const options = peelCloseOptions || {};
  const returnTarget = peelActivityReturnFocus;
  peelCloseOptions = null;
  peelActivityReturnFocus = null;
  activeActivity = null;
  delete app.dataset.activity;
  peelGestureMapper.reset();
  setRoomUiInteractive(roomEntered && !activePanel);
  setRoomBackgroundSuppressed(Boolean(activePanel));
  panorama.setInteractionEnabled(roomEntered && !activePanel);
  if (!activePanel) panorama.resetView();
  document.body.style.overflow = activePanel && window.innerWidth <= 820 ? 'hidden' : '';
  if (options.updateHistory !== false) {
    history.replaceState({ panel: null, activity: null, openedByApp: false }, '', buildRoomHash());
  }
  if (options.resumeGesture !== false) gestureController.returnToRoomFromActivity();
  if (options.restoreFocus !== false) {
    window.requestAnimationFrame(() => {
      if (returnTarget && document.contains(returnTarget) && returnTarget.getClientRects().length > 0) {
        returnTarget.focus({ preventScroll: true });
      } else {
        sceneFrame.focus({ preventScroll: true });
      }
    });
  }
  if (!activePanel) setMascotSpeech(idleSpeech());
  return true;
}

function closePeelActivity(options = {}) {
  if (activeActivity !== 'peel') return false;
  peelCloseOptions = options;
  peelGameController.close();
  return true;
}

function resolvePeelFocusAction(focusItem, orders = state.orders) {
  if (focusItem?.source === 'order') {
    const order = orders.find((item) => (
      String(item.id) === String(focusItem.orderId) && item.status === 'cooling'
    ));
    if (order) return { type: 'existing-order', orderId: order.id };
  }
  const productId = PEEL_COMMERCE_PRODUCT_BY_ID[focusItem?.id];
  return productId
    ? { type: 'catalog-product', productId }
    : { type: 'blank-composer' };
}

function openPeelBusinessPanel(panel, trigger, commerceType = 'shop') {
  if (panel === 'orders') {
    history.replaceState({ panel: 'orders', openedByApp: true }, '', '#orders');
    applyPanel('orders', trigger);
    return;
  }
  const route = { panel: 'new', phoneView: 'home', commerceType, productId: null };
  history.replaceState({ ...route, openedByApp: true }, '', buildNewHash(route));
  showPhoneView('home', { type: commerceType });
  applyPanel('new', trigger);
}

function focusPeelOrder(orderId) {
  const action = [...orderList.querySelectorAll('[data-order-action]')]
    .find((button) => button.dataset.orderId === String(orderId));
  action?.focus({ preventScroll: true });
  return Boolean(action);
}

function handlePeelGameIntent(intent) {
  if (intent?.type === 'replay') return false;
  if (intent?.type === 'dismiss') {
    closePeelActivity();
    showToast('这一局只留在这一局，商品和看穿层数都没有保存。');
    return true;
  }
  if (intent?.type !== 'cool') return false;

  const action = resolvePeelFocusAction(intent.focusItem);
  const trigger = peelActivityReturnFocus;
  closePeelActivity({ updateHistory: false, resumeGesture: false, restoreFocus: false });
  gestureController.handoffActivityToPanel();

  if (action.type === 'existing-order') {
    activeFilter = 'all';
    activeTimeFilter = 'all';
    renderOrders();
    openPeelBusinessPanel('orders', trigger);
    window.requestAnimationFrame(() => focusPeelOrder(action.orderId));
    showToast('这件商品已经在冷静区，没有重复创建。');
    return true;
  }

  const product = action.type === 'catalog-product'
    ? staticCommerceProduct(action.productId)
    : null;
  const commerceType = product ? commerceTypeForOrder(product) : 'shop';
  openPeelBusinessPanel('new', trigger, commerceType);
  if (product) prefillOrderFromCommerce(product, trigger);
  else {
    resetOrderComposer();
    openOrderComposer(trigger);
    showToast('先把想冷静的商品写下来，提交后才会产生记录。');
  }
  return true;
}

function peelActivityFocusableElements() {
  return [...peelGameRoot.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && !element.closest('[hidden]') && element.getClientRects().length > 0);
}

function handlePeelActivityKeydown(event) {
  if (activeActivity !== 'peel') return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closePeelActivity();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = peelActivityFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement);
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
    : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
  if (currentIndex >= 0 && !event.shiftKey && currentIndex < focusable.length - 1) return;
  if (currentIndex > 0 && event.shiftKey) return;
  event.preventDefault();
  focusable[nextIndex].focus({ preventScroll: true });
}

function completeRoomEntry() {
  roomEntered = true;
  setRoomUiInteractive(true);
  panorama.setInteractionEnabled(true);
  if (pendingPanel || pendingActivity) {
    const pendingRoute = routeSnapshot(history.state || {});
    pendingPanel = null;
    pendingActivity = null;
    syncRouteFromLocation(pendingRoute);
    return;
  }
  sceneStatus.textContent = panorama.ready ? '全景已就绪 · 拖动环视' : '静态房间已就绪 · 使用文字导航';
  sceneFrame.focus({ preventScroll: true });
}

setRoomUiInteractive(false);
focusPanel.inert = true;
focusPanel.setAttribute('aria-hidden', 'true');

const roomIntro = new RoomIntro({
  app,
  gate: roomIntroGate,
  video: document.querySelector('#roomIntroVideo'),
  entryVideo: document.querySelector('#roomEntryVideo'),
  canvas: document.querySelector('#introPixelCanvas'),
  status: document.querySelector('#introStatus'),
  lockup: roomEntryLockup,
  enterButton: enterRoomButton,
  duration: 3000,
  reducedMotion: state.settings.reduceMotion || reducedMotionQuery.matches,
  onEnter: () => panorama.animateToView(currentSceneDefaultView(), {
    duration: document.body.classList.contains('reduce-motion') ? 0 : ENTRY_TRANSITION_MS,
    updateIdle: true,
  }),
  onComplete: completeRoomEntry,
});

const sceneWhiteboard = new SceneBudgetWhiteboard({
  layer: sceneWhiteboardLayer,
  status: document.querySelector('#sceneWhiteboardStatus'),
  panorama,
  surface: SCENE_WHITEBOARD_SURFACE,
  onMove: updateGoalNotePosition,
  onEdit: editGoalNote,
});

function defaultState() {
  return {
    schemaVersion: 2,
    dataRevision: 0,
    orders: [],
    goals: [],
    activeGoalId: null,
    diagnosis: null,
    settings: { reduceMotion: false, aiConsent: false },
  };
}

function setAiConsentRevocationFallback(revoked) {
  let sessionUpdated = false;
  let storageUpdated = false;
  let cookieUpdated = false;
  try {
    if (revoked) sessionStorage.setItem(SESSION_AI_REVOCATION_KEY, '1');
    else sessionStorage.removeItem(SESSION_AI_REVOCATION_KEY);
    sessionUpdated = true;
  } catch {
  }
  try {
    if (revoked) localStorage.setItem(AI_REVOCATION_STORAGE_KEY, String(Date.now()));
    else localStorage.removeItem(AI_REVOCATION_STORAGE_KEY);
    storageUpdated = true;
  } catch {
  }
  try {
    document.cookie = revoked
      ? `${AI_REVOCATION_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Strict`
      : `${AI_REVOCATION_COOKIE}=; Max-Age=0; Path=/; SameSite=Strict`;
    const hasCookie = document.cookie
      .split(';')
      .some((part) => part.trim() === `${AI_REVOCATION_COOKIE}=1`);
    cookieUpdated = revoked ? hasCookie : !hasCookie;
  } catch {
  }
  return { sessionUpdated, storageUpdated, cookieUpdated };
}

function aiConsentRevokedByFallback() {
  try {
    if (sessionStorage.getItem(SESSION_AI_REVOCATION_KEY) === '1') return true;
  } catch {
  }
  try {
    if (localStorage.getItem(AI_REVOCATION_STORAGE_KEY)) return true;
  } catch {
  }
  try {
    return document.cookie
      .split(';')
      .some((part) => part.trim() === `${AI_REVOCATION_COOKIE}=1`);
  } catch {
    return false;
  }
}

function setAiConsentGrantedForSession(granted) {
  try {
    if (granted) sessionStorage.setItem(SESSION_AI_CONSENT_KEY, '1');
    else sessionStorage.removeItem(SESSION_AI_CONSENT_KEY);
    return true;
  } catch {
    return false;
  }
}

function aiConsentGrantedForSession() {
  try {
    return sessionStorage.getItem(SESSION_AI_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

function setAiDiagnosisInvalidatedForSession(invalidated) {
  try {
    if (invalidated) sessionStorage.setItem(SESSION_AI_DIAGNOSIS_INVALIDATED_KEY, '1');
    else sessionStorage.removeItem(SESSION_AI_DIAGNOSIS_INVALIDATED_KEY);
    return true;
  } catch {
    return false;
  }
}

function aiDiagnosisInvalidatedForSession() {
  try {
    return sessionStorage.getItem(SESSION_AI_DIAGNOSIS_INVALIDATED_KEY) === '1';
  } catch {
    return true;
  }
}

function businessStateForStorage(snapshot) {
  return {
    ...snapshot,
    diagnosis: null,
    settings: { ...snapshot.settings, aiConsent: false },
  };
}

function parseBusinessStateSnapshot(rawValue) {
  try {
    const parsed = rawValue === null ? defaultState() : JSON.parse(rawValue);
    if (!parsed || ![1, 2].includes(parsed.schemaVersion) || !Array.isArray(parsed.orders)) return null;
    return businessStateForStorage(migrateBudgetState({
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
    }));
  } catch {
    return null;
  }
}

function businessStateFingerprint(snapshot = state) {
  return JSON.stringify({
    schemaVersion: 2,
    dataRevision: Number(snapshot?.dataRevision) || 0,
    orders: Array.isArray(snapshot?.orders) ? snapshot.orders : [],
    goals: Array.isArray(snapshot?.goals) ? snapshot.goals : [],
    activeGoalId: snapshot?.activeGoalId || null,
  });
}

function diagnosisBusinessStateFingerprint(snapshot = state) {
  const activeGoal = activeBudgetGoal(snapshot);
  return JSON.stringify({
    schemaVersion: 2,
    dataRevision: Number(snapshot?.dataRevision) || 0,
    orders: Array.isArray(snapshot?.orders) ? snapshot.orders : [],
    activeGoalId: snapshot?.activeGoalId || null,
    activeGoal: activeGoal ? {
      id: activeGoal.id || null,
      amount: Number(activeGoal.amount) || 0,
      createdAt: activeGoal.createdAt || null,
      source: activeGoal.source || (activeGoal.demo ? 'demo' : 'personal'),
    } : null,
  });
}

function persistedDiagnosisBusinessStateFingerprint() {
  if (businessStateStorageDirty) return 'unavailable';
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);
    const snapshot = parseBusinessStateSnapshot(rawValue);
    return snapshot ? `valid:${diagnosisBusinessStateFingerprint(snapshot)}` : 'invalid';
  } catch {
    return 'unavailable';
  }
}

function loadPersistedAiDiagnosis() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AI_DIAGNOSIS_STORAGE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function persistAiDiagnosis(diagnosis, { silent = false } = {}) {
  try {
    if (diagnosis) localStorage.setItem(AI_DIAGNOSIS_STORAGE_KEY, JSON.stringify(diagnosis));
    else localStorage.removeItem(AI_DIAGNOSIS_STORAGE_KEY);
    return true;
  } catch {
    if (!silent) window.setTimeout(() => showToast('综合推演结果暂时无法保存，本页仍会使用当前结果。'), 0);
    return false;
  }
}

function restoreAiSessionState(snapshot) {
  const consentIsCurrent = aiConsentGrantedForSession() && !aiConsentRevokedByFallback();
  const diagnosisIsAllowed = consentIsCurrent && !aiDiagnosisInvalidatedForSession();
  snapshot.settings.aiConsent = consentIsCurrent;
  snapshot.diagnosis = diagnosisIsAllowed ? loadPersistedAiDiagnosis() : null;
  if (!diagnosisIsAllowed) persistAiDiagnosis(null, { silent: true });
  return snapshot;
}

function aiConsentIsCurrent() {
  return Boolean(state.settings.aiConsent
    && aiConsentGrantedForSession()
    && !aiConsentRevokedByFallback());
}

function gachaponIsBusy() {
  return aiUiState.status === 'requesting' || localGachaponSpinning;
}

function cancelLocalGachaponSpin() {
  const wasSpinning = localGachaponSpinning || localGachaponSpinTimer !== null;
  localGachaponSpinSequence += 1;
  if (localGachaponSpinTimer !== null) window.clearTimeout(localGachaponSpinTimer);
  localGachaponSpinTimer = null;
  localGachaponSpinning = false;
  return wasSpinning;
}

function cancelAiRequest(reason = 'cancelled') {
  const cancelledLocalSpin = cancelLocalGachaponSpin();
  analysisStageController.stop();
  if (!aiRequestController) return cancelledLocalSpin;
  const requestController = aiRequestController;
  aiRequestController = null;
  aiRequestSequence += 1;
  requestController.abort(reason);
  return true;
}

function applyExternalConsentRevocation() {
  const wasGranted = state.settings.aiConsent || aiConsentGrantedForSession();
  const hadDiagnosis = Boolean(state.diagnosis);
  const hadOpenResult = Boolean(gachaponResultModal?.open);
  state.settings.aiConsent = false;
  state.diagnosis = null;
  setAiConsentGrantedForSession(false);
  setAiDiagnosisInvalidatedForSession(true);
  cancelAiRequest('consent-revoked');
  persistAiDiagnosis(null, { silent: true });
  closeGachaponResult({ restoreFocus: false, flushPending: false });
  clearPoster();
  if (aiConsentCheckbox) aiConsentCheckbox.checked = false;
  if (aiConsentMessage) aiConsentMessage.textContent = '';
  if (!wasGranted && !hadDiagnosis && !hadOpenResult) return;
  aiUiState = { status: 'idle', message: '' };
  if (activePanel === 'clinic') renderClinic();
  showToast('数据发送同意已在另一个页面撤回。');
}

function loadState() {
  let loaded;
  let sourceKey;
  let parsed;
  let needsDiagnosisCleanup = false;
  let needsBudgetMigrationCleanup = false;
  try {
    sourceKey = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS].find((key) => localStorage.getItem(key));
    if (!sourceKey) return restoreAiSessionState(defaultState());
    parsed = JSON.parse(localStorage.getItem(sourceKey));
    if (!parsed || ![1, 2].includes(parsed.schemaVersion) || !Array.isArray(parsed.orders)) return restoreAiSessionState(defaultState());
    loaded = migrateBudgetState({
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...(parsed.settings || {}) },
    });
    needsBudgetMigrationCleanup = JSON.stringify(parsed.goals || []) !== JSON.stringify(loaded.goals)
      || JSON.stringify(parsed.orders) !== JSON.stringify(loaded.orders)
      || parsed.activeGoalId !== loaded.activeGoalId;
    const legacyDiagnosisNeedsCleanup = Boolean(parsed.diagnosis || parsed.settings?.aiConsent);
    loaded = restoreAiSessionState(loaded);
    const diagnosisHasPrivateMetadata = Boolean(loaded.diagnosis
      && (Object.hasOwn(loaded.diagnosis, 'provider') || Object.hasOwn(loaded.diagnosis, 'model')));
    if (diagnosisHasPrivateMetadata) {
      loaded.diagnosis = { ...loaded.diagnosis };
      delete loaded.diagnosis.provider;
      delete loaded.diagnosis.model;
      persistAiDiagnosis(loaded.diagnosis, { silent: true });
    }
    needsDiagnosisCleanup = legacyDiagnosisNeedsCleanup || diagnosisHasPrivateMetadata;
  } catch {
    window.setTimeout(() => showToast('本地记录暂时无法读取，本次先使用临时空间。'), 0);
    return defaultState();
  }

  const shouldPersistMigration = sourceKey !== STORAGE_KEY
    || parsed.schemaVersion !== 2
    || needsBudgetMigrationCleanup
    || needsDiagnosisCleanup;
  if (shouldPersistMigration) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(businessStateForStorage(loaded)));
      businessStateStorageDirty = false;
    } catch {
      businessStateStorageDirty = true;
      window.setTimeout(() => showToast('旧记录已在本次会话恢复，但暂时无法写回；刷新后仍会从原记录重试。'), 0);
    }
  }
  return loaded;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(businessStateForStorage(state)));
    businessStateStorageDirty = false;
    return true;
  } catch {
    businessStateStorageDirty = true;
    window.setTimeout(() => showToast('本地存储暂不可用，本次刷新后数据可能丢失。'), 0);
    return false;
  }
}

function applyExternalBusinessState(rawValue) {
  if (businessStateStorageDirty) return false;
  let persistedRawValue;
  try {
    persistedRawValue = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (persistedRawValue !== rawValue) return false;
  const incoming = parseBusinessStateSnapshot(rawValue);
  if (!incoming || businessStateFingerprint(incoming) === businessStateFingerprint(state)) return false;

  const diagnosisContextChanged = diagnosisBusinessStateFingerprint(incoming) !== diagnosisBusinessStateFingerprint(state);
  const currentDiagnosis = state.diagnosis;
  if (diagnosisContextChanged) cancelAiRequest('business-data-changed');
  const consentIsCurrent = aiConsentGrantedForSession() && !aiConsentRevokedByFallback();
  state = {
    ...incoming,
    diagnosis: diagnosisContextChanged ? null : currentDiagnosis,
    settings: { ...incoming.settings, aiConsent: consentIsCurrent },
  };
  restoredTestHistory = null;
  businessStateStorageDirty = false;
  if (diagnosisContextChanged) {
    setAiDiagnosisInvalidatedForSession(true);
    persistAiDiagnosis(null, { silent: true });
    aiUiState = { status: 'idle', message: '' };
    currentAssessment = null;
    personalityProfileRenderSignature = '';
  }
  selectedGoalId = state.goals.some((goal) => goal.id === state.activeGoalId)
    ? state.activeGoalId
    : state.goals[0]?.id || null;
  goalFormMode = selectedGoalId ? 'edit' : 'new';
  renderedGoalId = null;
  if (diagnosisContextChanged) {
    closeGachaponResult({ restoreFocus: false, flushPending: false });
    clearPoster();
  }
  syncReducedMotionPreference();
  renderAll();
  showToast(diagnosisContextChanged
    ? '另一个页面更新了记录，本页已同步并重新计算。'
    : '另一个页面更新了白板便签外观，本页已同步。');
  return true;
}

function mutate(mutator) {
  cancelAiRequest('data-changed');
  restoredTestHistory = null;
  aiUiState = { status: 'idle', message: '' };
  mutator(state);
  state.dataRevision += 1;
  const persisted = saveState();
  renderAll();
  return persisted;
}

function currentGoal() {
  return activeBudgetGoal(state);
}

function goalForAssessment(assessment) {
  const goal = currentGoal();
  if (!goal || !['personal', 'demo'].includes(assessment?.source)) return null;
  const assessmentUsesDemo = assessment.source === 'demo';
  return Boolean(goal.demo) === assessmentUsesDemo ? goal : null;
}

function goalById(goalId) {
  return state.goals.find((goal) => goal.id === goalId) || null;
}

function createLocalId(prefix) {
  return crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function sameLocalDay(dateA, dateB = new Date()) {
  const a = new Date(dateA);
  return a.getFullYear() === dateB.getFullYear()
    && a.getMonth() === dateB.getMonth()
    && a.getDate() === dateB.getDate();
}

function localDateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function totals() {
  const todayOrders = state.orders.filter((order) => sameLocalDay(order.createdAt));
  return {
    recordedToday: todayOrders.reduce((sum, order) => sum + order.amount, 0),
    savedToday: todayOrders.filter((order) => order.status === 'saved').reduce((sum, order) => sum + order.amount, 0),
    savedAll: state.orders.filter((order) => order.status === 'saved').reduce((sum, order) => sum + order.amount, 0),
    purchasedAll: state.orders.filter((order) => order.status === 'purchased').reduce((sum, order) => sum + order.amount, 0),
    cooling: state.orders.filter((order) => order.status === 'cooling').length,
  };
}

function orderDataMode(orders = []) {
  if (!orders.length) return 'empty';
  if (orders.every((order) => Boolean(order.demo))) return 'demo';
  if (orders.some((order) => Boolean(order.demo))) return 'mixed';
  return 'personal';
}

function dataScopeLabel(mode, count = 1) {
  if (!count || mode === 'empty') return '暂无记录';
  if (mode === 'demo') return '演示数据';
  if (mode === 'mixed') return '个人 + 演示';
  return '个人记录';
}

function loadTestHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEST_HISTORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item
      && typeof item.id === 'string'
      && typeof item.generatedAt === 'string'
      && typeof item.personaName === 'string')
      .slice(0, 12);
  } catch {
    return [];
  }
}

function restorableHistoryAssessment(assessment) {
  return Boolean(assessment
    && assessment.eligible
    && [7, 30].includes(Number(assessment.period))
    && assessment.primaryPersona
    && assessment.totals
    && assessment.axes
    && assessment.motivations
    && assessment.confidence
    && Array.isArray(assessment.categories)
    && Array.isArray(assessment.reasons)
    && Array.isArray(assessment.evidence));
}

function cloneLocalSnapshot(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function serializeReportProductGroups(groups = []) {
  return groups.map((group) => ({
    name: group.name,
    category: group.category,
    reason: group.reason,
    amount: group.amount,
    count: group.count,
    impulseScore: group.impulseScore,
    evidence: [...group.evidence],
    latestAt: group.latestAt,
    latestOrder: cloneLocalSnapshot(group.latestOrder),
    demoCount: group.demoCount,
  }));
}

function restoreReportProductGroups(groups = []) {
  if (!Array.isArray(groups)) return [];
  return groups.filter((group) => group
    && typeof group.name === 'string'
    && Number.isFinite(Number(group.amount))
    && group.latestOrder)
    .slice(0, 3)
    .map((group) => ({
      ...group,
      amount: Number(group.amount) || 0,
      count: Math.max(1, Number(group.count) || 1),
      impulseScore: Math.max(0, Number(group.impulseScore) || 0),
      evidence: new Set(Array.isArray(group.evidence) ? group.evidence.map(String).slice(0, 8) : []),
      latestAt: Number(group.latestAt) || 0,
      demoCount: Math.max(0, Number(group.demoCount) || 0),
    }));
}

function historicalReportContextFor(assessment = currentAssessment) {
  if (!restoredTestHistory || !restorableHistoryAssessment(assessment)) return null;
  return assessmentReportFingerprint(restoredTestHistory.assessment) === assessmentReportFingerprint(assessment)
    ? restoredTestHistory
    : null;
}

function saveTestHistory() {
  try {
    localStorage.setItem(TEST_HISTORY_STORAGE_KEY, JSON.stringify(testHistory.slice(0, 12)));
    return true;
  } catch {
    return false;
  }
}

function rememberTestResult(assessment, presentation, source) {
  const confidence = presentation.inference
    ? Math.round(presentation.inference.confidence * 100)
    : assessment.confidence.score;
  const periodOrders = clinicPeriodOrders(assessment.period, assessment.source);
  const diagnosisSteps = diagnosisIsFreshFor(assessment)
    ? (state.diagnosis?.result?.action?.steps || []).map(String).slice(0, 3)
    : [];
  const assessmentSnapshot = cloneLocalSnapshot(assessment);
  if (!restorableHistoryAssessment(assessmentSnapshot)) return false;
  testHistory.unshift({
    id: createLocalId('test'),
    generatedAt: new Date().toISOString(),
    period: assessment.period,
    orderCount: assessment.orderCount,
    personaName: presentation.card.displayName,
    canonicalName: presentation.canonical.name,
    confidence,
    dataMode: assessment.dataMode,
    source: source === 'local' ? 'local' : 'hybrid',
    assessment: assessmentSnapshot,
    presentationInference: cloneLocalSnapshot(presentation.inference),
    productGroups: serializeReportProductGroups(reportProductGroups(periodOrders)),
    adviceSteps: diagnosisSteps,
    goal: cloneLocalSnapshot(goalForAssessment(assessment)),
  });
  testHistory = testHistory.slice(0, 12);
  saveTestHistory();
  renderTestHistory();
  return true;
}

function restoreTestHistoryResult(historyId) {
  const entry = testHistory.find((item) => item.id === historyId);
  if (!entry || !restorableHistoryAssessment(entry.assessment)) {
    showToast('这条旧记录只有摘要，完成一次新测试后即可重新打开完整报告。');
    return false;
  }
  cancelAiRequest('history-report-opened');
  closeGachaponResult({ restoreFocus: false, flushPending: false });
  clearPoster();
  activeClinicPeriod = Number(entry.assessment.period) === 7 ? 7 : 30;
  restoredTestHistory = entry;
  currentAssessment = cloneLocalSnapshot(entry.assessment);
  personalityProfileRenderSignature = '';
  aiUiState = { status: 'idle', message: '' };
  renderClinic(currentAssessment);
  pushClinicView('report', {
    replaceCurrent: activePanel === 'clinic' && clinicView === 'report',
  });
  showToast('已打开当次保存的消费报告。');
  return true;
}

function renderTestHistory() {
  if (!testHistoryList) return;
  if (!testHistory.length) {
    testHistoryList.innerHTML = '<div class="test-history-empty"><b>还没有历史报告</b><span>完成一次消费测试后会自动保存在这里。</span></div>';
    return;
  }
  testHistoryList.innerHTML = testHistory.map((item) => {
    const generatedAt = new Date(item.generatedAt);
    const time = Number.isFinite(generatedAt.getTime())
      ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(generatedAt)
      : '时间未知';
    const canRestore = restorableHistoryAssessment(item.assessment);
    return `<button type="button" class="test-history-item" data-history-id="${escapeHtml(item.id)}" ${canRestore ? '' : 'aria-disabled="true"'} aria-label="${canRestore ? '打开' : '查看摘要：'}${escapeHtml(item.personaName)}，${escapeHtml(time)}">
      <time datetime="${escapeHtml(item.generatedAt)}">${escapeHtml(time)}</time>
      <div><h4>${escapeHtml(item.personaName)}</h4><p>规则底座 ${escapeHtml(item.canonicalName)} · 近 ${Number(item.period) || 30} 天 · ${Number(item.orderCount) || 0} 笔</p></div>
      <span><b>${Math.max(0, Math.min(100, Number(item.confidence) || 0))}%</b><small>${canRestore ? '打开报告' : '旧版摘要'}</small></span>
    </button>`;
  }).join('');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2500);
}

function setMascotSpeech(message) {
  mascotBubble.textContent = message;
}

const CONTROLLER_BUDGET_MIN = 500;
const CONTROLLER_BUDGET_MAX = 10000;
const CONTROLLER_BUDGET_DEFAULT = 600;

// The four Figma frames are representative states on one continuous slider.
// Midpoints between their anchor amounts keep every state reachable without
// turning the temporary preview into a second goal or order data source.
const CONTROLLER_BUDGET_TIERS = Object.freeze([
  Object.freeze({
    anchor: 600,
    max: 1800,
    name: 'calm',
    imageSrc: './assets/figma-controller-20260901/controller-elegant.webp',
    imageAlt: '穿西装的小浣熊坐在扶手椅上举着酒杯',
    badge: '优雅有钱人',
    quote: '预算可以很自由，钱包不行。',
    verdict: '钱包状态：容光焕发',
    advice: '不错不错，保持下去，小目标不是梦！',
  }),
  Object.freeze({
    anchor: 3000,
    max: 5000,
    name: 'steady',
    imageSrc: './assets/figma-controller-20260901/controller-worker.webp',
    imageAlt: '小浣熊坐在电脑前努力工作',
    badge: '努力打工人',
    quote: '花钱之前，先把班上了。',
    verdict: '钱包状态：轻微颤抖',
    advice: '已经够花了，再往右拖，浣熊要开始加班了。',
  }),
  Object.freeze({
    anchor: 7000,
    max: 8500,
    name: 'alert',
    imageSrc: './assets/figma-controller-20260901/controller-side-hustle.webp',
    imageAlt: '小浣熊骑着外卖电动车努力送单',
    badge: '深夜副业党',
    quote: '节不了流就学着开源，少走弯路',
    verdict: '钱包状态：勉强保命',
    advice: '拉的大大胆胆，单子肥肥嘟嘟，钱包岌岌可危',
  }),
  Object.freeze({
    anchor: 10000,
    max: Infinity,
    name: 'pause',
    imageSrc: './assets/figma-controller-20260901/controller-beggar.webp',
    imageAlt: '穿着破旧衣服的小浣熊拿着木碗和行囊',
    badge: '落魄讨饭人',
    quote: '预算可以很自由，钱包不行。',
    verdict: '钱包状态：命悬一线',
    advice: '就只活一天，明天后天大后天都不想活了吗？',
  }),
]);

function controllerBudgetTierFor(rawAmount) {
  const parsedAmount = Number(rawAmount);
  const amount = Number.isFinite(parsedAmount)
    ? Math.max(CONTROLLER_BUDGET_MIN, Math.min(CONTROLLER_BUDGET_MAX, parsedAmount))
    : CONTROLLER_BUDGET_DEFAULT;
  return CONTROLLER_BUDGET_TIERS.find((item) => amount <= item.max) || CONTROLLER_BUDGET_TIERS.at(-1);
}

function renderControllerBudget() {
  const parsedAmount = Number(desireBudgetRange?.value);
  const amount = Number.isFinite(parsedAmount)
    ? Math.max(CONTROLLER_BUDGET_MIN, Math.min(CONTROLLER_BUDGET_MAX, parsedAmount))
    : CONTROLLER_BUDGET_DEFAULT;
  const tier = controllerBudgetTierFor(amount);
  const progress = ((amount - CONTROLLER_BUDGET_MIN) / (CONTROLLER_BUDGET_MAX - CONTROLLER_BUDGET_MIN)) * 100;
  controllerBudgetAmount.textContent = money(amount);
  controllerStateBadge.textContent = tier.badge;
  controllerQuote.textContent = tier.quote;
  controllerVerdict.textContent = tier.verdict;
  controllerAdvice.textContent = tier.advice;
  if (controllerRaccoonImage.dataset.tier !== tier.name) {
    controllerRaccoonImage.classList.add('is-changing');
    controllerRaccoonImage.addEventListener('load', () => {
      window.requestAnimationFrame(() => controllerRaccoonImage.classList.remove('is-changing'));
    }, { once: true });
    window.setTimeout(() => controllerRaccoonImage.classList.remove('is-changing'), 320);
    controllerRaccoonImage.src = tier.imageSrc;
    controllerRaccoonImage.alt = tier.imageAlt;
    controllerRaccoonImage.dataset.tier = tier.name;
  }
  desireBudgetRange.setAttribute('aria-valuetext', `${money(amount)}，${tier.badge}`);
  desireBudgetRange.style.setProperty('--controller-progress', `${progress}%`);
  document.querySelector('#goalController').dataset.tier = tier.name;
}

CONTROLLER_BUDGET_TIERS.forEach((tier) => {
  const image = new Image();
  image.src = tier.imageSrc;
});

function setRecoveryTabState(view) {
  const activeView = view === 'controller' || view === 'orders' ? view : 'goal';
  recoveryTabButtons.forEach((button) => {
    const isActive = button.dataset.recoveryView === activeView;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    button.setAttribute('tabindex', isActive ? '0' : '-1');
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  app.dataset.recoveryView = activeView;
}

function beginRecoverySwitch(view) {
  app.classList.remove('is-recovery-switch');
  setRecoveryTabState(view);
  if (document.body.classList.contains('reduce-motion')) return;
  void app.offsetWidth;
  app.classList.add('is-recovery-switch');
}

function setGoalsView(view, { focus = false, updateHistory = false } = {}) {
  activeGoalsView = view === 'controller' ? 'controller' : 'goal';
  setRecoveryTabState(activeGoalsView);
  goalTabViews.forEach((viewElement) => {
    const isActive = viewElement.dataset.goalsPanel === activeGoalsView;
    viewElement.hidden = !isActive;
    viewElement.classList.toggle('is-active', isActive);
  });
  panelInner.scrollTo({ top: 0, behavior: 'auto' });
  if (updateHistory && activePanel === 'goals') {
    history.replaceState({ ...(history.state || {}), panel: 'goals', goalsView: activeGoalsView }, '', goalsHash(activeGoalsView));
  }
  if (focus) {
    window.requestAnimationFrame(() => {
      document.querySelector(activeGoalsView === 'controller' ? '#goalControllerTitle' : '#goalsPanelTitle')?.focus({ preventScroll: true });
    });
  }
}

function switchRecoveryView(view, trigger) {
  const targetView = view === 'controller' || view === 'orders' ? view : 'goal';
  const currentView = activePanel === 'orders'
    ? 'orders'
    : activePanel === 'goals'
      ? activeGoalsView
      : null;
  if (currentView === targetView) {
    setRecoveryTabState(targetView);
    const heading = targetView === 'orders'
      ? document.querySelector('#ordersPanelTitle')
      : document.querySelector(targetView === 'controller' ? '#goalControllerTitle' : '#goalsPanelTitle');
    heading?.focus({ preventScroll: true });
    return;
  }

  beginRecoverySwitch(targetView);
  if (targetView === 'orders') {
    openPanel('orders', trigger);
    return;
  }

  setGoalsView(targetView);
  if (activePanel === 'goals') {
    history.replaceState({ ...(history.state || {}), panel: 'goals', goalsView: targetView }, '', goalsHash(targetView));
    panelInner.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => {
      document.querySelector(targetView === 'controller' ? '#goalControllerTitle' : '#goalsPanelTitle')?.focus({ preventScroll: true });
    });
    return;
  }
  openPanel('goals', trigger);
}

function applyPanel(panel, trigger = null) {
  const previousPanel = activePanel;
  const previousTrigger = activeTrigger;
  const nextPanel = PANEL_META[panel] ? panel : null;
  const triggerIsPersistent = Boolean(trigger?.closest && !trigger.closest('.panel-view'));

  if (nextPanel) {
    gestureController.pauseForPanel();
    orientationController.stop('panel');
  }

  if (nextPanel === previousPanel) {
    if (nextPanel && triggerIsPersistent) activeTrigger = trigger;
    syncMobileDock(nextPanel);
    if (nextPanel === 'orders') setRecoveryTabState('orders');
    else if (nextPanel === 'goals') setRecoveryTabState(activeGoalsView);
    return false;
  }

  if (previousPanel === 'clinic' && nextPanel !== 'clinic') {
    if (cancelAiRequest('panel-changed')) aiUiState = { status: 'idle', message: '' };
  }
  if (nextPanel === 'clinic' && previousPanel !== 'clinic') {
    setClinicView('start', { scroll: false });
  }
  if (nextPanel !== 'new') cancelPhoneViewFocus();
  if (nextPanel !== 'clinic') {
    closePosterShare({ restoreFocus: false });
    closeGachaponResult({ restoreFocus: false, flushPending: false });
  }
  if (!['orders', 'goals'].includes(nextPanel)) app.classList.remove('is-recovery-switch');

  activePanel = nextPanel;
  if (activePanel !== 'new') {
    panelClose.setAttribute('aria-label', '回房间');
    panelCloseLabel.textContent = '回房间';
  }
  gachaponMotion.setActive(activePanel === 'clinic');
  syncMobileDock(activePanel);
  if (activePanel === 'orders') setRecoveryTabState('orders');
  else if (activePanel === 'goals') setRecoveryTabState(activeGoalsView);
  activeTrigger = activePanel ? (triggerIsPersistent ? trigger : panorama.getTriggerForPanel(activePanel)) : previousTrigger;

  document.querySelectorAll('.scene-hotspot.is-feature').forEach((object) => {
    const hotspot = sceneHotspots.find((item) => item.id === object.dataset.hotspotId);
    object.classList.toggle('is-active', hotspot?.panel === activePanel || hotspot?.panels?.includes(activePanel));
  });
  document.querySelectorAll('.panel-view').forEach((view) => {
    const isActive = view.dataset.panel === activePanel;
    view.classList.toggle('is-active', isActive);
    view.hidden = !isActive;
    view.inert = !isActive;
    view.setAttribute('aria-hidden', String(!isActive));
  });

  const activePhoneScreen = document.querySelector(`.phone-device[data-panel="${activePanel}"] .phone-screen-scroll`);
  activePhoneScreen?.scrollTo({ top: 0, behavior: 'auto' });
  panelInner.scrollTo({ top: 0, behavior: 'auto' });

  if (!activePanel) {
    app.dataset.focus = 'none';
    app.classList.remove('is-focusing', 'is-focused', 'is-recovery-switch');
    setRoomBackgroundSuppressed(false);
    const returnTarget = activeTrigger;
    activeTrigger = null;
    if (returnTarget && document.contains(returnTarget)) returnTarget.focus({ preventScroll: true });
    else sceneFrame.focus({ preventScroll: true });
    focusPanel.inert = true;
    focusPanel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    panorama.resetView();
    if (previousPanel === 'goals') renderGoal();
    setMascotSpeech(idleSpeech());
    gestureController.resumeFromPanel();
    return true;
  }

  app.dataset.focus = activePanel;
  if (!previousPanel) app.classList.add('is-focusing');
  app.classList.add('is-focused');
  focusPanel.inert = false;
  focusPanel.setAttribute('aria-hidden', 'false');
  setRoomBackgroundSuppressed(true);
  panelIndex.textContent = PANEL_META[activePanel].index;
  panorama.focusPanel(activePanel);
  setMascotSpeech(PANEL_META[activePanel].speech);
  if (window.innerWidth <= 820) document.body.style.overflow = 'hidden';
  if (previousPanel === 'goals' || activePanel === 'goals') renderGoal();
  if (activePanel === 'clinic') renderClinic();
  const panelAtSchedule = activePanel;
  window.requestAnimationFrame(() => {
    if (activePanel !== panelAtSchedule) return;
    if (activePanel === 'clinic') gachaponMotion.resize();
    const heading = activePanel === 'new' && phoneView === 'detail'
      ? commerceDetailContent.querySelector('h3')
      : activePanel === 'new' && phoneView === 'catalog'
        ? commerceTitle
        : activePanel === 'new' && phoneView === 'home'
          ? document.querySelector('#newPanelTitle')
          : activePanel === 'new' && phoneView === 'intro'
            ? shoppingIntroTitle
        : activePanel === 'clinic'
          ? (clinicView === 'report' ? clinicReportTitle : gachaponTitle)
          : activePanel === 'goals' && activeGoalsView === 'controller'
            ? document.querySelector('#goalControllerTitle')
            : document.querySelector(`.panel-view[data-panel="${activePanel}"] h2`);
    heading?.focus({ preventScroll: true });
  });
  return true;
}

function openPanel(panel, trigger = null) {
  if (!roomEntered || activeActivity || !PANEL_META[panel]) return false;
  const requestedGoalsView = panel === 'goals'
    ? (trigger?.dataset.goalsView || (activePanel === 'goals' ? activeGoalsView : 'goal'))
    : activeGoalsView;

  if (panel === activePanel) {
    if (panel === 'goals' && requestedGoalsView !== activeGoalsView) {
      setGoalsView(requestedGoalsView, { focus: true });
      history.replaceState({ ...(history.state || {}), panel: 'goals', goalsView: activeGoalsView }, '', goalsHash(activeGoalsView));
    }
    applyPanel(panel, trigger);
    return false;
  }

  closeMallSuccess();
  if (panel !== 'new') closeOrderComposer({ restoreFocus: false });
  if (panel === 'new') showPhoneView('intro');
  if (panel === 'goals') setGoalsView(requestedGoalsView);
  const updateHistory = activePanel ? 'replaceState' : 'pushState';
  const panelState = panel === 'new'
    ? { panel, phoneView: 'intro', openedByApp: true }
    : panel === 'goals'
      ? { panel, goalsView: activeGoalsView, openedByApp: true }
      : panel === 'clinic'
        ? { panel, clinicView: 'start', openedByApp: true }
      : { panel, openedByApp: true };
  const panelHash = panel === 'goals'
    ? goalsHash(activeGoalsView)
    : panel === 'clinic'
      ? buildClinicHash({ clinicView: 'start' })
      : `#${panel}`;
  history[updateHistory](panelState, '', panelHash);
  applyPanel(panel, trigger);
  return true;
}

function closePanel() {
  if (!activePanel) return;
  closeMallSuccess();
  closeOrderComposer({ restoreFocus: false });
  showPhoneView('intro');
  history.replaceState({ panel: null, openedByApp: false }, '', '#room');
  applyPanel(null);
}

function goalsHash(view = activeGoalsView) {
  return view === 'controller' ? '#goals-controller' : '#goals';
}

function goalsViewFromHash() {
  return location.hash === '#goals-controller' ? 'controller' : 'goal';
}

function panelFromHash() {
  const hash = panelNameFromHash(location.hash);
  if (hash === 'goals-controller') return 'goals';
  return PANEL_META[hash] ? hash : null;
}

function routeSnapshot(historyState = history.state || {}) {
  const panel = panelFromHash();
  const activity = panel ? null : parseRoomHashState(location.hash).activity;
  const goalsView = panel === 'goals' ? goalsViewFromHash() : 'goal';
  const clinicView = panel === 'clinic' ? parseClinicHashState(location.hash).clinicView : 'start';
  const newRoute = parseNewHashState(location.hash, historyState);
  const productBelongsToCatalog = newRoute.productId
    ? Boolean(commerceProduct(newRoute.productId, newRoute.commerceType))
    : false;
  const phoneView = panel === 'new'
    ? (newRoute.phoneView === 'detail' && !productBelongsToCatalog ? 'catalog' : newRoute.phoneView)
    : 'intro';
  return {
    panel,
    activity,
    goalsView,
    clinicView,
    phoneView,
    commerceType: panel === 'new' ? newRoute.commerceType : 'shop',
    productId: phoneView === 'detail' ? newRoute.productId : null,
  };
}

function currentRouteSnapshot() {
  return {
    panel: activePanel,
    activity: activePanel ? null : activeActivity,
    goalsView: activePanel === 'goals' ? activeGoalsView : 'goal',
    clinicView: activePanel === 'clinic' ? clinicView : 'start',
    phoneView: activePanel === 'new' ? phoneView : 'intro',
    commerceType: activePanel === 'new' ? activeCommerceType : 'shop',
    productId: activePanel === 'new' && phoneView === 'detail' ? activeCommerceProductId : null,
  };
}

function syncRouteFromLocation(route) {
  if (!roomEntered) {
    pendingPanel = route.panel;
    pendingActivity = route.activity;
    return;
  }

  if (route.activity === 'peel') {
    if (activePanel) applyPanel(null);
    if (activeActivity !== 'peel') openPeelActivity(null, { updateHistory: false });
    return;
  }

  if (activeActivity === 'peel') {
    const openingPanel = Boolean(route.panel);
    closePeelActivity({
      updateHistory: false,
      resumeGesture: !openingPanel,
      restoreFocus: !openingPanel,
    });
    if (openingPanel) gestureController.handoffActivityToPanel();
  }

  const panelChanged = route.panel !== activePanel;
  closeMallSuccess();
  if (route.panel !== 'new') closeOrderComposer({ restoreFocus: false });

  if (route.panel === 'goals') {
    setGoalsView(route.goalsView, { focus: !panelChanged });
    history.replaceState({ ...(history.state || {}), panel: 'goals', goalsView: route.goalsView }, '', goalsHash(route.goalsView));
  }

  if (route.panel === 'new') {
    const normalizedRoute = {
      panel: 'new',
      phoneView: route.phoneView,
      commerceType: route.commerceType,
      productId: route.productId,
    };
    restorePhoneView(normalizedRoute, { focus: !panelChanged });
    history.replaceState({
      ...(history.state || {}),
      ...normalizedRoute,
    }, '', buildNewHash(normalizedRoute));
  } else {
    showPhoneView('intro');
  }

  applyPanel(route.panel);
  if (route.panel === 'clinic') setClinicView(route.clinicView, { focus: !panelChanged });
}

const routeSyncCoordinator = createRouteSyncScheduler({
  readRoute: (historyState) => routeSnapshot(historyState || history.state || {}),
  applyRoute: syncRouteFromLocation,
  getCurrentSignature: () => routeSignature(currentRouteSnapshot()),
  schedule: (callback) => window.requestAnimationFrame(callback),
});

document.addEventListener('keydown', handlePeelActivityKeydown, { capture: true });

function idleSpeech() {
  const { cooling, savedAll } = totals();
  if (cooling > 0) return `电脑里还有 ${cooling} 张小票没决定。要不要去看一眼？`;
  if (savedAll > 0) return `目前确认省下 ${money(savedAll)}。别忘了，虚拟进度不等于真实存款。`;
  return '嗨，我先看数据，不乱贴标签。先从一张冷静小票开始吧。';
}

function renderMetrics() {
  const current = totals();
  const dataMode = orderDataMode(state.orders);
  const goal = currentGoal();
  const goalProgress = calculateGoalProgress(state.orders, goal);
  const clinicAssessment = scorePersonality({ orders: state.orders, period: 30 });
  document.querySelector('#metricRecorded').textContent = money(current.recordedToday);
  document.querySelector('#metricSaved').textContent = money(current.savedToday);
  document.querySelector('#metricCooling').textContent = current.cooling;
  const metricDataScope = document.querySelector('#metricDataScope');
  metricDataScope.textContent = dataScopeLabel(dataMode, state.orders.length);
  metricDataScope.dataset.mode = dataMode;
  document.querySelector('#computerStatus').textContent = current.cooling ? `${current.cooling} 张订单等决定` : '手机收件箱是空的';
  document.querySelector('#clinicStatus').textContent = clinicAssessment.eligible
    ? `${clinicAssessment.primaryPersona?.name || '画像形成中'} · ${clinicAssessment.confidence.score}%`
    : `近 30 天还差 ${Math.max(0, 3 - clinicAssessment.orderCount)} 笔记录`;
  const badge = document.querySelector('#orderBadge');
  if (badge) {
    badge.hidden = current.cooling === 0;
    badge.textContent = current.cooling;
  }
  document.querySelector('#goalStatus').textContent = goal
    ? `${goal.name} · ${Math.min(100, Math.round((goalProgress?.progressRate || 0) * 100))}%`
    : '白板还是空的';
  if (!activePanel) setMascotSpeech(idleSpeech());
}

function renderOrderDashboard() {
  const current = totals();
  const dataMode = orderDataMode(state.orders);
  const goal = currentGoal();
  const progress = calculateGoalProgress(state.orders, goal);
  const progressPercent = progress ? Math.min(100, Math.round((progress.progressRate || 0) * 100)) : 0;
  const goalRemaining = progress ? Math.max(0, progress.targetAmount - progress.progress) : 0;
  document.querySelector('#phoneGreetingLabel').textContent = '你好，要买东西嘛 👋';
  document.querySelector('#orderTodayRecorded').textContent = money(current.recordedToday);
  document.querySelector('#orderCoolingSummary').textContent = `${current.cooling} 笔冷静中`;
  const orderDataScope = document.querySelector('#orderDataScope');
  orderDataScope.textContent = dataScopeLabel(dataMode, state.orders.length);
  orderDataScope.dataset.mode = dataMode;
  document.querySelector('#orderGoalLabel').textContent = goal ? `当前目标 ${money(goal.amount)}` : '本月目标 ¥0';
  document.querySelector('#orderGoalProgressLabel').textContent = goal ? `确认省下 ${money(progress.progress)}` : '还没有预算便签';
  document.querySelector('#orderGoalPercent').textContent = goal ? `还剩 ${money(goalRemaining)}` : '0%';
  const progressTrack = document.querySelector('#orderGoalTrack');
  progressTrack.style.setProperty('--goal-progress', `${progressPercent}%`);
  progressTrack.setAttribute('aria-valuenow', String(progressPercent));

  const formatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
  const today = new Date();
  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - index));
    const amount = state.orders
      .filter((order) => localDateKey(order.createdAt) === localDateKey(date))
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);
    return { date, amount };
  });
  const previousTrend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (13 - index));
    const amount = state.orders
      .filter((order) => localDateKey(order.createdAt) === localDateKey(date))
      .reduce((sum, order) => sum + Number(order.amount || 0), 0);
    return amount;
  });
  const currentTrendTotal = trend.reduce((sum, item) => sum + item.amount, 0);
  const previousTrendTotal = previousTrend.reduce((sum, amount) => sum + amount, 0);
  const trendDelta = document.querySelector('#orderTrendDelta');
  if (previousTrendTotal > 0) {
    const change = Math.round(((currentTrendTotal - previousTrendTotal) / previousTrendTotal) * 100);
    trendDelta.textContent = `本周消费欲 ${change >= 0 ? '↑' : '↓'}${Math.abs(change)}%`;
  } else {
    trendDelta.textContent = currentTrendTotal > 0 ? '本周消费欲 · 新记录' : '本周消费欲 · 暂无';
  }
  const maximumAmount = Math.max(0, ...trend.map((item) => item.amount));
  const maximum = Math.max(1, maximumAmount);
  const points = trend.map((item, index) => {
    const x = 12 + index * (256 / 6);
    const y = 84 - (item.amount / maximum) * 62;
    return { ...item, x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
  });
  const linePath = points.map((item, index) => `${index ? 'L' : 'M'} ${item.x} ${item.y}`).join(' ');
  const areaPath = `${linePath} L ${points.at(-1).x} 92 L ${points[0].x} 92 Z`;
  document.querySelector('#orderTrendLine').setAttribute('d', linePath);
  document.querySelector('#orderTrendArea').setAttribute('d', areaPath);
  document.querySelector('#orderTrendPoints').innerHTML = points.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="3.5"></circle>`).join('');
  const peakIndex = trend.findIndex((item) => item.amount === maximumAmount);
  const peak = document.querySelector('#orderTrendPeak');
  peak.hidden = maximumAmount <= 0;
  if (maximumAmount > 0) {
    peak.textContent = money(maximumAmount);
    peak.style.setProperty('--peak-x', `${(points[peakIndex].x / 280) * 100}%`);
    peak.style.setProperty('--peak-y', `${(points[peakIndex].y / 106) * 100}%`);
  }
  document.querySelector('#orderTrendBars').innerHTML = trend.map((item) => {
    const label = formatter.format(item.date).replace('星期', '周');
    return `<li aria-label="${escapeHtml(label)}记录 ${money(item.amount)}"><small>${escapeHtml(label)}</small></li>`;
  }).join('');
}

function commerceTypeForSelectedCard() {
  return COMMERCE_TYPE_BY_CATEGORY[categoryCards[activeCategoryCardIndex]?.dataset.categoryShortcut] || 'shop';
}

function commerceCatalog(type = activeCommerceType) {
  return COMMERCE_CATALOGS[type] || COMMERCE_CATALOGS.shop;
}

function commerceProduct(productId = activeCommerceProductId, type = activeCommerceType) {
  return staticCommerceProduct(productId)
    || derivedCommerceProducts(type, state.orders).find((product) => product.id === productId)
    || null;
}

function orderThumbnailFor(order) {
  const catalogProducts = Object.values(COMMERCE_CATALOGS).flatMap((catalog) => catalog.products);
  const exactProduct = catalogProducts.find((product) => product.name === order.name);
  const fallbackProduct = staticCommerceProduct(ORDER_FALLBACK_PRODUCT_BY_CATEGORY[order.category]);
  return exactProduct?.image || fallbackProduct?.image || './assets/phone-raccoon.webp';
}

function renderCommerceShell() {
  const selectedCatalog = commerceCatalog(commerceTypeForSelectedCard());
  openMallButtonLabel.textContent = `逛${selectedCatalog.label}模拟商城`;
  const orderCount = state.orders.length;
  commerceCoolingBadge.hidden = orderCount === 0;
  commerceCoolingBadge.textContent = String(orderCount);
  if (phoneView === 'catalog') renderCommerceCatalog();
  if (phoneView === 'detail') renderCommerceDetail();
}

function renderCommerceCatalog() {
  const catalog = commerceCatalog();
  const ownedProducts = derivedCommerceProducts(activeCommerceType, state.orders);
  const availableFilters = ownedProducts.length ? ['我的商品', ...catalog.filters] : catalog.filters;
  if (!availableFilters.includes(activeCommerceFilter)) activeCommerceFilter = catalog.filters[0];
  const query = commerceSearchInput.value.trim().toLocaleLowerCase('zh-CN');
  const firstFilter = catalog.filters[0];
  commerceTitle.textContent = catalog.title;
  commerceSearchInput.placeholder = catalog.searchPlaceholder;
  commerceFilters.innerHTML = availableFilters.map((filter) => `
    <button type="button" class="${filter === activeCommerceFilter ? 'is-active' : ''}" data-commerce-filter="${escapeHtml(filter)}" aria-pressed="${filter === activeCommerceFilter}">${escapeHtml(filter)}</button>
  `).join('');

  const sourceProducts = activeCommerceFilter === '我的商品' ? ownedProducts : catalog.products;
  const products = sourceProducts.filter((product) => {
    const matchesFilter = activeCommerceFilter === firstFilter || product.filter === activeCommerceFilter;
    const searchable = `${product.name} ${product.badge || ''} ${product.detail}`.toLocaleLowerCase('zh-CN');
    return matchesFilter && (!query || searchable.includes(query));
  });
  commerceProducts.dataset.layout = activeCommerceType === 'food' ? 'list' : 'grid';
  commerceProducts.innerHTML = products.length ? products.map((product) => {
    if (activeCommerceType === 'food') {
      return `
        <article class="commerce-list-card">
          <button type="button" data-commerce-product="${product.id}" aria-label="查看${escapeHtml(product.name)}，${money(product.price)}">
            <img src="${product.image}" alt="" />
            <span class="commerce-list-copy">
              <span class="commerce-product-title"><b>${escapeHtml(product.name)}</b>${product.badge ? `<small>${escapeHtml(product.badge)}</small>` : ''}</span>
              <span class="commerce-product-description">${escapeHtml(product.detail)}</span>
              <span class="commerce-product-meta"><strong>${money(product.price)}</strong><i>🔥 ${product.heat}%</i></span>
            </span>
            <span class="commerce-plus" aria-hidden="true">＋</span>
          </button>
        </article>`;
    }
    return `
      <article class="commerce-grid-card">
        <button type="button" data-commerce-product="${product.id}" aria-label="查看${escapeHtml(product.name)}，${money(product.price)}">
          <span class="commerce-product-image"><img src="${product.image}" alt="" />${product.badge ? `<small>${escapeHtml(product.badge)}</small>` : ''}</span>
          <b>${escapeHtml(product.name)}</b>
          <span class="commerce-product-meta"><strong>${money(product.price)}</strong><i>🔥 ${product.heat}%</i></span>
          <span class="commerce-want">♡ 想买</span>
        </button>
      </article>`;
  }).join('') : '<div class="commerce-empty"><b>没有搜到这件心动</b><p>换个关键词，或者看看别的分类。</p></div>';
}

function focusCommerceFilter(filter) {
  const button = [...commerceFilters.querySelectorAll('[data-commerce-filter]')]
    .find((item) => item.dataset.commerceFilter === filter);
  button?.focus({ preventScroll: true });
}

function renderCommerceDetail() {
  const product = commerceProduct();
  if (!product) return;
  const catalog = commerceCatalog(activeCommerceType);
  commerceTitle.textContent = catalog.label;
  commerceDetailContent.innerHTML = `
    <div class="commerce-detail-image">
      <img src="${product.image}" alt="${escapeHtml(product.name)}" />
      <span>${escapeHtml(catalog.label)}</span>
    </div>
    <div class="commerce-detail-copy">
      <div class="commerce-detail-title"><h3 id="commerceProductName" tabindex="-1">${escapeHtml(product.name)}</h3><span>🔥 ${product.heat}%</span></div>
      <div class="commerce-detail-price"><strong>${money(product.price)}</strong>${product.originalPrice ? `<del>${money(product.originalPrice)}</del>` : ''}</div>
      <section class="commerce-reason"><h4>购买理由</h4><p>${escapeHtml(product.pitch)}</p></section>
      <div class="commerce-detail-stats"><div><img src="./assets/mall-detail-high-five.webp" alt="" /><b>${product.rating}%</b><small>剁手好评</small></div><div><img src="./assets/mall-detail-verdicts.webp" alt="" /><b>${escapeHtml(product.regret)}</b><small>后悔概率</small></div></div>
      <p class="commerce-boundary-note">模拟界面 · 点击后只会生成一张“冷静中”记录，不支付、不发货。</p>
    </div>`;
}

function cancelPhoneViewFocus() {
  phoneViewFocusSequence += 1;
  if (phoneViewFocusTimer === null) return;
  window.clearTimeout(phoneViewFocusTimer);
  phoneViewFocusTimer = null;
}

function showPhoneView(view, { type = activeCommerceType, productId = activeCommerceProductId, focus = false } = {}) {
  cancelPhoneViewFocus();
  phoneView = ['intro', 'home', 'catalog', 'detail'].includes(view) ? view : 'intro';
  app.dataset.phoneView = phoneView;
  const panelBackLabel = phoneView === 'intro' ? '回房间' : '返回上一页';
  panelClose.setAttribute('aria-label', panelBackLabel);
  panelCloseLabel.textContent = panelBackLabel;
  if (phoneView !== 'home' && editingOrderId) resetOrderComposer();
  const nextCommerceType = COMMERCE_CATALOGS[type] ? type : commerceTypeForSelectedCard();
  const nextCatalog = commerceCatalog(nextCommerceType);
  const filterRemainsValid = nextCatalog.filters.includes(activeCommerceFilter)
    || activeCommerceFilter === '我的商品';
  if (activeCommerceType !== nextCommerceType || !filterRemainsValid) {
    activeCommerceFilter = nextCatalog.filters[0];
  }
  activeCommerceType = nextCommerceType;
  activeCommerceProductId = phoneView === 'detail' ? productId : null;
  if (phoneView === 'detail' && !commerceProduct(activeCommerceProductId)) phoneView = 'catalog';
  app.dataset.phoneView = phoneView;

  shoppingIntroView.hidden = phoneView !== 'intro';
  phoneHomeView.hidden = phoneView !== 'home';
  phoneCommerce.hidden = !['catalog', 'detail'].includes(phoneView);
  commerceCatalogView.hidden = phoneView !== 'catalog';
  commerceDetailView.hidden = phoneView !== 'detail';
  newPhoneScreen.classList.toggle('is-shopping-intro', phoneView === 'intro');
  newPhoneScreen.classList.toggle('is-commerce', ['catalog', 'detail'].includes(phoneView));
  newPhoneScreen.dataset.commerceTheme = activeCommerceType;
  if (phoneView === 'catalog') renderCommerceCatalog();
  if (phoneView === 'detail') renderCommerceDetail();
  newPhoneScreen.scrollTo({ top: 0, behavior: 'auto' });

  if (focus) {
    const focusSequence = phoneViewFocusSequence;
    const focusView = phoneView;
    phoneViewFocusTimer = window.setTimeout(() => {
      phoneViewFocusTimer = null;
      if (activePanel !== 'new' || phoneViewFocusSequence !== focusSequence || phoneView !== focusView) return;
      if (focusView === 'detail') commerceDetailContent.querySelector('h3')?.focus?.({ preventScroll: true });
      else if (focusView === 'catalog') commerceTitle.focus({ preventScroll: true });
      else if (focusView === 'intro') shoppingIntroTitle.focus({ preventScroll: true });
      else document.querySelector('#newPanelTitle')?.focus({ preventScroll: true });
    }, document.body.classList.contains('reduce-motion') ? 20 : 220);
  }
}

function pushPhoneView(view, { type = activeCommerceType, productId = null } = {}) {
  const route = { phoneView: view, commerceType: type, productId };
  history.pushState({ panel: 'new', ...route, openedByApp: true }, '', buildNewHash(route));
  showPhoneView(view, { type, productId, focus: true });
}

function navigateBackWithinPhone({ focus = true } = {}) {
  if (phoneView === 'intro') return false;
  if (history.state?.panel === 'new' && history.state?.openedByApp) {
    history.back();
    return true;
  }

  const nextRoute = phoneView === 'detail'
    ? { phoneView: 'catalog', commerceType: activeCommerceType, productId: null }
    : phoneView === 'catalog'
      ? { phoneView: 'home', commerceType: activeCommerceType, productId: null }
      : { phoneView: 'intro', commerceType: activeCommerceType, productId: null };
  history.replaceState({
    panel: 'new',
    ...nextRoute,
    openedByApp: false,
  }, '', buildNewHash(nextRoute));
  showPhoneView(nextRoute.phoneView, { type: nextRoute.commerceType, focus });
  return true;
}

function restorePhoneView(historyState = {}, { focus = true } = {}) {
  if (historyState.panel !== 'new' || !historyState.phoneView) {
    showPhoneView('intro', { focus });
    return;
  }
  showPhoneView(historyState.phoneView, {
    type: historyState.commerceType,
    productId: historyState.productId,
    focus,
  });
}

function pushClinicView(view = 'start', { apply = true, replaceCurrent = false } = {}) {
  const nextView = view === 'report' ? 'report' : 'start';
  const historyMethod = replaceCurrent ? 'replaceState' : 'pushState';
  history[historyMethod]({
    panel: 'clinic',
    clinicView: nextView,
    openedByApp: replaceCurrent ? Boolean(history.state?.openedByApp) : true,
  }, '', buildClinicHash({ clinicView: nextView }));
  if (apply) setClinicView(nextView, { focus: true });
}

function navigateBackWithinClinic() {
  if (clinicView !== 'report') return false;
  if (history.state?.panel === 'clinic' && history.state?.openedByApp) {
    history.back();
    return true;
  }
  history.replaceState({
    panel: 'clinic',
    clinicView: 'start',
    openedByApp: false,
  }, '', buildClinicHash({ clinicView: 'start' }));
  setClinicView('start', { focus: true });
  return true;
}

function orderComposerFocusableElements() {
  return [...orderComposerModal.querySelectorAll('button, input, select, summary, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.disabled && !element.closest('[hidden]'));
}

function syncTransientModalIsolation() {
  const composerOpen = !orderComposerModal.hidden;
  const successOpen = !mallSuccessModal.hidden;
  const newDeviceTabs = document.querySelector('.phone-device[data-panel="new"] .device-tabs');
  const setHiddenAndInert = (element, value) => {
    if (!element) return;
    element.inert = value;
    if (value) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
  };

  setHiddenAndInert(panelInner, composerOpen);
  setHiddenAndInert(newPhoneScreen, successOpen);
  setHiddenAndInert(newDeviceTabs, successOpen);
  setHiddenAndInert(panelClose, composerOpen || successOpen);
  setHiddenAndInert(mobileDock, composerOpen || successOpen);
  app.classList.toggle('has-transient-modal', composerOpen || successOpen);
}

function openOrderComposer(trigger = document.activeElement) {
  if (!orderComposerModal.hidden) return;
  orderComposerReturnFocus = trigger && document.contains(trigger) ? trigger : null;
  orderComposerModal.hidden = false;
  app.dataset.orderComposer = 'open';
  syncTransientModalIsolation();
  window.requestAnimationFrame(() => orderForm.elements.name.focus({ preventScroll: true }));
}

function closeOrderComposer({ restoreFocus = true, reset = true } = {}) {
  if (orderComposerModal.hidden) return;
  const returnTarget = orderComposerReturnFocus;
  if (reset) resetOrderComposer();
  orderComposerModal.hidden = true;
  delete app.dataset.orderComposer;
  syncTransientModalIsolation();
  orderComposerReturnFocus = null;
  if (restoreFocus) {
    window.requestAnimationFrame(() => {
      if (returnTarget && document.contains(returnTarget) && returnTarget.getClientRects().length) returnTarget.focus({ preventScroll: true });
      else document.querySelector('#newPanelTitle')?.focus({ preventScroll: true });
    });
  }
}

function prefillOrderFromCommerce(product, trigger = commercePrefillButton) {
  if (!product) return;
  closeMallSuccess();
  resetOrderComposer();
  orderForm.elements.name.value = product.name;
  orderForm.elements.amount.value = product.price;
  orderForm.elements.category.value = product.category;
  orderForm.elements.reason.value = product.reason;
  openOrderComposer(trigger);
  showToast('商品信息已带入冷静单，确认后再记录。');
}

function restartMallGif(image, path) {
  if (document.body.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  image.removeAttribute('src');
  window.requestAnimationFrame(() => { image.src = `${path}?play=${Date.now()}`; });
}

function mallSuccessAdviceItems(product, order, assessment = null) {
  if (!product || !order) return [];
  const localAdvice = [];
  if (order.reason === '限时优惠') localAdvice.push('先记下真正需要它的场景，明天再看优惠是不是仍然重要。');
  else if (order.reason === '情绪不好' || order.reason === '嘴馋') localAdvice.push('先照顾当下的感受，十分钟后再回订单页做决定。');
  else if (order.category === '学习成长') localAdvice.push('先写下未来七天第一次使用它的具体时间，再决定是否购买。');
  else localAdvice.push('先让它在订单里冷静一晚，明天仍然想要再做最终决定。');

  if (Number(order.amount) >= 1000) localAdvice.push('金额较高，可以先比较一次替代品和二手价格，不用现在付款。');
  else if (Number(order.amount) >= 300) localAdvice.push('把价格换算成使用次数，看看每一次使用是否真的值得。');
  else localAdvice.push('小额也会累积，先确认它不是因为“顺手”才被加入。');
  localAdvice.push('它已经同步到“我的商品”和订单页，状态变化会从同一笔记录重新计算。');

  const effectiveAssessment = assessment?.eligible
    ? assessment
    : scorePersonality({ orders: state.orders, period: activeClinicPeriod });
  const onlineAdvice = aiConsentIsCurrent() && diagnosisIsFreshFor(effectiveAssessment)
    ? (state.diagnosis?.result?.action?.steps || []).map(String).filter(Boolean).slice(0, 2)
    : [];
  return [...new Set([...onlineAdvice, ...localAdvice])].slice(0, onlineAdvice.length ? 4 : 3);
}

function showMallSuccess(product, order) {
  if (!product || !order) return;
  lastCommerceProduct = product;
  if (mallMoodIcon) {
    const isSmiling = state.orders.length % 2 === 1;
    mallMoodIcon.textContent = isSmiling ? '😂' : '😭';
    mallMoodIcon.setAttribute('aria-label', isSmiling ? '笑着记录' : '哭着冷静');
  }
  document.querySelector('#mallSuccessAmount').textContent = money(order.amount);
  document.querySelector('#mallSuccessTotal').textContent = money(totals().recordedToday);
  const adviceItems = mallSuccessAdviceItems(product, order);
  if (mallSuccessAdviceTitle) mallSuccessAdviceTitle.textContent = adviceItems.length > 3 ? '结合最新报告，先做这几步' : '先冷静一下，可以这样做';
  if (mallSuccessAdviceList) {
    mallSuccessAdviceList.innerHTML = adviceItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }
  mallSuccessModal.hidden = false;
  syncTransientModalIsolation();
  restartMallGif(mallConfettiGif, './assets/mall-confetti.gif');
  restartMallGif(mallHornGif, './assets/mall-horn.gif');
  window.setTimeout(() => mallSuccessTitle.focus({ preventScroll: true }), document.body.classList.contains('reduce-motion') ? 20 : 180);
}

function closeMallSuccess({ restoreFocus = false } = {}) {
  if (mallSuccessModal.hidden) return;
  mallSuccessModal.hidden = true;
  syncTransientModalIsolation();
  if (restoreFocus) commerceBuyButton.focus({ preventScroll: true });
}

function simulateCommerceOrder(product) {
  if (!product) return;
  if (editingOrderId) resetOrderComposer();
  const formData = new FormData();
  formData.set('name', product.name);
  formData.set('amount', String(product.price));
  formData.set('category', product.category);
  formData.set('reason', product.reason);
  const order = createOrder(formData, { showReceipt: false });
  showMallSuccess(product, order);
}

function renderOrderEditor() {
  const editingOrder = editingOrderId ? state.orders.find((order) => order.id === editingOrderId) : null;
  if (!editingOrder || editingOrder.status !== 'cooling') editingOrderId = null;
  document.querySelector('#orderFormEyebrow').textContent = editingOrderId ? 'EDIT COOLING TICKET' : 'NEW COOLING TICKET';
  document.querySelector('#orderFormTitle').textContent = editingOrderId ? '修改想买的东西' : '新增想买的东西';
  document.querySelector('#orderSubmitLabel').textContent = editingOrderId ? '保存修改' : '保存到冷静单';
  cancelOrderEditButton.hidden = !editingOrderId;
}

function renderOrders() {
  const filtered = state.orders
    .filter((order) => activeFilter === 'all' || order.status === activeFilter)
    .filter((order) => orderMatchesTimeFilter(order, activeTimeFilter))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  document.querySelectorAll('[data-filter]').forEach((button) => {
    const isActive = button.dataset.filter === activeFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  document.querySelector('#orderTimeFilterLabel').textContent = ORDER_TIME_FILTER_LABELS[activeTimeFilter];
  document.querySelectorAll('[data-time-filter]').forEach((button) => {
    const isActive = button.dataset.timeFilter === activeTimeFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-checked', String(isActive));
  });

  const orderTotal = state.orders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const isFiltered = activeFilter !== 'all' || activeTimeFilter !== 'all';
  document.querySelector('#orderCountSticker').textContent = isFiltered ? `${filtered.length}/${state.orders.length} 笔` : `${state.orders.length} 笔`;
  document.querySelector('#orderSummary').textContent = isFiltered
    ? `当前显示 ${filtered.length} / 共 ${state.orders.length} 笔虚拟订单 · 全部合计 ${money(orderTotal)}`
    : `共 ${state.orders.length} 笔虚拟订单 · 合计 ${money(orderTotal)}`;
  document.querySelector('#exportButton').disabled = !state.orders.some((order) => !order.demo)
    && !state.goals.some((goal) => !goal.demo);
  document.querySelector('#exportCsvButton').disabled = !state.orders.some((order) => !order.demo);

  if (!filtered.length) {
    orderList.innerHTML = `
      <div class="empty-state">
        <b>${state.orders.length ? '这个筛选里暂时没有小票' : '订单电脑还是空的'}</b>
        <p>${state.orders.length ? '换一个状态或时间看看。' : '去茶几手机记下第一笔消费欲望。'}</p>
      </div>`;
    return;
  }

  orderList.innerHTML = filtered.map((order) => {
    const created = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(order.createdAt));
    const orderId = escapeHtml(order.id);
    const statusActions = allowedOrderStatusActions(order.status);
    return `
      <article class="order-ticket">
        <div class="order-ticket-main">
          <img class="order-ticket-thumb" src="${orderThumbnailFor(order)}" alt="" width="78" height="78" />
          <div class="order-ticket-copy">
            <h3>${escapeHtml(order.name)}</h3>
            <p class="order-ticket-meta"><span>${escapeHtml(order.category)} · ${escapeHtml(order.reason)}</span><time datetime="${escapeHtml(order.createdAt)}">${created}</time></p>
            <div class="ticket-status-row"><span class="order-state ${order.status}" title="${STATUS_LABELS[order.status]}">${STATUS_TAG_LABELS[order.status]}</span>${order.demo ? '<span class="order-demo-tag">演示</span>' : ''}</div>
          </div>
        </div>
        <strong class="order-amount">${money(order.amount)}</strong>
        <div class="ticket-actions">
          ${statusActions.includes('saved') ? `<button type="button" data-order-action="saved" data-order-id="${orderId}">幸好没买</button>` : ''}
          ${statusActions.includes('purchased') ? `<button type="button" data-order-action="purchased" data-order-id="${orderId}">最终购买</button>` : ''}
          ${order.status === 'cooling' ? `<button type="button" data-order-action="edit" data-order-id="${orderId}">编辑</button>` : ''}
          <button class="ticket-delete" type="button" data-order-action="delete" data-order-id="${orderId}" aria-label="删除 ${escapeHtml(order.name)}">删除</button>
        </div>
      </article>`;
  }).join('');
}

function setOrderTimeFilterMenu(open, { focus = false } = {}) {
  orderTimeFilterMenu.hidden = !open;
  orderTimeFilterButton.setAttribute('aria-expanded', String(open));
  orderTimeFilter.classList.toggle('is-open', open);
  if (!focus) return;
  if (open) {
    orderTimeFilterMenu.querySelector(`[data-time-filter="${activeTimeFilter}"]`)?.focus({ preventScroll: true });
  } else {
    orderTimeFilterButton.focus({ preventScroll: true });
  }
}

function moveOrderTimeFilterFocus(key) {
  const options = [...orderTimeFilterMenu.querySelectorAll('[data-time-filter]')];
  const currentIndex = Math.max(0, options.indexOf(document.activeElement));
  const nextIndex = key === 'Home'
    ? 0
    : key === 'End'
      ? options.length - 1
      : (currentIndex + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
  options[nextIndex]?.focus({ preventScroll: true });
}

function focusOrderAfterStatusChange(orderId, nextStatus) {
  const actionButtons = [...orderList.querySelectorAll('[data-order-action]')]
    .filter((button) => button.dataset.orderId === orderId);
  const preferredAction = allowedOrderStatusActions(nextStatus)[0];
  const target = actionButtons.find((button) => button.dataset.orderAction === preferredAction)
    || actionButtons[0]
    || document.querySelector(`[data-filter="${activeFilter}"]`);
  target?.focus({ preventScroll: true });
}

function confidenceLabel(confidence) {
  if (confidence.level === 'insufficient') return '记录不足';
  if (confidence.level === 'stable') return `相对稳定 · ${confidence.score}%`;
  return `正在形成 · ${confidence.score}%`;
}

function axisTendency(axis, score) {
  if (score === null) return '待补证据';
  if (score >= 65) return axis.high;
  if (score <= 35) return axis.low;
  return '两端相对均衡';
}

const REPORT_CATEGORY_ICONS = Object.freeze({
  餐饮饮品: '🍜',
  服饰美妆: '🛍️',
  数码家居: '🎧',
  娱乐社交: '🎮',
  学习成长: '📷',
  旅行交通: '🧳',
  其他: '✨',
});

const REPORT_IMPULSE_SIGNAL_LABELS = Object.freeze({
  instant: '没做功课就想下单',
  creator: '推荐触发',
  deal: '优惠触发',
  comfort: '氛围触发',
  stock: '已有同类仍想囤',
});

const REPORT_IMPULSE_REASONS = new Set(['嘴馋', '无聊', '被种草', '情绪不好', '限时优惠']);

function clinicPeriodOrders(period, source = 'personal', now = new Date()) {
  const normalizedPeriod = Math.max(1, Number(period) || 30);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (normalizedPeriod - 1));
  cutoff.setHours(0, 0, 0, 0);
  return state.orders
    .filter((order) => !order.deletedAt && Number(order.amount) > 0)
    .filter((order) => (source === 'demo' ? Boolean(order.demo) : !order.demo))
    .filter((order) => {
      const createdAt = new Date(order.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt >= cutoff && createdAt <= now;
    });
}

function exactCommerceProductForOrder(order) {
  return Object.values(COMMERCE_CATALOGS)
    .flatMap((catalog) => catalog.products)
    .find((product) => product.name === order.name) || null;
}

function orderImpulseEvidence(order) {
  const evidence = (Array.isArray(order.decisionSignals) ? order.decisionSignals : [])
    .map((signal) => REPORT_IMPULSE_SIGNAL_LABELS[signal])
    .filter(Boolean);
  if (REPORT_IMPULSE_REASONS.has(order.reason)) evidence.push(`${order.reason}触发`);
  const createdAt = new Date(order.createdAt);
  const decidedAt = new Date(order.decidedAt);
  if (!Number.isNaN(createdAt.getTime()) && !Number.isNaN(decidedAt.getTime())) {
    const hours = (decidedAt - createdAt) / 3_600_000;
    if (hours >= 0 && hours <= 3) evidence.push('3 小时内决定');
  }
  return [...new Set(evidence)];
}

function reportProductGroups(orders) {
  const groups = new Map();
  orders.filter((order) => order.status === 'purchased').forEach((order) => {
    const normalizedName = String(order.name || '').trim().toLocaleLowerCase('zh-CN');
    if (!normalizedName) return;
    const evidence = orderImpulseEvidence(order);
    const createdAt = new Date(order.decidedAt || order.updatedAt || order.createdAt).getTime() || 0;
    const current = groups.get(normalizedName) || {
      name: String(order.name).trim(),
      category: order.category || '其他',
      reason: order.reason || '其他',
      amount: 0,
      count: 0,
      impulseScore: 0,
      evidence: new Set(),
      latestAt: 0,
      latestOrder: order,
      demoCount: 0,
    };
    current.amount += Number(order.amount) || 0;
    current.count += 1;
    current.impulseScore += evidence.length;
    evidence.forEach((item) => current.evidence.add(item));
    current.demoCount += order.demo ? 1 : 0;
    if (createdAt >= current.latestAt) {
      current.latestAt = createdAt;
      current.latestOrder = order;
      current.category = order.category || current.category;
      current.reason = order.reason || current.reason;
    }
    groups.set(normalizedName, current);
  });
  return [...groups.values()]
    .sort((a, b) => b.amount - a.amount || b.latestAt - a.latestAt || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 3);
}

function localReportSuggestion(group) {
  if (group.reason === '限时优惠') return '先把原价、到手价和真正需要写在一起，明天再看优惠是否仍值得。';
  if (group.reason === '情绪不好' || group.reason === '嘴馋') return '先照顾当下的感受，十分钟后再决定商品是不是答案。';
  if (group.category === '学习成长') return '先写下七天内第一次使用它的具体时间，再决定是否购买。';
  return '先留在冷静单一晚；明天仍然想要，再做最终决定。';
}

function assessmentReportFingerprint(assessment) {
  return JSON.stringify({
    period: assessment.period,
    modelVersion: assessment.modelVersion,
    source: assessment.source,
    eligible: Boolean(assessment.eligible),
    orderCount: assessment.orderCount,
    totals: assessment.totals,
    categories: assessment.categories,
    reasons: assessment.reasons,
    axes: assessment.axes,
    motivations: assessment.motivations,
    outcomes: assessment.outcomes,
    confidence: assessment.confidence,
    evidence: assessment.evidence,
    primaryPersona: assessment.primaryPersona,
    secondaryPersona: assessment.secondaryPersona,
    walletTheme: assessment.walletTheme,
    localAdvice: assessment.localAdvice,
    excludedDemoCount: assessment.excludedDemoCount,
  });
}

function personalityProfileSignature({ assessment, presentation, dataRevision }) {
  const historyContext = typeof historicalReportContextFor === 'function'
    ? historicalReportContextFor(assessment)
    : null;
  return [
    dataRevision,
    historyContext?.id || 'current',
    assessmentReportFingerprint(assessment),
    presentation.canonical.id,
    presentation.card.id,
    presentation.localCard?.id || presentation.card.id,
    presentation.decision || 'local',
    presentation.inference?.confidence ?? 'local',
    presentation.inference?.rationale || '',
    presentation.inference?.evidenceIds?.join(',') || '',
  ].join(':');
}

function shouldRenderPersonalityProfile(assessment, presentation, dataRevision) {
  const nextSignature = personalityProfileSignature({ assessment, presentation, dataRevision });
  if (personalityProfileRenderSignature === nextSignature) return false;
  personalityProfileRenderSignature = nextSignature;
  return true;
}

function renderPersonalityProfile(assessment) {
  const presentation = personaPresentationFor(assessment);
  if (!shouldRenderPersonalityProfile(assessment, presentation, state.dataRevision)) return false;
  const profile = document.querySelector('#personalityProfile');
  const { canonical, card, decision, inference } = presentation;
  profile.dataset.personaId = canonical.id;
  profile.dataset.personaCard = card.id;
  profile.style.setProperty('--persona-accent', card.accent);
  profile.style.setProperty('--persona-start', card.gradient[0]);
  profile.style.setProperty('--persona-end', card.gradient[1]);
  if (!assessment.eligible) {
    profile.innerHTML = `
      <div class="profile-empty">
        <span>NEED ${Math.max(0, 3 - assessment.orderCount)} MORE</span>
        <h3>钱包的性格<br />还没显影</h3>
        <p>近 ${assessment.period} 天已有 ${assessment.orderCount} 笔记录。至少 3 笔后才给初步人格，避免拿一两次消费给你硬贴标签。</p>
      </div>`;
    return true;
  }

  const persona = canonical;
  const secondary = assessment.secondaryPersona;
  const motivationEntries = Object.entries(assessment.motivations).sort((a, b) => b[1].share - a[1].share);
  const outcome = assessment.outcomes;
  const historyContext = historicalReportContextFor(assessment);
  const periodOrders = historyContext ? [] : clinicPeriodOrders(assessment.period, assessment.source);
  const atlas = assessment.categories.slice(0, 4);
  const productGroups = historyContext
    ? restoreReportProductGroups(historyContext.productGroups)
    : reportProductGroups(periodOrders);
  const diagnosisSteps = historyContext
    ? (Array.isArray(historyContext.adviceSteps) ? historyContext.adviceSteps.map(String).slice(0, 3) : [])
    : diagnosisIsFreshFor(assessment)
      ? (state.diagnosis?.result?.action?.steps || [])
      : [];
  const topReason = assessment.reasons[0]?.reason || '当前诱因';
  const stageLabel = assessment.confidence.level === 'stable' ? '相对稳定的近期画像' : '初步倾向';
  const presentationConfidence = inference ? Math.round(inference.confidence * 100) : assessment.confidence.score;
  const presentationRationale = inference?.rationale || card.quote;
  const reportScenes = [
    { label: '购物消费', value: assessment.axes.I.score, note: '即时冲动证据' },
    { label: '兴趣增长', value: Math.round((assessment.motivations.achievement?.share || 0) * 100), note: '成就动机占比' },
    { label: '情绪慰藉', value: Math.round((assessment.motivations.healing?.share || 0) * 100), note: '疗愈动机占比' },
  ];
  profile.innerHTML = `
    <header class="report-hero profile-identity">
      <div class="report-hero-copy">
        <small>你的消费人格是 · 近 ${assessment.period} 天</small>
        <span class="report-persona-stage">${stageLabel}</span>
        <div class="report-persona-fun">规则人格底座 · ${escapeHtml(persona.name)}</div>
        <h3>${escapeHtml(card.displayName)}</h3>
        <div class="report-persona-progress">
          <span>消费指数</span>
          <i role="meter" aria-label="消费指数" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${presentationConfidence}"><b style="--report-progress:${presentationConfidence}%"></b></i>
          <strong>${presentationConfidence}%</strong>
        </div>
        <p>${escapeHtml(presentationRationale)}</p>
        <div class="report-persona-tags">${card.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="report-hero-metrics">
          <span><b>${persona.fitScore}</b><small>规则人格匹配度</small></span>
          <span><b>${presentationConfidence}</b><small>${decision === 'hybrid' ? '综合推演置信度' : '本地证据可信度'}</small></span>
        </div>
      </div>
      <div class="report-hero-art" aria-hidden="true"><i></i><img src="${personaArtUrl(card.art)}" alt="" loading="eager" decoding="async" /></div>
    </header>
    <section class="report-summary-grid" aria-label="消费报告摘要">
      <article class="report-total-card">
        <small>近 ${assessment.period} 天最终购买总额</small>
        <strong>${money(assessment.totals.purchased)}</strong>
        <p>记录金额合计 ${money(assessment.totals.recorded)} · 确认省下 ${money(assessment.totals.saved)}</p>
        <div class="report-total-breakdown">
          <span><small>本周期的钱包主题</small><b>${escapeHtml(assessment.walletTheme)}</b></span>
          <span><small>当前状态</small><b>有效记录 ${assessment.orderCount} 笔</b><em>冷静中 ${assessment.totals.coolingCount} 笔</em></span>
        </div>
      </article>
      <article class="report-atlas-card">
        <div class="report-section-heading"><div><small>HIGH-FREQUENCY ATLAS</small><h4>高频欲望图鉴</h4></div><span>按本地记录聚合</span></div>
        <div class="report-atlas-grid">
          ${atlas.length ? atlas.map((category) => {
            const ratio = assessment.totals.recorded ? Math.round(category.amount / assessment.totals.recorded * 100) : 0;
            return `<div><i aria-hidden="true">${REPORT_CATEGORY_ICONS[category.category] || REPORT_CATEGORY_ICONS.其他}</i><span><b>${escapeHtml(category.category)}</b><small>${category.count} 次 · ${money(category.amount)}</small><em aria-hidden="true"><b style="--atlas-value:${ratio}%"></b></em></span><strong>${ratio}%</strong></div>`;
          }).join('') : '<p class="report-empty-copy">当前周期还没有可汇总的记录。</p>'}
        </div>
      </article>
    </section>
    <section class="report-impulses">
      <div class="report-section-heading"><div><small>PURCHASED PRODUCT CARDS</small><h4>本月最贵的三个冲动</h4></div><span>只从当前周期已剁手商品中选取</span></div>
      <ol>
        ${productGroups.length ? productGroups.map((group, index) => {
          const strength = Math.min(3, group.evidence.size);
          const demoLabel = group.demoCount === group.count ? '<em>演示</em>' : (group.demoCount ? '<em>混合</em>' : '');
          const suggestion = diagnosisSteps[index] || localReportSuggestion(group);
          return `<li>
            <div class="report-product-rank">0${index + 1}</div>
            <div class="report-product-media"><img src="${orderThumbnailFor(group.latestOrder)}" alt="" loading="lazy" decoding="async" /></div>
            <div class="report-product-copy"><small>${escapeHtml(group.category)} · ${escapeHtml(group.reason)} ${demoLabel}</small><div><h5>${escapeHtml(group.name)}</h5><strong>${money(group.amount)}</strong></div><p>${group.count} 次已剁手记录</p><q>${escapeHtml(suggestion)}</q></div>
            <div class="report-product-evidence"><span>冲动证据强度</span><i role="meter" aria-label="${escapeHtml(group.name)}的冲动证据强度" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${strength}">${[1, 2, 3].map((level) => `<b class="${level <= strength ? 'is-on' : ''}"></b>`).join('')}</i><small>${escapeHtml([...group.evidence][0] || '当前证据较少')}</small></div>
          </li>`;
        }).join('') : '<li class="report-product-empty">当前周期还没有已剁手商品，不会用无关示例补位。</li>'}
      </ol>
    </section>
    <section class="report-advice">
      <div class="report-section-heading"><div><small>LOCAL FIRST AID</small><h4>钱包急救包</h4></div><span>低压力、可撤销</span></div>
      <div>
        <article><b>01</b><h5>先做一个小动作</h5><p>${escapeHtml(assessment.localAdvice)}</p></article>
        <article><b>02</b><h5>认出高频诱因</h5><p>最近常见的是“${escapeHtml(topReason)}”。它出现时，先离开结算页十分钟。</p></article>
        <article><b>03</b><h5>决定权仍在你</h5><p>只有你标记“幸好没买”才计入目标；最终购买不会被当成失败。</p></article>
      </div>
    </section>
    <details class="report-methodology">
      <summary>查看评分依据 <span>${assessment.evidence.length} 条证据 · 五维与动机明细</span></summary>
      <section class="report-scenes" aria-label="三个固定消费场景">
        ${reportScenes.map((scene, index) => `<article><small>SCENE 0${index + 1}</small><h4>${scene.label}</h4><strong>${scene.value === null ? '—' : `${scene.value}%`}</strong><i aria-hidden="true"><b style="--scene-value:${scene.value === null ? 0 : scene.value}%"></b></i><p>${scene.value === null ? '当前证据不足' : scene.note}</p></article>`).join('')}
      </section>
      <div class="profile-tags">
        <span>规则人格 · ${escapeHtml(persona.name)}</span>
        <span>趣味人格 · ${escapeHtml(card.displayName)}</span>
        <span>卡面来源 · ${decision === 'hybrid' ? '规则 + 聚合推演' : '本地规则映射'}</span>
        ${secondary ? `<span>副人格 · ${escapeHtml(secondary.name)}</span>` : '<span>单一倾向暂不明显</span>'}
        <span>钱包主题 · ${escapeHtml(assessment.walletTheme)}</span>
        ${assessment.source === 'demo' ? '<span class="demo-tag">演示数据</span>' : ''}
        ${assessment.excludedDemoCount ? `<span class="demo-tag">已排除 ${assessment.excludedDemoCount} 笔演示记录</span>` : ''}
      </div>
      <div class="axis-report" aria-label="五维消费评分">
        ${Object.entries(AXIS_META).map(([key, meta]) => {
          const axis = assessment.axes[key];
          const width = axis.score === null ? 0 : axis.score;
          return `<div class="axis-row ${axis.score === null ? 'is-missing' : ''}">
            <div><span>${escapeHtml(meta.label)}</span><small>${escapeHtml(axisTendency(meta, axis.score))}</small><b>${axis.score === null ? '—' : axis.score}</b></div>
            <div class="axis-track" role="meter" aria-label="${escapeHtml(meta.label)}" aria-valuemin="0" aria-valuemax="100" ${axis.score === null ? '' : `aria-valuenow="${axis.score}"`}><i style="--axis-score:${width}%"></i></div>
          </div>`;
        }).join('')}
      </div>
      <div class="motive-report">
        <div class="report-label"><span>为什么想买</span><small>MOTIVE MIX</small></div>
        <div class="motive-grid">${motivationEntries.map(([, motive], index) => `<div class="${index === 0 ? 'is-leading' : ''}"><b>${escapeHtml(motive.label)}</b><strong>${Math.round(motive.share * 100)}%</strong><small>${escapeHtml(motive.description)}</small></div>`).join('')}</div>
      </div>
      <div class="outcome-strip">
        <div><small>冷静单数率</small><strong>${outcome.decidedCount ? `${Math.round(outcome.savedCountRate * 100)}%` : '—'}</strong></div>
        <div><small>冷静金额率</small><strong>${outcome.decidedCount ? `${Math.round(outcome.savedAmountRate * 100)}%` : '—'}</strong></div>
        <div><small>中位决定时间</small><strong>${outcome.medianDecisionHours === null ? '—' : `${outcome.medianDecisionHours}h`}</strong></div>
      </div>
      <div class="profile-evidence">
        <b>为什么这样判断</b>
        <p>${escapeHtml(persona.rationale)}</p>
        <ul>${assessment.evidence.map((item) => `<li>${escapeHtml(item.statement)}</li>`).join('')}</ul>
      </div>
    </details>
    `;
  const personaArt = profile.querySelector('.report-hero-art img');
  personaArt?.addEventListener('error', () => {
    personaArt.src = './assets/phone-raccoon.webp';
  }, { once: true });
  return true;
}

function diagnosisRequestFingerprint(assessment = currentAssessment) {
  if (!assessment?.eligible) return '';
  try {
    return JSON.stringify(buildDiagnosisRequest({
      assessment,
      goal: goalForAssessment(assessment),
      orders: state.orders,
    }));
  } catch {
    return '';
  }
}

function latestAssessmentForDiagnosis(assessment = currentAssessment) {
  if (!assessment || ![7, 30].includes(Number(assessment.period))) return null;
  return scorePersonality({ orders: state.orders, period: Number(assessment.period) });
}

function diagnosisMatchesAssessmentContext(
  assessment = currentAssessment,
  latestAssessment = latestAssessmentForDiagnosis(assessment),
) {
  const savedFingerprint = typeof state.diagnosis?.requestFingerprint === 'string'
    ? state.diagnosis.requestFingerprint
    : '';
  const renderedFingerprint = diagnosisRequestFingerprint(assessment);
  const latestFingerprint = diagnosisRequestFingerprint(latestAssessment);
  return Boolean(assessment
    && latestAssessment
    && state.diagnosis
    && savedFingerprint
    && savedFingerprint === renderedFingerprint
    && savedFingerprint === latestFingerprint
    && state.diagnosis.sourceRevision === state.dataRevision
    && state.diagnosis.period === activeClinicPeriod
    && state.diagnosis.period === assessment.period
    && state.diagnosis.period === latestAssessment.period
    && state.diagnosis.scoringModelVersion === assessment.modelVersion
    && state.diagnosis.scoringModelVersion === latestAssessment.modelVersion);
}

function diagnosisIsFreshFor(assessment = currentAssessment) {
  if (!aiConsentIsCurrent()) return false;
  const latestAssessment = latestAssessmentForDiagnosis(assessment);
  return diagnosisMatchesAssessmentContext(assessment, latestAssessment)
    && validateAiDiagnosis({ result: state.diagnosis.result }, latestAssessment);
}

function diagnosisIsFresh() {
  return diagnosisIsFreshFor(currentAssessment);
}

function personaPresentationFor(assessment = currentAssessment) {
  const historyContext = historicalReportContextFor(assessment);
  const historicalInference = historyContext?.presentationInference;
  const inference = historicalInference
    ? { candidates: [historicalInference] }
    : diagnosisIsFreshFor(assessment) && aiUiState.status !== 'error'
      ? { candidates: state.diagnosis.result.persona.candidates }
      : null;
  return resolvePersonaPresentation(assessment, inference);
}

function renderConsentSummary(assessment) {
  const payload = buildDiagnosisRequest({ assessment, goal: goalForAssessment(assessment), orders: state.orders });
  const topCategory = payload.categories[0];
  const topReason = payload.reasons[0];
  const goalProgressLabel = payload.goal
    ? `已确认 ${money(payload.goal.progress)} / 目标 ${money(payload.goal.targetAmount)} · ${Math.round(payload.goal.progressRate * 100)}%`
    : '未设置';
  aiConsentSummary.innerHTML = `
    <div><span>周期</span><b>${payload.period} 天</b></div>
    <div><span>数据范围</span><b>${escapeHtml(dataScopeLabel(assessment.dataMode, assessment.orderCount))}</b></div>
    <div><span>有效记录</span><b>${assessment.orderCount} 笔</b></div>
    <div><span>最高频分类</span><b>${escapeHtml(topCategory?.category || '暂无')}</b></div>
    <div><span>最高频诱因</span><b>${escapeHtml(topReason?.reason || '暂无')}</b></div>
    <div><span>规则人格底座</span><b>${escapeHtml(assessment.primaryPersona.name)}</b></div>
    <div><span>目标金额与进度</span><b>${escapeHtml(goalProgressLabel)}</b></div>`;
}

function analysisStageCopy(snapshot = analysisStageState) {
  if (snapshot.index === ANALYSIS_STAGES.length - 1 && snapshot.outcome === 'error') {
    return {
      key: 'fallback',
      title: '这次没有完成复诊',
      detail: '已停止等待并保留本地规则人格、趣味卡面和可执行建议。',
    };
  }
  return snapshot.stage || ANALYSIS_STAGES[0];
}

function analysisStageMarkup() {
  const current = analysisStageState.index;
  return ANALYSIS_STAGES.map((stage, index) => {
    const visibleStage = index === ANALYSIS_STAGES.length - 1
      ? analysisStageCopy({ ...analysisStageState, index, stage })
      : stage;
    const stateName = index < current ? 'complete' : index === current ? 'active' : 'pending';
    return `<li data-analysis-stage="${escapeHtml(stage.key)}" data-stage-state="${stateName}"><i>${index + 1}</i><span><b>${escapeHtml(visibleStage.title)}</b><small>${escapeHtml(visibleStage.detail)}</small></span></li>`;
  }).join('');
}

function updateAnalysisStageView() {
  if (!aiCard || aiUiState.status !== 'requesting') return;
  const copy = analysisStageCopy();
  aiCard.dataset.analysisStage = copy.key;
  aiCard.querySelectorAll('[data-analysis-stage]').forEach((item, index) => {
    const stateName = index < analysisStageState.index
      ? 'complete'
      : index === analysisStageState.index ? 'active' : 'pending';
    item.dataset.stageState = stateName;
    if (index === ANALYSIS_STAGES.length - 1) {
      const finalCopy = analysisStageState.index === ANALYSIS_STAGES.length - 1
        ? copy
        : ANALYSIS_STAGES[ANALYSIS_STAGES.length - 1];
      item.querySelector('b').textContent = finalCopy.title;
      item.querySelector('small').textContent = finalCopy.detail;
    }
  });
  const liveStatus = aiCard.querySelector('[data-analysis-live]');
  if (liveStatus) liveStatus.textContent = `${copy.title}。${copy.detail}`;
  gachaponTitle.textContent = copy.title;
  gachaponHint.textContent = copy.detail;
}

function renderAiResult(assessment) {
  const result = document.querySelector('#aiResult');
  const status = document.querySelector('#aiCardStatus');
  const light = document.querySelector('#aiStatusLight');
  const fresh = diagnosisIsFresh();
  const presentation = personaPresentationFor(assessment);
  const { canonical, card, decision, inference } = presentation;
  const scopeLabel = dataScopeLabel(assessment.dataMode, assessment.orderCount);
  light.dataset.status = aiUiState.status;
  revokeAiConsentButton.hidden = !aiConsentIsCurrent();

  if (localGachaponSpinning) {
    status.textContent = 'LOCAL PERSONALITY DRAW IN PROGRESS';
    result.innerHTML = `<div class="ai-diagnosis-label">本地抽取 · ${escapeHtml(scopeLabel)}</div><div class="ai-analysis-progress"><p role="status" aria-live="polite" aria-atomic="true">六颗扭蛋正在碰撞旋转，马上揭晓本地趣味人格。</p></div>`;
  } else if (aiUiState.status === 'requesting') {
    status.textContent = 'SUMMARY REVIEW IN PROGRESS';
    const copy = analysisStageCopy();
    result.innerHTML = `<div class="ai-diagnosis-label">复诊中 · ${escapeHtml(scopeLabel)}</div><div class="ai-analysis-progress"><ol aria-hidden="true">${analysisStageMarkup()}</ol><p role="status" aria-live="polite" aria-atomic="true" data-analysis-live>${escapeHtml(copy.title)}。${escapeHtml(copy.detail)}</p></div>`;
  } else if (aiUiState.status === 'error') {
    status.textContent = 'SERVICE UNAVAILABLE · LOCAL FALLBACK ACTIVE';
    result.innerHTML = `<div class="ai-fallback"><span>本地降级 · ${escapeHtml(scopeLabel)}</span><h3>${escapeHtml(card.displayName)}</h3><p>规则人格底座：${escapeHtml(canonical.name)}</p><p>${escapeHtml(aiUiState.message)}</p><strong>本地建议仍然有效：</strong><p>${escapeHtml(assessment.localAdvice)}</p></div>`;
  } else if (fresh) {
    const diagnosis = state.diagnosis.result;
    const generated = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(state.diagnosis.generatedAt));
    status.textContent = `复诊完成 · ${generated}`;
    result.innerHTML = `
      <div class="ai-diagnosis-label">复诊结论 · ${escapeHtml(scopeLabel)}</div>
      <h3>${escapeHtml(card.displayName)}</h3>
      <p class="ai-summary">规则人格底座：${escapeHtml(canonical.name)} · ${decision === 'hybrid' ? `综合推演置信度 ${Math.round(inference.confidence * 100)}%` : '当前使用本地卡面'}</p>
      <p class="ai-summary">${escapeHtml(diagnosis.persona.summary)}</p>
      <div class="ai-evidence"><small>它引用了这些本地事实</small><ul>${diagnosis.evidence.map((item) => `<li>${escapeHtml(item.statement)}</li>`).join('')}</ul></div>
      <div class="ai-pattern"><small>模式解读</small><p>${escapeHtml(diagnosis.pattern)}</p></div>
      <div class="ai-prescription"><span>本周只做这一步</span><h4>${escapeHtml(diagnosis.action.title)}</h4><ol>${diagnosis.action.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></div>
      <p class="ai-goal-link"><strong>和目标的关系：</strong>${escapeHtml(diagnosis.goalLink)}</p>
      <p class="ai-disclaimer">${escapeHtml(diagnosis.disclaimer)}</p>`;
  } else if (state.diagnosis) {
    const periodChanged = state.diagnosis.period !== activeClinicPeriod;
    const modelChanged = state.diagnosis.scoringModelVersion !== assessment.modelVersion;
    const contractChanged = diagnosisMatchesAssessmentContext(assessment);
    const staleLabel = periodChanged ? '统计周期已切换' : (modelChanged ? '评分规则已更新' : (contractChanged ? '复诊格式已更新' : '数据已变化'));
    status.textContent = 'SOURCE SCOPE CHANGED · RECHECK NEEDED';
    result.innerHTML = `<div class="ai-stale"><span>${staleLabel} · ${escapeHtml(scopeLabel)}</span><p>旧的解读已经盖上“待复诊”章。本地分数已按当前范围重算，重新分析后才会覆盖旧结果。</p></div>`;
  } else if (assessment.eligible) {
    status.textContent = 'LOCAL SCORE READY · CONSENT REQUIRED';
    result.innerHTML = `<div class="ai-diagnosis-label">本地结果 · ${escapeHtml(scopeLabel)}</div><p>当前趣味人格为 <strong>${escapeHtml(card.displayName)}</strong>，规则人格底座是 <strong>${escapeHtml(canonical.name)}</strong>。只有你主动确认后，才会发送右侧列出的聚合摘要，用于综合推演趣味人格和生成解读。</p>`;
  } else {
    status.textContent = 'WAITING FOR ENOUGH LOCAL EVIDENCE';
    result.innerHTML = `<div class="ai-diagnosis-label">当前范围 · ${escapeHtml(scopeLabel)}</div><p>近 ${assessment.period} 天至少留下 3 笔记录，才会生成规则人格底座并开放综合推演。</p>`;
  }
}

function renderGachapon(assessment) {
  const fresh = diagnosisIsFresh();
  const presentation = personaPresentationFor(assessment);
  const personaName = assessment.eligible ? presentation.card.displayName : '等待显影';
  const canonicalName = assessment.primaryPersona?.name || '欲望观察员';
  let machineState = 'ready';
  let title = '一起看看你的钱到底去哪了～';
  let hint = '30 秒消费测试，生成你的专属消费报告';

  if (!assessment.eligible) {
    const missing = Math.max(0, 3 - assessment.orderCount);
    machineState = 'locked';
    title = '先攒够三颗消费扭蛋';
    hint = `近 ${assessment.period} 天还差 ${missing} 笔记录，攒够后才揭晓初步倾向。`;
  } else if (localGachaponSpinning) {
    machineState = 'spinning';
    title = '扭蛋正在真实碰撞旋转';
    hint = '这次只使用本地规则，不会发送任何消费摘要。';
  } else if (aiUiState.status === 'requesting') {
    machineState = 'spinning';
    const copy = analysisStageCopy();
    title = copy.title;
    hint = copy.detail;
  } else if (aiUiState.status === 'error') {
    machineState = 'fallback';
    title = `本地扭蛋仍是「${personaName}」`;
    hint = `这次没有完成综合推演，已回到本地卡面；规则人格底座仍是「${canonicalName}」。`;
  } else if (fresh) {
    machineState = 'revealed';
    title = `抽到了「${personaName}」`;
    hint = `规则人格底座是「${canonicalName}」，趣味人格由本地规则与聚合推演综合得到。`;
  } else if (state.diagnosis) {
    machineState = 'stale';
    title = '这颗扭蛋需要重新摇一摇';
    hint = '周期、记录或评分规则已经变化，旧解读不会覆盖当前结果。';
  }

  aiCard.dataset.gachaponState = machineState;
  gachaponMachine.classList.toggle('is-physics-active', machineState === 'ready' || machineState === 'locked' || machineState === 'spinning');
  gachaponMotion.setState(machineState);
  aiCard.setAttribute('aria-busy', String(machineState === 'spinning'));
  gachaponTitle.textContent = title;
  gachaponHint.textContent = hint;
  gachaponPrize.innerHTML = machineState === 'spinning'
    ? '<b>···</b><small>抽取中</small>'
    : machineState === 'locked'
      ? `<b>${Math.max(0, 3 - assessment.orderCount)}</b><small>还差记录</small>`
      : `<b>${machineState === 'ready' ? '?' : escapeHtml(personaName.slice(0, 1))}</b><small>${machineState === 'ready' ? '等待抽取' : escapeHtml(personaName)}</small>`;
}

function renderClinic(assessment = null) {
  currentAssessment = assessment?.period === activeClinicPeriod
    ? assessment
    : scorePersonality({ orders: state.orders, period: activeClinicPeriod });
  clockClinicAssessmentFingerprint = assessmentReportFingerprint(currentAssessment);
  const topReason = currentAssessment.reasons[0]?.reason || '暂无';
  document.querySelector('#clinicLedger').innerHTML = `
    <div><small>${activeClinicPeriod} 天记录</small><strong>${currentAssessment.orderCount}</strong></div>
    <div><small>确认省下</small><strong>${money(currentAssessment.totals.saved)}</strong></div>
    <div><small>高频诱因</small><strong>${escapeHtml(topReason)}</strong></div>`;
  document.querySelector('#clinicConfidence').textContent = confidenceLabel(currentAssessment.confidence);
  document.querySelectorAll('[data-clinic-period]').forEach((button) => {
    const isActive = Number(button.dataset.clinicPeriod) === activeClinicPeriod;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  renderPersonalityProfile(currentAssessment);
  renderAiResult(currentAssessment);
  renderGachapon(currentAssessment);
  const busy = gachaponIsBusy();
  const consentPromptVisible = currentAssessment.eligible
    && !aiConsentIsCurrent()
    && !busy;
  if (consentPromptVisible) renderConsentSummary(currentAssessment);
  aiConsentPanel.hidden = !consentPromptVisible;
  analyzeButton.disabled = !currentAssessment.eligible || busy;
  analyzeButton.querySelector('span').textContent = !currentAssessment.eligible
    ? `还差 ${Math.max(0, 3 - currentAssessment.orderCount)} 笔记录`
    : busy
      ? '测试中…'
      : diagnosisIsFresh()
        ? '再测一次'
        : (aiConsentIsCurrent() ? '重新测试' : '开始测试');
  const shareAssessment = currentAssessment;
  posterButton.disabled = !shareAssessment.eligible || posterGenerating || busy;
  if (posterBlob && posterFingerprint !== currentPosterFingerprint()) clearPoster();
  posterButton.textContent = shareAssessment.eligible
    ? '分享报告'
    : `还差 ${Math.max(0, 3 - shareAssessment.orderCount)} 笔记录`;
}

function currentPosterFingerprint(assessment = currentAssessment) {
  const requestedAssessment = assessment || currentAssessment;
  const historyContext = typeof historicalReportContextFor === 'function'
    ? historicalReportContextFor(requestedAssessment)
    : null;
  const effectiveAssessment = historyContext
    ? requestedAssessment
    : requestedAssessment?.period === activeClinicPeriod
      ? requestedAssessment
      : scorePersonality({ orders: state.orders, period: activeClinicPeriod });
  const presentation = personaPresentationFor(effectiveAssessment);
  return [
    historyContext?.id || state.dataRevision,
    historyContext?.generatedAt ? localDateKey(historyContext.generatedAt) : localDateKey(new Date()),
    assessmentReportFingerprint(effectiveAssessment),
    presentation.canonical.id,
    presentation.card.id,
    presentation.localCard.id,
    presentation.decision,
    presentation.inference?.confidence ?? 'local',
    presentation.inference?.evidenceIds?.join(',') || '',
  ].join(':');
}

function openPosterShare() {
  if (!posterShare.open) {
    posterShareReturnFocus = posterButton;
    posterShare.showModal();
  }
  window.requestAnimationFrame(() => posterReturnButton.focus({ preventScroll: true }));
}

function closePosterShare({ restoreFocus = true } = {}) {
  if (!posterShare?.open) return;
  posterShare.close();
  const returnTarget = posterShareReturnFocus;
  posterShareReturnFocus = null;
  if (restoreFocus && returnTarget && document.contains(returnTarget)) {
    window.requestAnimationFrame(() => returnTarget.focus({ preventScroll: true }));
  }
}

function openGachaponResult({ source = 'hybrid' } = {}) {
  if (!currentAssessment?.eligible || activePanel !== 'clinic') return false;
  closePosterShare({ restoreFocus: false });
  const resultWasOpen = Boolean(gachaponResultModal.open);
  const presentation = source === 'local'
    ? resolvePersonaPresentation(currentAssessment)
    : personaPresentationFor(currentAssessment);
  const { canonical, card, decision, inference } = presentation;
  gachaponResultSource = source === 'local' ? 'local' : 'hybrid';
  gachaponResultModal.dataset.personaId = canonical.id;
  gachaponResultModal.dataset.personaCard = card.id;
  gachaponResultModal.style.setProperty('--persona-accent', card.accent);
  gachaponResultModal.style.setProperty('--persona-start', card.gradient[0]);
  gachaponResultModal.style.setProperty('--persona-end', card.gradient[1]);
  gachaponResultArt.onerror = () => {
    gachaponResultArt.onerror = null;
    gachaponResultArt.src = './assets/figma-gachapon-result.png';
  };
  gachaponResultArt.src = './assets/figma-gachapon-result.png';
  gachaponResultFlair.textContent = '消费人格';
  gachaponResultTags.innerHTML = card.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  gachaponResultTitle.textContent = card.displayName;
  const stageLabel = currentAssessment.confidence.level === 'stable' ? '相对稳定的近期画像' : '初步倾向';
  gachaponResultDescription.textContent = decision === 'hybrid'
    ? `从近 ${currentAssessment.period} 天的 ${currentAssessment.orderCount} 笔有效记录中，以「${canonical.name}」为规则人格底座，结合聚合证据推演出${stageLabel}；综合置信度 ${Math.round(inference.confidence * 100)}%。`
    : `从近 ${currentAssessment.period} 天的 ${currentAssessment.orderCount} 笔有效记录中，以「${canonical.name}」为规则人格底座生成${stageLabel}。当前没有可用的综合推演，展示本地卡面。`;
  gachaponResultRetryButton.textContent = '再测一次';
  gachaponResultReturnFocus = source === 'local' ? localOnlyButton : analyzeButton;
  aiCard.classList.add('is-gachapon-result-open');
  if (!resultWasOpen) {
    if (typeof rememberTestResult === 'function') rememberTestResult(currentAssessment, presentation, source);
    if (typeof sessionStorage !== 'undefined' && typeof RETURN_TO_ROOM_ON_LOAD_KEY !== 'undefined') {
      try {
        sessionStorage.setItem(RETURN_TO_ROOM_ON_LOAD_KEY, '1');
      } catch {
      }
    }
    gachaponResultModal.showModal();
  }
  window.requestAnimationFrame(() => gachaponResultTitle.focus({ preventScroll: true }));
  return true;
}

function startLocalGachaponReveal() {
  if (gachaponIsBusy() || activePanel !== 'clinic') return false;
  const assessment = scorePersonality({ orders: state.orders, period: activeClinicPeriod, now: new Date() });
  if (!assessment.eligible) {
    currentAssessment = assessment;
    renderClinic(assessment);
    return false;
  }

  const startRevision = state.dataRevision;
  const startPeriod = activeClinicPeriod;
  const startFingerprint = assessmentReportFingerprint(assessment);
  const spinToken = ++localGachaponSpinSequence;
  currentAssessment = assessment;
  clockClinicAssessmentFingerprint = startFingerprint;
  localGachaponSpinning = true;
  aiUiState = { status: 'idle', message: '' };
  closeGachaponResult({ restoreFocus: false, flushPending: false });
  renderClinic(assessment);

  const reveal = () => {
    localGachaponSpinTimer = null;
    if (spinToken !== localGachaponSpinSequence) return;
    const latestAssessment = scorePersonality({ orders: state.orders, period: activeClinicPeriod, now: new Date() });
    const contextIsCurrent = activePanel === 'clinic'
      && startRevision === state.dataRevision
      && startPeriod === activeClinicPeriod
      && startFingerprint === assessmentReportFingerprint(latestAssessment)
      && latestAssessment.eligible;
    localGachaponSpinning = false;
    if (!contextIsCurrent) {
      if (activePanel === 'clinic') renderClinic(latestAssessment);
      return;
    }
    currentAssessment = latestAssessment;
    gachaponMachine.classList.remove('is-physics-active');
    gachaponMotion.setState('revealed');
    aiCard.setAttribute('aria-busy', 'false');
    clinicRenderPending = true;
    showToast('本地人格已经揭晓，全程没有发送消费摘要。');
    if (!openGachaponResult({ source: 'local' })) {
      clinicRenderPending = false;
      renderClinic(latestAssessment);
    }
  };

  const delay = document.body.classList.contains('reduce-motion') ? 0 : 1400;
  localGachaponSpinTimer = window.setTimeout(reveal, delay);
  return true;
}

function closeGachaponResult({ restoreFocus = true, flushPending = true } = {}) {
  if (!gachaponResultModal?.open) {
    aiCard.classList.remove('is-gachapon-result-open');
    if (clinicRenderPending) {
      clinicRenderPending = false;
      if (flushPending && activePanel === 'clinic') renderClinic();
    }
    return;
  }
  gachaponResultModal.close();
  aiCard.classList.remove('is-gachapon-result-open');
  const shouldRenderClinic = clinicRenderPending;
  clinicRenderPending = false;
  if (shouldRenderClinic && flushPending && activePanel === 'clinic') renderClinic();
  const returnTarget = gachaponResultReturnFocus;
  gachaponResultReturnFocus = null;
  if (restoreFocus && returnTarget && document.contains(returnTarget)) {
    window.requestAnimationFrame(() => returnTarget.focus({ preventScroll: true }));
  }
}

function clearPoster() {
  closePosterShare({ restoreFocus: false });
  if (posterUrl) URL.revokeObjectURL(posterUrl);
  posterBlob = null;
  posterUrl = null;
  posterFingerprint = '';
  posterPreview.removeAttribute('src');
  posterShare.dataset.state = 'idle';
  posterShareStatus.textContent = '分享报告只在当前浏览器中生成。';
}

function posterModel(assessment = currentAssessment) {
  const historyContext = historicalReportContextFor(assessment);
  const effectiveAssessment = historyContext
    ? assessment
    : assessment?.period === activeClinicPeriod
      ? assessment
      : scorePersonality({ orders: state.orders, period: activeClinicPeriod });
  const modelInput = {
    assessment: effectiveAssessment,
    presentation: personaPresentationFor(effectiveAssessment),
    goal: goalForAssessment(effectiveAssessment),
  };
  if (historyContext?.goal) modelInput.goal = historyContext.goal;
  return buildSharePosterModel(modelInput);
}

function posterAltText(model) {
  const saved = model.savedAmount === null
    ? '确认省下金额证据不足'
    : `确认省下 ${model.savedLabel}，共 ${model.savedCountLabel}`;
  return `钱包人格分享海报：${model.periodLabel}，${model.recordScope}，趣味人格${model.funPersona}，规则人格底座${model.persona}，来源为${model.source}；${saved}；最高频分类${model.topCategory}；样本 ${model.orderCount} 笔，可信度 ${model.confidence}%；${model.goalLabel}；建议：${model.advice}；生成日期 ${model.generatedDate}。这是近期行为观察，不是永久标签；数据来自用户自我记录；确认省下是产品内的虚拟记录，不代表真实账户余额。`;
}

async function generatePoster() {
  const historyContext = historicalReportContextFor(currentAssessment);
  const shareAssessment = historyContext
    ? currentAssessment
    : scorePersonality({ orders: state.orders, period: activeClinicPeriod });
  if (posterGenerating || !shareAssessment.eligible) return;
  const fingerprint = currentPosterFingerprint(shareAssessment);
  if (posterBlob && posterFingerprint === fingerprint) {
    posterShare.dataset.state = 'ready';
    openPosterShare();
    return;
  }
  posterGenerating = true;
  posterButton.disabled = true;
  posterButton.textContent = '正在生成 PNG…';
  posterShare.dataset.state = 'generating';
  posterShareStatus.textContent = `正在本地绘制近 ${shareAssessment.period} 天人格海报…`;
  openPosterShare();
  try {
    const model = posterModel(shareAssessment);
    const blob = await renderSharePoster(model);
    if (fingerprint !== currentPosterFingerprint()) {
      posterShare.dataset.state = 'error';
      posterShareStatus.textContent = '生成期间记录或周期发生变化，请重新生成当前报告。';
      return;
    }
    if (posterUrl) URL.revokeObjectURL(posterUrl);
    posterBlob = blob;
    posterFingerprint = fingerprint;
    posterUrl = URL.createObjectURL(blob);
    posterPreview.src = posterUrl;
    posterPreview.alt = posterAltText(model);
    posterShare.dataset.state = 'ready';
    posterShareStatus.textContent = '已在本地生成高清 PNG，可保存到相册。';
    showToast('分享海报已生成，没有上传消费明细。');
  } catch (error) {
    posterShare.dataset.state = 'error';
    posterShareStatus.textContent = error?.message || '海报生成失败，请稍后重试。';
  } finally {
    posterGenerating = false;
    const latestHistoryContext = historicalReportContextFor(currentAssessment);
    const latestShareAssessment = latestHistoryContext
      ? currentAssessment
      : scorePersonality({ orders: state.orders, period: activeClinicPeriod });
    posterButton.disabled = !latestShareAssessment.eligible;
    posterButton.textContent = latestShareAssessment.eligible
      ? '分享报告'
      : `还差 ${Math.max(0, 3 - latestShareAssessment.orderCount)} 笔记录`;
  }
}

function fillGoalForm(goal) {
  goalForm.elements.goalName.value = goal.name;
  goalAmountInput.max = String(goal.amount > MAX_BUDGET_GOAL_AMOUNT ? goal.amount : MAX_BUDGET_GOAL_AMOUNT);
  goalForm.elements.goalAmount.value = goal.amount;
  goalDatePicker.setValue(goal.deadline || '');
  goalForm.elements.goalNoteText.value = goal.noteText || '';
  const color = normalizeGoalNote(goal.note).color;
  goalForm.querySelectorAll('[name="goalNoteColor"]').forEach((input) => {
    input.checked = input.value === color;
  });
  validateGoalAmountField();
  renderGoalAmountChoice(goal.amount);
}

function resetGoalForm() {
  goalForm.reset();
  goalAmountInput.max = String(MAX_BUDGET_GOAL_AMOUNT);
  goalDatePicker.setValue('');
  const yellow = goalForm.querySelector('[name="goalNoteColor"][value="yellow"]');
  if (yellow) yellow.checked = true;
  validateGoalAmountField();
  renderGoalAmountChoice(0);
}

function selectedGoalAmountForValidation() {
  if (goalFormMode !== 'edit') return null;
  return goalById(selectedGoalId)?.amount ?? null;
}

function validateGoalAmountField({ announce = false } = {}) {
  const validation = validateBudgetGoalAmount(goalAmountInput.value, selectedGoalAmountForValidation());
  const empty = String(goalAmountInput.value).trim() === '';
  const message = validation.reason === 'over-limit'
    ? `目标金额最多为 ¥${MAX_BUDGET_GOAL_AMOUNT.toLocaleString('zh-CN')}`
    : (!empty && validation.reason === 'invalid' ? '请输入大于 0 的目标金额' : '');
  goalAmountInput.setCustomValidity(message);
  goalAmountError.textContent = message;
  goalAmountError.hidden = !message;
  if (announce && message) {
    goalAmountInput.focus({ preventScroll: true });
    goalAmountInput.reportValidity();
  }
  return validation;
}

function renderGoalAmountChoice(rawAmount) {
  const amount = Math.max(0, Number(rawAmount) || 0);
  if (goalTargetAmount) goalTargetAmount.textContent = money(amount);
  goalAmountBeads.forEach((button) => {
    const selected = amount >= Number(button.dataset.goalAmount);
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function renderGoalEditor() {
  const selectedGoal = goalById(selectedGoalId);
  if (goalFormMode === 'edit' && selectedGoal) {
    document.querySelector('#goalFormTitle').textContent = `编辑目标 · ${selectedGoal.name}`;
    document.querySelector('#goalSubmitLabel').textContent = '保存目标';
    deleteGoalButton.hidden = false;
    setActiveGoalButton.hidden = selectedGoal.id === state.activeGoalId;
    if (renderedGoalId !== selectedGoal.id) {
      fillGoalForm(selectedGoal);
      renderedGoalId = selectedGoal.id;
    }
    return;
  }
  document.querySelector('#goalFormTitle').textContent = '新建目标';
  document.querySelector('#goalSubmitLabel').textContent = '保存目标';
  deleteGoalButton.hidden = true;
  setActiveGoalButton.hidden = true;
  if (renderedGoalId !== '__new__') {
    resetGoalForm();
    renderedGoalId = '__new__';
  }
}

function renderGoalList() {
  document.querySelector('#goalCount').textContent = `${state.goals.length} 个目标`;
  if (!state.goals.length) {
    goalList.innerHTML = '<div class="goal-note-list-empty">还没有消费小目标。点“新建目标”，把真正想要的东西先定下来。</div>';
    return;
  }
  goalList.innerHTML = state.goals.map((goal) => {
    const progress = calculateGoalProgress(state.orders, goal);
    const percent = Math.min(100, Math.round((progress?.progressRate || 0) * 100));
    return `<button class="goal-note-list-item is-${normalizeGoalNote(goal.note).color} ${goal.id === selectedGoalId ? 'is-selected' : ''}" type="button" data-goal-select="${escapeHtml(goal.id)}">
      <span>${goal.id === state.activeGoalId ? '当前目标' : '候选目标'}${goal.demo ? ' · 演示' : ''}</span><b>${escapeHtml(goal.name)}</b><small>${percent}% · 已确认 ${money(progress?.progress || 0)}</small>
    </button>`;
  }).join('');
}

function renderGoal() {
  if (selectedGoalId && !goalById(selectedGoalId)) selectedGoalId = state.activeGoalId || state.goals[0]?.id || null;
  const goal = currentGoal();
  const progress = calculateGoalProgress(state.orders, goal);
  const amount = progress?.targetAmount || 0;
  const saved = progress?.progress || 0;
  const percent = progress ? Math.min(100, Math.round(progress.progressRate * 100)) : 0;
  document.querySelector('#goalPercent').textContent = `${percent}%`;
  document.querySelector('#goalRing').style.setProperty('--progress', `${percent * 3.6}deg`);
  document.querySelector('#goalRing').style.setProperty('--progress-pct', `${percent}%`);
  document.querySelector('#goalSaved').textContent = money(saved);
  if (goalCurrentSaved) goalCurrentSaved.textContent = money(saved);
  if (goalCurrentName) goalCurrentName.textContent = goal?.name || '等待设置';
  renderGoalAmountChoice(goal?.amount || goalForm.elements.goalAmount.value);
  document.querySelector('#goalSummary').textContent = goal
    ? `当前目标${goal.demo ? '（演示）' : ''}：${goal.name}，还差 ${money(Math.max(0, amount - saved))}。`
    : '还没有设定目标。';
  const items = goal ? [goal].map((item) => {
    const itemProgress = calculateGoalProgress(state.orders, item);
    return { goal: item, saved: itemProgress?.progress || 0, percent: Math.min(100, Math.round((itemProgress?.progressRate || 0) * 100)) };
  }) : [];
  sceneWhiteboard.render({ items, activeGoalId: state.activeGoalId, selectedGoalId, active: activePanel === 'goals' });
  renderGoalList();
  renderGoalEditor();
}

function renderAll() {
  renderMetrics();
  renderOrderDashboard();
  renderCommerceShell();
  renderOrderEditor();
  renderOrders();
  renderClinic();
  renderGoal();
  renderTestHistory();
}

function createOrder(formData, { showReceipt = true } = {}) {
  const amount = Number(formData.get('amount'));
  const now = new Date().toISOString();
  const values = {
    name: String(formData.get('name')).trim(),
    amount,
    category: String(formData.get('category')),
    reason: String(formData.get('reason')),
    decisionSignals: formData.getAll('decisionSignals').map(String).slice(0, 2),
  };
  if (!values.name || !Number.isFinite(amount) || amount <= 0 || !values.category || !values.reason) return null;

  if (editingOrderId) {
    const orderId = editingOrderId;
    mutate((draft) => {
      const order = draft.orders.find((item) => item.id === orderId && item.status === 'cooling');
      if (!order) return;
      Object.assign(order, values, { updatedAt: now });
    });
    editingOrderId = null;
    orderForm.reset();
    renderOrderEditor();
    setMascotSpeech(`冷静单“${values.name}”已经更新，决定权还在你手里。`);
    showToast('冷静单已更新，统计已经重新计算。');
    closeOrderComposer({ restoreFocus: false, reset: false });
    history.replaceState({ panel: 'orders', openedByApp: true }, '', '#orders');
    applyPanel('orders');
    return null;
  }

  const order = {
    id: crypto.randomUUID ? crypto.randomUUID() : `order-${Date.now()}`,
    ...values,
    status: 'cooling',
    decidedAt: null,
    statusHistory: [],
    demo: false,
    createdAt: now,
    updatedAt: now,
  };

  mutate((draft) => draft.orders.push(order));
  orderForm.reset();
  setMascotSpeech(`收到！${money(amount)} 先进入冷静中，还不能算成省下。`);
  const phone = panorama.getTriggerForPanel('new');
  phone?.classList.add('is-pulsing');
  showToast('模拟订单已创建，进入“冷静中”。');
  if (showReceipt) {
    document.querySelector('#receiptProductName').textContent = order.name;
    document.querySelector('#receiptAmount').textContent = money(order.amount);
    orderForm.hidden = true;
    document.querySelector('.order-form-heading').hidden = true;
    orderReceipt.hidden = false;
    document.querySelector('#receiptProductName').focus({ preventScroll: true });
    orderReceipt.scrollIntoView({ behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth', block: 'center' });
  } else {
    orderForm.hidden = false;
    document.querySelector('.order-form-heading').hidden = false;
    orderReceipt.hidden = true;
    renderOrderEditor();
  }
  window.setTimeout(() => phone?.classList.remove('is-pulsing'), document.body.classList.contains('reduce-motion') ? 30 : 820);
  return order;
}

function resetOrderComposer() {
  editingOrderId = null;
  orderForm.reset();
  orderForm.hidden = false;
  document.querySelector('.order-form-heading').hidden = false;
  orderReceipt.hidden = true;
  activateCategoryShortcut(categoryCards[activeCategoryCardIndex], { revealForm: false, moveToForm: false });
  renderOrderEditor();
}

function editOrder(id, trigger) {
  const order = state.orders.find((item) => item.id === id);
  if (!order || order.status !== 'cooling') {
    showToast('只有“冷静中”的订单可以编辑。');
    return;
  }
  resetOrderComposer();
  editingOrderId = id;
  orderForm.elements.name.value = order.name;
  orderForm.elements.amount.value = order.amount;
  orderForm.elements.category.value = order.category;
  orderForm.elements.reason.value = order.reason;
  const signals = new Set(order.decisionSignals || []);
  orderForm.querySelectorAll('input[name="decisionSignals"]').forEach((checkbox) => {
    checkbox.checked = signals.has(checkbox.value);
  });
  renderOrderEditor();
  history.replaceState({ panel: 'new', phoneView: 'home', openedByApp: false }, '', buildNewHash({ phoneView: 'home' }));
  showPhoneView('home');
  applyPanel('new', trigger);
  window.setTimeout(() => openOrderComposer(trigger), document.body.classList.contains('reduce-motion') ? 20 : 360);
}

function deleteOrder(id) {
  const order = state.orders.find((item) => item.id === id);
  if (!order || !window.confirm(`确定删除“${order.name}”这张小票吗？删除后统计和目标进度会重新计算。`)) return;
  mutate((draft) => {
    draft.orders = draft.orders.filter((item) => item.id !== id);
  });
  if (editingOrderId === id) resetOrderComposer();
  setMascotSpeech('这张小票已经删除，统计和目标进度也重新算过了。');
  showToast('小票已删除。');
}

function updateOrderStatus(id, status) {
  const existingOrder = state.orders.find((item) => item.id === id);
  if (!existingOrder || !allowedOrderStatusActions(existingOrder.status).includes(status)) {
    showToast('这张小票不能这样改变状态。');
    return false;
  }
  const previousStatus = existingOrder.status;
  const changedAt = new Date().toISOString();
  mutate((draft) => {
    const order = draft.orders.find((item) => item.id === id);
    if (!order || !applyOrderStatusTransition(order, status, changedAt)) return;
    if (status === 'saved' && previousStatus !== 'saved') {
      order.goalId = goalForSavedOrder(order, draft.goals, draft.activeGoalId);
    }
  });
  const messages = {
    saved: '这次确认没买。目标罐听见了一声清脆的回血。',
    purchased: '记录为最终购买。这里不评判，只帮你看清决定。',
  };
  setMascotSpeech(messages[status]);
  showToast(`订单已更新为“${STATUS_LABELS[status]}”。`);
  focusOrderAfterStatusChange(id, status);
  return true;
}

function validateAiDiagnosis(payload, assessment = currentAssessment) {
  const result = payload?.result;
  const persona = result?.persona;
  if (!result || typeof result !== 'object' || !persona || typeof persona !== 'object' || !assessment?.primaryPersona) return false;
  const localPresentation = resolvePersonaPresentation(assessment);
  const allowedEvidenceIds = new Set((Array.isArray(assessment.evidence) ? assessment.evidence : [])
    .slice(0, 8)
    .map((item, index) => (typeof item?.statement === 'string' && item.statement.trim() ? `E${index + 1}` : null))
    .filter(Boolean));
  const validText = (value, maxLength) => typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
  const validEvidenceIds = (value, { allowEmpty = false } = {}) => Array.isArray(value)
    && (value.length === 0 ? allowEmpty : value.length >= 2)
    && value.length <= 3
    && new Set(value).size === value.length
    && value.every((id) => typeof id === 'string' && allowedEvidenceIds.has(id));
  const validConfidence = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

  if (!validText(persona.title, 40)
    || !validText(persona.canonicalTitle, 40)
    || !validText(persona.rationale, 180)
    || !validText(persona.summary, 160)) return false;
  if (persona.canonicalTitle !== localPresentation.canonical.name) return false;
  if (!isFigmaPersonaCardId(persona.cardId) || persona.localCardId !== localPresentation.localCard.id) return false;
  if (!['local', 'hybrid'].includes(persona.decision) || !validConfidence(persona.confidence)) return false;
  if (!validEvidenceIds(persona.evidenceIds, { allowEmpty: persona.decision === 'local' })) return false;
  if (!Array.isArray(persona.candidates) || persona.candidates.length > 3) return false;
  if (persona.candidates.some((candidate) => !candidate
    || typeof candidate !== 'object'
    || !isFigmaPersonaCardId(candidate.cardId)
    || !validConfidence(candidate.confidence)
    || !validText(candidate.rationale, 180)
    || !validEvidenceIds(candidate.evidenceIds))) return false;

  const resolved = resolvePersonaPresentation(assessment, { candidates: persona.candidates });
  if (resolved.card.id !== persona.cardId || resolved.decision !== persona.decision) return false;
  if (persona.title !== resolved.card.displayName) return false;
  if (resolved.decision === 'hybrid') {
    if (!resolved.inference || Math.abs(resolved.inference.confidence - persona.confidence) > 0.001) return false;
    if (resolved.inference.rationale !== persona.rationale) return false;
    if (resolved.inference.evidenceIds.join('|') !== persona.evidenceIds.join('|')) return false;
  }
  if (!Array.isArray(result.evidence) || result.evidence.length < 2 || result.evidence.length > 4) return false;
  const resultEvidenceIds = result.evidence.map((item) => item?.id);
  if (new Set(resultEvidenceIds).size !== resultEvidenceIds.length
    || result.evidence.some((item) => !allowedEvidenceIds.has(item?.id) || !validText(item?.statement, 220))) return false;
  if (!validText(result.pattern, 260) || !validText(result.action?.title, 80)) return false;
  if (!Array.isArray(result.action?.steps) || result.action.steps.length < 1 || result.action.steps.length > 3) return false;
  if (result.action.steps.some((step) => !validText(step, 100))) return false;
  if (!validText(result.goalLink, 180) || !validText(result.disclaimer, 220)) return false;
  return true;
}

function friendlyAiError(error) {
  if (error?.name === 'AbortError') return '本次综合推演已取消，本地规则结果没有受到影响。';
  if (error?.code === 'missing_api_key') return '复诊服务尚未配置，当前展示本地人格卡面。';
  if (error?.code === 'rate_limited') return '今天的复诊有点拥挤，请稍后再试；当前展示本地人格卡面。';
  if (error?.code === 'upstream_timeout') return '这次等待时间较长，先使用本地人格与建议。';
  return error?.message || '暂时没有完成综合推演，先使用本地人格与建议。';
}

async function requestAiDiagnosis() {
  if (aiUiState.status === 'requesting') return;
  const requestAssessment = scorePersonality({
    orders: state.orders,
    period: activeClinicPeriod,
    now: new Date(),
  });
  currentAssessment = requestAssessment;
  clockClinicAssessmentFingerprint = assessmentReportFingerprint(requestAssessment);
  if (!requestAssessment.eligible) {
    aiUiState = { status: 'idle', message: '' };
    closeGachaponResult({ restoreFocus: false, flushPending: false });
    renderClinic(requestAssessment);
    return;
  }
  if (!aiConsentIsCurrent()) {
    state.settings.aiConsent = false;
    aiUiState = { status: 'idle', message: '' };
    renderClinic(requestAssessment);
    if (aiConsentMessage) aiConsentMessage.textContent = '请先勾选同意发送匿名聚合摘要，或选择只看本地人格。';
    return;
  }
  const requestRevision = state.dataRevision;
  const requestPeriod = activeClinicPeriod;
  const requestPayload = buildDiagnosisRequest({ assessment: requestAssessment, goal: goalForAssessment(requestAssessment), orders: state.orders });
  const requestFingerprint = JSON.stringify(requestPayload);
  const requestBusinessFingerprint = diagnosisBusinessStateFingerprint(state);
  const requestPersistedFingerprint = persistedDiagnosisBusinessStateFingerprint();
  const expectedPersistedFingerprint = `valid:${requestBusinessFingerprint}`;
  if (requestPersistedFingerprint !== 'unavailable'
    && requestPersistedFingerprint !== expectedPersistedFingerprint) {
    try {
      applyExternalBusinessState(localStorage.getItem(STORAGE_KEY));
    } catch {
    }
    return;
  }
  let outcome = { status: 'idle', message: '' };
  let timedOut = false;
  cancelAiRequest('superseded');
  const requestToken = ++aiRequestSequence;
  const requestController = new AbortController();
  aiRequestController = requestController;
  const requestIsCurrent = () => requestToken === aiRequestSequence;
  const requestBusinessContextIsCurrent = () => {
    const currentPersistedFingerprint = persistedDiagnosisBusinessStateFingerprint();
    return requestBusinessFingerprint === diagnosisBusinessStateFingerprint(state)
      && (currentPersistedFingerprint === 'unavailable'
        || currentPersistedFingerprint === expectedPersistedFingerprint);
  };
  const timeout = window.setTimeout(() => {
    timedOut = true;
    requestController.abort('timeout');
  }, 12_000);
  state.diagnosis = null;
  setAiDiagnosisInvalidatedForSession(true);
  persistAiDiagnosis(null, { silent: true });
  closeGachaponResult({ restoreFocus: false, flushPending: false });
  aiUiState = { status: 'requesting', message: '' };
  analysisStageController.start({ reduceMotion: document.body.classList.contains('reduce-motion') });
  renderClinic(requestAssessment);
  if (posterBlob) clearPoster();
  setMascotSpeech('本地五维和规则人格已经算好，正在用去掉商品名和备注后的聚合证据推演趣味人格。');

  try {
    const response = await fetch('/api/ai/diagnosis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: requestController.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!requestIsCurrent()) return;
    if (!response.ok) {
      const error = new Error(payload.message || `复诊服务返回 ${response.status}`);
      error.code = payload.code;
      throw error;
    }
    if (!validateAiDiagnosis(payload, requestAssessment)) throw new Error('返回结构不完整或人格映射不一致，已切换为本地结果。');
    if (!aiConsentIsCurrent()) {
      const error = new Error('数据发送同意已撤回。');
      error.code = 'consent_revoked';
      throw error;
    }
    const latestRequestAssessment = latestAssessmentForDiagnosis(requestAssessment);
    if (requestRevision !== state.dataRevision
      || requestPeriod !== activeClinicPeriod
      || requestFingerprint !== diagnosisRequestFingerprint(latestRequestAssessment)
      || !requestBusinessContextIsCurrent()) {
      return;
    }
    state.diagnosis = {
      sourceRevision: requestRevision,
      period: requestPeriod,
      scoringModelVersion: requestAssessment.modelVersion,
      requestFingerprint,
      generatedAt: new Date().toISOString(),
      result: payload.result,
    };
    if (persistAiDiagnosis(state.diagnosis) && requestBusinessContextIsCurrent()) {
      setAiDiagnosisInvalidatedForSession(false);
    } else if (!requestBusinessContextIsCurrent()) {
      state.diagnosis = null;
      setAiDiagnosisInvalidatedForSession(true);
      persistAiDiagnosis(null, { silent: true });
      return;
    }
    outcome = { status: 'success', message: '' };
  } catch (error) {
    if (!requestIsCurrent()) return;
    state.diagnosis = null;
    setAiDiagnosisInvalidatedForSession(true);
    persistAiDiagnosis(null, { silent: true });
    if (error?.code === 'consent_revoked' || (!aiConsentIsCurrent() && error?.name === 'AbortError')) return;
    if (error?.name === 'AbortError' && !timedOut) return;
    const effectiveError = timedOut
      ? Object.assign(new Error('这次等待时间较长，先使用本地建议。'), { code: 'upstream_timeout' })
      : error;
    outcome = { status: 'error', message: friendlyAiError(effectiveError) };
  } finally {
    window.clearTimeout(timeout);
    if (!requestIsCurrent()) return;

    if (outcome.status === 'success' || outcome.status === 'error') {
      await analysisStageController.finish(outcome.status);
    } else {
      analysisStageController.stop();
    }

    if (!requestIsCurrent()) return;
    if (aiRequestController === requestController) aiRequestController = null;
    const finalRequestAssessment = latestAssessmentForDiagnosis(requestAssessment);
    const requestDataIsCurrent = requestRevision === state.dataRevision
      && requestPeriod === activeClinicPeriod
      && requestAssessment.modelVersion === finalRequestAssessment?.modelVersion
      && requestFingerprint === diagnosisRequestFingerprint(finalRequestAssessment)
      && requestBusinessContextIsCurrent()
      && aiConsentIsCurrent();
    if (!requestDataIsCurrent && state.diagnosis?.requestFingerprint === requestFingerprint) {
      state.diagnosis = null;
      setAiDiagnosisInvalidatedForSession(true);
      persistAiDiagnosis(null, { silent: true });
    }
    const requestContextIsCurrent = activePanel === 'clinic' && requestDataIsCurrent;
    if (!requestContextIsCurrent) {
      aiUiState = { status: 'idle', message: '' };
      closeGachaponResult({ restoreFocus: false, flushPending: false });
      clearPoster();
      if (activePanel === 'clinic') renderClinic(finalRequestAssessment);
      return;
    }

    aiUiState = outcome;
    if (outcome.status === 'idle') {
      renderClinic();
      return;
    }

    gachaponMachine.classList.remove('is-physics-active');
    gachaponMotion.setState(outcome.status === 'success' ? 'revealed' : 'fallback');
    aiCard.setAttribute('aria-busy', 'false');
    if (outcome.status === 'success') {
      const presentation = personaPresentationFor(requestAssessment);
      setMascotSpeech(`综合推演完成：趣味人格是“${presentation.card.displayName}”，规则人格底座是“${presentation.canonical.name}”。`);
      showToast('综合人格与复诊建议已更新。');
    } else {
      setMascotSpeech('这次没接上，但本地规则、卡面和订单都好好的。');
      showToast('已切换到本地人格结果。');
    }
    clinicRenderPending = true;
    if (!openGachaponResult()) {
      clinicRenderPending = false;
      renderClinic();
    }
  }
}

function startAiDiagnosis() {
  const inlineConsentMessage = document.querySelector('#aiConsentMessage');
  const latestAssessment = scorePersonality({
    orders: state.orders,
    period: activeClinicPeriod,
    now: new Date(),
  });
  currentAssessment = latestAssessment;
  clockClinicAssessmentFingerprint = assessmentReportFingerprint(latestAssessment);
  if (!latestAssessment.eligible) {
    aiUiState = { status: 'idle', message: '' };
    closeGachaponResult({ restoreFocus: false, flushPending: false });
    renderClinic(latestAssessment);
    return;
  }
  if (!aiConsentIsCurrent()) {
    state.settings.aiConsent = false;
    if (!aiConsentCheckbox.checked) {
      aiUiState = { status: 'idle', message: '' };
      if (inlineConsentMessage) inlineConsentMessage.textContent = '未发送消费摘要，本次只使用本地规则测试。';
      startLocalGachaponReveal();
      return;
    }
    setAiConsentRevocationFallback(false);
    state.settings.aiConsent = setAiConsentGrantedForSession(true);
    if (!aiConsentIsCurrent()) {
      aiUiState = { status: 'idle', message: '' };
      renderClinic(latestAssessment);
      if (inlineConsentMessage) inlineConsentMessage.textContent = '当前浏览器无法保留本次授权，已停止发送；仍可只看本地人格。';
      return;
    }
    if (inlineConsentMessage) inlineConsentMessage.textContent = '';
  }
  requestAiDiagnosis();
}

function replaceGoalForScope(draft, savedGoal) {
  const isDemoGoal = Boolean(savedGoal.demo);
  const replacedGoalIds = new Set(draft.goals
    .filter((goal) => Boolean(goal.demo) === isDemoGoal && goal.id !== savedGoal.id)
    .map((goal) => goal.id));
  const preservedGoals = draft.goals.filter((goal) => Boolean(goal.demo) !== isDemoGoal);
  draft.goals.splice(0, draft.goals.length, ...preservedGoals, savedGoal);
  if (replacedGoalIds.size) {
    draft.orders.forEach((order) => {
      if (replacedGoalIds.has(order.goalId)) delete order.goalId;
    });
  }
  draft.activeGoalId = savedGoal.id;
  return replacedGoalIds;
}

function setGoal(formData) {
  const name = String(formData.get('goalName')).trim();
  const amountValidation = validateBudgetGoalAmount(formData.get('goalAmount'), selectedGoalAmountForValidation());
  const amount = amountValidation.amount;
  const deadline = normalizeDateValue(formData.get('goalDeadline'));
  const noteText = String(formData.get('goalNoteText') || '').trim().slice(0, 36);
  const noteColor = String(formData.get('goalNoteColor') || 'yellow');
  if (!name || !amountValidation.valid) {
    validateGoalAmountField({ announce: true });
    return;
  }
  if (deadline && !isDateOnOrAfter(deadline)) {
    showToast('目标日期不能早于今天。');
    goalDatePicker.open();
    return;
  }
  let savedGoalId = selectedGoalId;
  const isNew = goalFormMode === 'new' || !goalById(selectedGoalId);
  mutate((draft) => {
    const existing = isNew ? null : draft.goals.find((goal) => goal.id === selectedGoalId);
    savedGoalId = existing?.id || createLocalId('goal');
    const now = new Date().toISOString();
    const previousNote = existing?.note || nextGoalNote(draft.goals, noteColor);
    const savedGoal = normalizeBudgetGoal({
      id: savedGoalId,
      name,
      amount,
      deadline,
      noteText,
      note: normalizeGoalNote({ ...previousNote, color: noteColor }),
      demo: Boolean(existing?.demo),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }, savedGoalId);
    replaceGoalForScope(draft, savedGoal);
  });
  selectedGoalId = savedGoalId;
  goalFormMode = 'edit';
  renderedGoalId = null;
  renderGoal();
  setMascotSpeech(isNew ? `当前目标已替换为“${name}”，进度会从这次设置之后重新计算。` : `目标“${name}”的内容已经更新。`);
  showToast(isNew ? '当前目标已替换，进度卡已更新。' : '目标已更新。');
  panorama.focusHotspot('whiteboard');
  window.setTimeout(() => {
    sceneWhiteboard.flashPinned(savedGoalId);
    if (activePanel === 'goals') {
      [...goalList.querySelectorAll('[data-goal-select]')]
        .find((button) => button.dataset.goalSelect === savedGoalId)
        ?.focus({ preventScroll: true });
    } else {
      sceneWhiteboard.getNote(savedGoalId)?.focus({ preventScroll: true });
    }
  }, document.body.classList.contains('reduce-motion') ? 20 : 560);
}

function setMonthlyGoalPreset(rawAmount) {
  const amountValidation = validateBudgetGoalAmount(rawAmount);
  if (!amountValidation.valid) return false;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const goalId = `goal-monthly-${monthKey}`;
  const deadline = localDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const timestamp = now.toISOString();
  mutate((draft) => {
    const existing = draft.goals.find((goal) => goal.id === goalId);
    const savedGoal = normalizeBudgetGoal({
      id: goalId,
      name: `${now.getMonth() + 1} 月消费缓冲`,
      amount: amountValidation.amount,
      deadline,
      noteText: '本月先冷静，再决定。',
      note: existing?.note || nextGoalNote(draft.goals, 'yellow'),
      demo: false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    }, goalId);
    replaceGoalForScope(draft, savedGoal);
  });
  selectedGoalId = goalId;
  goalFormMode = 'edit';
  renderedGoalId = null;
  renderGoal();
  showToast(`本月额度已设为 ${money(amountValidation.amount)}，进度只累计之后确认“幸好没买”的记录。`);
  return true;
}

function focusGoalForm() {
  goalForm.scrollIntoView({ behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth', block: 'center' });
  window.setTimeout(() => goalForm.elements.goalName.focus({ preventScroll: true }), document.body.classList.contains('reduce-motion') ? 0 : 280);
}

function startNewGoal({ focus = true } = {}) {
  goalFormMode = 'new';
  selectedGoalId = null;
  renderedGoalId = null;
  renderGoal();
  if (focus) focusGoalForm();
}

function selectGoal(goalId, { focus = false } = {}) {
  if (!goalById(goalId)) return;
  selectedGoalId = goalId;
  goalFormMode = 'edit';
  renderedGoalId = null;
  renderGoal();
  if (focus) focusGoalForm();
}

function editGoalNote(goalId, trigger) {
  selectGoal(goalId);
  if (activePanel !== 'goals') {
    openPanel('goals', trigger || sceneWhiteboard.getNote(goalId));
    window.setTimeout(focusGoalForm, document.body.classList.contains('reduce-motion') ? 30 : 700);
    return;
  }
  focusGoalForm();
}

function updateGoalNotePosition(goalId, note) {
  const goal = goalById(goalId);
  if (!goal) return false;
  goal.note = normalizeGoalNote(note);
  return saveState();
}

function updateGoalNoteColor(goalId, color) {
  const goal = goalById(goalId);
  if (!goal) return;
  goal.note = normalizeGoalNote({ ...goal.note, color });
  saveState();
  renderGoal();
  showToast('便签颜色已更换。');
}

function removeGoalNote() {
  const goal = goalById(selectedGoalId);
  if (!goal || !window.confirm(`撕掉“${goal.name}”会同时删除这个预算目标，继续吗？`)) return;
  mutate((draft) => {
    draft.goals = draft.goals.filter((item) => item.id !== goal.id);
    draft.orders.forEach((order) => {
      if (order.goalId === goal.id) order.goalId = null;
    });
    if (draft.activeGoalId === goal.id) draft.activeGoalId = draft.goals[0]?.id || null;
  });
  selectedGoalId = state.activeGoalId || state.goals[0]?.id || null;
  goalFormMode = selectedGoalId ? 'edit' : 'new';
  renderedGoalId = null;
  renderGoal();
  setMascotSpeech('这张便签已经撕掉，其他目标和订单都还在。');
  showToast('预算便签已删除。');
  goalForm.elements.goalName.focus({ preventScroll: true });
}

function setActiveGoal(goalId) {
  const goal = goalById(goalId);
  if (!goal || goal.id === state.activeGoalId) return;
  mutate((draft) => {
    draft.activeGoalId = goal.id;
  });
  setMascotSpeech(`“${goal.name}”已设为当前目标，以后新确认省下的金额会计入它。`);
  showToast('当前目标已切换，不会重复计入过去的省下金额。');
}

function daysAgo(days, hour = 14, minute = 10) {
  const now = new Date();
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  // Demo records should never be placed in the future. Around midnight the
  // requested clock time may not have happened yet, so use its latest local
  // occurrence instead and keep the 7/30-day statistics internally consistent.
  if (date > now) date.setDate(date.getDate() - 1);
  return date.toISOString();
}

function minutesAgoToday(minutes) {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(Math.max(startOfToday.getTime(), now.getTime() - minutes * 60_000)).toISOString();
}

function loadDemo() {
  if ((state.orders.length || state.goals.length) && !window.confirm('载入演示数据会替换当前浏览器中的原型数据，继续吗？')) return;
  restoredTestHistory = null;
  const demoGoalId = 'goal-demo-seaside';
  state = {
    ...defaultState(),
    dataRevision: 1,
    activeGoalId: demoGoalId,
    goals: [{
      id: demoGoalId,
      name: '去海边看日落',
      amount: 3000,
      deadline: '',
      noteText: '少买一点，海边就近一点。',
      note: { x: 0.52, y: 0.46, color: 'cyan', rotation: -2 },
      demo: true,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    }],
    orders: [
      { id: 'demo-1', name: '超大杯珍珠奶茶', amount: 28, category: '餐饮饮品', reason: '嘴馋', decisionSignals: ['wait'], status: 'saved', goalId: demoGoalId, decidedAt: minutesAgoToday(1), statusHistory: [{ from: 'cooling', to: 'saved', at: minutesAgoToday(1) }], demo: true, createdAt: minutesAgoToday(2), updatedAt: minutesAgoToday(1) },
      { id: 'demo-2', name: '联名帆布包', amount: 169, category: '服饰美妆', reason: '被种草', decisionSignals: ['creator', 'instant'], status: 'cooling', decidedAt: null, statusHistory: [], demo: true, createdAt: daysAgo(1, 22), updatedAt: daysAgo(1, 22) },
      { id: 'demo-6', name: '无线降噪耳机 Air', amount: 1299, category: '数码家居', reason: '被种草', decisionSignals: ['creator', 'instant'], status: 'purchased', decidedAt: daysAgo(2, 19), statusHistory: [{ from: 'cooling', to: 'purchased', at: daysAgo(2, 19) }], demo: true, createdAt: daysAgo(2, 18), updatedAt: daysAgo(2, 19) },
      { id: 'demo-3', name: '深夜炸鸡套餐', amount: 45, category: '餐饮饮品', reason: '情绪不好', decisionSignals: ['comfort'], status: 'purchased', decidedAt: daysAgo(3, 23, 20), statusHistory: [{ from: 'cooling', to: 'purchased', at: daysAgo(3, 23, 20) }], demo: true, createdAt: daysAgo(3, 23), updatedAt: daysAgo(3, 23, 20) },
      { id: 'demo-7', name: '复古真皮托特包', amount: 799, category: '服饰美妆', reason: '限时优惠', decisionSignals: ['deal', 'instant'], status: 'purchased', decidedAt: daysAgo(4, 16), statusHistory: [{ from: 'cooling', to: 'purchased', at: daysAgo(4, 16) }], demo: true, createdAt: daysAgo(4, 15), updatedAt: daysAgo(4, 16) },
      { id: 'demo-4', name: '桌面氛围灯', amount: 89, category: '数码家居', reason: '限时优惠', decisionSignals: ['compare', 'deal'], status: 'saved', goalId: demoGoalId, decidedAt: daysAgo(5, 21), statusHistory: [{ from: 'cooling', to: 'saved', at: daysAgo(5, 21) }], demo: true, createdAt: daysAgo(5, 20), updatedAt: daysAgo(5, 21) },
      { id: 'demo-5', name: '线上摄影课', amount: 199, category: '学习成长', reason: '自我提升', decisionSignals: ['research', 'achievement'], status: 'saved', goalId: demoGoalId, decidedAt: daysAgo(8, 13), statusHistory: [{ from: 'cooling', to: 'saved', at: daysAgo(8, 13) }], demo: true, createdAt: daysAgo(8, 12), updatedAt: daysAgo(8, 13) },
    ],
  };
  selectedGoalId = demoGoalId;
  goalFormMode = 'edit';
  renderedGoalId = null;
  saveState();
  renderAll();
  setMascotSpeech('演示记录已经放进房间。健身屏、手机和白板都会显示新的状态。');
  showToast('已载入 7 笔演示数据。');
}

function localDateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function exportData() {
  const personalGoals = state.goals.filter((goal) => !goal.demo);
  const personalGoalIds = new Set(personalGoals.map((goal) => goal.id));
  const personalOrders = state.orders.filter((order) => !order.demo).map((order) => {
    if (!order.goalId || personalGoalIds.has(order.goalId)) return order;
    const sanitized = { ...order };
    delete sanitized.goalId;
    return sanitized;
  });
  if (!personalOrders.length && !personalGoals.length) {
    showToast('当前只有演示数据，没有可备份的个人记录。');
    return;
  }
  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    currency: 'CNY',
    orders: personalOrders,
    goals: personalGoals,
    activeGoalId: personalGoals.some((goal) => goal.id === state.activeGoalId) ? state.activeGoalId : null,
    settings: {},
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `让你花个爽！数据-${localDateStamp()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  showToast('JSON 已在本地生成，没有上传数据。');
}

const CSV_ORDER_HEADERS = Object.freeze([
  '订单编号',
  '商品名称',
  '金额',
  '分类',
  '购买原因',
  '备注',
  '状态',
  '创建时间',
  '更新时间',
]);

function csvCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvOrderRow(order, statusLabels = STATUS_LABELS) {
  return [
    order.id,
    order.name,
    Number(order.amount || 0).toFixed(2),
    order.category,
    order.reason,
    order.note || '',
    statusLabels[order.status] || order.status,
    order.createdAt,
    order.updatedAt,
  ];
}

function exportOrdersCsv() {
  const orders = state.orders.filter((order) => !order.demo);
  if (!orders.length) {
    showToast('还没有可导出的个人订单。');
    return;
  }
  const rows = [
    CSV_ORDER_HEADERS,
    ...orders.map((order) => csvOrderRow(order)),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `让你花个爽！订单-${localDateStamp()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  showToast('订单 CSV 已在本地生成，未包含演示订单。');
}

function toggleMotion() {
  state.settings.reduceMotion = !state.settings.reduceMotion;
  syncReducedMotionPreference();
  saveState();
  showToast(state.settings.reduceMotion
    ? '已减少房间动态效果。'
    : reducedMotionQuery.matches
      ? '已关闭站内开关；系统仍要求减少动态效果。'
      : '已恢复房间动态效果。');
}

function scrollToPanelTarget(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const delay = document.body.classList.contains('reduce-motion') ? 20 : 460;
  window.setTimeout(() => {
    target.scrollIntoView({ behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth', block: 'start' });
    target.querySelector('h2, h3, button, input')?.focus({ preventScroll: true });
  }, delay);
}

recoveryTabButtons.forEach((trigger) => {
  trigger.addEventListener('click', () => switchRecoveryView(trigger.dataset.recoveryView, trigger));
});

document.querySelectorAll('.recovery-tabs').forEach((tablist) => {
  tablist.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...tablist.querySelectorAll('[data-recovery-view]')];
    const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
    const nextView = tabs[nextIndex]?.dataset.recoveryView;
    window.requestAnimationFrame(() => {
      document.querySelector(`.panel-view.is-active .recovery-tabs [data-recovery-view="${nextView}"]`)
        ?.focus({ preventScroll: true });
    });
  });
});

desireBudgetRange.addEventListener('input', renderControllerBudget);
renderControllerBudget();

document.querySelectorAll('[data-open]:not(.scene-hotspot):not([data-recovery-view])').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    if (trigger.dataset.open === 'new' && trigger.closest('.device-tabs')) {
      const route = { phoneView: 'home', commerceType: commerceTypeForSelectedCard(), productId: null };
      history.replaceState({ panel: 'new', ...route, openedByApp: false }, '', buildNewHash(route));
      showPhoneView('home', { type: route.commerceType, focus: true });
      if (activePanel !== 'new') applyPanel('new', trigger);
      return;
    }
    openPanel(trigger.dataset.open, trigger);
    if (trigger.dataset.open === 'new' && trigger.classList.contains('wishlist-add')) {
      resetOrderComposer();
      openOrderComposer(trigger);
    }
    if (trigger.dataset.scrollTarget) scrollToPanelTarget(trigger.dataset.scrollTarget);
  });
});

document.querySelectorAll('[data-scroll-target]:not([data-open])').forEach((trigger) => {
  trigger.addEventListener('click', () => scrollToPanelTarget(trigger.dataset.scrollTarget));
});

document.querySelectorAll('[data-scene-target]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const hotspot = sceneHotspots.find((item) => item.id === trigger.dataset.sceneTarget);
    if (!hotspot) return;
    if (hotspot.panel === 'new' && activePanel === 'orders') {
      const route = { phoneView: 'home', commerceType: commerceTypeForSelectedCard(), productId: null };
      history.replaceState({ panel: 'new', ...route, openedByApp: false }, '', buildNewHash(route));
      showPhoneView('home', { type: route.commerceType, focus: true });
      applyPanel('new', trigger);
      return;
    }
    if (hotspot.panel) openPanel(hotspot.panel, trigger);
    else panorama.focusHotspot(hotspot.id);
  });
});

document.querySelectorAll('[data-scene-group]').forEach((trigger) => {
  trigger.addEventListener('click', () => {
    panorama.focusGroup(trigger.dataset.sceneGroup);
    setMascotSpeech('这堆快递里藏着几句真心话。把鼠标移到发光的小箱子上看看。');
  });
});

panelClose.addEventListener('click', () => {
  if (activePanel === 'new' && phoneView !== 'intro' && navigateBackWithinPhone({ focus: true })) return;
  if (activePanel === 'clinic' && clinicView === 'report' && navigateBackWithinClinic()) return;
  closePanel();
});

document.addEventListener('keydown', (event) => {
  if (gachaponResultModal.open && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeGachaponResult();
    return;
  }
  if (posterShare.open && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closePosterShare();
    return;
  }
  if (gachaponResultModal.open || posterShare.open) return;
  if (!activePanel) return;
  if (!mallSuccessModal.hidden && event.key === 'Tab') {
    const focusable = [mallSuccessBackButton, mallSuccessContinueButton];
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex].focus({ preventScroll: true });
    return;
  }
  if (!orderComposerModal.hidden && event.key === 'Tab') {
    const focusable = orderComposerFocusableElements();
    if (!focusable.length) return;
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
      : (currentIndex + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex].focus({ preventScroll: true });
    return;
  }
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  if (!orderTimeFilterMenu.hidden) {
    setOrderTimeFilterMenu(false, { focus: true });
    return;
  }
  if (!mallSuccessModal.hidden) {
    closeMallSuccess({ restoreFocus: true });
    return;
  }
  if (!orderComposerModal.hidden) {
    closeOrderComposer();
    return;
  }
  if (activePanel === 'new' && phoneView !== 'intro') {
    navigateBackWithinPhone({ focus: true });
    return;
  }
  if (activePanel === 'clinic' && clinicView === 'report') {
    navigateBackWithinClinic();
    return;
  }
  closePanel();
}, { capture: true });

orderForm.addEventListener('submit', (event) => {
  event.preventDefault();
  createOrder(new FormData(orderForm));
});

cancelOrderEditButton.addEventListener('click', () => {
  closeOrderComposer();
  showToast('已取消编辑，原冷静单没有变化。');
});

continueOrderButton.addEventListener('click', () => {
  resetOrderComposer();
  window.requestAnimationFrame(() => orderForm.elements.name.focus({ preventScroll: true }));
});

viewOrdersButton.addEventListener('click', (event) => {
  closeOrderComposer({ restoreFocus: false });
  history.replaceState({ panel: 'orders', openedByApp: true }, '', '#orders');
  applyPanel('orders', event.currentTarget);
});

openMallButton.addEventListener('click', () => {
  activeCommerceType = commerceTypeForSelectedCard();
  activeCommerceFilter = commerceCatalog(activeCommerceType).filters[0];
  activeCommerceProductId = null;
  commerceSearchInput.value = '';
  pushPhoneView('catalog', { type: activeCommerceType });
});

enterShoppingPhoneButton.addEventListener('click', () => {
  pushPhoneView('home', { type: commerceTypeForSelectedCard() });
});

commerceBackButton.addEventListener('click', () => {
  navigateBackWithinPhone({ focus: true });
});

commerceOrdersButton.addEventListener('click', (event) => {
  closeMallSuccess();
  showPhoneView('home');
  history.replaceState({ panel: 'orders', openedByApp: true }, '', '#orders');
  applyPanel('orders', event.currentTarget);
});

commerceSearchInput.addEventListener('input', renderCommerceCatalog);

commerceFilters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-commerce-filter]');
  if (!button || button.dataset.commerceFilter === activeCommerceFilter) return;
  activeCommerceFilter = button.dataset.commerceFilter;
  renderCommerceCatalog();
  focusCommerceFilter(activeCommerceFilter);
});

commerceProducts.addEventListener('click', (event) => {
  const button = event.target.closest('[data-commerce-product]');
  if (!button) return;
  pushPhoneView('detail', { type: activeCommerceType, productId: button.dataset.commerceProduct });
});

commercePrefillButton.addEventListener('click', (event) => prefillOrderFromCommerce(commerceProduct(), event.currentTarget));
commerceBuyButton.addEventListener('click', () => simulateCommerceOrder(commerceProduct()));

orderComposerCloseButton.addEventListener('click', () => closeOrderComposer());
orderComposerModal.addEventListener('click', (event) => {
  if (event.target === orderComposerModal) closeOrderComposer();
});

mallSuccessBackButton.addEventListener('click', () => {
  closeMallSuccess();
  resetOrderComposer();
  history.replaceState({ panel: 'new', phoneView: 'home', openedByApp: false }, '', buildNewHash({ phoneView: 'home' }));
  showPhoneView('home');
  window.setTimeout(() => openMallButton.focus({ preventScroll: true }), document.body.classList.contains('reduce-motion') ? 20 : 280);
});

mallSuccessContinueButton.addEventListener('click', () => {
  const type = activeCommerceType;
  closeMallSuccess();
  if (phoneView === 'detail') {
    navigateBackWithinPhone({ focus: true });
    return;
  }
  const route = { phoneView: 'catalog', commerceType: type, productId: null };
  history.replaceState({ panel: 'new', ...route, openedByApp: true }, '', buildNewHash(route));
  showPhoneView('catalog', { type, focus: true });
});

function categoryCardLabel(button) {
  return button.querySelector('small')?.textContent.trim() || button.dataset.categoryShortcut;
}

function renderCategoryCarousel({ focus = false, announce = false } = {}) {
  const cardCount = categoryCards.length;
  if (!cardCount) return;

  categoryCards.forEach((button, index) => {
    const offset = (index - activeCategoryCardIndex + cardCount) % cardCount;
    const cardState = offset === 0 ? 'active' : offset === 1 ? 'next' : 'previous';
    const isActive = cardState === 'active';
    const label = categoryCardLabel(button);
    const actionLabel = button.querySelector(':scope > span');
    button.dataset.cardState = cardState;
    button.setAttribute('aria-pressed', String(isActive));
    if (actionLabel) actionLabel.textContent = '查看模拟商品 →';
    button.setAttribute('aria-label', isActive ? `${label}，当前选中，点击查看模拟商品` : `${label}，点击查看模拟商品`);
    button.classList.toggle('is-selected', isActive);
    categoryDots[index]?.classList.toggle('is-active', isActive);
  });

  const activeCard = categoryCards[activeCategoryCardIndex];
  openMallButtonLabel.textContent = `逛${commerceCatalog(commerceTypeForSelectedCard()).label}模拟商城`;
  if (announce && categoryCarouselStatus) categoryCarouselStatus.textContent = `当前选中：${categoryCardLabel(activeCard)}。`;
  if (focus) activeCard.focus({ preventScroll: true });
}

function setActiveCategoryCard(index, { select = true, ...renderOptions } = {}) {
  const cardCount = categoryCards.length;
  if (!cardCount) return;
  activeCategoryCardIndex = (index + cardCount) % cardCount;
  renderCategoryCarousel(renderOptions);
  if (select) activateCategoryShortcut(categoryCards[activeCategoryCardIndex], { revealForm: false, moveToForm: false });
}

function activateCategoryShortcut(button, { revealForm = true, moveToForm = true } = {}) {
  if (!button) return;
  if (revealForm) {
    orderForm.hidden = false;
    document.querySelector('.order-form-heading').hidden = false;
    orderReceipt.hidden = true;
  }
  orderForm.elements.category.value = button.dataset.categoryShortcut;
  if (button.dataset.categoryShortcut === '餐饮饮品') orderForm.elements.reason.value = '嘴馋';
  if (button.dataset.categoryShortcut === '服饰美妆') orderForm.elements.reason.value = '被种草';
  if (button.dataset.categoryShortcut === '学习成长') orderForm.elements.reason.value = '自我提升';
  if (!moveToForm) return;
  openOrderComposer(button);
}

categoryCards.forEach((button, index) => {
  button.addEventListener('click', (event) => {
    if (suppressCategoryShortcutClick) {
      suppressCategoryShortcutClick = false;
      event.preventDefault();
      return;
    }
    if (index !== activeCategoryCardIndex) setActiveCategoryCard(index, { announce: true });
    activeCommerceType = COMMERCE_TYPE_BY_CATEGORY[button.dataset.categoryShortcut] || 'shop';
    activeCommerceFilter = commerceCatalog(activeCommerceType).filters[0];
    activeCommerceProductId = null;
    commerceSearchInput.value = '';
    pushPhoneView('catalog', { type: activeCommerceType });
  });

  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') setActiveCategoryCard(0, { focus: true, announce: true });
    else if (event.key === 'End') setActiveCategoryCard(categoryCards.length - 1, { focus: true, announce: true });
    else setActiveCategoryCard(activeCategoryCardIndex + (event.key === 'ArrowRight' ? 1 : -1), { focus: true, announce: true });
  });
});

categoryCarousel?.addEventListener('pointerdown', (event) => {
  const pointerCard = event.target.closest('[data-category-shortcut]');
  if (event.isPrimary === false || event.button !== 0 || !pointerCard) return;
  categoryPointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, card: pointerCard };
  pointerCard.setPointerCapture?.(event.pointerId);
});

categoryCarousel?.addEventListener('pointerup', (event) => {
  if (!categoryPointerStart || categoryPointerStart.id !== event.pointerId) return;
  const deltaX = event.clientX - categoryPointerStart.x;
  const deltaY = event.clientY - categoryPointerStart.y;
  categoryPointerStart.card.releasePointerCapture?.(event.pointerId);
  categoryPointerStart = null;
  if (Math.abs(deltaX) < 38 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
  suppressCategoryShortcutClick = true;
  setActiveCategoryCard(activeCategoryCardIndex + (deltaX < 0 ? 1 : -1), { announce: true });
  window.setTimeout(() => { suppressCategoryShortcutClick = false; }, 0);
});

categoryCarousel?.addEventListener('pointercancel', () => {
  categoryPointerStart = null;
});

renderCategoryCarousel();
activateCategoryShortcut(categoryCards[activeCategoryCardIndex], { revealForm: false, moveToForm: false });

testHistoryList?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-history-id]');
  if (!button) return;
  if (button.getAttribute('aria-disabled') === 'true') {
    showToast('这条旧记录只有摘要，完成一次新测试后即可重新打开完整报告。');
    return;
  }
  restoreTestHistoryResult(button.dataset.historyId);
});

goalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setGoal(new FormData(goalForm));
});

goalForm.elements.goalAmount.addEventListener('input', () => {
  validateGoalAmountField();
  renderGoalAmountChoice(goalForm.elements.goalAmount.value);
});

goalAmountBeads.forEach((button) => {
  button.addEventListener('click', () => {
    goalForm.elements.goalAmount.value = button.dataset.goalAmount;
    validateGoalAmountField();
    renderGoalAmountChoice(button.dataset.goalAmount);
    goalForm.elements.goalAmount.focus({ preventScroll: true });
  });
});

monthlyGoalButtons.forEach((button) => {
  button.addEventListener('click', () => setMonthlyGoalPreset(button.dataset.monthlyGoal));
});

goalForm.querySelectorAll('[name="goalNoteColor"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked && goalFormMode === 'edit' && selectedGoalId) updateGoalNoteColor(selectedGoalId, input.value);
  });
});

deleteGoalButton.addEventListener('click', removeGoalNote);
setActiveGoalButton.addEventListener('click', () => setActiveGoal(selectedGoalId));
newGoalButton.addEventListener('click', () => startNewGoal());
goalList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-goal-select]');
  if (button) selectGoal(button.dataset.goalSelect, { focus: true });
});

orderList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-order-action]');
  if (!button) return;
  if (button.dataset.orderAction === 'edit') {
    editOrder(button.dataset.orderId, button);
    return;
  }
  if (button.dataset.orderAction === 'delete') {
    deleteOrder(button.dataset.orderId);
    return;
  }
  updateOrderStatus(button.dataset.orderId, button.dataset.orderAction);
});

document.querySelectorAll('[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    renderOrders();
  });
});

orderTimeFilterButton.addEventListener('click', () => {
  setOrderTimeFilterMenu(orderTimeFilterMenu.hidden);
});

orderTimeFilterButton.addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  setOrderTimeFilterMenu(true, { focus: true });
  if (event.key === 'ArrowUp') moveOrderTimeFilterFocus('End');
});

orderTimeFilterMenu.addEventListener('click', (event) => {
  const option = event.target.closest('[data-time-filter]');
  if (!option) return;
  activeTimeFilter = option.dataset.timeFilter;
  renderOrders();
  setOrderTimeFilterMenu(false, { focus: true });
});

orderTimeFilterMenu.addEventListener('keydown', (event) => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  moveOrderTimeFilterFocus(event.key);
});

orderTimeFilter.addEventListener('focusout', () => {
  window.setTimeout(() => {
    if (!orderTimeFilter.contains(document.activeElement)) setOrderTimeFilterMenu(false);
  }, 0);
});

document.addEventListener('click', (event) => {
  if (orderTimeFilterMenu.hidden || orderTimeFilter.contains(event.target)) return;
  setOrderTimeFilterMenu(false);
});

document.querySelectorAll('[data-clinic-period]').forEach((button) => {
  button.addEventListener('click', () => {
    const nextPeriod = Number(button.dataset.clinicPeriod) === 7 ? 7 : 30;
    if (nextPeriod === activeClinicPeriod) return;
    cancelAiRequest('period-changed');
    restoredTestHistory = null;
    activeClinicPeriod = nextPeriod;
    aiUiState = { status: 'idle', message: '' };
    renderClinic();
  });
});

orderForm.querySelectorAll('input[name="decisionSignals"]').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    const selected = [...orderForm.querySelectorAll('input[name="decisionSignals"]:checked')];
    if (selected.length <= 2) return;
    checkbox.checked = false;
    showToast('决策动作最多选择 2 项。');
  });
});

analyzeButton.addEventListener('click', startAiDiagnosis);
aiConsentCheckbox.addEventListener('change', () => {
  if (aiConsentMessage) aiConsentMessage.textContent = '';
});
localOnlyButton.addEventListener('click', () => {
  aiConsentCheckbox.checked = false;
  if (aiConsentMessage) aiConsentMessage.textContent = '';
  startLocalGachaponReveal();
});
revokeAiConsentButton.addEventListener('click', () => {
  cancelAiRequest('consent-revoked');
  state.settings.aiConsent = false;
  state.diagnosis = null;
  setAiDiagnosisInvalidatedForSession(true);
  persistAiDiagnosis(null, { silent: true });
  const sessionConsentCleared = setAiConsentGrantedForSession(false);
  const fallbackProtection = setAiConsentRevocationFallback(true);
  aiConsentChannel?.postMessage({ type: 'revoked' });
  aiUiState = { status: 'idle', message: '' };
  aiConsentCheckbox.checked = false;
  if (aiConsentMessage) aiConsentMessage.textContent = '';
  closeGachaponResult({ restoreFocus: false, flushPending: false });
  clearPoster();
  renderClinic();
  showToast(fallbackProtection.storageUpdated || fallbackProtection.cookieUpdated || sessionConsentCleared
    ? '已撤回数据发送同意，新的页面也会重新确认。'
    : '本页已停止发送；存储保护不可用，新的页面仍会重新确认。');
});
posterButton.addEventListener('click', generatePoster);
posterReturnButton.addEventListener('click', () => closePosterShare());
posterShare.addEventListener('cancel', (event) => {
  event.preventDefault();
  closePosterShare();
});
posterShare.addEventListener('click', (event) => {
  if (event.target === posterShare) closePosterShare();
});
gachaponResultCloseButton.addEventListener('click', () => closeGachaponResult());
gachaponResultModal.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeGachaponResult();
});
gachaponResultModal.addEventListener('click', (event) => {
  if (event.target === gachaponResultModal) closeGachaponResult();
});
gachaponResultRetryButton.addEventListener('click', () => {
  closeGachaponResult({ restoreFocus: false });
  if (gachaponResultSource === 'local') startLocalGachaponReveal();
  else startAiDiagnosis();
});
gachaponResultOpenButton.addEventListener('click', () => {
  closeGachaponResult({ restoreFocus: false });
  restoredTestHistory = null;
  pushClinicView('report', { apply: false });
  setClinicView('report', { focus: true });
});
clinicReportBackButton.addEventListener('click', () => {
  if (!navigateBackWithinClinic()) setClinicView('start', { focus: true });
});
downloadPosterButton.addEventListener('click', () => {
  if (!posterBlob) return;
  const download = downloadSharePoster(posterBlob, `让你花个爽-钱包人格-${localDateStamp()}.png`);
  posterShareStatus.textContent = download.mobileSaveHint || '已发起保存高清 PNG 的请求。';
});
document.querySelector('#loadDemoButton').addEventListener('click', loadDemo);
document.querySelector('#exportButton').addEventListener('click', exportData);
document.querySelector('#exportCsvButton').addEventListener('click', exportOrdersCsv);
document.querySelector('#motionButton').addEventListener('click', toggleMotion);
roomHelpButton.addEventListener('click', () => {
  if (!roomHelpDialog.open) roomHelpDialog.showModal();
  window.requestAnimationFrame(() => roomHelpCloseButton.focus({ preventScroll: true }));
});
roomHelpCloseButton.addEventListener('click', () => roomHelpDialog.close());
roomHelpDialog.addEventListener('click', (event) => {
  if (event.target === roomHelpDialog) roomHelpDialog.close();
});
resetRoomViewButton.addEventListener('click', () => {
  roomHelpDialog.close();
  panorama.animateToView(currentSceneDefaultView(), {
    duration: document.body.classList.contains('reduce-motion') ? 0 : 420,
    updateIdle: true,
  });
  window.setTimeout(() => sceneFrame.focus({ preventScroll: true }), document.body.classList.contains('reduce-motion') ? 0 : 430);
});

aiConsentChannel?.addEventListener('message', (event) => {
  if (event.data?.type === 'revoked') applyExternalConsentRevocation();
});
window.addEventListener('storage', (event) => {
  if (event.key === AI_REVOCATION_STORAGE_KEY && event.newValue) applyExternalConsentRevocation();
  if (event.key === STORAGE_KEY) applyExternalBusinessState(event.newValue);
});
window.addEventListener('pagehide', () => {
  aiConsentChannel?.close();
  gachaponMotion.destroy();
  peelCloseOptions = { updateHistory: false, resumeGesture: false, restoreFocus: false };
  peelGameController.destroy();
  gestureController.destroy();
  orientationController.destroy();
  document.removeEventListener('keydown', handlePeelActivityKeydown, { capture: true });
  sceneViewportMedia.removeEventListener('change', syncSceneDefaultView);
}, { once: true });

sceneFrame.addEventListener('panoramaready', () => {
  sceneStatus.textContent = '全景已就绪 · 拖动环视';
});

sceneFrame.addEventListener('panoramaerror', (event) => {
  sceneStatus.textContent = event.detail;
});

window.addEventListener('popstate', (event) => routeSyncCoordinator.request(event.state || {}));
window.addEventListener('hashchange', () => routeSyncCoordinator.request(history.state || {}));

window.addEventListener('beforeunload', () => {
  if (posterUrl) URL.revokeObjectURL(posterUrl);
});

function updateClock(now = new Date()) {
  const nextDateSignature = localDateKey(now);
  const crossedLocalDate = Boolean(clockDateSignature && clockDateSignature !== nextDateSignature);
  clockDateSignature = nextDateSignature;
  const currentTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  document.querySelector('#clock').textContent = currentTime;
  document.querySelectorAll('[data-phone-clock]').forEach((clock) => { clock.textContent = currentTime; });

  let latestAssessment = null;
  let assessmentChanged = false;
  if (activePanel === 'clinic') {
    latestAssessment = scorePersonality({ orders: state.orders, period: activeClinicPeriod, now });
    const nextAssessmentFingerprint = assessmentReportFingerprint(latestAssessment);
    assessmentChanged = Boolean(clockClinicAssessmentFingerprint
      && clockClinicAssessmentFingerprint !== nextAssessmentFingerprint);
    clockClinicAssessmentFingerprint = nextAssessmentFingerprint;
  }
  if (!crossedLocalDate && !assessmentChanged) return;

  cancelAiRequest('assessment-time-changed');
  state.diagnosis = null;
  setAiDiagnosisInvalidatedForSession(true);
  persistAiDiagnosis(null, { silent: true });
  aiUiState = { status: 'idle', message: '' };
  closeGachaponResult({ restoreFocus: false, flushPending: false });
  clearPoster();
  if (activePanel === 'clinic') renderClinic(latestAssessment);
}

function syncReducedMotionPreference() {
  const shouldReduceMotion = state.settings.reduceMotion || reducedMotionQuery.matches;
  document.body.classList.toggle('reduce-motion', shouldReduceMotion);
  analysisStageController.setReducedMotion?.(shouldReduceMotion);
  panorama.setReducedMotion(shouldReduceMotion);
  roomIntro.setReducedMotion(shouldReduceMotion);
  gachaponMotion.setReducedMotion(shouldReduceMotion);
  gestureController.handleReducedMotionChange(shouldReduceMotion);
  orientationController.handleReducedMotionChange(shouldReduceMotion);
  const motionButton = document.querySelector('#motionButton');
  motionButton.setAttribute('aria-pressed', String(shouldReduceMotion));
  motionButton.textContent = shouldReduceMotion ? '恢复动态效果' : '减少动态效果';
}

syncReducedMotionPreference();
reducedMotionQuery.addEventListener?.('change', syncReducedMotionPreference);
updateClock();
window.setInterval(updateClock, 30_000);
renderAll();

let returnToRoomOnLoad = false;
try {
  returnToRoomOnLoad = sessionStorage.getItem(RETURN_TO_ROOM_ON_LOAD_KEY) === '1';
  if (returnToRoomOnLoad) sessionStorage.removeItem(RETURN_TO_ROOM_ON_LOAD_KEY);
} catch {
}
if (returnToRoomOnLoad) history.replaceState({ panel: null, openedByApp: false }, '', '#room');
const initialRoute = routeSnapshot(history.state || {});
const initialPanel = initialRoute.panel;
const initialActivity = initialRoute.activity;
const initialGoalsView = initialRoute.goalsView;
const initialClinicView = initialRoute.clinicView;
pendingPanel = initialPanel;
pendingActivity = initialActivity;
history.replaceState({
  panel: initialPanel,
  ...(initialActivity ? { activity: initialActivity } : {}),
  ...(initialPanel === 'new' ? {
    phoneView: initialRoute.phoneView,
    commerceType: initialRoute.commerceType,
    productId: initialRoute.productId,
  } : {}),
  ...(initialPanel === 'goals' ? { goalsView: initialGoalsView } : {}),
  ...(initialPanel === 'clinic' ? { clinicView: initialClinicView } : {}),
  openedByApp: false,
}, '', initialPanel === 'new'
  ? buildNewHash(initialRoute)
  : initialPanel === 'goals'
    ? goalsHash(initialGoalsView)
    : initialPanel === 'clinic'
      ? buildClinicHash({ clinicView: initialClinicView })
      : initialPanel ? `#${initialPanel}` : buildRoomHash({ activity: initialActivity }));
if (returnToRoomOnLoad && typeof roomIntro.skipToRoom === 'function') roomIntro.skipToRoom();
else roomIntro.start();
panorama.whenReady().then((result) => {
  if (result.fallback) sceneStatus.textContent = result.message;
});
