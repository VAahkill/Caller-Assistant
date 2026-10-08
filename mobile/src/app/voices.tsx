import { clearAllPreloadedSources, preload, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { VoiceRecorderSheet } from '../components/domain/VoiceRecorderSheet';
import { AudioPlayer } from '../components/ui/AudioPlayer';
import { AsyncContent } from '../components/ui/AsyncContent';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { useConfirm } from '../components/ui/ConfirmSheet';
import { IconButton } from '../components/ui/IconButton';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { StatusPill } from '../components/ui/StatusPill';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../hooks/useAsyncAction';
import { useProfile } from '../hooks/useProfile';
import { useResource } from '../hooks/useResource';
import { api, type MediaSource } from '../lib/api';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { duration, timeAgo } from '../lib/format';
import { engineName } from '../lib/labels';
import { languageName } from '../lib/languages';
import type { VoiceInfo } from '../lib/types';

/** Voices: your recorded voices first, then built-in voices by language with instant demos. */
export default function Voices() {
  const t = useTokens();
  const toast = useToast();
  const voices = useResource(() => api.voices());
  const profile = useProfile();
  const [recording, setRecording] = useState(false);
  const [recordSession, setRecordSession] = useState(0);
  const [renaming, setRenaming] = useState<VoiceInfo | null>(null);
  const demo = useDemoPlayer();

  const mine = useMemo(() => (voices.data ?? []).filter((v) => v.kind === 'clone'), [voices.data]);
  const builtIn = useMemo(() => {
    const groups = new Map<string, VoiceInfo[]>();
    for (const v of (voices.data ?? []).filter((x) => x.kind !== 'clone')) {
      const lang = v.languages[0] ?? 'en';
      groups.set(lang, [...(groups.get(lang) ?? []), v]);
    }
    const order = profile.data?.caller_languages ?? [];
    return [...groups.entries()].sort(([a], [b]) => (order.indexOf(a) + 99) % 100 - ((order.indexOf(b) + 99) % 100));
  }, [voices.data, profile.data?.caller_languages]);

  // Fetch every demo as soon as the list arrives, so tapping play starts at once.
  useEffect(() => {
    const sources = (voices.data ?? []).filter((v) => v.status === 'ready').map((v) => api.voiceSample(v)).filter((s): s is MediaSource => !!s);
    // Promise.resolve: the web build's versions return nothing instead of a promise.
    for (const s of sources) {
      Promise.resolve()
        .then(() => preload(s))
        .catch((e: unknown) => console.warn('Voice demo preload failed', s.uri, e));
    }
    return () => {
      Promise.resolve()
        .then(() => clearAllPreloadedSources())
        .catch((e: unknown) => console.warn('Clearing preloaded demos failed', e));
    };
  }, [voices.data]);

  const p = profile.data;
  const chosenFor = (lang: string) => p?.voices_by_language[lang] ?? (lang === 'en' ? p?.voice : undefined);
  const choose = async (v: VoiceInfo, lang: string) => {
    if (!p) return;
    const patch = lang === 'en' ? { voice: v.id, voices_by_language: { ...p.voices_by_language, en: v.id } } : { voices_by_language: { ...p.voices_by_language, [lang]: v.id } };
    await profile.patch(patch, `${v.name} will answer ${languageName(lang)} callers.`);
  };

  const confirm = useConfirm();
  const remove = async (v: VoiceInfo) => {
    const ok = await confirm({
      title: `Delete "${v.name}"?`,
      message: 'The recording and the voice made from it are removed from your server.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    voices.mutate((list) => list?.filter((x) => x.id !== v.id));
    try {
      await api.deleteVoice(v.id);
      toast.success(`Deleted "${v.name}".`);
      void profile.reload();
    } catch (e) {
      voices.mutate((list) => (list ? [v, ...list] : list));
      toast.error(`Couldn't delete: ${errorMessage(e)}`);
    }
  };

  return (
    <Screen bottomInset refreshing={voices.refreshing} onRefresh={() => void voices.refresh()} testID="voices">
      <Section title="My voices" grouped={false}>
        {mine.map((v) => (
          <MyVoiceCard key={v.id} voice={v} onRename={() => setRenaming(v)} onDelete={() => void remove(v)} demo={demo} />
        ))}
        <Card
          onPress={() => {
            setRecordSession((n) => n + 1);
            setRecording(true);
          }}
          accessibilityLabel="Record a new voice"
        >
          <View style={styles.addRow}>
            <View style={[styles.addIcon, { backgroundColor: t.color.primaryContainer }]}>
              <Icon name="mic" size={22} color={t.color.onPrimaryContainer} />
            </View>
            <View style={styles.flex}>
              <Text variant="headline">Record a voice</Text>
              <Text variant="subhead" color="text2">
                Read a short passage for 15 to 30 seconds. Your assistant can then speak in it.
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={t.color.text3} />
          </View>
        </Card>
      </Section>

      <AsyncContent
        data={voices.data}
        loading={voices.loading}
        error={voices.error}
        onRetry={() => void voices.reload()}
        isEmpty={() => builtIn.length === 0}
        empty={{ icon: 'mic-off-outline', title: 'No built-in voices', message: 'The server reported no voices. Check it finished starting up.' }}
      >
        {() =>
          builtIn.map(([lang, list]) => (
            <Section key={lang} title={languageName(lang)}>
              {list.map((v) => (
                <BuiltInRow key={v.id} voice={v} chosen={chosenFor(lang) === v.id} onChoose={() => void choose(v, lang)} demo={demo} />
              ))}
            </Section>
          ))
        }
      </AsyncContent>

      <VoiceRecorderSheet
        key={recordSession}
        visible={recording}
        onClose={() => setRecording(false)}
        onSaved={(v) => {
          setRecording(false);
          voices.mutate((list) => [v, ...(list ?? [])]);
        }}
      />
      <RenameSheet
        voice={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(v) => {
          setRenaming(null);
          voices.mutate((list) => list?.map((x) => (x.id === v.id ? v : x)));
        }}
      />
    </Screen>
  );
}

type Demo = ReturnType<typeof useDemoPlayer>;

/** One player for all demos: tap a row to play, tap again to stop. */
function useDemoPlayer() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  const playing = current && status.playing ? current : null;
  const loading = current && !status.playing && !status.didJustFinish && !status.isLoaded ? current : null;
  const toggle = (key: string, source: MediaSource | null) => {
    if (!source) return;
    if (current === key && status.playing) {
      player.pause();
      setCurrent(null);
      return;
    }
    setCurrent(key);
    player.replace(source);
    player.play();
  };
  return { playing, loading, toggle };
}

function MyVoiceCard({ voice: v, onRename, onDelete, demo }: { voice: VoiceInfo; onRename: () => void; onDelete: () => void; demo: Demo }) {
  const recording = api.voiceRecording(v);
  const key = `${v.id}#sample`;
  return (
    <Card>
      <View style={styles.addRow}>
        <View style={styles.flex}>
          <Text variant="headline" numberOfLines={1}>
            {v.name}
          </Text>
          <Text variant="footnote" color="text2">
            {[v.seconds ? duration(v.seconds) : null, v.created_at ? timeAgo(v.created_at) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <StatusPill
          label={v.status === 'ready' ? 'Ready' : v.status === 'preparing' ? 'Preparing' : 'Failed'}
          tone={v.status === 'ready' ? 'success' : v.status === 'preparing' ? 'info' : 'danger'}
          dot={v.status === 'preparing'}
          pulse={v.status === 'preparing'}
        />
        <IconButton icon="create-outline" label={`Rename ${v.name}`} onPress={onRename} />
        <IconButton icon="trash-outline" label={`Delete ${v.name}`} onPress={onDelete} />
      </View>
      {recording ? <AudioPlayer source={recording} title="Original recording" knownDuration={v.seconds} speed={false} /> : null}
      <Button
        title={demo.playing === key ? 'Stop' : 'Play in the assistant voice'}
        icon={demo.playing === key ? 'stop' : 'sparkles-outline'}
        variant="tonal"
        size="sm"
        loading={demo.loading === key}
        disabled={v.status !== 'ready'}
        onPress={() => demo.toggle(key, api.voiceSample(v))}
      />
    </Card>
  );
}

function BuiltInRow({ voice: v, chosen, onChoose, demo }: { voice: VoiceInfo; chosen: boolean; onChoose: () => void; demo: Demo }) {
  const t = useTokens();
  const playing = demo.playing === v.id;
  return (
    <Pressable
      onPress={onChoose}
      accessibilityRole="radio"
      accessibilityState={{ checked: chosen }}
      accessibilityLabel={`${v.name}${v.gender ? `, ${v.gender}` : ''}`}
      android_ripple={{ color: t.color.surface3 }}
      style={[styles.voiceRow, { paddingHorizontal: t.space.lg }]}
    >
      <Icon name={chosen ? 'radio-button-on' : 'radio-button-off'} size={22} color={chosen ? t.color.primary : t.color.text3} />
      <View style={styles.flex}>
        <Text variant="headline">{v.name}</Text>
        <Text variant="footnote" color="text2">
          {[v.gender && v.gender.charAt(0).toUpperCase() + v.gender.slice(1), v.engine && engineName(v.engine)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <IconButton
        icon={playing ? 'stop' : 'play'}
        label={playing ? `Stop ${v.name}` : `Play ${v.name}`}
        variant="tonal"
        loading={demo.loading === v.id}
        onPress={() => demo.toggle(v.id, api.voiceSample(v))}
      />
    </Pressable>
  );
}

function RenameSheet({ voice, onClose, onRenamed }: { voice: VoiceInfo | null; onClose: () => void; onRenamed: (v: VoiceInfo) => void }) {
  const [name, setName] = useState('');
  const [forVoice, setForVoice] = useState<VoiceInfo | null>(null);
  if (voice && voice !== forVoice) {
    setForVoice(voice);
    setName(voice.name);
  }
  const save = useAsyncAction(() => api.renameVoice(voice!.id, name.trim()), { success: 'Renamed.', error: false });
  return (
    <BottomSheet visible={!!voice} onClose={onClose} title="Rename voice">
      <View style={styles.sheet}>
        <TextField label="Name" value={name} onChangeText={setName} autoFocus maxLength={40} error={save.error} />
        <Button title="Save" loading={save.busy} disabled={!name.trim()} fullWidth onPress={() => void save.run().then((v) => v && onRenamed(v))} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 8 },
  sheet: { gap: 16 },
});
