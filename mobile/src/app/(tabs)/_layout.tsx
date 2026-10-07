import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { useLive } from '../../lib/live';
import { useTheme } from '../../lib/theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  const { questions } = useLive();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: icon('☎'), tabBarBadge: questions.length || undefined }}
      />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: icon('☰') }} />
      <Tabs.Screen name="tasks" options={{ title: 'Call for me', tabBarIcon: icon('↗') }} />
      <Tabs.Screen name="assistant" options={{ title: 'Assistant', tabBarIcon: icon('✦') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
