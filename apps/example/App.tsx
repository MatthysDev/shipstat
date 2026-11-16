import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Shipstat from 'shipstat';

const HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const ENDPOINT = `http://${HOST}:8787/events`;

Shipstat.init({ endpoint: ENDPOINT, debug: true, flushIntervalMs: 5000, headers: { Authorization: 'Bearer dev-token' } });

export default function App() {
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  const [log, setLog] = useState<string[]>([]);
  const [anonId, setAnonId] = useState('');

  const add = (line: string) => setLog((l) => [line, ...l].slice(0, 12));

  useEffect(() => {
    setAnonId(Shipstat.getAnonId());
    Shipstat.setContext({ variant, feature: 'paywall_v2' });
  }, [variant]);

  const benchmark = () => {
    const n = 10_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) Shipstat.track('bench_event', { i, ok: true });
    const ms = performance.now() - t0;
    add(`bench: ${n} track() en ${ms.toFixed(1)} ms → ${((ms / n) * 1000).toFixed(1)} µs/appel`);
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>Shipstat example</Text>
      <Text style={styles.muted} testID="anon">anon_id: {anonId}</Text>
      <Text style={styles.muted}>endpoint: {ENDPOINT}</Text>
      <Text style={styles.muted} testID="variant">variante: {variant}</Text>

      <Btn id="toggle-variant" label={`Passer en variante ${variant === 'A' ? 'B' : 'A'}`} onPress={() => setVariant((v) => (v === 'A' ? 'B' : 'A'))} />
      <Btn id="track-paywall" label="track paywall_viewed" onPress={() => { Shipstat.track('paywall_viewed', { placement: 'onboarding_end' }); add('paywall_viewed'); }} />
      <Btn id="track-purchase" label="track purchase_done" onPress={() => { Shipstat.track('purchase_done', { plan: 'yearly', price: 59.99 }); add('purchase_done'); }} />
      <Btn id="identify" label="identify user_42" onPress={() => { Shipstat.identify('user_42'); add('identify user_42'); }} />
      <Btn id="flush" label="flush()" onPress={async () => { await Shipstat.flush(); add('flush terminé'); }} />
      <Btn id="bench" label="Benchmark 10 000 track()" onPress={benchmark} />

      <View style={styles.log}>
        {log.map((l, i) => <Text key={i} style={styles.logLine}>{l}</Text>)}
      </View>
    </ScrollView>
  );
}

function Btn({ id, label, onPress }: { id: string; label: string; onPress: () => void }) {
  return (
    <Pressable testID={id} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, paddingTop: 80, gap: 10 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  muted: { color: '#62626b', fontSize: 12 },
  btn: { backgroundColor: '#4f46e5', padding: 14, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  log: { marginTop: 12, gap: 4 },
  logLine: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 12 },
});
