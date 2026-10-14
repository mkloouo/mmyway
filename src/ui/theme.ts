// Design tokens. The single source of colour, type and spacing for every screen.
// Screens never write a literal hex; they read from useTheme().
import { useColorScheme } from 'react-native';

interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Outline of an unselected chip or tag. */
  borderStrong: string;
  /** Search field and round close button fill. */
  fill: string;
  border: string;
  accent: string;
  accentSoft: string;
  /** Accent text on accentSoft (a selected chip or tag). */
  accentStrong: string;
  /** A disabled primary button's fill. */
  accentDisabled: string;
  /** Text/icon color for content placed on an accent-filled surface (a primary button, the FAB). */
  onAccent: string;
  income: string;
  /** Background behind an income icon or badge. */
  incomeSoft: string;
  transfer: string;
  /** Background behind a transfer icon or badge. */
  transferSoft: string;
  /** Background behind a neutral (uncategorised) icon. */
  neutralSoft: string;
  warn: string;
  warnSoft: string;
  /** Warn text on warnSoft (a queued badge). */
  warnStrong: string;
  danger: string;
  dangerSoft: string;
  /** Text/icon color for content placed on a danger-filled surface (a swipe-to-delete reveal). */
  onDanger: string;
  scrim: string;
  /** Behind a full-screen photo (a receipt): black in both schemes, so the image reads true. */
  photoBackdrop: string;
  /** Text/icon color on a photo (the receipt viewer's close button and title). */
  onPhoto: string;
  /** Translucent control fill on a photo (the receipt viewer's remove button). */
  photoControl: string;
  /** Destructive text/icon on a photo. */
  onPhotoDanger: string;
  /** Tile tint: purple (Rules, Subscriptions). */
  purple: string;
  purpleSoft: string;
  /** Tile tint: ink (Lock the app). */
  ink: string;
  inkSoft: string;
}

const light: Palette = {
  bg: '#F5F5F3',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEFEC',
  text: '#14151A',
  textMuted: '#6B6F76',
  textFaint: '#9AA0A6',
  borderStrong: '#C9C9C4',
  fill: '#E8E8E4',
  border: '#E3E3DF',
  accent: '#4C5BD4',
  accentSoft: '#E7E9FB',
  accentStrong: '#3A48B8',
  accentDisabled: '#B9BFEA',
  onAccent: '#FFFFFF',
  income: '#2E8B57',
  incomeSoft: '#E6F2EA',
  transfer: '#3B82F6',
  transferSoft: '#E8F0FE',
  neutralSoft: '#F0F0EE',
  warn: '#B45309',
  warnSoft: '#FDF0DC',
  warnStrong: '#8A4006',
  danger: '#C2413A',
  dangerSoft: '#FBE9E7',
  onDanger: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.40)',
  photoBackdrop: '#0B0B0D',
  onPhoto: '#FFFFFF',
  photoControl: 'rgba(255, 255, 255, 0.12)',
  onPhotoDanger: '#FF8A80',
  purple: '#7C5BD4',
  purpleSoft: '#EDE8FA',
  ink: '#14151A',
  inkSoft: '#EFEFEC',
};

const dark: Palette = {
  bg: '#0F1013',
  surface: '#191B1F',
  surfaceAlt: '#23262B',
  text: '#F2F3F5',
  textMuted: '#A0A5AD',
  textFaint: '#71767E',
  borderStrong: '#3A3F47',
  fill: '#23262B',
  border: '#2C3037',
  accent: '#8B95F7',
  accentSoft: '#262B4A',
  accentStrong: '#8B95F7',
  accentDisabled: '#3A4170',
  onAccent: '#0F1013',
  income: '#4ADE80',
  incomeSoft: '#1B3B2B',
  transfer: '#60A5FA',
  transferSoft: '#1B2C4B',
  neutralSoft: '#2A2A2E',
  warn: '#FBBF24',
  warnSoft: '#3A2C10',
  warnStrong: '#FBBF24',
  danger: '#F87171',
  dangerSoft: '#3A1E1C',
  onDanger: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.60)',
  photoBackdrop: '#0B0B0D',
  onPhoto: '#FFFFFF',
  photoControl: 'rgba(255, 255, 255, 0.12)',
  onPhotoDanger: '#FF8A80',
  purple: '#A78BFA',
  purpleSoft: '#2E2248',
  ink: '#F2F3F5',
  inkSoft: '#23262B',
};

const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
const radius = { xs: 8, sm: 10, button: 12, md: 14, lg: 22, pill: 999 } as const;
/** Smallest comfortable touch target (design §3.3). */
export const hitSize = 44;

// Money always renders with tabular figures so columns line up down a list.
const tabular = { fontVariant: ['tabular-nums' as const] };

const type = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700' as const, ...tabular },
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700' as const },
  amount: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, ...tabular },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 17, fontWeight: '500' as const },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 0.6 },
  money: tabular,
} as const;

interface Theme {
  dark: boolean;
  color: Palette;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
}

function themeFor(scheme: string | null | undefined): Theme {
  const isDark = scheme === 'dark';
  return { dark: isDark, color: isDark ? dark : light, space, radius, type };
}

const LIGHT = themeFor('light');
const DARK = themeFor('dark');

/** One object per scheme, so a theme passed down or used as a dependency keeps its identity. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}
