import { router } from 'expo-router';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { ListRow } from '../../components/ui/ListRow';
import { Section } from '../../components/ui/Section';

// STUB(B4): pick the assistant's voice right here, with instant demos per
// language (the Voices screen has the full picker and recording flow).
export default function VoiceStep() {
  return (
    <OnboardingFrame step="voice" title="Choose a voice" subtitle="Pick how your assistant sounds in each language, or record your own voice.">
      <Section>
        <ListRow icon="mic-outline" iconTone="primary" title="Open Voices" subtitle="Hear the demos and pick one per language" chevron onPress={() => router.push('/voices')} />
      </Section>
    </OnboardingFrame>
  );
}
