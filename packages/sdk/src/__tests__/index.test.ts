jest.mock('../ShipstatModule', () => ({
  __esModule: true,
  default: {
  init: jest.fn(),
  track: jest.fn(),
  setContext: jest.fn(),
  unsetContext: jest.fn(),
  identify: jest.fn(),
  setEnabled: jest.fn(),
  reset: jest.fn(),
  flush: jest.fn(() => Promise.resolve()),
  getAnonId: jest.fn(() => 'anon'),
},
}));

import Shipstat from '../index';
import { checkEvent, normalizeConfig } from '../validate';

const mockNative = jest.requireMock('../ShipstatModule').default;

beforeEach(() => jest.clearAllMocks());

describe('init', () => {
  it('fills defaults and passes sdk version', () => {
    Shipstat.init({ endpoint: 'https://api.example.com/events' });
    expect(mockNative.init).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://api.example.com/events',
        headers: {},
        flushAt: 50,
        flushIntervalMs: 10000,
        maxQueueSize: 10000,
        enabled: true,
        debug: false,
        sdkVersion: '0.1.0',
        ota: null,
      })
    );
  });

  it('rejects a missing or non-http endpoint', () => {
    expect(() => normalizeConfig({ endpoint: 'ftp://x' })).toThrow(/endpoint/);
    expect(() => normalizeConfig({} as any)).toThrow(/endpoint/);
  });
});

describe('track', () => {
  it('forwards name, props and a timestamp', () => {
    Shipstat.track('paywall_viewed', { placement: 'onboarding_end' });
    expect(mockNative.track).toHaveBeenCalledWith('paywall_viewed', { placement: 'onboarding_end' }, expect.any(Number));
  });

  it('sends null props when none are given', () => {
    Shipstat.track('app_opened');
    expect(mockNative.track).toHaveBeenCalledWith('app_opened', null, expect.any(Number));
  });

  it('drops invalid events in development with a warning', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    Shipstat.track('bad', { nested: { a: 1 } } as any);
    Shipstat.track('');
    expect(mockNative.track).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('validation', () => {
  it('accepts primitives and arrays of primitives in props', () => {
    expect(checkEvent('ok', { a: 'x', b: 1, c: true, d: null, e: [1, 'two'] })).toEqual([]);
  });
  it('rejects NaN and nested arrays', () => {
    expect(checkEvent('ok', { n: NaN })).toHaveLength(1);
    expect(checkEvent('ok', { a: [[1]] as any })).toHaveLength(1);
  });
});

describe('context', () => {
  it('rejects arrays in context', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    Shipstat.setContext({ variant: ['A'] } as any);
    expect(mockNative.setContext).not.toHaveBeenCalled();
    Shipstat.setContext({ variant: 'B' });
    expect(mockNative.setContext).toHaveBeenCalledWith({ variant: 'B' });
    warn.mockRestore();
  });

  it('unsetContext passes keys as an array', () => {
    Shipstat.unsetContext('variant', 'feature');
    expect(mockNative.unsetContext).toHaveBeenCalledWith(['variant', 'feature']);
  });
});
