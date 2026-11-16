import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Shipstat from 'shipstat';

// A small fitness app instrumented with Shipstat, to test it like a real integration.
// Events go to `shipstat-dashboard` running on this Mac.
const HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
Shipstat.init({ endpoint: `http://${HOST}:8790/events`, flushIntervalMs: 3000, debug: __DEV__ });

/** Stable A/B bucket per install, from the anonymous id. */
function bucket(id: string): 'A' | 'B' {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 === 0 ? 'A' : 'B';
}

type Screen = 'onboarding' | 'home' | 'paywall' | 'settings';
const INK = '#14150f';
const ACCENT = '#f2542d';

export default function App() {
  const anonId = useMemo(() => Shipstat.getAnonId(), []);
  // Set the context before the first render: child effects run before parent effects, so a
  // context set in a useEffect here would miss the first events of the screens below.
  const [variant, setVariant] = useState<'A' | 'B'>(() => {
    const v = bucket(anonId);
    Shipstat.setContext({ variant: v, feature: 'paywall_v2' });
    return v;
  });
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [premium, setPremium] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    Shipstat.setContext({ variant, feature: 'paywall_v2' });
  }, [variant]);

  useEffect(() => {
    Shipstat.track('app_opened');
  }, []);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1400);
  };

  const go = (s: Screen, placement?: string) => {
    if (s === 'paywall') Shipstat.track('paywall_viewed', { placement: placement ?? 'home' });
    setScreen(s);
  };

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        {screen === 'onboarding' && <Onboarding onDone={() => go('paywall', 'onboarding_end')} />}
        {screen === 'home' && <Home premium={premium} onPaywall={() => go('paywall', 'locked_feature')} onSettings={() => setScreen('settings')} say={say} />}
        {screen === 'paywall' && (
          <Paywall
            variant={variant}
            onBuy={(plan, price) => {
              Shipstat.track('purchase_done', { plan, price, currency: 'EUR' });
              setPremium(true);
              say(`purchase_done · ${plan}`);
              setScreen('home');
            }}
            onClose={() => {
              Shipstat.track('paywall_dismissed');
              setScreen('home');
            }}
          />
        )}
        {screen === 'settings' && <Settings anonId={anonId} variant={variant} setVariant={setVariant} onBack={() => setScreen('home')} say={say} />}
      </ScrollView>
      {toast && <View style={styles.toast}><Text style={styles.toastText}>✓ {toast}</Text></View>}
    </View>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const steps = ['Pick your goal', 'Set your level', 'Choose your days'];
  const [i, setI] = useState(0);
  useEffect(() => {
    Shipstat.track('onboarding_step', { step: i + 1 });
  }, [i]);
  return (
    <View style={styles.gap}>
      <Text style={styles.kicker}>Step {i + 1} of {steps.length}</Text>
      <Text style={styles.h1}>{steps[i]}</Text>
      <Text style={styles.muted}>Each step sends onboarding_step with its number.</Text>
      <View style={{ height: 24 }} />
      <Button
        label={i < steps.length - 1 ? 'Continue' : 'Finish'}
        onPress={() => {
          if (i < steps.length - 1) setI(i + 1);
          else {
            Shipstat.track('onboarding_completed');
            onDone();
          }
        }}
      />
    </View>
  );
}

function Home({ premium, onPaywall, onSettings, say }: { premium: boolean; onPaywall: () => void; onSettings: () => void; say: (m: string) => void }) {
  const [program, setProgram] = useState<'strength' | 'cardio'>('strength');
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <Text style={styles.h1}>Today</Text>
        <Pressable onPress={onSettings} hitSlop={12}><Text style={styles.link}>Settings</Text></Pressable>
      </View>
      <Text style={styles.muted}>{premium ? 'Premium member' : 'Free plan'}</Text>
      <View style={styles.segment}>
        {(['strength', 'cardio'] as const).map((p) => (
          <Pressable key={p} onPress={() => setProgram(p)} style={[styles.segItem, program === p && styles.segOn]}>
            <Text style={[styles.segText, program === p && styles.segTextOn]}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <Button label="Start workout" onPress={() => { Shipstat.track('workout_started', { program, source: 'home' }); say('workout_started'); }} />
      <Button
        label="Log a set"
        secondary
        onPress={() => {
          const exercise = program === 'strength' ? 'squat' : 'rowing';
          Shipstat.track('set_logged', { exercise, reps: 8 + Math.floor(Math.random() * 5), weight: 40 + Math.floor(Math.random() * 40) });
          say('set_logged');
        }}
      />
      {!premium && <Button label="Unlock advanced plans" accent onPress={onPaywall} />}
      <Button label="Share progress" secondary onPress={() => { Shipstat.track('share_tapped', { target: 'messages' }); say('share_tapped'); }} />
    </View>
  );
}

function Paywall({ variant, onBuy, onClose }: { variant: 'A' | 'B'; onBuy: (plan: string, price: number) => void; onClose: () => void }) {
  return (
    <View style={styles.gap}>
      <Text style={styles.kicker}>Variant {variant}</Text>
      {variant === 'A' ? (
        <>
          <Text style={styles.h1}>Go Premium</Text>
          <Text style={styles.muted}>Advanced plans, history and coaching tips.</Text>
          <View style={{ height: 12 }} />
          <Button label="Yearly · 59.99 €" onPress={() => onBuy('yearly', 59.99)} />
          <Button label="Monthly · 9.99 €" secondary onPress={() => onBuy('monthly', 9.99)} />
        </>
      ) : (
        <>
          <Text style={styles.h1}>Try Premium free for 7 days</Text>
          <Text style={styles.muted}>Then 59.99 € a year. Cancel anytime.</Text>
          <View style={{ height: 12 }} />
          <Button label="Start my free week" accent onPress={() => onBuy('yearly_trial', 59.99)} />
          <Button label="Monthly · 9.99 €" secondary onPress={() => onBuy('monthly', 9.99)} />
        </>
      )}
      <Pressable onPress={onClose} style={{ alignSelf: 'center', padding: 12 }}><Text style={styles.link}>Not now</Text></Pressable>
    </View>
  );
}

function Settings({ anonId, variant, setVariant, onBack, say }: { anonId: string; variant: 'A' | 'B'; setVariant: (v: 'A' | 'B') => void; onBack: () => void; say: (m: string) => void }) {
  const [signedIn, setSignedIn] = useState(false);
  const [enabled, setEnabled] = useState(true);
  return (
    <View style={styles.gap}>
      <View style={styles.row}>
        <Text style={styles.h1}>Settings</Text>
        <Pressable onPress={onBack} hitSlop={12}><Text style={styles.link}>Done</Text></Pressable>
      </View>
      <Text style={styles.mono}>anon_id {anonId}</Text>
      <Text style={styles.label}>Paywall variant</Text>
      <View style={styles.segment}>
        {(['A', 'B'] as const).map((v) => (
          <Pressable key={v} onPress={() => setVariant(v)} style={[styles.segItem, variant === v && styles.segOn]}>
            <Text style={[styles.segText, variant === v && styles.segTextOn]}>{v}</Text>
          </Pressable>
        ))}
      </View>
      <Button
        label={signedIn ? 'Sign out' : 'Sign in as user_42'}
        secondary
        onPress={() => {
          Shipstat.identify(signedIn ? null : 'user_42');
          setSignedIn(!signedIn);
          say(signedIn ? 'signed out' : 'identify(user_42)');
        }}
      />
      <Button
        label={enabled ? 'Stop analytics (opt out)' : 'Allow analytics'}
        secondary
        onPress={() => {
          Shipstat.setEnabled(!enabled);
          setEnabled(!enabled);
          say(enabled ? 'opted out, queue cleared' : 'analytics on');
        }}
      />
      <Button label="Send now (flush)" secondary onPress={async () => { await Shipstat.flush(); say('flushed'); }} />
    </View>
  );
}

function Button({ label, onPress, secondary, accent }: { label: string; onPress: () => void; secondary?: boolean; accent?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.btn, secondary && styles.btnSecondary, accent && styles.btnAccent, pressed && { opacity: 0.7 }]}>
      <Text style={[styles.btnText, secondary && { color: INK }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fbfaf6' },
  body: { padding: 24, paddingTop: 72 },
  gap: { gap: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { color: ACCENT, fontWeight: '700' },
  h1: { fontSize: 32, fontWeight: '800', letterSpacing: -1.2, color: INK },
  muted: { color: '#6b6c63', fontSize: 15 },
  label: { fontWeight: '700', color: INK, marginTop: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11, color: '#a2a39a' },
  link: { color: INK, fontWeight: '700' },
  segment: { flexDirection: 'row', backgroundColor: '#f1efe8', borderRadius: 999, padding: 4 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { color: '#6b6c63', fontWeight: '700', textTransform: 'capitalize' },
  segTextOn: { color: INK },
  btn: { backgroundColor: INK, paddingVertical: 16, borderRadius: 999, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ebe9e2' },
  btnAccent: { backgroundColor: ACCENT },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  toast: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: INK, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  toastText: { color: '#fff', fontWeight: '700' },
});
