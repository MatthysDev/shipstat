/**
 * A typical pure-JavaScript analytics client, used as a baseline: event objects are built on
 * the JS thread (id, timestamp, merged context), queued in memory, then serialized and sent
 * with fetch every 50 events. Real JS SDKs usually also persist the queue to AsyncStorage,
 * which costs more: this baseline is a lower bound.
 */
type Primitive = string | number | boolean | null;

const queue: object[] = [];
let context: Record<string, Primitive> = {};
let endpoint = '';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const NaiveSdk = {
  init(url: string) {
    endpoint = url;
  },
  setContext(ctx: Record<string, Primitive>) {
    context = { ...context, ...ctx };
  },
  track(name: string, props?: Record<string, Primitive>) {
    queue.push({ id: uuid(), name, ts: new Date().toISOString(), props: props ?? {}, context: { ...context, platform: 'js' } });
    if (queue.length >= 50) {
      const body = JSON.stringify({ schema: 1, sent_at: new Date().toISOString(), events: queue.splice(0) });
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bench': 'naive' }, body }).catch(() => undefined);
    }
  },
};
