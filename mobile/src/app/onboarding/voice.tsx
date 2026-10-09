import { router } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { VoiceLanguageGroup, demoSources, visibleVoices } from '../../components/domain/VoicePicker';
import { AsyncContent } from '../../components/ui/AsyncContent';
import { ListRow } from '../../components/ui/ListRow';
import { Section } from '../../components/ui/Section';
import { useToast } from '../../components/ui/Toast';
import { useDemoPlayer, usePreloadedSources } from '../../hooks/useDemoPlayer';
import { useProfile } from '../../hooks/useProfile';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import { languageName } from '../../lib/languages';
import { useLive } from '../../lib/live';
import { stepHref } from '../../lib/onboarding';
import type { VoiceInfo } from '../../lib/types';
import { choosePatch, chosenVoiceId, voiceGroups } from '../../lib/voices';

/** Voices shown per language here; the Voices screen has all of them. */
export const ONBOARDING_VOICES_PER_LANGUAGE = 3;

/** Pick how the assistant sounds for each language callers speak, with demos
 *  that play at once. Recording your own voice is a tap away. */
export default function VoiceStep() {
  const toast = useToast();
  const { voicesKey } = useLive();
  const voices = useResource(() => api.voices(), voicesKey);
  const profile = useProfile();
  const onDemoError = useCallback((message: string) => toast.error(message), [toast]);
  const demo = useDemoPlayer(onDemoError);
  const p = profile.data;

  const groups = useMemo(
    () => voiceGroups(voices.data ?? [], p?.caller_languages ?? []).filter((g) => g.primary),
    [voices.data, p?.caller_languages],
  );
  const shown = useMemo(
    () => groups.map((g) => ({ ...g, voices: visibleVoices(g, p ? chosenVoiceId(p, g.lang) : undefined, ONBOARDING_VOICES_PER_LANGUAGE) })),
    [groups, p],
  );
  usePreloadedSources(useMemo(() => demoSources(shown), [shown]));

  const choose = (v: VoiceInfo, lang: string) => {
    if (!p || chosenVoiceId(p, lang) === v.id) return;
    void profile.patch(choosePatch(p, lang, v.id), `${v.name} will answer ${languageName(lang)} callers.`);
  };

  return (
    <OnboardingFrame
      step="voice"
      title="Choose a voice"
      subtitle="Tap play to hear one, tap again to stop. Pick one for each language your callers speak."
      primary={{ title: 'Continue', onPress: () => router.push(stepHref('done') as never) }}
    >
      <AsyncContent
        data={voices.data && p ? voices.data : undefined}
        loading={voices.loading || profile.loading}
        error={voices.error ?? profile.error}
        onRetry={() => void Promise.all([voices.reload(), profile.reload()])}
        isEmpty={() => shown.every((g) => g.voices.length === 0)}
        empty={{ icon: 'mic-off-outline', title: 'No voices on your server yet', message: 'It may still be starting up. You can pick voices later in Assistant, Voices.' }}
      >
        {() =>
          shown.map((g) => (
            <VoiceLanguageGroup
              key={g.lang}
              group={groups.find((x) => x.lang === g.lang) ?? g}
              chosen={p ? chosenVoiceId(p, g.lang) : undefined}
              demo={demo}
              onChoose={(v) => choose(v, g.lang)}
              limit={ONBOARDING_VOICES_PER_LANGUAGE}
            />
          ))
        }
      </AsyncContent>
      <Section>
        <ListRow
          icon="mic-outline"
          iconTone="primary"
          title="Use your own voice"
          subtitle="Record 15 seconds and your assistant can speak in it"
          chevron
          onPress={() => {
            demo.stop();
            router.push('/voices');
          }}
        />
      </Section>
    </OnboardingFrame>
  );
}
