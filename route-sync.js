const NEW_PHONE_VIEWS = new Set(['intro', 'home', 'catalog', 'detail']);
const COMMERCE_TYPES = new Set(['shop', 'food', 'interest']);
const CLINIC_VIEWS = new Set(['start', 'report']);
const ROOM_ACTIVITIES = new Set(['peel']);

export function panelNameFromHash(hash = '') {
  return String(hash).replace(/^#/, '').split('?')[0];
}

export function parseNewHashState(hash = '', _historyState = {}) {
  if (panelNameFromHash(hash) !== 'new') {
    return { phoneView: 'intro', commerceType: 'shop', productId: null };
  }

  const query = String(hash).replace(/^#new\??/, '');
  const params = new URLSearchParams(query);
  const requestedView = params.has('view') ? params.get('view') : 'intro';
  const phoneView = NEW_PHONE_VIEWS.has(requestedView) ? requestedView : 'intro';
  const requestedType = params.has('type') ? params.get('type') : 'shop';
  const commerceType = COMMERCE_TYPES.has(requestedType) ? requestedType : 'shop';
  const requestedProductId = params.has('product') ? params.get('product') : null;
  const productId = phoneView === 'detail' && requestedProductId
    ? String(requestedProductId).slice(0, 80)
    : null;

  return {
    phoneView: phoneView === 'detail' && !productId ? 'catalog' : phoneView,
    commerceType,
    productId,
  };
}

export function buildNewHash({ phoneView = 'intro', commerceType = 'shop', productId = null } = {}) {
  const view = NEW_PHONE_VIEWS.has(phoneView) ? phoneView : 'intro';
  if (view === 'intro') return '#new';
  if (view === 'home') return '#new?view=home';

  const params = new URLSearchParams();
  params.set('view', view === 'detail' && !productId ? 'catalog' : view);
  params.set('type', COMMERCE_TYPES.has(commerceType) ? commerceType : 'shop');
  if (view === 'detail' && productId) params.set('product', String(productId).slice(0, 80));
  return `#new?${params.toString()}`;
}

export function parseClinicHashState(hash = '') {
  if (panelNameFromHash(hash) !== 'clinic') return { clinicView: 'start' };
  const query = String(hash).replace(/^#clinic\??/, '');
  const params = new URLSearchParams(query);
  const requestedView = params.get('view') || 'start';
  return { clinicView: CLINIC_VIEWS.has(requestedView) ? requestedView : 'start' };
}

export function buildClinicHash({ clinicView = 'start' } = {}) {
  return clinicView === 'report' ? '#clinic?view=report' : '#clinic';
}

export function parseRoomHashState(hash = '') {
  if (panelNameFromHash(hash) !== 'room') return { activity: null };
  const query = String(hash).replace(/^#room\??/, '');
  const requestedActivity = new URLSearchParams(query).get('activity');
  return { activity: ROOM_ACTIVITIES.has(requestedActivity) ? requestedActivity : null };
}

export function buildRoomHash({ activity = null } = {}) {
  return ROOM_ACTIVITIES.has(activity) ? `#room?activity=${encodeURIComponent(activity)}` : '#room';
}

export function panelTransitionHistoryMethod(historyState = {}) {
  return historyState?.openedByApp ? 'replaceState' : 'pushState';
}

export function routeSignature(route = {}) {
  const panel = route.panel || 'room';
  const activity = panel === 'room' && ROOM_ACTIVITIES.has(route.activity) ? route.activity : '-';
  const goalsView = panel === 'goals' ? (route.goalsView || 'goal') : '-';
  const clinicView = panel === 'clinic' ? (route.clinicView || 'start') : '-';
  const phoneView = panel === 'new' ? (route.phoneView || 'intro') : '-';
  const commerceType = panel === 'new' && !['intro', 'home'].includes(phoneView) ? (route.commerceType || 'shop') : '-';
  const productId = panel === 'new' && phoneView === 'detail' ? (route.productId || '-') : '-';
  return [panel, activity, goalsView, clinicView, phoneView, commerceType, productId].map(encodeURIComponent).join('|');
}

export function createRouteSyncScheduler({
  readRoute,
  applyRoute,
  getCurrentSignature = () => '',
  schedule = (callback) => queueMicrotask(callback),
}) {
  let scheduled = false;
  let pendingHistoryState;
  let lastAppliedSignature = '';

  function flush() {
    scheduled = false;
    const route = readRoute(pendingHistoryState);
    pendingHistoryState = undefined;
    const signature = routeSignature(route);
    if (signature === lastAppliedSignature && signature === getCurrentSignature()) return;
    lastAppliedSignature = signature;
    applyRoute(route);
  }

  return {
    request(historyState) {
      pendingHistoryState = historyState;
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
    reset() {
      scheduled = false;
      pendingHistoryState = undefined;
      lastAppliedSignature = '';
    },
  };
}
