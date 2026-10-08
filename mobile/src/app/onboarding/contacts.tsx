import { router } from 'expo-router';
import { useState } from 'react';
import { Linking } from 'react-native';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { Banner } from '../../components/ui/Banner';
import { errorMessage, useAsyncAction } from '../../hooks/useAsyncAction';
import { syncContacts } from '../../lib/contacts';
import { stepHref } from '../../lib/onboarding';

/** Sync contacts so saved people always get through and are greeted by name. */
export default function ContactsStep() {
  const [denied, setDenied] = useState<{ message: string; settings: boolean } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const sync = useAsyncAction(
    async () => {
      setDenied(null);
      const r = await syncContacts();
      if (!r.ok) {
        setDenied({ message: r.message, settings: !r.canAskAgain });
        return null;
      }
      setDone(r.count);
      return r;
    },
    { error: (e) => `Sync failed. ${errorMessage(e)}` },
  );

  return (
    <OnboardingFrame
      step="contacts"
      title="Let your contacts through"
      subtitle="Your assistant greets saved contacts by name and never treats them as spam. Only names and numbers are sent, to your own server."
      primary={
        done != null
          ? { title: 'Continue', onPress: () => router.push(stepHref('voice') as never) }
          : { title: 'Sync contacts', icon: 'arrow-forward', loading: sync.busy, onPress: () => void sync.run() }
      }
    >
      {done != null ? <Banner tone="success" title={`Synced ${done} numbers.`} message="Sync again any time from Assistant, Who gets through." /> : null}
      {denied ? (
        <Banner
          tone="warning"
          title={denied.message}
          action={denied.settings ? { label: 'Open Settings', onPress: () => void Linking.openSettings() } : { label: 'Try again', onPress: () => void sync.run() }}
        />
      ) : null}
    </OnboardingFrame>
  );
}
