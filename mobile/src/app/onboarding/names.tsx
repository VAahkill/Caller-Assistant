import { router } from 'expo-router';
import { useState } from 'react';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { Card } from '../../components/ui/Card';
import { Text } from '../../components/ui/Text';
import { TextField } from '../../components/ui/TextField';
import { useProfile } from '../../hooks/useProfile';
import { greetingLine, ownName } from '../../lib/labels';
import { stepHref } from '../../lib/onboarding';

/** Your name and the assistant's name, with the greeting callers will hear. */
export default function NamesStep() {
  const profile = useProfile();
  const p = profile.data;
  const [user, setUser] = useState('');
  const [assistant, setAssistant] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (p && !loaded) {
    setLoaded(true);
    setUser(ownName(p.user_name));
    setAssistant(p.assistant_name);
  }

  const next = async () => {
    if (p && (user.trim() !== ownName(p.user_name) || assistant.trim() !== p.assistant_name)) {
      setSaving(true);
      const ok = await profile.patch({ user_name: user.trim(), assistant_name: assistant.trim() });
      setSaving(false);
      if (!ok) return;
    }
    router.push(stepHref('region') as never);
  };

  return (
    <OnboardingFrame
      step="names"
      title="You and your assistant"
      subtitle="Callers hear both names when it picks up."
      primary={{ title: 'Continue', loading: saving, disabled: !p || !user.trim() || !assistant.trim(), onPress: () => void next() }}
    >
      <TextField
        label="Your name"
        value={user}
        onChangeText={setUser}
        autoCapitalize="words"
        autoComplete="name"
        maxLength={40}
        placeholder="Arjun"
        helper="How your assistant refers to you, e.g. Arjun's assistant."
        testID="names-user"
      />
      <TextField
        label="Assistant's name"
        value={assistant}
        onChangeText={setAssistant}
        autoCapitalize="words"
        maxLength={40}
        placeholder="Ava"
        helper="A short, friendly name callers can say back."
        testID="names-assistant"
      />
      <Card tone="primary">
        <Text variant="overline" color="onPrimaryContainer">
          Callers hear
        </Text>
        <Text variant="body" color="onPrimaryContainer">
          {greetingLine(user, assistant)}
        </Text>
      </Card>
      {profile.error && !p ? (
        <Text variant="subhead" color="danger">
          {profile.error}
        </Text>
      ) : null}
    </OnboardingFrame>
  );
}
