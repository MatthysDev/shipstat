import { Platform } from 'react-native';
import Shipstat from 'shipstat';

import { NaiveSdk } from './naiveSdk';

export type Subject = 'noop' | 'naive' | 'shipstat';
export const SUBJECTS: Subject[] = ['noop', 'naive', 'shipstat'];

export interface LatencyResult {
  subject: Subject;
  calls: number;
  meanUs: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
  maxUs: number;
}

export interface FrameResult {
  subject: Subject;
  perFrame: number;
  eventsPerSecond: number;
  seconds: number;
  fps: number;
  longFrames: number;
}

export interface Report {
  platform: string;
  osVersion: string;
  build: 'debug' | 'release';
  date: string;
  latency: LatencyResult[];
  frames: FrameResult[];
  delivery: { events: number; ms: number } | null;
}

const noop = (_name: string, _props?: object) => undefined;

function caller(subject: Subject) {
  if (subject === 'shipstat') return (name: string, props: Record<string, string | number | boolean>) => Shipstat.track(name, props);
  if (subject === 'naive') return (name: string, props: Record<string, string | number | boolean>) => NaiveSdk.track(name, props);
  return noop;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/** Times every call individually (µs), after a warm-up. */
export async function measureLatency(subject: Subject, calls = 10_000): Promise<LatencyResult> {
  const fn = caller(subject);
  for (let i = 0; i < 1000; i++) fn('bench_warmup', { i, ok: true, screen: 'perf' });
  await pause(300);
  const samples = new Array<number>(calls);
  for (let i = 0; i < calls; i++) {
    const t0 = performance.now();
    fn('bench_event', { i, ok: true, screen: 'perf' });
    samples[i] = (performance.now() - t0) * 1000;
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / calls;
  return { subject, calls, meanUs: mean, p50Us: percentile(sorted, 0.5), p95Us: percentile(sorted, 0.95), p99Us: percentile(sorted, 0.99), maxUs: sorted[sorted.length - 1] };
}

/**
 * Fires `perFrame` events on every animation frame for `seconds`, and counts the frames the
 * JS thread managed to render. 60 fps = no impact; long frames are those over 20 ms.
 */
export function measureFrames(subject: Subject, perFrame = 20, seconds = 3): Promise<FrameResult> {
  const fn = caller(subject);
  return new Promise((resolve) => {
    let frames = 0;
    let long = 0;
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      frames++;
      if (now - last > 20) long++;
      last = now;
      for (let i = 0; i < perFrame; i++) fn('bench_frame', { i, ok: true, screen: 'perf' });
      if (now - start < seconds * 1000) requestAnimationFrame(tick);
      else resolve({ subject, perFrame, eventsPerSecond: perFrame * 60, seconds, fps: frames / ((now - start) / 1000), longFrames: long });
    };
    requestAnimationFrame(tick);
  });
}

/** Time until the server has received `count` new Shipstat events. */
export async function measureDelivery(healthUrl: string, headers: Record<string, string>, count = 5000) {
  const read = async () => ((await (await fetch(healthUrl, { headers })).json()) as { events: number }).events;
  await Shipstat.flush();
  await pause(1500);
  const before = await read();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) Shipstat.track('bench_delivery', { i });
  await Shipstat.flush();
  for (let k = 0; k < 600; k++) {
    if ((await read()) - before >= count) return { events: count, ms: performance.now() - t0 };
    await pause(50);
  }
  return null;
}

export async function runAll(opts: { healthUrl: string; headers: Record<string, string>; onStep: (s: string) => void }): Promise<Report> {
  const latency: LatencyResult[] = [];
  const frames: FrameResult[] = [];
  for (const s of SUBJECTS) {
    opts.onStep(`latency · ${s}`);
    // Best of 3 runs by p50, to limit noise from the simulator host.
    const runs = [await measureLatency(s), await measureLatency(s), await measureLatency(s)];
    latency.push(runs.sort((a, b) => a.p50Us - b.p50Us)[0]);
    await Shipstat.flush();
    await pause(500);
  }
  for (const perFrame of [20, 100]) {
    for (const s of SUBJECTS) {
      opts.onStep(`frames · ${s} · ${perFrame}/frame`);
      frames.push(await measureFrames(s, perFrame));
      await Shipstat.flush();
      await pause(800);
    }
  }
  opts.onStep('delivery');
  const delivery = await measureDelivery(opts.healthUrl, opts.headers);
  return { platform: Platform.OS, osVersion: String(Platform.Version), build: __DEV__ ? 'debug' : 'release', date: new Date().toISOString(), latency, frames, delivery };
}
