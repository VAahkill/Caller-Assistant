import { Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '../components/ui/Banner';
import { IconButton } from '../components/ui/IconButton';
import { ListRow } from '../components/ui/ListRow';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { Select } from '../components/ui/Select';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { useProfile } from '../hooks/useProfile';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { haptic } from '../lib/haptics';
import { LANGUAGES, languageName, languageNative, moveLanguage, toggleLanguage } from '../lib/languages';

/** Which languages callers speak (ordered: the first is the best guess), the
 *  owner's own language, and live translation. Each change saves at once. */
export default function Languages() {
  const t = useTokens();
  const profile = useProfile();
  const p = profile.data;

  if (!p) {
    return (
      <Screen bottomInset testID="languages">
        {profile.error ? (
          <Banner tone="danger" title="Couldn't load your settings" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
        ) : (
          <SkeletonRows rows={5} />
        )}
      </Screen>
    );
  }

  const chosen = p.caller_languages;
  const others = LANGUAGES.filter((l) => !chosen.includes(l.code));
  const setCallers = (next: string[]) => {
    if (next === chosen) return;
    haptic.tap();
    void profile.patch({ caller_languages: next });
  };

  return (
    <Screen bottomInset refreshing={profile.refreshing} onRefresh={() => void profile.refresh()} testID="languages">
      <Section
        title="Callers speak"
        footer="Your assistant listens for these, in this order, and answers in the language the caller uses. Put the most common first."
      >
        {chosen.map((code, i) => (
          <View key={code} style={[styles.row, { paddingHorizontal: t.space.lg }]}>
            <Pressable
              onPress={() => setCallers(toggleLanguage(chosen, code))}
              disabled={chosen.length === 1}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: true, disabled: chosen.length === 1 }}
              accessibilityLabel={`${languageName(code)}, ${i + 1} of ${chosen.length}`}
              accessibilityHint={chosen.length === 1 ? 'Keep at least one language' : 'Removes it'}
              style={styles.label}
            >
              <Icon name="checkbox" size={22} color={chosen.length === 1 ? t.color.text3 : t.color.primary} />
              <View style={styles.flex}>
                <Text variant="bodyStrong">{languageName(code)}</Text>
                {languageNative(code) !== languageName(code) ? (
                  <Text variant="footnote" color="text2">
                    {languageNative(code)}
                  </Text>
                ) : null}
              </View>
              {i === 0 ? (
                <Text variant="caption" color="primary">
                  First guess
                </Text>
              ) : null}
            </Pressable>
            <IconButton icon="chevron-up" label={`Move ${languageName(code)} up`} size={40} disabled={i === 0} onPress={() => setCallers(moveLanguage(chosen, code, -1))} />
            <IconButton
              icon="chevron-down"
              label={`Move ${languageName(code)} down`}
              size={40}
              disabled={i === chosen.length - 1}
              onPress={() => setCallers(moveLanguage(chosen, code, 1))}
            />
          </View>
        ))}
      </Section>

      {others.length ? (
        <Section title="Add a language">
          {others.map((l) => (
            <ListRow
              key={l.code}
              icon="add"
              iconTone="primary"
              title={l.name}
              subtitle={l.native !== l.name ? l.native : undefined}
              chevron={false}
              accessibilityHint="Adds it to the languages callers speak"
              onPress={() => setCallers(toggleLanguage(chosen, l.code))}
            />
          ))}
        </Section>
      ) : null}

      <Section title="You" footer="Call transcripts, summaries and notifications are shown in this language, and you can reply in it during a call.">
        <View style={{ padding: t.space.lg }}>
          <Select
            label="My language"
            value={p.owner_language}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.name, description: l.native !== l.name ? l.native : undefined }))}
            onChange={(v) => void profile.patch({ owner_language: v }, `You'll read calls in ${languageName(v)}.`)}
            sheetTitle="My language"
          />
        </View>
        <ListRow
          icon="swap-horizontal-outline"
          iconTone="primary"
          title="Translate calls live"
          subtitle={`Show what callers say in ${languageName(p.owner_language)} as they speak`}
          switchValue={p.translate_live}
          onSwitchChange={(v) => void profile.patch({ translate_live: v })}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 60 },
  label: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  flex: { flex: 1 },
});
