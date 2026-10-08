import Constants from 'expo-constants';
import { StyleSheet, View } from 'react-native';

import { ServerConnect } from '../../components/domain/ServerConnect';
import { Button } from '../../components/ui/Button';
import { LargeHeader } from '../../components/ui/LargeHeader';
import { ListRow } from '../../components/ui/ListRow';
import { Screen } from '../../components/ui/Screen';
import { Section } from '../../components/ui/Section';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { StatusPill } from '../../components/ui/StatusPill';
import { Text } from '../../components/ui/Text';
import { useToast } from '../../components/ui/Toast';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useResource } from '../../hooks/useResource';
import { useServerConfig } from '../../hooks/useServerConfig';
import { api } from '../../lib/api';
import { useThemePreference, type ThemePreference } from '../../lib/design/theme';
import { dialerName } from '../../lib/format';
import { useLive } from '../../lib/live';
import { sendTestNotification } from '../../lib/notifications';

/** Settings: the server connection, notifications, appearance and diagnostics. */
export default function Settings() {
  const toast = useToast();
  const live = useLive();
  const server = useServerConfig();
  const theme = useThemePreference();
  const configured = !!server.config;
  const health = useResource(() => api.health(), `${live.connected}-${server.config?.url}`, configured);

  const test = useAsyncAction(sendTestNotification, { success: 'Sent. Check your notification shade.' });

  const h = health.data;
  const appVersion = Constants.expoConfig?.version ?? '';
  return (
    <Screen topInset testID="settings">
      <LargeHeader title="Settings" />

      <Section
        title="Your server"
        footer="The address of the computer running OpenCall, like http://192.168.1.7:8000 at home or your tunnel address."
        grouped={false}
      >
        <ServerConnect
          onConnected={() => void health.reload()}
          header={
            <View style={styles.status}>
              <StatusPill
                label={!configured ? 'Not connected' : live.connected ? 'Connected' : 'Reconnecting'}
                tone={!configured ? 'neutral' : live.connected ? 'success' : 'warning'}
                dot
                pulse={configured && !live.connected}
              />
              {h?.version ? (
                <Text variant="footnote" color="text2">
                  Server {h.version}
                </Text>
              ) : null}
            </View>
          }
        />
      </Section>

      {configured ? (
        <Section title="Connection">
          <ListRow icon="pulse-outline" title="Live updates" value={live.connected ? 'On' : 'Reconnecting'} />
          <ListRow icon="call-outline" title="Outbound calling" value={h ? dialerName(h.dialer) : '…'} />
          <ListRow
            icon="hardware-chip-outline"
            title="Speech and AI"
            value={!h ? '…' : !h.ready ? 'Unknown' : Object.values(h.ready).every(Boolean) ? 'All ready' : 'Starting up'}
          />
        </Section>
      ) : null}

      <Section title="Notifications" footer="Calls, questions from callers and security alerts arrive as notifications, even when the app is closed.">
        <ListRow
          icon="notifications-outline"
          title="Send a test notification"
          trailing={<Button title="Send" variant="tonal" size="sm" loading={test.busy} onPress={() => void test.run()} />}
        />
      </Section>

      <Section title="Appearance">
        <View style={styles.pad}>
          <SegmentedControl<ThemePreference>
            accessibilityLabel="Theme"
            value={theme.preference}
            onChange={(v) => {
              theme.setPreference(v).catch((e: unknown) => {
                console.warn("Couldn't save the theme", e);
                toast.error("Couldn't save the theme on this phone.");
              });
            }}
            segments={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </View>
      </Section>

      <Section title="About" footer="Server logs: on the computer, run docker compose logs -f backend.">
        <ListRow icon="information-circle-outline" title="App version" value={appVersion} />
        {h?.llm_model ? <ListRow icon="sparkles-outline" title="Language model" subtitle={h.llm_model} /> : null}
        <ListRow icon="logo-github" title="Free and open source" subtitle="Runs on your own computer. No paid services." />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pad: { padding: 12 },
});
