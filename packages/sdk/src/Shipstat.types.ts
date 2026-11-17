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
  /**
   * Send waiting events at this interval. Default 30 000 ms. Each send wakes the phone's radio,
   * which stays powered for several seconds: fewer, larger sends save battery. Nothing wakes up
   * while no event is waiting, and waiting events are also sent when the app goes to the background.
   */
  flushIntervalMs?: number;
  /** Max events kept on disk; the oldest are dropped past it. Default 10 000. */
  maxQueueSize?: number;
  /** false = nothing is stored nor sent. Default true. */
  enabled?: boolean;
  /** Native logs. Default false. */
  debug?: boolean;
  /**
   * Gzip each batch (`Content-Encoding: gzip`): typically 10–20× fewer bytes on the network.
   * Default true. If your endpoint answers a gzipped batch with an error, the batch is sent again
   * as plain JSON and the rest of the session stays plain; set false to never compress.
   */
  compress?: boolean;
}
