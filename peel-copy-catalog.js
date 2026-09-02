export const PEEL_COPY_VERSION = 'peel-copy-v1';

const ALL_CATEGORIES = Object.freeze(['food', 'digital', 'fashion', 'interest', 'home']);
const TONES = Object.freeze(['direct', 'meme', 'direct', 'meme', 'gentle']);

const FAMILY_DEFINITIONS = Object.freeze([
  {
    id: 'urgency',
    sourcePattern: 'time-pressure',
    pairs: [
      ['最后一天', '这个“最后一天”挺长情'],
      ['错过等一年', '返场可能比我先到'],
      ['倒计时开抢', '倒计时不替我做决定'],
      ['现在不买就没了', '需要不会在零点消失'],
      ['仅限今晚', '今晚先让想法过夜'],
    ],
  },
  {
    id: 'scarcity',
    sourcePattern: 'stock-pressure',
    pairs: [
      ['仅剩 2 件', '焦虑库存倒是很足'],
      ['限量发售', '限的是货，别限思考'],
      ['库存告急', '我的需求还没报警'],
      ['手慢无', '手可以慢，需求先说'],
      ['售完不补', '没补货也不等于遗憾'],
    ],
  },
  {
    id: 'anchor',
    sourcePattern: 'price-anchor',
    pairs: [
      ['低至 9 块 9', '“至”字拥有无限可能'],
      ['原价 999', '锚点很高，不等于省得多'],
      ['立省 300', '先问还要花出去多少'],
      ['今日骨折价', '骨折的是价格还是判断'],
      ['比平时更划算', '划算和需要是两张答卷'],
    ],
  },
  {
    id: 'installment',
    sourcePattern: 'price-per-payment',
    pairs: [
      ['每天一杯奶茶钱', '总价请出来说句话'],
      ['月付没压力', '月份们正在排队'],
      ['0 息拿下', '利息为零，总价还在'],
      ['先享后付', '享受先到，账单随后'],
      ['一顿饭的钱', '饭钱叠起来也会长高'],
    ],
  },
  {
    id: 'bundle',
    sourcePattern: 'threshold-bundle',
    pairs: [
      ['再买一点就包邮', '为省运费，多买了一车'],
      ['第二件半价', '第一件先问：需要我吗'],
      ['满 300 减 30', '别为 30 临时找 200'],
      ['三件更划算', '少买两件更省空间'],
      ['凑单马上成功', '凑单成功，需求掉线'],
    ],
  },
  {
    id: 'social',
    sourcePattern: 'social-proof',
    pairs: [
      ['大家都在买', '大家是谁，先认识一下'],
      ['爆款同款', '同款很多，需求未必同款'],
      ['一万人已加购', '加购不是我的投票'],
      ['全网都在晒', '热闹归热闹，钱包有一票'],
      ['人气断层第一', '排名很响，适合要另答'],
    ],
  },
  {
    id: 'identity',
    sourcePattern: 'identity-projection',
    pairs: [
      ['精致生活必备', '精致不一定需要新快递'],
      ['通勤人标配', '标配是谁配的'],
      ['懂生活的人都选', '懂生活也可以懂留白'],
      ['氛围感拉满', '氛围到了，收纳也到了'],
      ['你的风格就差它', '我的风格不靠补货完成'],
    ],
  },
  {
    id: 'emotion',
    sourcePattern: 'emotional-reward',
    pairs: [
      ['奖励一下自己', '奖励可以，先问今天奖过没'],
      ['花钱买开心', '开心收到，账单稍后到'],
      ['成年人的小确幸', '小确幸不必一定签收'],
      ['今天够累了，买吧', '辛苦是真的，下单可以等等'],
      ['悦己就现在', '悦己也包括允许自己不买'],
    ],
  },
  {
    id: 'collection',
    sourcePattern: 'collection-completion',
    pairs: [
      ['就差这一款', '系列完整，柜子先满'],
      ['隐藏款在等你', '概率很神秘，预算很具体'],
      ['全套才完整', '缺一件不影响我完整'],
      ['绝版必须收', '绝版不是必买许可证'],
      ['集齐召唤快乐', '快乐未必需要整套出场'],
    ],
  },
  {
    id: 'gift',
    sourcePattern: 'gift-pressure',
    pairs: [
      ['赠品价值 99', '先花 599 才能认识它'],
      ['买就送同款', '第二个也需要收纳'],
      ['前 100 名加赠', '名额在催，需求没发言'],
      ['会员专享礼', '专享不是非享不可'],
      ['赠品比正装还香', '若只想要赠品，先别买正装'],
    ],
  },
  {
    id: 'algorithm',
    sourcePattern: 'algorithmic-affinity',
    pairs: [
      ['刷到就是缘分', '划走也算有缘告别'],
      ['猜你喜欢', '算法懂点开，未必懂需要'],
      ['为你专属推荐', '专属可能只是精准投放'],
      ['这就是命定款', '命定不急这一分钟'],
      ['它又来找你了', '它会再来，我先不追'],
    ],
  },
  {
    id: 'upgrade',
    sourcePattern: 'self-upgrade',
    pairs: [
      ['效率神器', '买前生产力，买后充电器'],
      ['买了就会自律', '装备先到，习惯还在路上'],
      ['一步升级生活', '生活升级不等于设备更新'],
      ['新手也能出大片', '器材加分，练习不代打'],
      ['早买早享受', '晚点决定，也不耽误生活'],
    ],
  },
  {
    id: 'coupon',
    sourcePattern: 'coupon-loss-aversion',
    pairs: [
      ['你的券要过期了', '券过期，不等于钱消失'],
      ['不用就是亏', '没买不是亏，是没消费'],
      ['先领券再说', '领券不是签下购买合同'],
      ['再买一单升会员', '会员等级不替需求投票'],
      ['专属折扣待领取', '折扣在等，决定不用赶'],
    ],
  },
]);

export const PEEL_COPY_FAMILIES = Object.freeze(
  FAMILY_DEFINITIONS.map(({ id }) => id),
);

export const PEEL_COPY_CATALOG = Object.freeze(
  FAMILY_DEFINITIONS.flatMap((family) => family.pairs.map(([lure, reveal], index) => Object.freeze({
    id: `${family.id}-${String(index + 1).padStart(2, '0')}`,
    family: family.id,
    lure,
    reveal,
    tone: TONES[index],
    intensity: index < 2 ? 1 : index < 4 ? 2 : 3,
    eligibleCategories: ALL_CATEGORIES,
    allowedLayers: Object.freeze([1, 2]),
    isFictionalClaim: true,
    sourcePattern: family.sourcePattern,
    version: PEEL_COPY_VERSION,
  }))),
);

const COPY_BY_ID = new Map(PEEL_COPY_CATALOG.map((copy) => [copy.id, copy]));

export const APPROVED_DOUBLE_SHELLS = Object.freeze([
  Object.freeze(['urgency-01', 'social-01']),
  Object.freeze(['installment-02', 'emotion-01']),
  Object.freeze(['collection-01', 'coupon-01']),
  Object.freeze(['upgrade-01', 'bundle-02']),
]);

export const NEUTRAL_QUESTION_SHELLS = Object.freeze([
  Object.freeze({
    id: 'neutral-01',
    family: 'reflection',
    lure: '是什么在推着我？',
    reveal: '先把推动我的东西说清楚',
    tone: 'gentle',
    intensity: 1,
    eligibleCategories: ALL_CATEGORIES,
    allowedLayers: Object.freeze([1]),
    isFictionalClaim: false,
    sourcePattern: 'self-reflection',
    version: PEEL_COPY_VERSION,
  }),
  Object.freeze({
    id: 'neutral-02',
    family: 'reflection',
    lure: '我要的是它，还是现在？',
    reveal: '需要和现在可以分开决定',
    tone: 'gentle',
    intensity: 1,
    eligibleCategories: ALL_CATEGORIES,
    allowedLayers: Object.freeze([1]),
    isFictionalClaim: false,
    sourcePattern: 'self-reflection',
    version: PEEL_COPY_VERSION,
  }),
  Object.freeze({
    id: 'neutral-03',
    family: 'reflection',
    lure: '如果明天再看呢？',
    reveal: '明天还想要，也来得及',
    tone: 'gentle',
    intensity: 1,
    eligibleCategories: ALL_CATEGORIES,
    allowedLayers: Object.freeze([1]),
    isFictionalClaim: false,
    sourcePattern: 'self-reflection',
    version: PEEL_COPY_VERSION,
  }),
]);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function itemHasStructuredTrigger(item) {
  return Array.isArray(item?.structuredTriggers) && item.structuredTriggers.length > 0;
}

function historyIds(history) {
  return new Set((Array.isArray(history) ? history : [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.id)
    .filter(Boolean));
}

function historyFamilies(history) {
  return (Array.isArray(history) ? history : [])
    .map((entry) => typeof entry === 'string' ? COPY_BY_ID.get(entry) : entry)
    .map((entry) => entry?.family)
    .filter(Boolean);
}

function deterministicPick(values, seed) {
  if (!values.length) return null;
  return values[stableHash(seed) % values.length];
}

function eligibleCopies({ item, history }) {
  const category = String(item?.category || '').trim();
  const usedIds = historyIds(history);
  const families = historyFamilies(history);
  const lastFamily = families.at(-1);
  const avoidFamily = lastFamily && families.at(-2) === lastFamily ? lastFamily : null;
  const triggers = new Set(item?.structuredTriggers || []);
  const restrictToTriggers = item?.source === 'order' && triggers.size > 0;

  const matches = PEEL_COPY_CATALOG.filter((copy) => (
    !usedIds.has(copy.id)
    && copy.family !== avoidFamily
    && (!category || copy.eligibleCategories.includes(category))
    && (!restrictToTriggers || triggers.has(copy.family))
  ));

  if (matches.length) return matches;
  return PEEL_COPY_CATALOG.filter((copy) => (
    !usedIds.has(copy.id)
    && copy.family !== avoidFamily
    && (!category || copy.eligibleCategories.includes(category))
  ));
}

function selectApprovedPair({ seed, item, history }) {
  const candidates = eligibleCopies({ item, history });
  const candidateIds = new Set(candidates.map((copy) => copy.id));
  const pairs = APPROVED_DOUBLE_SHELLS.filter(([outerId, innerId]) => (
    candidateIds.has(outerId) && candidateIds.has(innerId)
  ));
  const pair = deterministicPick(pairs, `${seed}:pair`);
  return pair ? pair.map((id) => COPY_BY_ID.get(id)) : [];
}

export function selectShellSequence({
  seed = 'peel',
  phase = 'single',
  layers,
  history = [],
  item = {},
} = {}) {
  if (item?.source === 'order' && !itemHasStructuredTrigger(item)) {
    return [deterministicPick(NEUTRAL_QUESTION_SHELLS, `${seed}:neutral`)];
  }

  const wantsDouble = Number(layers) === 2
    || (layers == null && phase === 'mixed' && stableHash(`${seed}:layers`) % 100 < 35);
  if (wantsDouble) {
    const pair = selectApprovedPair({ seed, item, history });
    if (pair.length === 2) return pair;
  }

  const copy = deterministicPick(eligibleCopies({ item, history }), `${seed}:single`);
  return copy ? [copy] : [];
}
