import { router } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import {
  PHONE_LINE_GUIDE_URL,
  SERVER_OUTDATED_TITLE,
  UPDATE_GUIDE_URL,
  lineUnknown,
  phoneLineDetail,
  serverOutdatedText,
  whyPhoneLine,
} from '../../lib/serverStatus';
import type { Health } from '../../lib/types';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';

/** Opens a guide on GitHub in the browser. */
export function openGuide(url: string): void {
  Linking.openURL(url).catch((e: unknown) => console.warn("Couldn't open the guide", url, e));
}

/** The server is older than 2.1: what that breaks, and where the update steps are. */
export function OutdatedServerBanner({ health, testID = 'server-outdated' }: { health: Health | null | undefined; testID?: string }) {
  return (
    <Banner
      tone="warning"
      icon="cloud-download-outline"
      title={SERVER_OUTDATED_TITLE}
      message={serverOutdatedText(health)}
      action={{ label: 'Open the setup guide', onPress: () => openGuide(UPDATE_GUIDE_URL) }}
      testID={testID}
    />
  );
}

/** Today, when the server has no line for real calls (or is too old to say): why
 *  the app can't answer them itself, what the server found, and the two ways forward. */
export function PhoneLineCard({ assistantName, health }: { assistantName: string; health: Health }) {
  const t = useTokens();
  const c = t.color;
  return (
    <Card testID="phone-line" style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: c.warningContainer }]}>
          <Icon name="call-outline" size={20} color={c.onWarningContainer} />
        </View>
        <View style={styles.flex}>
          <Text variant="headline">
            {lineUnknown(health) ? `Real calls need a phone line` : `Real calls can't reach ${assistantName} yet`}
          </Text>
          <Text variant="subhead" color="text2">
            {whyPhoneLine(assistantName)}
          </Text>
        </View>
      </View>
      <View style={[styles.detail, { backgroundColor: c.surface2, borderRadius: t.radius.md }]}>
        <Icon name="server-outline" size={16} color={c.text2} />
        <Text variant="footnote" color="text2" style={styles.flex}>
          {phoneLineDetail(health)}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Try a practice call" icon="headset-outline" size="sm" onPress={() => router.push('/practice')} />
        <Button title="How to connect a phone line" icon="open-outline" variant="tonal" size="sm" onPress={() => openGuide(PHONE_LINE_GUIDE_URL)} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 2 },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
