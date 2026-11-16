import { NativeModule, requireNativeModule } from 'expo';

export type NativeConfig = {
  endpoint: string;
  headers: Record<string, string>;
  flushAt: number;
  flushIntervalMs: number;
  maxQueueSize: number;
  enabled: boolean;
  debug: boolean;
  compress: boolean;
  sdkVersion: string;
  ota: string | null;
};

declare class ShipstatNativeModule extends NativeModule<Record<string, never>> {
  init(config: NativeConfig): void;
  track(name: string, propsJson: string | null, tsMs: number): void;
  setContext(ctx: Record<string, unknown>): void;
  unsetContext(keys: string[]): void;
  identify(userId: string | null): void;
  setEnabled(enabled: boolean): void;
  reset(): void;
  flush(): Promise<void>;
  getAnonId(): string;
}

export default requireNativeModule<ShipstatNativeModule>('Shipstat');
