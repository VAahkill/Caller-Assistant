import { useAudioPlayer, useAudioPlayerStatus, type AudioSource } from 'expo-audio';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { useTokens } from '../../lib/design/theme';
import { duration as fmt } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { IconButton } from './IconButton';
import { Text } from './Text';

const RATES = [1, 1.5, 2] as const;

export interface AudioPlayerProps {
  /** A URL, a file:// URI or { uri, headers } (use headers for the server token). */
  source: AudioSource;
  title?: string;
  subtitle?: string;
  /** Seconds, if known before the file loads. */
  knownDuration?: number | null;
  /** Hide the speed button, e.g. for short voice samples. */
  speed?: boolean;
  testID?: string;
}

/** Play/pause, a seekable progress bar, elapsed and total time, and speed. */
export function AudioPlayer({ source, title, subtitle, knownDuration, speed = true, testID }: AudioPlayerProps) {
  const t = useTokens();
  const c = t.color;
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [barWidth, setBarWidth] = useState(0);

  const total = status.duration > 0 ? status.duration : (knownDuration ?? 0);
  const position = Math.min(status.currentTime, total || status.currentTime);
  const progress = total > 0 ? Math.min(1, position / total) : 0;
  const atEnd = total > 0 && position >= total - 0.05;

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (atEnd || status.didJustFinish) await player.seekTo(0);
    player.play();
  };

  const seek = async (x: number) => {
    if (!barWidth || !total) return;
    haptic.tap();
    await player.seekTo(Math.max(0, Math.min(total, (x / barWidth) * total)));
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    player.setPlaybackRate(next);
  };

  return (
    <View testID={testID} style={[styles.wrap, { backgroundColor: c.surface2, borderRadius: t.radius.lg }]}>
      <IconButton
        icon={status.playing ? 'pause' : 'play'}
        label={status.playing ? `Pause ${title ?? 'recording'}` : `Play ${title ?? 'recording'}`}
        variant="filled"
        size={44}
        iconSize={22}
        loading={status.playing && status.isBuffering}
        onPress={() => {
          void toggle();
        }}
        testID={testID ? `${testID}-toggle` : undefined}
      />
      <View style={styles.body}>
        {title ? (
          <View style={styles.titleRow}>
            <Text variant="callout" weight="semibold" numberOfLines={1} style={styles.flex}>
              {title}
            </Text>
            {subtitle ? (
              <Text variant="caption" color="text2" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{ min: 0, max: Math.round(total), now: Math.round(position), text: `${fmt(position)} of ${fmt(total)}` }}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
          onPress={(e) => {
            void seek(e.nativeEvent.locationX);
          }}
          hitSlop={{ top: 12, bottom: 12 }}
          style={styles.barZone}
        >
          <View style={[styles.track, { backgroundColor: c.surface3 }]}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: c.primary }]} />
          </View>
        </Pressable>
        <View style={styles.times}>
          <Text variant="caption" color="text2" tabular>
            {fmt(position)}
          </Text>
          <Text variant="caption" color="text2" tabular>
            {total ? fmt(total) : status.isLoaded ? '--:--' : 'Loading…'}
          </Text>
        </View>
      </View>
      {speed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${rate} times`}
          onPress={() => {
            haptic.tap();
            cycleRate();
          }}
          hitSlop={8}
          style={[styles.rate, { borderColor: c.border, borderRadius: t.radius.sm }]}
        >
          <Text variant="caption" weight="semibold" color="text2" tabular>
            {rate}x
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  barZone: { paddingVertical: 6, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  rate: { minWidth: 40, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingHorizontal: 6 },
});
