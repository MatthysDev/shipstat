import * as Vexo from '../compat/vexo';

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

const mockNative = jest.requireMock('../ShipstatModule').default;

beforeEach(() => jest.clearAllMocks());

describe('shipstat/vexo', () => {
  it('starts Shipstat with an endpoint URL', () => {
    Vexo.vexo('https://stats.example.com/events', { sessionReplay: false });
    expect(mockNative.init).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://stats.example.com/events' }));
  });

  it('accepts a full config', () => {
    Vexo.vexo({ endpoint: 'https://stats.example.com/events', compress: true });
    expect(mockNative.init).toHaveBeenCalledWith(expect.objectContaining({ compress: true }));
  });

  it('ignores a leftover Vexo API key instead of sending to it', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    Vexo.vexo('97fb4497-c895-479a-bf5e-b673f74e302c');
    expect(mockNative.init).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('maps customEvent to track and flattens nested props', () => {
    Vexo.customEvent('checkout', { total: 42, cart: { items: 3, coupon: null }, tags: ['a', 'b'], lines: [{ id: 1 }] });
    const [name, json] = mockNative.track.mock.calls[0];
    expect(name).toBe('checkout');
    expect(JSON.parse(json)).toEqual({ total: 42, 'cart.items': 3, 'cart.coupon': null, tags: ['a', 'b'], lines: '[{"id":1}]' });
  });

  it('maps identify, opt-out and screens', async () => {
    await Vexo.identifyDevice('user_1');
    await Vexo.disableTracking();
    await Vexo.enableTracking();
    Vexo.trackScreen('Home', { tab: 'feed' });
    expect(mockNative.identify).toHaveBeenCalledWith('user_1');
    expect(mockNative.setEnabled.mock.calls).toEqual([[false], [true]]);
    expect(mockNative.track).toHaveBeenCalledWith('screen_viewed', JSON.stringify({ screen: 'Home', tab: 'feed' }), expect.any(Number));
  });

  it('records errors as events without throwing', () => {
    Vexo.trackError(new Error('boom'), { handled: false });
    expect(mockNative.track).toHaveBeenCalledWith('error', JSON.stringify({ message: 'boom', handled: false }), expect.any(Number));
  });

  it('renders children for replay components', () => {
    expect(Vexo.VexoMask({ children: 'x' })).toBe('x');
    expect(Vexo.VexoProvider({ children: null })).toBeNull();
    Vexo.setHeatmapSegment('a');
  });
});
