import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useServerConfig } from '../../hooks/useServerConfig';
import { api, BAD_ADDRESS, connect, normalizeServerUrl, type ConnectResult } from '../../lib/api';
import { useLive } from '../../lib/live';
import { setupNotifications } from '../../lib/notifications';
import { BottomSheet } from '../ui/BottomSheet';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';

export interface ServerConnectProps {
  /** Shown at the top of the card, e.g. the connection status. */
  header?: ReactNode;
  onConnected?: (r: ConnectResult) => void;
  /** Toast on success (Settings) or stay quiet and let the caller move on (onboarding). */
  toastOnSuccess?: boolean;
}

/** Server address + token (or a pairing code), with every failure explained inline. */
export function ServerConnect({ header, onConnected, toastOnSuccess = true }: ServerConnectProps) {
  const live = useLive();
  const server = useServerConfig();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairSession, setPairSession] = useState(0);

  // Show the saved server once it has been read (and after connecting elsewhere).
  const [shownConfig, setShownConfig] = useState<typeof server.config>(null);
  if (server.config && server.config !== shownConfig) {
    setShownConfig(server.config);
    setUrl(server.config.url);
    setToken(server.config.token);
  }
  // Forgotten in Settings: the token goes too; the address stays to pair again.
  if (!server.config && shownConfig) {
    setShownConfig(null);
    setToken('');
  }

  const doConnect = useAsyncAction(
    async (typedToken?: string) => {
      const r = await connect(url, typedToken ?? token);
      if (r.url) setUrl(r.url);
      if (!r.ok) throw new Error(r.message);
      live.reconnect();
      if (Platform.OS !== 'web') {
        setupNotifications().catch((e: unknown) => console.warn('Notification setup failed', e));
      }
      onConnected?.(r);
      return r;
    },
    { success: toastOnSuccess ? (r) => r.message : undefined, error: false },
  );

  return (
    <Card>
      {header}
      <TextField
        label="Server address"
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.7:8000"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        icon="server-outline"
        clearable
        error={url.trim() && !normalizeServerUrl(url) ? BAD_ADDRESS : null}
        testID="server-url"
      />
      <TextField
        label="Access token"
        value={token}
        onChangeText={setToken}
        placeholder="OPENCALL_API_TOKEN from the .env file"
        autoCapitalize="none"
        autoCorrect={false}
        secret
        icon="key-outline"
        testID="server-token"
      />
      {doConnect.error ? (
        <Text variant="subhead" color="danger" accessibilityLiveRegion="polite" testID="connect-error">
          {doConnect.error}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <Button
          title="Connect"
          icon="link-outline"
          loading={doConnect.busy}
          success={doConnect.succeeded}
          successTitle="Connected"
          disabled={!url.trim()}
          onPress={() => void doConnect.run()}
          style={styles.flex}
          testID="connect"
        />
        <Button
          title="Pair with code"
          variant="tonal"
          icon="keypad-outline"
          disabled={!normalizeServerUrl(url)}
          onPress={() => {
            setPairSession((n) => n + 1);
            setPairing(true);
          }}
          style={styles.flex}
        />
      </View>
      <PairSheet
        key={pairSession}
        visible={pairing}
        url={normalizeServerUrl(url) ?? ''}
        onClose={() => setPairing(false)}
        onPaired={(newToken) => {
          setPairing(false);
          setToken(newToken);
          void doConnect.run(newToken);
        }}
      />
    </Card>
  );
}

function PairSheet({ visible, url, onClose, onPaired }: { visible: boolean; url: string; onClose: () => void; onPaired: (token: string) => void }) {
  const [code, setCode] = useState('');
  const [asked, setAsked] = useState(false);
  const start = useAsyncAction(() => api.pairStart(url), { error: false });
  const finish = useAsyncAction(() => api.pairFinish(url, code), { error: false });

  const ask = async () => {
    if (await start.run()) setAsked(true);
  };
  const submit = async () => {
    const r = await finish.run();
    if (r) onPaired(r.token);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Pair with a code" subtitle="No need to type the long token.">
      <View style={styles.sheet}>
        <Text variant="body" color="text2">
          1. Ask the server for a code. It appears in the server's window or log, valid for 5 minutes.
        </Text>
        <Button title={asked ? 'Ask for a new code' : 'Get a code'} variant={asked ? 'tonal' : 'filled'} icon="keypad-outline" loading={start.busy} onPress={() => void ask()} />
        {start.error ? (
          <Text variant="subhead" color="danger">
            {start.error}
          </Text>
        ) : null}
        <Text variant="body" color="text2">
          2. Type the 6-digit code here.
        </Text>
        <TextField
          label="Pairing code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="482913"
          maxLength={6}
          error={finish.error}
        />
        <Button title="Pair" icon="checkmark" loading={finish.busy} disabled={code.length !== 6} onPress={() => void submit()} fullWidth />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  sheet: { gap: 14 },
});
