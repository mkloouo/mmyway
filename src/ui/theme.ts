// Design tokens. The single source of colour, type and spacing for every screen —
// see docs/superpowers/designs/2026-09-27-mmyway-ui-design.md §3.
// Screens never write a literal hex; they read from useTheme().
import { useColorScheme } from 'react-native';

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  accent: string;
  accentSoft: string;
  income: string;
  transfer: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
}

const light: Palette = {
  bg: '#F5F5F3',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEFEC',
  text: '#14151A',
  textMuted: '#6B6F76',
  textFaint: '#9AA0A6',
  border: '#E3E3DF',
  accent: '#4C5BD4',
  accentSoft: '#E7E9FB',
  income: '#2E8B57',
  transfer: '#3B82F6',
  warn: '#B45309',
  warnSoft: '#FDF0DC',
  danger: '#C2413A',
  dangerSoft: '#FBE9E7',
};

const dark: Palette = {
  bg: '#0F1013',
  surface: '#191B1F',
  surfaceAlt: '#23262B',
  text: '#F2F3F5',
  textMuted: '#A0A5AD',
  textFaint: '#71767E',
  border: '#2C3037',
  accent: '#8B95F7',
  accentSoft: '#262B4A',
  income: '#4ADE80',
  transfer: '#60A5FA',
  warn: '#FBBF24',
  warnSoft: '#3A2C10',
  danger: '#F87171',
  dangerSoft: '#3A1E1C',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 22, pill: 999 } as const;
/** Smallest comfortable touch target (design §3.3). */
export const hitSize = 44;

// Money always renders with tabular figures so columns line up down a list.
const tabular = { fontVariant: ['tabular-nums' as const] };

export const type = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700' as const, ...tabular },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '500' as const },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.6 },
  money: tabular,
} as const;

export interface Theme {
  dark: boolean;
  color: Palette;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
}

export function themeFor(scheme: string | null | undefined): Theme {
  const isDark = scheme === 'dark';
  return { dark: isDark, color: isDark ? dark : light, space, radius, type };
}

export function useTheme(): Theme {
  return themeFor(useColorScheme());
}
