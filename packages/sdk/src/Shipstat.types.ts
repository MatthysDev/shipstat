export type Primitive = string | number | boolean | null;

/** Event properties. Flat on purpose: nested objects are not allowed. */
export type Props = Record<string, Primitive | Primitive[]>;

/** Global context merged into every following event (e.g. variant, feature). */
export type Context = Record<string, Primitive>;

export interface ShipstatConfig {
  /** URL that receives batches of events (POST, JSON). */
  endpoint: string;
  /** Extra headers sent with every batch, e.g. Authorization. */
  headers?: Record<string, string>;
  /** Send as soon as this many events are waiting. Default 50. */
  flushAt?: number;
  /** Send waiting events at this interval. Default 10 000 ms. */
  flushIntervalMs?: number;
  /** Max events kept on disk; the oldest are dropped past it. Default 10 000. */
  maxQueueSize?: number;
  /** false = nothing is stored nor sent. Default true. */
  enabled?: boolean;
  /** Native logs. Default false. */
  debug?: boolean;
}
