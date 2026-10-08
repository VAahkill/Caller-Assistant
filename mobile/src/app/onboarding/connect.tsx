import { router } from 'expo-router';

import { OnboardingFrame } from '../../components/domain/OnboardingFrame';
import { ServerConnect } from '../../components/domain/ServerConnect';
import { Banner } from '../../components/ui/Banner';
import { useServerConfig } from '../../hooks/useServerConfig';
import { stepHref } from '../../lib/onboarding';

/** Connect to the OpenCall server on the owner's computer. */
export default function ConnectStep() {
  const server = useServerConfig();
  return (
    <OnboardingFrame
      step="connect"
      title="Connect to your server"
      subtitle="Type the address shown when OpenCall started on your computer, then pair with a code or paste the token."
      primary={{ title: 'Continue', disabled: !server.config, onPress: () => router.push(stepHref('names') as never) }}
    >
      <ServerConnect toastOnSuccess={false} onConnected={() => router.push(stepHref('names') as never)} />
      <Banner
        tone="info"
        icon="wifi-outline"
        title="Phone and computer on the same Wi-Fi?"
        message="At home use the computer's address, like http://192.168.1.7:8000. Away from home, use your tunnel address."
      />
    </OnboardingFrame>
  );
}
