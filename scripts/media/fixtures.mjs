// Boards and A/B test used for screenshots and the promo video, injected into localStorage
// so every capture shows the same thing.
const w = (id, title, viz, extra = {}) => ({ id, title, viz, metric: 'events', range: '30d', filters: {}, size: 1, ...extra });

export const overviewBoard = {
  id: 'overview',
  name: 'Overview',
  widgets: [
    w('u', 'Unique users', 'number', { metric: 'users' }),
    w('p', 'Purchases', 'number', { metric: 'users', event: 'purchase_done' }),
    w('e', 'Events per user', 'number', { metric: 'per_user' }),
    w('v', 'Events per day by app version', 'bar', { split: 'app_version', size: 2 }),
    w('pl', 'Platforms', 'pie', { split: 'platform', metric: 'users' }),
    w('f', 'Paywall funnel by variant', 'funnel', { steps: ['app_opened', 'paywall_viewed', 'purchase_done'], split: 'variant', metric: 'users', size: 2 }),
    w('t', 'Top events', 'table', { split: 'name' }),
    w('fd', 'Latest events', 'feed', { size: 3 }),
  ],
};

export const liveBoard = {
  id: 'live',
  name: 'Live',
  widgets: [
    w('lp', 'Paywall views · 24 h', 'number', { event: 'paywall_viewed', range: '24h' }),
    w('lb', 'Purchases · 24 h', 'number', { event: 'purchase_done', range: '24h' }),
    w('lu', 'Active users · 24 h', 'number', { metric: 'users', range: '24h' }),
    w('lf', 'Latest events', 'feed', { size: 3 }),
  ],
};

export const paywallTest = { id: 'paywall', name: 'New paywall', exposure: 'paywall_viewed', goal: 'purchase_done', variantKey: 'variant', control: 'A' };
