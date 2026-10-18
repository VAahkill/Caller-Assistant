import { StyleSheet, View } from 'react-native';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { Chip } from '../../components/ui/Chip';
import { CountryPicker } from '../../components/ui/CountryPicker';
import { Section } from '../../components/ui/Section';
import { Select } from '../../components/ui/Select';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { useProfile } from '../../hooks/useProfile';
import { LANGUAGES, languageName, toggleLanguage } from '../../lib/languages';

/** Home country and languages. Each choice saves at once. */
export default function RegionStep() {
  const profile = useProfile();
  const p = profile.data;
  return (
    <OnboardingFrame step="region" title="Country and languages" subtitle="So your assistant knows local callers and the languages they speak.">
      {!p ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <CountryPicker value={p.home_country_code} onChange={(dial) => void profile.patch({ home_country_code: dial })} />
          <Section title="Callers speak" grouped={false} footer="Tap in order of how often you hear them. You can reorder later in Languages.">
            <View style={styles.chips}>
              {LANGUAGES.map((l) => (
                <Chip
                  key={l.code}
                  label={l.name}
                  selected={p.caller_languages.includes(l.code)}
                  onPress={() => void profile.patch({ caller_languages: toggleLanguage(p.caller_languages, l.code) })}
                />
              ))}
            </View>
          </Section>
          <Select
            label="My language"
            helper="Transcripts and summaries are shown to you in this language."
            value={p.owner_language}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.name, description: l.native !== l.name ? l.native : undefined }))}
            onChange={(v) => void profile.patch({ owner_language: v }, `You'll read calls in ${languageName(v)}.`)}
            sheetTitle="My language"
          />
        </>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
