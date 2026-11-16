import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Shipstat from 'shipstat';

import { runAll, type Report } from './src/bench';
import { NaiveSdk } from './src/naiveSdk';

// The example sends to `npx shipstat-dashboard` running on the host machine.
const HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const SERVER = `http://${HOST}:8787`;
const HEADERS: Record<string, string> = {};

Shipstat.init({ endpoint: `${SERVER}/events`, headers: HEADERS, flushIntervalMs: 5000, debug: __DEV__ });
NaiveSdk.init(`${SERVER}/events`);

type Tab = 'demo' | 'perf';

export default function App() {
  const [tab, setTab] = useState<Tab>('demo');
  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        <TabButton id="tab-demo" label="Demo" on={tab === 'demo'} onPress={() => setTab('demo')} />
        <TabButton id="tab-perf" label="Perf lab" on={tab === 'perf'} onPress={() => setTab('perf')} />
      </View>
      {tab === 'demo' ? <Demo /> : <PerfLab />}
    </View>
  );
}

function Demo() {
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  const [log, setLog] = useState<string[]>([]);
  const [anonId, setAnonId] = useState('');
  const [optedOut, setOptedOut] = useState(false);
  const add = (line: string) => setLog((l) => [line, ...l].slice(0, 10));

  useEffect(() => {
    setAnonId(Shipstat.getAnonId());
    Shipstat.setContext({ variant, feature: 'paywall_v2' });
  }, [variant]);

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>Shipstat</Text>
      <Text style={styles.muted} testID="anon">anon_id {anonId}</Text>
      <Text style={styles.muted}>sending to {SERVER}/events</Text>

      <View style={styles.variantRow}>
        <Text style={styles.label}>Variant</Text>
        {(['A', 'B'] as const).map((v) => (
          <Pressable key={v} testID={`variant-${v}`} onPress={() => setVariant(v)} style={[styles.pill, variant === v && styles.pillOn]}>
            <Text style={[styles.pillText, variant === v && styles.pillTextOn]}>{v}</Text>
          </Pressable>
        ))}
      </View>

      <Button id="track-open" label="track('app_opened')" onPress={() => { Shipstat.track('app_opened'); add('app_opened'); }} />
      <Button id="track-paywall" label="track('paywall_viewed')" onPress={() => { Shipstat.track('paywall_viewed', { placement: 'onboarding_end' }); add(`paywall_viewed · variant ${variant}`); }} />
      <Button id="track-purchase" label="track('purchase_done')" onPress={() => { Shipstat.track('purchase_done', { plan: 'yearly', price: 59.99 }); add(`purchase_done · variant ${variant}`); }} />
      <Button id="identify" label="identify('user_42')" onPress={() => { Shipstat.identify('user_42'); add('identify user_42'); }} secondary />
      <Button id="flush" label="flush()" onPress={async () => { await Shipstat.flush(); add('flushed ✓'); }} secondary />
      <Button
        id="opt-out"
        label={optedOut ? 'setEnabled(true)' : 'setEnabled(false)'}
        onPress={() => { Shipstat.setEnabled(optedOut); setOptedOut(!optedOut); add(optedOut ? 'tracking enabled' : 'opted out: queue cleared'); }}
        secondary
      />

      <View style={styles.log}>
        {log.map((l, i) => <Text key={i} style={[styles.logLine, i === 0 && { color: INK }]}>{l}</Text>)}
      </View>
    </ScrollView>
  );
}

function PerfLab() {
  const [step, setStep] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const run = async () => {
    setReport(null);
    const r = await runAll({ healthUrl: `${SERVER}/health`, headers: HEADERS, onStep: setStep });
    setStep(null);
    setReport(r);
    // Saved by shipstat-dashboard into bench-results.ndjson, next to its data file.
    fetch(`${SERVER}/bench`, { method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(r) }).catch(() => undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>Perf lab</Text>
      <Text style={styles.muted}>{Platform.OS} · {__DEV__ ? 'debug' : 'release'} build · 10 000 calls per subject, best of 3</Text>
      <Button id="run-bench" label={step ? `Running: ${step}…` : 'Run benchmark'} onPress={run} disabled={!!step} />
      {report && (
        <View testID="bench-done">
          <Text style={styles.section}>track() cost on the JS thread (µs)</Text>
          <Row cells={['', 'p50', 'p95', 'p99', 'mean']} head />
          {report.latency.map((l) => <Row key={l.subject} cells={[l.subject, l.p50Us.toFixed(1), l.p95Us.toFixed(1), l.p99Us.toFixed(1), l.meanUs.toFixed(1)]} />)}
          <Text style={styles.section}>JS frame rate while tracking</Text>
          <Row cells={['', 'events/s', 'fps', 'long frames']} head />
          {report.frames.map((f) => <Row key={f.subject + f.perFrame} cells={[f.subject, String(f.eventsPerSecond), f.fps.toFixed(1), String(f.longFrames)]} />)}
          <Text style={styles.section}>Delivery</Text>
          <Text style={styles.muted}>{report.delivery ? `${report.delivery.events} events stored by the server in ${(report.delivery.ms / 1000).toFixed(2)} s` : 'server not reachable'}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Row({ cells, head }: { cells: string[]; head?: boolean }) {
  return (
    <View style={styles.row}>
      {cells.map((c, i) => <Text key={i} style={[styles.cell, i === 0 && styles.cellFirst, head && styles.cellHead]}>{c}</Text>)}
    </View>
  );
}

function Button({ id, label, onPress, secondary, disabled }: { id: string; label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable testID={id} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.btn, secondary && styles.btnSecondary, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[styles.btnText, secondary && styles.btnTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function TabButton({ id, label, on, onPress }: { id: string; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable testID={id} accessibilityRole="tab" onPress={onPress} style={[styles.tab, on && styles.tabOn]}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });
const INK = '#0a0a0a';
const ACCENT = '#f2542d';
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fbfaf6', paddingTop: 64 },
  tabs: { flexDirection: 'row', marginHorizontal: 24, backgroundColor: '#f1efe8', borderRadius: 999, padding: 4 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  tabOn: { backgroundColor: '#ffffff', shadowColor: INK, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  tabText: { color: '#6b6c63', fontWeight: '700' },
  tabTextOn: { color: INK },
  body: { padding: 24, gap: 10 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -1.4, color: INK },
  muted: { color: '#a2a39a', fontSize: 12 },
  label: { fontWeight: '700', color: INK, marginRight: 6 },
  variantRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  pill: { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 999, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#ebe9e2' },
  pillOn: { backgroundColor: ACCENT, borderColor: ACCENT },
  pillText: { fontWeight: '800', color: INK },
  pillTextOn: { color: '#ffffff' },
  btn: { backgroundColor: INK, paddingVertical: 16, paddingHorizontal: 20, borderRadius: 999, shadowColor: INK, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  btnSecondary: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#ebe9e2', shadowOpacity: 0 },
  btnText: { color: '#ffffff', fontWeight: '700', textAlign: 'center', fontFamily: mono, fontSize: 13.5 },
  btnTextSecondary: { color: INK },
  log: { marginTop: 12, gap: 6, borderTopWidth: 1, borderColor: '#ebe9e2', paddingTop: 14 },
  logLine: { fontFamily: mono, fontSize: 12, color: '#6b6c63' },
  section: { marginTop: 16, fontWeight: '600', color: INK },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e0e0e0', paddingVertical: 6 },
  cell: { flex: 1, textAlign: 'right', fontFamily: mono, fontSize: 12, color: INK },
  cellFirst: { flex: 1.4, textAlign: 'left' },
  cellHead: { color: '#999999' },
});
