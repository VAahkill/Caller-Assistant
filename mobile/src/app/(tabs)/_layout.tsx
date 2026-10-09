import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, TAB_ICONS, tabBarOptions } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { useLive } from '../../lib/live';
import { shouldShowOnboarding } from '../../lib/onboarding';

type TabName = keyof typeof TAB_ICONS;

const TABS: { name: TabName; title: string }[] = [
  { name: 'index', title: 'Today' },
  { name: 'inbox', title: 'Inbox' },
  { name: 'tasks', title: 'Call for me' },
  { name: 'assistant', title: 'Assistant' },
  { name: 'settings', title: 'Settings' },
];

export default function TabsLayout() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { questions, alerts } = useLive();
  const needsSetup = useNeedsSetup();

  // Wait for the saved settings (a few ms) so the first run never flashes Today.
  if (needsSetup === null) return null;
  if (needsSetup) return <Redirect href="/onboarding" />;

  const needsYou = questions.length + alerts.length;
  return (
    <Tabs screenOptions={tabBarOptions(t, insets.bottom)}>
      {TABS.map(({ name, title }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: name === 'index' && needsYou ? `${title}, ${needsYou} need you` : title,
            tabBarBadge: name === 'index' && needsYou ? needsYou : undefined,
            tabBarIcon: ({ color, focused }) => (
              <Icon name={focused ? TAB_ICONS[name].active : TAB_ICONS[name].idle} size={24} color={String(color)} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

/** First run: no server yet and setup never finished or put off. */
function useNeedsSetup(): boolean | null {
  const [needs, setNeeds] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    shouldShowOnboarding()
      .then((show) => alive && setNeeds(show))
      .catch((e: unknown) => {
        console.warn("Couldn't read the saved settings", e);
        if (alive) setNeeds(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return needs;
}
