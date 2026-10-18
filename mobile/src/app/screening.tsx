import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ContactPicker } from '../components/domain/ContactPicker';
import { Banner } from '../components/ui/Banner';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { CountryPicker } from '../components/ui/CountryPicker';
import { IconButton } from '../components/ui/IconButton';
import { ListRow } from '../components/ui/ListRow';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { api } from '../lib/api';
import { lastSync, syncContacts, type LastSync } from '../lib/contacts';
import { useTokens } from '../lib/design/theme';
import { prettyNumber, timeAgo } from '../lib/format';
import { contactName, isDialable, normalizeNumber, normalizePrefix, sameNumber, type NamedNumber } from '../lib/phone';

type AddKind = 'vip' | 'block' | 'prefix';

/** Who gets through: country, international and unknown callers, contacts,
 *  VIPs and blocks. Switches save at once; lists change one entry at a time. */
export default function Screening() {
  const t = useTokens();
  const toast = useToast();
  const profile = useProfile();
  const p = profile.data;
  const [synced, setSynced] = useState<LastSync | null>(null);
  const [denied, setDenied] = useState<{ message: string; settings: boolean } | null>(null);
  const [adding, setAdding] = useState<AddKind | null>(null);

  useEffect(() => {
    lastSync()
      .then(setSynced)
      .catch((e: unknown) => console.warn("Couldn't read the last contacts sync", e));
  }, []);

  const sync = useAsyncAction(
    async () => {
      setDenied(null);
      const r = await syncContacts(profile.data?.home_country_code);
      if (!r.ok) {
        setDenied({ message: r.message, settings: !r.canAskAgain });
        return null;
      }
      setSynced({ at: r.at, count: r.count });
      // Names for VIPs, blocks and the contact pickers come from the server's copy.
      void profile.reload();
      return r;
    },
    { success: (r) => (r ? `Synced ${r.count} numbers. Saved contacts always get through.` : ''), error: (e) => `Sync failed. ${errorMessage(e)}` },
  );

  if (!p) {
    return (
      <Screen bottomInset testID="screening">
        {profile.error ? (
          <Banner tone="danger" title="Couldn't load your settings" message={profile.error} action={{ label: 'Retry', onPress: () => void profile.reload() }} />
        ) : (
          <SkeletonRows rows={6} />
        )}
      </Screen>
    );
  }

  const unblock = async (number: string) => {
    profile.mutate((d) => (d ? { ...d, blocked_numbers: d.blocked_numbers.filter((n) => n !== number) } : d));
    try {
      const next = await api.unblockNumber(number);
      profile.mutate(() => next);
      toast.undo(`Unblocked ${prettyNumber(number)}.`, () => {
        api
          .blockNumber(number)
          .then((back) => profile.mutate(() => back))
          .catch((e: unknown) => toast.error(`Couldn't block it again. ${errorMessage(e)}`));
      });
    } catch (e) {
      void profile.reload();
      toast.error(`Not unblocked. ${errorMessage(e)}`);
    }
  };

  const removeFrom = (key: 'vip_numbers' | 'blocked_prefixes', value: string, label: string) => {
    const before = p[key];
    void profile.patch({ [key]: before.filter((x) => x !== value) }).then((ok) => {
      if (ok) toast.undo(label, () => void profile.patch({ [key]: before }));
    });
  };

  const homeCc = p.home_country_code;
  const who = (n: string) => contactName(p.contacts, n, homeCc) ?? prettyNumber(n);
  const add = async (kind: AddKind, value: string) => {
    if (kind === 'block') {
      if (p.blocked_numbers.some((n) => sameNumber(n, value, homeCc))) throw new Error('Already blocked.');
      const next = await api.blockNumber(value);
      profile.mutate(() => next);
      toast.success(`Blocked ${who(value)}. Your assistant won't answer it.`);
    } else {
      const key = kind === 'vip' ? 'vip_numbers' : 'blocked_prefixes';
      if (p[key].some((x) => (kind === 'vip' ? sameNumber(x, value, homeCc) : x === value))) throw new Error('Already on the list.');
      const ok = await profile.patch({ [key]: [...p[key], value] }, kind === 'vip' ? `${who(value)} is now a VIP.` : `Blocking numbers starting ${value}.`);
      if (!ok) throw new Error('Not saved.');
    }
    setAdding(null);
  };

  return (
    <Screen bottomInset refreshing={profile.refreshing} onRefresh={() => void profile.refresh()} testID="screening">
      <Section title="Country" grouped={false}>
        <CountryPicker value={p.home_country_code} onChange={(dial) => void profile.patch({ home_country_code: dial }, 'Country saved.')} />
      </Section>

      <Section title="Who the assistant answers">
        <ListRow
          icon="globe-outline"
          iconTone="warning"
          title="Block international calls"
          subtitle="Calls from outside your country are declined"
          switchValue={p.block_international}
          onSwitchChange={(v) => void profile.patch({ block_international: v })}
        />
        <ListRow
          icon="help-circle-outline"
          iconTone="primary"
          title="Answer unknown numbers"
          subtitle={p.answer_unknown_numbers ? 'It screens them and takes a message' : 'Only saved contacts and VIPs get through'}
          switchValue={p.answer_unknown_numbers}
          onSwitchChange={(v) => void profile.patch({ answer_unknown_numbers: v })}
        />
      </Section>

      <Section title="Contacts" footer="Names and numbers only. Saved contacts always get through and are greeted by name.">
        <ListRow
          icon="people-outline"
          iconTone="success"
          title="Sync contacts"
          subtitle={
            synced
              ? `Last synced ${timeAgo(synced.at)} · ${synced.count} numbers`
              : p.contacts.length
                ? `${p.contacts.length} numbers on your server`
                : 'Not synced yet'
          }
          trailing={<Button title={sync.busy ? 'Syncing' : 'Sync now'} size="sm" variant="tonal" icon="sync" loading={sync.busy} onPress={() => void sync.run()} />}
          testID="contacts-sync"
        />
      </Section>
      {denied ? (
        <Banner
          tone="warning"
          title={denied.message}
          action={denied.settings ? { label: 'Open Settings', onPress: () => void Linking.openSettings() } : { label: 'Try again', onPress: () => void sync.run() }}
          onDismiss={() => setDenied(null)}
        />
      ) : null}

      <Section
        title="VIPs"
        footer="You get an urgent notification when a VIP calls, and the assistant knows they matter."
        action={{ label: 'Add', onPress: () => setAdding('vip') }}
      >
        {p.vip_numbers.length ? (
          p.vip_numbers.map((n) => (
            <NumberRow key={n} icon="star" number={n} name={contactName(p.contacts, n, homeCc)} onRemove={() => removeFrom('vip_numbers', n, `Removed ${prettyNumber(n)} from VIPs.`)} />
          ))
        ) : (
          <EmptyRow text="No VIPs yet." />
        )}
      </Section>

      <Section title="Blocked" action={{ label: 'Add', onPress: () => setAdding('block') }}>
        {p.blocked_numbers.length || p.blocked_prefixes.length ? (
          <>
            {p.blocked_numbers.map((n) => (
              <NumberRow key={n} icon="ban" number={n} name={contactName(p.contacts, n, homeCc)} onRemove={() => void unblock(n)} removeLabel="Unblock" />
            ))}
            {p.blocked_prefixes.map((prefix) => (
              <NumberRow
                key={`prefix-${prefix}`}
                icon="funnel-outline"
                number={prefix}
                note="Every number starting with this"
                onRemove={() => removeFrom('blocked_prefixes', prefix, `Stopped blocking ${prefix}.`)}
                removeLabel="Unblock"
                raw
              />
            ))}
          </>
        ) : (
          <EmptyRow text="Nothing blocked. Spam and loan calls are declined automatically." />
        )}
      </Section>
      <View style={{ height: t.space.lg }} />

      <AddNumberSheet
        kind={adding}
        contacts={p.contacts}
        homeCc={homeCc}
        onSyncContacts={() => {
          setAdding(null);
          void sync.run();
        }}
        onClose={() => setAdding(null)}
        onAdd={add}
        onKind={setAdding}
      />
    </Screen>
  );
}

function NumberRow({
  icon,
  number,
  name,
  note,
  onRemove,
  removeLabel = 'Remove',
  raw,
}: {
  icon: 'star' | 'ban' | 'funnel-outline';
  number: string;
  /** A saved contact's name: shown as the title, with the number under it. */
  name?: string;
  /** A line under the number, e.g. what a blocked prefix means. */
  note?: string;
  onRemove: () => void;
  removeLabel?: string;
  raw?: boolean;
}) {
  const shown = raw ? number : prettyNumber(number);
  return (
    <ListRow
      icon={icon}
      iconTone={icon === 'star' ? 'warning' : 'danger'}
      title={name || shown}
      subtitle={name ? shown : note}
      trailing={<IconButton icon="close" label={`${removeLabel} ${shown}`} onPress={onRemove} />}
    />
  );
}

function EmptyRow({ text }: { text: string }) {
  const t = useTokens();
  return (
    <View style={{ padding: t.space.lg }}>
      <Text variant="subhead" color="text2">
        {text}
      </Text>
    </View>
  );
}

function AddNumberSheet({
  kind,
  contacts,
  homeCc,
  onSyncContacts,
  onClose,
  onAdd,
  onKind,
}: {
  kind: AddKind | null;
  contacts: NamedNumber[];
  homeCc: string;
  onSyncContacts: () => void;
  onClose: () => void;
  onAdd: (kind: AddKind, value: string) => Promise<void>;
  onKind: (k: AddKind) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Switching between VIP, number and prefix starts the field afresh.
  const [shownKind, setShownKind] = useState(kind);
  if (kind !== shownKind) {
    setShownKind(kind);
    setText('');
    setError(null);
  }

  // Saved in the server's form, so "098665 54433" and "+91 98665 54433" are one number.
  const value = kind === 'prefix' ? normalizePrefix(text, homeCc) : normalizeNumber(text, homeCc);
  const valid = kind === 'prefix' ? value.replace(/\D/g, '').length >= 3 : isDialable(text);
  const name = kind !== 'prefix' && valid ? contactName(contacts, value, homeCc) : undefined;

  const submit = async (number = value) => {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(kind, number);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const blocking = kind === 'block' || kind === 'prefix';
  return (
    <BottomSheet visible={!!kind} onClose={onClose} title={kind === 'vip' ? 'Add a VIP' : 'Block'}>
      <View style={styles.sheet}>
        {blocking ? (
          <SegmentedControl
            segments={[
              { value: 'block', label: 'One number' },
              { value: 'prefix', label: 'Numbers starting with' },
            ]}
            value={kind === 'prefix' ? 'prefix' : 'block'}
            onChange={(v) => onKind(v as AddKind)}
            accessibilityLabel="What to block"
          />
        ) : null}
        <TextField
          label={kind === 'prefix' ? 'Starts with' : 'Phone number'}
          value={text}
          onChangeText={setText}
          keyboardType="phone-pad"
          autoFocus
          placeholder={kind === 'prefix' ? '+92 or 140' : '+91 98480 12345'}
          helper={
            valid
              ? kind === 'prefix'
                ? `Blocks every number starting ${value}.`
                : `Saved as ${prettyNumber(value)}${name ? ` (${name})` : ''}.`
              : kind === 'prefix'
                ? 'For example 140, the series telemarketers use in India.'
                : 'Include the country code for numbers from abroad.'
          }
          error={error}
        />
        <Button
          title={kind === 'vip' ? 'Add VIP' : 'Block'}
          variant={blocking ? 'destructive' : 'filled'}
          icon={kind === 'vip' ? 'star' : 'ban'}
          fullWidth
          loading={busy}
          disabled={!valid}
          onPress={() => void submit()}
        />
        {kind === 'vip' || kind === 'block' ? (
          <View style={styles.sheet}>
            <Text variant="overline" color="text2">
              Or pick from your contacts
            </Text>
            <ContactPicker contacts={contacts} homeCc={homeCc} onPick={(n) => void submit(n)} onSyncContacts={onSyncContacts} pageSize={4} testID="add-from-contacts" />
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: 16 },
});
