import { router } from 'expo-router';

import { Banner } from '../../components/ui/Banner';
import { LargeHeader } from '../../components/ui/LargeHeader';
import { ListRow } from '../../components/ui/ListRow';
import { Screen } from '../../components/ui/Screen';
import { Section } from '../../components/ui/Section';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { useProfile } from '../../hooks/useProfile';
import { awayActive } from '../../lib/api';
import { countryLabel } from '../../lib/countries';
import { languageName } from '../../lib/languages';
import { isExpired } from '../../lib/rules';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Assistant: everything about how calls are answered, one row per area. */
export default function AssistantHub() {
  const profile = useProfile();
  const p = profile.data;
  const go = (href: string) => () => router.push(href as never);

  const activeInstructions = p ? p.instructions.filter((i) => i.enabled && !isExpired(i.expires_at)).length : 0;
  const notes = p ? p.knowledge.filter((k) => k.enabled).length : 0;
  const blocked = p ? p.blocked_numbers.length + p.blocked_prefixes.length : 0;
  const loc = p?.location;

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
          <Section title="Your assistant">
            <ListRow
              icon="person-circle-outline"
              iconTone="primary"
              title="Name and greeting"
              subtitle={`${p.assistant_name} answers for ${p.user_name || 'you'}`}
              chevron
              onPress={go('/persona')}
            />
            <ListRow icon="mic-outline" iconTone="primary" title="Voices" subtitle="Pick a voice per language, or record your own" chevron onPress={go('/voices')} />
            <ListRow
              icon="language-outline"
              iconTone="primary"
              title="Languages"
              subtitle={`Callers: ${p.caller_languages.map(languageName).join(', ')} · You: ${languageName(p.owner_language)}`}
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
