import { Pressable, StyleSheet, View } from 'react-native';

import type { DemoPlayer } from '../../hooks/useDemoPlayer';
import { api, type MediaSource } from '../../lib/api';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { duration } from '../../lib/format';
import { engineName } from '../../lib/labels';
import { languageName } from '../../lib/languages';
import type { VoiceInfo } from '../../lib/types';
import { preloadable, samplePathFor, type VoiceGroup } from '../../lib/voices';
import { IconButton } from '../ui/IconButton';
import { Section } from '../ui/Section';
import { Text } from '../ui/Text';

/** The demo player's key for a voice's demo in one language. */
export const sampleKey = (id: string, lang: string) => `${id}@${lang}`;

export interface VoiceLanguageGroupProps {
  group: VoiceGroup;
  /** The voice picked for this language. */
  chosen?: string;
  demo: DemoPlayer;
  onChoose: (v: VoiceInfo) => void;
  /** Show only the first few voices (onboarding); the picked one is always shown. */
  limit?: number;
}

/** One language: its voices as radio rows, each with a demo that plays at once. */
export function VoiceLanguageGroup({ group, chosen, demo, onChoose, limit }: VoiceLanguageGroupProps) {
  const name = languageName(group.lang);
  const picked = group.voices.some((v) => v.id === chosen);
  const shown = visibleVoices(group, chosen, limit);
  return (
    <Section
      // English name only: the overline's letter spacing breaks Indic scripts apart.
      title={name}
      footer={
        group.voices.length === 0
          ? undefined
          : picked
            ? `Used when callers speak ${name}.`
            : `Not picked yet: your server uses its default ${name} voice.`
      }
      testID={`voices-${group.lang}`}
    >
      {group.voices.length === 0 ? (
        <View style={styles.none}>
          <Text variant="subhead" color="text2">
            No {name} voice on your server yet. Callers who speak {name} hear the closest voice it has.
          </Text>
        </View>
      ) : (
        shown.map((v) => <VoiceRow key={v.id} voice={v} lang={group.lang} chosen={chosen === v.id} demo={demo} onChoose={() => onChoose(v)} />)
      )}
    </Section>
  );
}

export function VoiceRow({ voice: v, lang, chosen, demo, onChoose }: { voice: VoiceInfo; lang: string; chosen: boolean; demo: DemoPlayer; onChoose: () => void }) {
  const t = useTokens();
  const key = sampleKey(v.id, lang);
  const phase = demo.phaseOf(key);
  const mine = v.kind === 'clone';
  const meta = mine
    ? ['Your voice', v.seconds ? `${duration(v.seconds)} recording` : null]
    : [v.gender && v.gender.charAt(0).toUpperCase() + v.gender.slice(1), v.engine && engineName(v.engine)];
  return (
    <View testID={`voice-${v.id}-${lang}`}>
      <Pressable
        onPress={onChoose}
        accessibilityRole="radio"
        accessibilityState={{ checked: chosen }}
        accessibilityLabel={`${v.name}${mine ? ', your voice' : v.gender ? `, ${v.gender}` : ''}, for ${languageName(lang)}`}
        android_ripple={{ color: t.color.surface3 }}
        style={[styles.voiceRow, { paddingHorizontal: t.space.lg }]}
      >
        <Icon name={chosen ? 'radio-button-on' : 'radio-button-off'} size={22} color={chosen ? t.color.primary : t.color.text3} />
        <View style={styles.flex}>
          <Text variant="headline">{v.name}</Text>
          <Text variant="footnote" color={phase === 'error' ? 'danger' : 'text2'}>
            {phase === 'playing' ? 'Playing…' : phase === 'loading' ? 'Loading…' : phase === 'error' ? "Couldn't play. Tap to try again." : meta.filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton
          icon={phase === 'playing' || phase === 'loading' ? 'stop' : phase === 'error' ? 'refresh' : 'play'}
          label={phase === 'playing' || phase === 'loading' ? `Stop ${v.name}` : `Play ${v.name}`}
          variant="tonal"
          loading={phase === 'loading'}
          onPress={() => demo.toggle(key, api.voiceSample({ sample_url: samplePathFor(v, lang) }))}
          testID={`play-${v.id}-${lang}`}
        />
      </Pressable>
      {phase === 'playing' ? <ProgressLine value={demo.progress} /> : null}
    </View>
  );
}

/** A thin bar showing how far through a demo the player is. */
export function ProgressLine({ value }: { value: number }) {
  const t = useTokens();
  return (
    <View
      style={[styles.progress, { backgroundColor: t.color.surface3 }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
    >
      <View style={[styles.progressFill, { width: `${Math.round(value * 100)}%`, backgroundColor: t.color.primary }]} />
    </View>
  );
}

/** The voices a group shows: the first `limit` (all without one), plus the picked one. */
export function visibleVoices(group: VoiceGroup, chosen?: string, limit?: number): VoiceInfo[] {
  return limit ? group.voices.filter((v, i) => i < limit || v.id === chosen) : group.voices;
}

/** The demo of each voice shown, in list order, as sources to preload so a
 *  tap plays at once. Demos the server makes on demand are left out. */
export function demoSources(shown: { lang: string; voices: VoiceInfo[] }[]): MediaSource[] {
  const out = new Map<string, MediaSource>();
  for (const g of shown) {
    for (const v of g.voices) {
      const path = samplePathFor(v, g.lang);
      const s = preloadable(path) ? api.voiceSample({ sample_url: path }) : null;
      if (s && v.status === 'ready') out.set(s.uri, s);
    }
  }
  return [...out.values()];
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 8 },
  none: { padding: 16 },
  progress: { height: 3, borderRadius: 2, overflow: 'hidden', marginHorizontal: 16, marginBottom: 6 },
  progressFill: { height: 3, borderRadius: 2 },
});
