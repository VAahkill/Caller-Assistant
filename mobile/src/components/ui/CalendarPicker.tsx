import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { END_TIMES, WEEKDAYS, endsAt, isFutureEnd, monthGrid, monthTitle, shiftMonth, splitExpiry, type EndTime } from '../../lib/calendar';
import { useTokens } from '../../lib/design/theme';
import { haptic } from '../../lib/haptics';
import { Chip } from './Chip';
import { IconButton } from './IconButton';
import { Text } from './Text';

export interface CalendarPickerProps {
  /** Epoch seconds, or null before a day is picked. */
  value: number | null;
  onChange: (expiresAt: number) => void;
  /** Months ahead that can be shown. */
  monthsAhead?: number;
  testID?: string;
}

/** A month calendar and an end time, for "ends on" dates. Days before today
 *  can't be picked. Plain JS, so it looks the same on every phone. */
export function CalendarPicker({ value, onChange, monthsAhead = 12, testID }: CalendarPickerProps) {
  const t = useTokens();
  const c = t.color;
  // Read once when the calendar opens; a sheet is not left open across midnight.
  const [now] = useState(() => Date.now());
  const picked = value != null ? splitExpiry(value) : null;
  const start = new Date(picked?.day ?? now);
  const [shown, setShown] = useState<[number, number]>([start.getFullYear(), start.getMonth()]);
  const [year, month] = shown;
  const thisMonth = new Date(now);
  const atFirst = year === thisMonth.getFullYear() && month === thisMonth.getMonth();
  const last = shiftMonth(thisMonth.getFullYear(), thisMonth.getMonth(), monthsAhead);
  const atLast = year === last[0] && month === last[1];
  const end: EndTime = picked?.end ?? 'night';

  const pickDay = (time: number) => {
    haptic.tap();
    // Keep the end time, unless it has already gone by on that day.
    const keep = isFutureEnd(time, end, now) ? end : 'night';
    onChange(endsAt(time, keep));
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <IconButton icon="chevron-back" label="Previous month" size={40} disabled={atFirst} onPress={() => setShown(shiftMonth(year, month, -1))} />
        <Text variant="headline" accessibilityRole="header" style={styles.title}>
          {monthTitle(year, month)}
        </Text>
        <IconButton icon="chevron-forward" label="Next month" size={40} disabled={atLast} onPress={() => setShown(shiftMonth(year, month, 1))} />
      </View>
      <View style={styles.row}>
        {WEEKDAYS.map((d) => (
          <Text key={d} variant="caption" color="text3" style={styles.weekday}>
            {d.slice(0, 2)}
          </Text>
        ))}
      </View>
      {monthGrid(year, month, now).map((week) => (
        <View key={week[0].time} style={styles.row}>
          {week.map((d) => {
            const selected = picked?.day === d.time;
            const label = new Date(d.time).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' });
            return (
              <View key={d.time} style={styles.cell}>
                {d.inMonth ? (
                  <Pressable
                    onPress={() => pickDay(d.time)}
                    disabled={d.past}
                    accessibilityRole="button"
                    accessibilityLabel={d.isToday ? `Today, ${label}` : label}
                    accessibilityState={{ selected, disabled: d.past }}
                    style={({ pressed }) => [
                      styles.day,
                      {
                        backgroundColor: selected ? c.primary : pressed ? c.surface3 : 'transparent',
                        borderColor: d.isToday && !selected ? c.primary : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      variant="callout"
                      weight={selected || d.isToday ? 'semibold' : 'regular'}
                      color={selected ? c.onPrimary : d.past ? c.text3 : d.isToday ? c.primary : c.text}
                      tabular
                    >
                      {d.day}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      {picked ? (
        <View style={styles.times}>
          <Text variant="overline" color="text2">
            At
          </Text>
          <View style={styles.chips}>
            {END_TIMES.map((x) => (
              <Chip
                key={x.value}
                label={x.label}
                selected={end === x.value}
                disabled={!isFutureEnd(picked.day, x.value, now)}
                onPress={() => onChange(endsAt(picked.day, x.value))}
              />
            ))}
          </View>
        </View>
      ) : (
        <Text variant="footnote" color="text2">
          Pick the day it should stop.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', paddingVertical: 4 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 44 },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  times: { gap: 8, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
