import { useColorScheme } from 'react-native';

const light = {
  bg: '#F7F7FB',
  card: '#FFFFFF',
  text: '#14141F',
  muted: '#6B6B80',
  border: '#E4E4EE',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
  caller: '#EEF0F6',
  assistant: '#E0E7FF',
  user: '#DCFCE7',
  warn: '#FEF3C7',
  warnText: '#92400E',
  danger: '#DC2626',
  ok: '#16A34A',
};

const dark: typeof light = {
  bg: '#0E0E14',
  card: '#191922',
  text: '#F2F2F7',
  muted: '#A0A0B4',
  border: '#2A2A36',
  primary: '#818CF8',
  primaryText: '#0E0E14',
  caller: '#22222E',
  assistant: '#2B2F5E',
  user: '#1E3B2A',
  warn: '#3A2E10',
  warnText: '#FCD34D',
  danger: '#F87171',
  ok: '#4ADE80',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}
