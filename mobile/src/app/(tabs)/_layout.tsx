import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, TAB_ICONS, tabBarOptions } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { loadConfig } from '../../lib/api';
import { useLive } from '../../lib/live';
import { onboardingSkipped } from '../../lib/onboarding';

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

/** First run: no server yet and onboarding not skipped. */
function useNeedsSetup(): boolean {
  const [needs, setNeeds] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([loadConfig(), onboardingSkipped()])
      .then(([cfg, skipped]) => alive && setNeeds(!cfg && !skipped))
      .catch((e: unknown) => console.warn("Couldn't read the saved settings", e));
    return () => {
      alive = false;
    };
  }, []);
  return needs;
}
