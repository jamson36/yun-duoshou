import {
  CANONICAL_PERSONAS,
  FIGMA_PERSONA_CARDS,
  getAllowedPersonaCardIds,
  resolvePersonaPresentation,
} from './persona-presentations.js?v=20260830-persona-hybrid-3';

const POSTER_WIDTH = 1080;
const POSTER_HEIGHT = 1538;
const DEFAULT_SHARE_URL = 'https://spree.jamson.top';
const PERSONA_ART_CACHE_VERSION = '20260831-persona-hd-1';

const DISPLAY_FONT = 'Nunito, "Arial Rounded MT Bold", "PingFang SC", system-ui, sans-serif';
const TEXT_FONT = '"PingFang SC", system-ui, sans-serif';

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function finiteNumber(value) {
  if (value === null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clean(value, maxLength = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function localDateLabel(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '生成日期未知';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function topCategoryFrom(categories) {
  if (!Array.isArray(categories) || !categories.length) return '';
  return [...categories]
    .filter((item) => clean(item?.category, 18))
    .sort((left, right) => {
      const countDifference = (finiteNumber(right?.count) || 0) - (finiteNumber(left?.count) || 0);
      if (countDifference) return countDifference;
      return (finiteNumber(right?.amount) || 0) - (finiteNumber(left?.amount) || 0);
    })
    .map((item) => clean(item.category, 18))[0] || '';
}

function normalizePersona(persona, { allowFallback = false } = {}) {
  const canonical = CANONICAL_PERSONAS[persona?.id];
  if (!canonical || (!allowFallback && canonical.id === 'desire_observer')) return null;
  return {
    id: canonical.id,
    name: canonical.name,
    rationale: clean(persona?.rationale, 96),
    fitScore: Math.min(100, Math.max(0, Math.round(finiteNumber(persona?.fitScore) || 0))),
  };
}

function stageFrom(assessment) {
  const level = assessment?.confidence?.level;
  if (level === 'stable') return { id: 'stable', label: '相对稳定' };
  if (level === 'forming' || Number(assessment?.orderCount) >= 3) return { id: 'forming', label: '初步倾向' };
  return { id: 'insufficient', label: '记录不足' };
}

function topMotivationFrom(assessment) {
  const entries = Object.entries(assessment?.motivations || {})
    .map(([id, value]) => ({
      id,
      label: clean(value?.label, 16),
      share: finiteNumber(value?.share),
    }))
    .filter((entry) => entry.label && entry.share !== null && entry.share >= 0 && entry.share <= 1)
    .sort((left, right) => right.share - left.share);
  const top = entries[0];
  // The scorer starts every motive at the same neutral prior. A share above 25%
  // means the current period contributed actual motive evidence.
  if (!top || Number(assessment?.orderCount || 0) < 1 || top.share <= 0.25) return null;
  return {
    ...top,
    percentage: Math.round(top.share * 100),
    labelText: `${top.label} ${Math.round(top.share * 100)}%`,
  };
}

function aggregateEvidenceFrom(assessment) {
  const allowedMetrics = new Set(['outcome', 'axis', 'motivation', 'category', 'reason', 'sample']);
  const priority = ['outcome', 'axis', 'motivation', 'category', 'reason', 'sample'];
  const entries = (Array.isArray(assessment?.evidence) ? assessment.evidence : [])
    .filter((item) => allowedMetrics.has(item?.metric) && clean(item?.statement, 132))
    .sort((left, right) => priority.indexOf(left.metric) - priority.indexOf(right.metric));
  if (entries[0]) return clean(entries[0].statement, 132);
  const decidedCount = Math.max(0, Math.floor(finiteNumber(assessment?.outcomes?.decidedCount) || 0));
  const savedCount = Math.max(0, Math.floor(finiteNumber(assessment?.outcomes?.savedCount) || 0));
  if (decidedCount) return `已做决定的 ${decidedCount} 笔中，有 ${savedCount} 笔冷静后没有购买。`;
  const orderCount = Math.max(0, Math.floor(finiteNumber(assessment?.orderCount) || 0));
  return orderCount ? `本次画像使用 ${orderCount} 笔有效聚合记录。` : '当前聚合证据不足，继续记录后会重新计算。';
}

function registeredCard(value) {
  const cardId = clean(value?.id, 48);
  return FIGMA_PERSONA_CARDS[cardId] || null;
}

function visualThemeFrom(card) {
  return {
    cardId: card.id,
    sourceName: card.sourceName,
    displayName: card.displayName,
    art: card.art,
    gradient: [...card.gradient],
    accent: card.accent,
    quote: card.quote,
    tags: [...card.tags],
  };
}

function normalizeInference(inference, finalCard, allowedCardIds) {
  const inferenceCard = registeredCard({ id: inference?.cardId });
  const confidence = finiteNumber(inference?.confidence);
  const rationale = clean(inference?.rationale, 160);
  const evidenceIds = [...new Set(Array.isArray(inference?.evidenceIds) ? inference.evidenceIds : [])]
    .map((id) => clean(id, 3))
    .filter((id) => /^E[1-8]$/.test(id))
    .slice(0, 3);
  if (
    !inferenceCard
    || inferenceCard.id !== finalCard.id
    || !allowedCardIds.includes(inferenceCard.id)
    || confidence === null
    || confidence < 0.55
    || confidence > 1
    || !rationale
    || evidenceIds.length < 2
  ) return null;
  return {
    cardId: inferenceCard.id,
    confidence,
    rationale,
    evidenceIds,
  };
}

function normalizeResolvedPresentation(assessment, suppliedPresentation) {
  const localFallback = resolvePersonaPresentation(assessment);
  const fallbackLocalCard = localFallback.localCard || localFallback.card;
  const suppliedLocalCard = registeredCard(suppliedPresentation?.localCard);
  const localCard = suppliedLocalCard?.id === fallbackLocalCard.id ? suppliedLocalCard : fallbackLocalCard;
  const allowedCardIds = getAllowedPersonaCardIds(assessment);
  const registeredSuppliedCard = registeredCard(suppliedPresentation?.card);
  const suppliedCard = allowedCardIds.includes(registeredSuppliedCard?.id) ? registeredSuppliedCard : null;
  const proposedFinalCard = suppliedCard || localCard;
  const inference = suppliedPresentation?.decision === 'hybrid'
    ? normalizeInference(suppliedPresentation.inference, proposedFinalCard, allowedCardIds)
    : null;
  const decision = inference ? 'hybrid' : 'local';
  return {
    // The rules assessment remains the only authority for the canonical layer.
    // A pre-resolved presentation may only choose an existing Figma card.
    canonical: localFallback.canonical,
    card: decision === 'hybrid' ? proposedFinalCard : localCard,
    localCard,
    decision,
    inference,
  };
}

export function buildSharePosterModel({
  assessment,
  presentation: suppliedPresentation,
  totals,
  periodSummary,
  goal,
  shareUrl = DEFAULT_SHARE_URL,
  generatedAt = new Date(),
}) {
  const presentation = normalizeResolvedPresentation(assessment, suppliedPresentation);
  const canonicalPersona = presentation.canonical;
  const visualTheme = visualThemeFrom(presentation.card);
  const localVisualTheme = visualThemeFrom(presentation.localCard);
  const decision = presentation.decision;
  const inference = presentation.inference;
  const source = decision === 'hybrid' ? '本地规则 + 聚合推演' : '本地规则映射';
  const inferenceNote = decision === 'hybrid'
    ? '本期趣味人格由本地规则与聚合推演综合得出；规则人格仍由本地计算。'
    : '本期趣味人格由本地聚合记录映射，继续记录后会随证据更新。';
  const persona = canonicalPersona.name;
  const advice = clean(assessment?.localAdvice || '先记下想买的，再给自己一点决定时间。', 92);
  const assessmentPeriod = Number(assessment?.period);
  const explicitSummary = periodSummary || ([7, 30].includes(Number(totals?.period)) ? totals : null);
  const summaryPeriod = Number(explicitSummary?.period);
  // The poster's time claim always comes from the exact assessment that chose
  // the persona. Summaries may fill metrics only when they match that period.
  const period = [7, 30].includes(assessmentPeriod) ? assessmentPeriod : null;
  const profileHasPeriod = [7, 30].includes(assessmentPeriod);
  const profileSavedAmount = profileHasPeriod ? finiteNumber(assessment?.totals?.saved) : null;
  const externalSavedAmount = summaryPeriod === period ? finiteNumber(explicitSummary?.saved) : null;
  const rawSavedAmount = profileSavedAmount ?? externalSavedAmount;
  const savedAmount = rawSavedAmount === null ? null : Math.max(0, rawSavedAmount);
  const profileSavedCount = profileHasPeriod
    ? (finiteNumber(assessment?.outcomes?.savedCount) ?? finiteNumber(assessment?.statuses?.saved))
    : null;
  const externalSavedCount = summaryPeriod === period ? finiteNumber(explicitSummary?.savedCount) : null;
  const rawSavedCount = profileSavedCount ?? externalSavedCount;
  const savedCount = rawSavedCount === null ? null : Math.max(0, Math.floor(rawSavedCount));
  const categorySource = profileHasPeriod && Array.isArray(assessment?.categories)
    ? assessment.categories
    : (summaryPeriod === period ? explicitSummary?.categories : null);
  const topCategory = topCategoryFrom(categorySource);
  const orderCount = Math.max(0, Math.floor(Number(assessment?.orderCount || 0) || 0));
  const confidence = Math.min(100, Math.max(0, Math.round(Number(assessment?.confidence?.score || 0) || 0)));
  const stage = stageFrom(assessment);
  const secondaryPersona = normalizePersona(assessment?.secondaryPersona);
  const walletTheme = clean(assessment?.walletTheme, 28) || '钱包主题形成中';
  const topMotivation = topMotivationFrom(assessment);
  const evidence = aggregateEvidenceFrom(assessment);
  const assessmentSource = ['personal', 'demo'].includes(assessment?.source) ? assessment.source : null;
  const goalSource = goal?.source === 'demo' || goal?.source === 'personal'
    ? goal.source
    : (goal ? (goal.demo ? 'demo' : 'personal') : null);
  const scopedGoal = assessmentSource && goalSource === assessmentSource ? goal : null;
  const recordScope = (assessment?.source || assessment?.dataMode) === 'demo'
    ? '演示记录'
    : ((assessment?.source || assessment?.dataMode) === 'mixed' ? '个人与演示记录' : '本地个人记录');
  const goalName = clean(scopedGoal?.name, 24);
  return {
    brand: '让你花个爽！',
    tagline: '先假装下单，再认真决定。',
    canonicalPersona,
    personaId: canonicalPersona.id,
    persona,
    personaRationale: canonicalPersona.rationale,
    fitScore: canonicalPersona.fitScore,
    fitLabel: `${canonicalPersona.fitScore}%`,
    funPersona: visualTheme.displayName,
    funPersonaSource: visualTheme.sourceName,
    quote: visualTheme.quote,
    tags: [...visualTheme.tags],
    visualTheme,
    localVisualTheme,
    decision,
    source,
    inference,
    inferenceNote,
    stage: stage.id,
    stageLabel: stage.label,
    secondaryPersona,
    walletTheme,
    topMotivation,
    evidence,
    advice,
    savedAmount,
    savedLabel: savedAmount === null ? '数据不足' : money(savedAmount),
    savedCount,
    savedCountLabel: savedCount === null ? '数据不足' : `${savedCount} 次`,
    topCategory: topCategory || '证据不足',
    orderCount,
    confidence,
    period,
    periodLabel: period ? `最近 ${period} 天` : '统计周期未标注',
    recordScope,
    goalName,
    goalLabel: goalName ? `当前预算目标：${goalName}` : '当前未设置预算目标',
    generatedDate: localDateLabel(generatedAt),
    shareUrl: clean(shareUrl, 120) || DEFAULT_SHARE_URL,
  };
}

export function buildShareCaption(model) {
  return `我在「${model.brand}」测出的本期消费人格是“${model.funPersona}”，规则底座是“${model.persona}”。\n${model.tagline}\n${model.shareUrl}`;
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
}

function fillRoundRect(context, x, y, width, height, radius, fillStyle) {
  context.fillStyle = fillStyle;
  roundRect(context, x, y, width, height, radius);
  context.fill();
}

function strokeRoundRect(context, x, y, width, height, radius, strokeStyle, lineWidth = 2) {
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  roundRect(context, x, y, width, height, radius);
  context.stroke();
}

function drawTextLines(context, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const characters = [...text];
  const lines = [];
  let line = '';
  characters.forEach((character) => {
    const candidate = `${line}${character}`;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      return;
    }
    lines.push(line);
    line = character;
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((item, index) => {
    const last = index === maxLines - 1 && lines.length > maxLines;
    context.fillText(last ? `${item.slice(0, -1)}…` : item, x, y + index * lineHeight);
  });
}

function fitText(context, text, maxWidth, initialSize, minSize = 28, weight = 900, family = DISPLAY_FONT) {
  let size = initialSize;
  context.font = `${weight} ${size}px ${family}`;
  while (size > minSize && context.measureText(text).width > maxWidth) {
    size -= 2;
    context.font = `${weight} ${size}px ${family}`;
  }
}

function drawPill(context, text, x, y, { background = '#fffaf0', color = '#604832', border = '#ead5b9' } = {}) {
  context.save();
  context.textAlign = 'left';
  context.font = `800 25px ${TEXT_FONT}`;
  const width = Math.ceil(context.measureText(text).width) + 46;
  fillRoundRect(context, x, y, width, 54, 27, background);
  strokeRoundRect(context, x, y, width, 54, 27, border, 2);
  context.fillStyle = color;
  context.fillText(text, x + 23, y + 36);
  context.restore();
  return width;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function versionedPersonaArtUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${PERSONA_ART_CACHE_VERSION}`;
}

function drawImageContain(context, image, x, y, width, height) {
  const ratio = Math.min(width / image.width, height / image.height);
  const targetWidth = image.width * ratio;
  const targetHeight = image.height * ratio;
  context.drawImage(
    image,
    x + (width - targetWidth) / 2,
    y + (height - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('海报图片生成失败。')), 'image/png', 1);
  });
}

export async function renderSharePoster(model, { mascotUrl = './assets/raccoon-guide.webp' } = {}) {
  await document.fonts?.ready;
  const personaArt = await loadImage(versionedPersonaArtUrl(model?.visualTheme?.art));
  const mascot = personaArt || await loadImage(mascotUrl);
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const context = canvas.getContext('2d');

  const accent = model?.visualTheme?.accent || '#f47b39';
  context.fillStyle = '#f2f1ee';
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  const cardGradient = context.createLinearGradient(26, 26, 1054, 1512);
  cardGradient.addColorStop(0, '#fffdf8');
  cardGradient.addColorStop(0.55, '#fffaf1');
  cardGradient.addColorStop(1, '#ffedd8');
  fillRoundRect(context, 26, 26, 1028, 1486, 92, cardGradient);
  strokeRoundRect(context, 26, 26, 1028, 1486, 92, 'rgba(222, 198, 169, 0.22)', 2);

  context.textAlign = 'center';
  context.fillStyle = '#b2b1ad';
  context.font = `800 34px ${TEXT_FONT}`;
  const brand = clean(model?.brand, 28).replace(/！$/, '');
  context.fillText(`🦝 ${brand} · 消费人格测试`, POSTER_WIDTH / 2, 142);

  // The persona artwork is the supplied 4x Figma PNG. Always use contain so
  // every part of the illustration remains visible in the saved image.
  if (mascot) {
    drawImageContain(context, mascot, 130, 202, 820, 646);
  } else {
    context.fillStyle = accent;
    context.font = `900 180px ${DISPLAY_FONT}`;
    context.fillText('爽', POSTER_WIDTH / 2, 590);
  }

  context.fillStyle = '#62615f';
  context.font = `800 35px ${TEXT_FONT}`;
  context.fillText('我的消费人格是', POSTER_WIDTH / 2, 924);

  context.fillStyle = accent;
  fitText(context, model.funPersona, 860, 88, 60, 900);
  context.fillText(model.funPersona, POSTER_WIDTH / 2, 1028);

  context.fillStyle = '#211f1d';
  context.font = `900 39px ${TEXT_FONT}`;
  drawTextLines(context, `“${model.quote}”`, POSTER_WIDTH / 2, 1112, 800, 56, 2);

  const tag = clean(model?.tags?.[0], 18);
  if (tag) {
    context.font = `800 25px ${TEXT_FONT}`;
    const label = `#${tag.replace(/^#/, '')}`;
    const pillWidth = Math.ceil(context.measureText(label).width) + 46;
    drawPill(context, label, (POSTER_WIDTH - pillWidth) / 2, 1246, {
      background: 'rgba(255, 255, 255, 0.72)',
      color: '#2b2927',
      border: 'rgba(136, 111, 87, 0.08)',
    });
  }

  context.fillStyle = '#aaa7a2';
  context.font = `600 27px ${TEXT_FONT}`;
  context.fillText('快乐测测你的消费人格吧～', POSTER_WIDTH / 2, 1402);
  context.fillStyle = '#b8a99b';
  context.font = `600 20px ${TEXT_FONT}`;
  context.fillText('近期倾向，不是永久标签', POSTER_WIDTH / 2, 1452);
  context.textAlign = 'left';

  return canvasBlob(canvas);
}

export function downloadSharePoster(blob, filename = '让你花个爽-钱包人格海报.png', environment = {}) {
  const documentObject = environment.document || globalThis.document;
  const urlObject = environment.URL || globalThis.URL;
  const navigatorObject = environment.navigator || globalThis.navigator;
  const schedule = environment.setTimeout || globalThis.setTimeout;
  const url = urlObject.createObjectURL(blob);
  const link = documentObject.createElement('a');
  link.href = url;
  link.download = filename;
  documentObject.body?.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove?.();
    schedule(() => urlObject.revokeObjectURL(url), 1000);
  }
  const userAgent = clean(navigatorObject?.userAgent, 240);
  const mobileSaveHint = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    ? '如果浏览器没有开始下载，请长按上方海报图片保存。'
    : '';
  return {
    status: mobileSaveHint ? 'download-requested-mobile' : 'download-requested',
    downloadRequested: true,
    mobileSaveHint,
  };
}

export async function copySharePoster(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持复制图片，请使用下载。');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function copyShareCaption(text, environment = {}) {
  const navigatorObject = environment.navigator || globalThis.navigator;
  const documentObject = environment.document || globalThis.document;
  if (navigatorObject?.clipboard?.writeText) {
    await navigatorObject.clipboard.writeText(text);
    return;
  }
  const input = documentObject.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  documentObject.body.appendChild(input);
  let copied = false;
  try {
    input.select();
    copied = documentObject.execCommand('copy');
  } finally {
    input.remove();
  }
  if (!copied) throw new Error('当前浏览器未能复制文案，请手动复制。');
}
