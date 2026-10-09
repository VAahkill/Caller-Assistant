import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { LargeHeader } from '../../components/ui/LargeHeader';
import { ListRow } from '../../components/ui/ListRow';
import { Screen } from '../../components/ui/Screen';
import { Section } from '../../components/ui/Section';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Text } from '../../components/ui/Text';
import { useProfile } from '../../hooks/useProfile';
import { useResource } from '../../hooks/useResource';
import { api, awayActive } from '../../lib/api';
import { countryLabel } from '../../lib/countries';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { setupChecklist, voiceSummary, type SetupItem } from '../../lib/hub';
import { greetingLine } from '../../lib/labels';
import { languageName } from '../../lib/languages';
import { useLive } from '../../lib/live';
import { isExpired } from '../../lib/rules';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Assistant: everything about how calls are answered, one row per area. */
export default function AssistantHub() {
  const profile = useProfile();
  const { voicesKey } = useLive();
  const voices = useResource(() => api.voices(), voicesKey);
  const p = profile.data;
  const go = (href: string) => () => router.push(href as never);

  const activeInstructions = p ? p.instructions.filter((i) => i.enabled && !isExpired(i.expires_at)).length : 0;
  const notes = p ? p.knowledge.filter((k) => k.enabled).length : 0;
  const blocked = p ? p.blocked_numbers.length + p.blocked_prefixes.length : 0;
  const loc = p?.location;
  const setup = p ? setupChecklist(p) : [];
  const todo = setup.filter((i) => !i.done);

  return (
    <Screen topInset refreshing={profile.refreshing} onRefresh={() => void profile.refresh()} testID="assistant">
      <LargeHeader
        title="Assistant"
        subtitle={p ? `How ${p.assistant_name} answers your calls.` : 'How your assistant answers your calls.'}
      />
      {profile.error && !p ? (
        <Banner tone="danger" title="Couldn't load your settings" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
      ) : null}
      {!p && !profile.error ? (
        <SkeletonRows rows={6} />
      ) : p ? (
        <>
          {todo.length ? <SetupCard items={setup} onOpen={(href) => router.push(href as never)} /> : null}
          <Section title="Your assistant">
            <ListRow
              icon="person-circle-outline"
              iconTone="primary"
              title="Name and greeting"
              subtitle={`${p.assistant_name} answers for ${p.user_name || 'you'}: "${greetingLine(p.user_name, p.assistant_name)}"`}
              chevron
              onPress={go('/persona')}
            />
            <ListRow icon="mic-outline" iconTone="primary" title="Voices" subtitle={voiceSummary(p, voices.data)} chevron onPress={go('/voices')} />
            <ListRow
              icon="language-outline"
              iconTone="primary"
              title="Languages"
              subtitle={`Callers: ${p.caller_languages.map(languageName).join(', ')} · You: ${languageName(p.owner_language)}${p.translate_live ? ' · Live translation on' : ''}`}
              chevron
              onPress={go('/languages')}
            />
          </Section>

          <Section title="What it knows">
            <ListRow
              icon="list-outline"
              iconTone="success"
              title="Instructions"
              subtitle={activeInstructions ? `${plural(activeInstructions, 'rule')} in use` : 'Tell it how to handle calls'}
              chevron
              onPress={go('/instructions')}
            />
            <ListRow
              icon="book-outline"
              iconTone="success"
              title="What callers may know"
              subtitle={notes ? plural(notes, 'note') : 'Facts it may share, and with whom'}
              chevron
              onPress={go('/notes')}
            />
            <ListRow
              icon="location-outline"
              iconTone="success"
              title="Delivery location"
              subtitle={loc && (loc.building || loc.address) ? [loc.floor_unit, loc.building || loc.address].filter(Boolean).join(', ') : 'Pin your door for delivery partners'}
              chevron
              onPress={go('/location')}
            />
          </Section>

          <Section title="Calls">
            <ListRow
              icon="shield-checkmark-outline"
              iconTone="warning"
              title="Who gets through"
              subtitle={`${countryLabel(p.home_country_code)}${blocked ? ` · ${plural(blocked, 'block')}` : ''}`}
              chevron
              onPress={go('/screening')}
            />
            <ListRow
              icon="moon-outline"
              iconTone="warning"
              title="Away"
              subtitle={awayActive(p.away) ? p.away.message : 'Not set'}
              chevron
              onPress={go('/away')}
            />
            <ListRow
              icon="play-circle-outline"
              iconTone="primary"
              title="Practice call"
              subtitle="Play a caller and hear how it answers"
              chevron
              onPress={go('/practice')}
            />
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

/** What is left to set up, with a count; each line opens its screen. */
function SetupCard({ items, onOpen }: { items: SetupItem[]; onOpen: (href: string) => void }) {
  const t = useTokens();
  const done = items.filter((i) => i.done).length;
  return (
    <Card testID="setup-checklist">
      <View style={styles.head}>
        <Text variant="headline" style={styles.flex}>
          Finish setting up
        </Text>
        <Text variant="footnote" color="text2" tabular>
          {done} of {items.length} done
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: t.color.surface3 }]}>
        <View style={[styles.fill, { width: `${(done / items.length) * 100}%`, backgroundColor: t.color.success }]} />
      </View>
      {items
        .filter((i) => !i.done)
        .map((i) => (
          <Pressable
            key={i.id}
            onPress={() => onOpen(i.href)}
            accessibilityRole="button"
            accessibilityLabel={`${i.title}. ${i.detail}`}
            android_ripple={{ color: t.color.surface3 }}
            style={styles.item}
          >
            <Icon name="ellipse-outline" size={20} color={t.color.text3} />
            <View style={styles.flex}>
              <Text variant="callout" weight="semibold">
                {i.title}
              </Text>
              <Text variant="footnote" color="text2">
                {i.detail}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={t.color.text3} />
          </Pressable>
        ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, minHeight: 48 },
});
