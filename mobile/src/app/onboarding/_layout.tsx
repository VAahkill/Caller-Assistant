import { Stack } from 'expo-router';

import { useTokens } from '../../lib/design/theme';

/** First-run setup. Each step draws its own header and progress. */
export default function OnboardingLayout() {
  const t = useTokens();
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: t.color.bg } }} />;
}
