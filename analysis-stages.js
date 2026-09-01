export const ANALYSIS_STAGE_DURATION_MS = 850;
export const ANALYSIS_REPORT_DELAY_MS = 500;

export const ANALYSIS_STAGES = Object.freeze([
  Object.freeze({
    key: 'local-score',
    title: '本地规则人格已计算',
    detail: '五维、动机和规则人格仍由本地版本化规则生成。',
  }),
  Object.freeze({
    key: 'summary-ready',
    title: '聚合摘要已准备',
    detail: '只整理次数、金额、分类与行为结果，不含商品名和备注。',
  }),
  Object.freeze({
    key: 'waiting-response',
    title: '正在等待复诊回复',
    detail: '请求已经发出；如果网络较慢，会停在这里而不会伪造完成进度。',
  }),
  Object.freeze({
    key: 'validated',
    title: '返回结构已通过校验',
    detail: '人格候选和证据已经过本地门槛复核，准备打开报告。',
  }),
]);

export function createAnalysisStageController({
  onChange = () => {},
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer),
  now = () => performance.now(),
} = {}) {
  let active = false;
  let reducedMotion = false;
  let startedAt = 0;
  let index = 0;
  let outcome = null;
  const timers = new Set();
  const pendingDelays = new Map();

  const snapshot = () => ({ active, reducedMotion, index, outcome, stage: ANALYSIS_STAGES[index] });
  const emit = () => onChange(snapshot());

  const delay = (milliseconds) => new Promise((resolve) => {
    if (!active || milliseconds <= 0) {
      resolve(active);
      return;
    }
    const timer = schedule(() => {
      timers.delete(timer);
      pendingDelays.delete(timer);
      resolve(active);
    }, milliseconds);
    timers.add(timer);
    pendingDelays.set(timer, resolve);
  });

  const stop = ({ preserve = false } = {}) => {
    active = false;
    timers.forEach((timer) => cancel(timer));
    timers.clear();
    pendingDelays.forEach((resolve) => resolve(false));
    pendingDelays.clear();
    if (!preserve) {
      index = 0;
      outcome = null;
    }
    // Observers also need the terminal inactive snapshot when the final
    // stage is preserved for display. Otherwise the UI can retain an
    // active=true snapshot after finish() has already settled.
    emit();
  };

  const setReducedMotion = (value) => {
    const nextValue = Boolean(value);
    if (nextValue === reducedMotion) return;
    reducedMotion = nextValue;
    if (!active || !reducedMotion) return;
    timers.forEach((timer) => cancel(timer));
    timers.clear();
    pendingDelays.forEach((resolve) => resolve(true));
    pendingDelays.clear();
    index = outcome ? 3 : 2;
    emit();
  };

  const scheduleStage = (nextIndex, milliseconds) => {
    const timer = schedule(() => {
      timers.delete(timer);
      if (!active || index >= 3) return;
      index = nextIndex;
      emit();
    }, milliseconds);
    timers.add(timer);
  };

  const start = ({ reduceMotion = false } = {}) => {
    stop();
    active = true;
    reducedMotion = Boolean(reduceMotion);
    startedAt = now();
    index = reducedMotion ? 2 : 0;
    outcome = null;
    emit();
    if (!reducedMotion) {
      scheduleStage(1, ANALYSIS_STAGE_DURATION_MS);
      scheduleStage(2, ANALYSIS_STAGE_DURATION_MS * 2);
    }
    return snapshot();
  };

  const finish = async (nextOutcome = 'success') => {
    if (!active) return false;
    outcome = nextOutcome;
    if (reducedMotion) {
      index = 3;
      emit();
      stop({ preserve: true });
      return true;
    }

    if (nextOutcome !== 'success') {
      index = 3;
      emit();
      const readyForFallback = await delay(ANALYSIS_REPORT_DELAY_MS);
      if (!readyForFallback) return false;
      stop({ preserve: true });
      return true;
    }

    const earliestValidationAt = ANALYSIS_STAGE_DURATION_MS * 3;
    const readyForValidation = await delay(Math.max(0, earliestValidationAt - (now() - startedAt)));
    if (!readyForValidation) return false;
    index = 3;
    emit();
    if (reducedMotion) {
      stop({ preserve: true });
      return true;
    }

    const revealDelay = ANALYSIS_STAGE_DURATION_MS + ANALYSIS_REPORT_DELAY_MS;
    const readyForReveal = await delay(revealDelay);
    if (!readyForReveal) return false;
    stop({ preserve: true });
    return true;
  };

  return {
    finish,
    getSnapshot: snapshot,
    setReducedMotion,
    start,
    stop,
  };
}
