import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { api, awayActive } from '../lib/api';
import { AWAY_PRESETS, DURATIONS, awayMessage, spokenTime, untilFor, type AwayPreset, type Duration } from '../lib/away';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { haptic } from '../lib/haptics';

/** Away: a status callers hear ("In a meeting until 3 PM"); the assistant takes messages. */
export default function Away() {
  const t = useTokens();
  const profile = useProfile();
  const p = profile.data;
  const [preset, setPreset] = useState<AwayPreset>(AWAY_PRESETS[0]);
  const [length, setLength] = useState<Duration>(AWAY_PRESETS[0].defaultFor);
  const [custom, setCustom] = useState<string | null>(null);
  // Changing a status that is on starts from what it is now (once, when it loads).
  const [seeded, setSeeded] = useState(false);
  if (p && !seeded) {
    setSeeded(true);
    const now = awayActive(p.away) ? AWAY_PRESETS.find((x) => x.id === p.away?.preset) : undefined;
    if (now) {
      setPreset(now);
      setLength(now.defaultFor);
    }
  }

  const until = untilFor(length);
  const message = custom ?? awayMessage(preset.phrase, until);

  const setAway = useAsyncAction(
    async () => {
      const next = await api.putAway({ preset: custom != null ? 'custom' : preset.id, message: message.trim(), until });
      profile.mutate(() => next);
      return next;
    },
    { success: (next) => `Away: ${next.away?.message ?? message}. Your assistant takes messages.` },
  );
  const clear = useAsyncAction(
    async () => {
      const next = await api.clearAway();
      profile.mutate(() => next);
    },
    { success: "You're back. Calls are handled as usual." },
  );

  if (!p) {
    return (
      <Screen bottomInset testID="away">
        {profile.error ? (
          <Banner tone="danger" title="Couldn't load your status" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
        ) : (
          <SkeletonRows rows={4} />
        )}
      </Screen>
    );
  }

  const active = awayActive(p.away) ? p.away : null;
  const pick = (next: AwayPreset) => {
    haptic.tap();
    setPreset(next);
    setLength(next.defaultFor);
    setCustom(null);
  };

  return (
    <Screen
      bottomInset
      footer={
        <Button
          title={active ? 'Update away status' : 'Set away'}
          icon="moon"
          fullWidth
          loading={setAway.busy}
          disabled={!message.trim()}
          onPress={() => void setAway.run()}
        />
      }
      testID="away"
    >
      {active ? (
        <Card tone="warning">
          <View style={styles.row}>
            <Icon name="moon" size={22} color={t.color.onWarningContainer} />
            <View style={styles.flex}>
              <Text variant="overline" color="onWarningContainer">
                You are away
              </Text>
              <Text variant="headline" color="onWarningContainer">
                {active.message}
              </Text>
              {/* The end time, unless the message already says it ("In a meeting until 3 PM"). */}
              {active.until && active.message.includes(spokenTime(active.until)) ? null : (
                <Text variant="footnote" color="onWarningContainer">
                  {active.until ? `Ends at ${spokenTime(active.until)}` : 'Until you turn it off'}
                </Text>
              )}
            </View>
          </View>
          <Button title="I'm back" icon="sunny-outline" variant="filled" loading={clear.busy} onPress={() => void clear.run()} />
        </Card>
      ) : null}

      <Section title={active ? 'Change it' : 'What are you doing?'} grouped={false}>
        <View style={styles.grid}>
          {AWAY_PRESETS.map((x) => {
            const on = x.id === preset.id && custom == null;
            return (
              <Pressable
                key={x.id}
                onPress={() => pick(x)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={x.label}
                style={[
                  styles.tile,
                  {
                    backgroundColor: on ? t.color.primaryContainer : t.color.surface,
                    borderColor: on ? t.color.primary : t.color.border,
                    borderRadius: t.radius.md,
                  },
                ]}
              >
                <Icon name={x.icon} size={22} color={on ? t.color.onPrimaryContainer : t.color.text2} />
                <Text variant="callout" color={on ? 'onPrimaryContainer' : 'text'}>
                  {x.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title={active ? 'For how long, from now?' : 'For how long?'} grouped={false}>
        <View style={styles.chips}>
          {DURATIONS.map((d) => (
            <Chip
              key={String(d.value)}
              label={d.label}
              selected={length === d.value}
              onPress={() => {
                setLength(d.value);
                setCustom(null);
              }}
            />
          ))}
        </View>
      </Section>

      <Section title={active ? 'What callers will hear' : 'What callers hear'} grouped={false}>
        <TextField
          label={active ? 'New away message' : 'Away message'}
          value={message}
          onChangeText={setCustom}
          maxLength={120}
          helper={`${p.assistant_name} says this, then offers to take a message. You still get an urgent alert when a VIP calls.`}
        />
        <Text variant="footnote" color="text2">
          Want it to share more, like when you are usually free?{' '}
          <Text variant="footnote" color="primary" onPress={() => router.push('/notes')} accessibilityRole="link">
            Add a note
          </Text>
        </Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderWidth: 1, minHeight: 56 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
