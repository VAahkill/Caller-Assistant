import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';

import { READY_PARTS, ReadinessSheet } from '../../components/domain/ReadinessSheet';
import { OutdatedServerBanner } from '../../components/domain/ServerNotices';
import { ServerConnect } from '../../components/domain/ServerConnect';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/ConfirmSheet';
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
import { clearConfig } from '../../lib/api';
import { useThemePreference, type ThemePreference } from '../../lib/design/theme';
import { checkHealth, diagnosticsText, LOGS_COMMAND, speedWord } from '../../lib/diagnostics';
import { clockTime } from '../../lib/format';
import { useLive } from '../../lib/live';
import { firstVersion, phoneLineText, serverOutdated } from '../../lib/serverStatus';
import { allowNotifications, notificationAccess, sendTestNotification, type NotificationAccess } from '../../lib/notifications';

const ACCESS_WORD: Record<NotificationAccess, string> = {
  allowed: 'Allowed',
  ask: 'Not allowed yet',
  blocked: 'Off',
  unsupported: 'Android app only',
};

/** Settings: the server connection and its health, notifications, appearance,
 *  and what someone helping with a problem needs to know. */
export default function Settings() {
  const toast = useToast();
  const confirm = useConfirm();
  const live = useLive();
  const server = useServerConfig();
  const theme = useThemePreference();
  const configured = !!server.config;
  const health = useResource(() => checkHealth(), `${live.connected}-${server.config?.url}`, configured);
  const [partsOpen, setPartsOpen] = useState(false);

  // Notification permission, read again when the owner comes back from Android settings.
  const access = useResource(notificationAccess);
  const reloadAccess = access.reload;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reloadAccess();
    });
    return () => sub.remove();
  }, [reloadAccess]);
  const allow = useAsyncAction(allowNotifications, { success: 'Notifications are on.' });
  const test = useAsyncAction(sendTestNotification, { success: 'Sent. Check your notification shade.' });

  const forgetAction = useAsyncAction(
    async () => {
      await clearConfig();
      live.reconnect();
    },
    { success: 'This phone forgot the server.' },
  );
  const forget = async () => {
    const yes = await confirm({
      title: 'Forget this server?',
      message: 'This phone stops getting calls and alerts until you connect again. Nothing on the server is deleted.',
      confirmLabel: 'Forget',
      destructive: true,
      icon: 'trash-outline',
    });
    if (yes) await forgetAction.run();
  };

  const appVersion = Constants.expoConfig?.version ?? '';
  const copyLogs = useAsyncAction(() => Clipboard.setStringAsync(LOGS_COMMAND), { success: 'Copied the command.' });
  const copyReport = useAsyncAction(
    () =>
      Clipboard.setStringAsync(
        diagnosticsText({
          appVersion,
          platform: Platform.OS === 'android' ? `Android (API ${Platform.Version})` : Platform.OS,
          config: server.config,
          connected: live.connected,
          check: health.data ?? null,
          error: health.error,
        }),
      ),
    { success: 'Copied. Paste it in a message or an issue. Your token is not in it.' },
  );

  const check = health.data;
  const h = check?.health;
  const waiting = health.loading && !check ? 'Checking…' : '–';
  const notReady = h?.ready ? READY_PARTS.filter((p) => !h.ready?.[p.key]) : [];
  const accessNow = access.data;
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
        <Section title="Connection" testID="connection">
          {health.error ? (
            <View style={styles.pad}>
              <Banner tone="danger" title="Your server didn't answer" message={health.error} testID="health-error" />
            </View>
          ) : serverOutdated(h) ? (
            <View style={styles.pad}>
              <OutdatedServerBanner health={h} />
            </View>
          ) : null}
          <ListRow icon="pulse-outline" title="Live updates" value={live.connected ? 'On' : 'Reconnecting'} />
          <ListRow icon="speedometer-outline" title="Response time" value={check ? `${check.ms} ms · ${speedWord(check.ms)}` : waiting} />
          <ListRow icon="call-outline" title="Phone line" value={h ? phoneLineText(h) : waiting} />
          <ListRow icon="people-outline" title="Calls right now" value={h ? String(h.active_calls) : waiting} />
          <ListRow
            icon="hardware-chip-outline"
            title="Speech and AI"
            value={!h ? waiting : !h.ready ? 'Not reported' : notReady.length ? `${READY_PARTS.length - notReady.length} of ${READY_PARTS.length} ready` : 'All ready'}
            onPress={() => setPartsOpen(true)}
            testID="parts"
          />
          <ListRow
            icon="refresh"
            title="Check again"
            subtitle={check ? `Last checked ${clockTime(check.at / 1000)}` : undefined}
            trailing={<Button title="Check" variant="tonal" size="sm" loading={health.refreshing} onPress={() => void health.refresh()} testID="check-again" />}
          />
          <ListRow
            icon="trash-outline"
            iconTone="danger"
            destructive
            title="Forget this server"
            subtitle="Removes the token from this phone. You can pair again any time."
            onPress={() => void forget()}
            disabled={forgetAction.busy}
          />
        </Section>
      ) : null}

      <Section title="Notifications" footer="Calls, questions from callers and security alerts arrive as notifications while the app is open or was used recently. Getting them when it is fully closed needs a build with push set up (see the setup guide).">
        <ListRow
          icon="notifications-outline"
          title="Notifications"
          value={accessNow ? ACCESS_WORD[accessNow] : access.error ? 'Unknown' : 'Checking…'}
          subtitle={access.error ?? (accessNow === 'blocked' ? 'Turned off in Android settings.' : undefined)}
          trailing={
            accessNow === 'ask' ? (
              <Button
                title="Allow"
                variant="tonal"
                size="sm"
                loading={allow.busy}
                onPress={() => void allow.run().then(reloadAccess)}
              />
            ) : accessNow === 'blocked' ? (
              <Button
                title="Open settings"
                variant="tonal"
                size="sm"
                onPress={() =>
                  void Linking.openSettings().catch((e: unknown) => {
                    console.warn("Couldn't open Android settings", e);
                    toast.error("Couldn't open Android settings. Open Settings > Apps > OpenCall > Notifications.");
                  })
                }
              />
            ) : undefined
          }
          testID="notification-access"
        />
        {accessNow !== 'unsupported' ? (
          <ListRow
            icon="paper-plane-outline"
            title="Send a test notification"
            subtitle={test.error ?? undefined}
            trailing={<Button title="Send" variant="tonal" size="sm" loading={test.busy} onPress={() => void test.run()} testID="test-notification" />}
          />
        ) : null}
      </Section>

      <Section title="Appearance" footer="System follows your phone's dark mode setting.">
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

      <Section title="About and diagnostics" testID="about">
        <ListRow icon="phone-portrait-outline" title="App version" value={appVersion || 'Unknown'} />
        {h ? <ListRow icon="server-outline" title="Server version" value={h.version || (firstVersion(h) ? 'First version' : 'Unknown')} /> : null}
        {h?.llm_model ? <ListRow icon="sparkles-outline" title="Language model" subtitle={h.llm_model} /> : null}
        <ListRow
          icon="document-text-outline"
          title="Server logs"
          subtitle={`On the server computer, run ${LOGS_COMMAND}`}
          trailing={<Button title="Copy" variant="tonal" size="sm" loading={copyLogs.busy} onPress={() => void copyLogs.run()} testID="copy-logs" />}
        />
        <ListRow
          icon="clipboard-outline"
          title="Copy diagnostics"
          subtitle="Versions and what is ready, to paste when asking for help. No token."
          onPress={() => void copyReport.run()}
          disabled={copyReport.busy}
          testID="copy-diagnostics"
        />
        <ListRow
          icon="play-circle-outline"
          title="Run first-time setup again"
          subtitle="Names, languages, contacts and voice, step by step."
          onPress={() => router.push('/onboarding')}
        />
        <ListRow icon="logo-github" title="Free and open source" subtitle="Runs on your own computer. No paid services." />
      </Section>

      <ReadinessSheet
        visible={partsOpen}
        onClose={() => setPartsOpen(false)}
        connected={live.connected}
        health={h ?? null}
        error={health.error}
        refreshing={health.refreshing}
        onRefresh={() => void health.refresh()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pad: { padding: 12 },
});
