export type Primitive = string | number | boolean | null;

/** Context keys added automatically by the native module. */
export interface AutoContext {
  app_version: string;
  build: string;
  ota?: string;
  platform: 'ios' | 'android';
  os_version: string;
  device_model: string;
  locale: string;
  sdk_version: string;
}

export interface ShipstatEvent {
  /** UUID v4, unique per event: use it to deduplicate. */
  id: string;
  name: string;
  /** Client timestamp, ISO 8601 UTC with milliseconds. */
  ts: string;
  anon_id: string;
  user_id: string | null;
  props: Record<string, Primitive | Primitive[]>;
  /** Developer context (setContext) merged with AutoContext; auto keys win. */
  context: Partial<AutoContext> & Record<string, Primitive>;
  /** Set by the receiving backend, optional. */
  received_at?: string;
}

/** Body of POST <endpoint>. */
export interface EventBatch {
  schema: 1;
  sent_at: string;
  events: ShipstatEvent[];
}

/** Response of GET <read_url>?since=<cursor>&limit=<n>. */
export interface ExportPage {
  events: ShipstatEvent[];
  next_cursor: string | null;
  /** Cursor to resume from on the next sync, once next_cursor is null. */
  cursor?: string;
}
