import type { BubbleSpeaker } from '../types/sim';

export const PALETTE = {
  // Warm sunlit beige / linen Pixel-Dots canvas backdrop
  bg: '#F6EFE2',
  bgDeep: '#EAE0CE',
  bgCenterGlow: '#FFFDF7',
  gridDot: '#DFD2BC',
  gridDotTwinkle: '#CBB89A',

  // Core warm neutrals & crisp espresso typography
  cream: '#FFFDF8',
  creamSoft: '#F3E9D8',
  textPrimary: '#2F241D',
  textSecondary: '#6F5E4F',
  slate: '#786758',
  slateMuted: '#A1907E',
  slateDark: '#5A4B3E',
  ink: '#2F241D',

  // Semantic cozy candy accents (rich & crisp on warm beige!)
  mint: '#22A882',
  mintLight: '#9BEED5',
  mintDark: '#147A5B',

  butter: '#F2A93B',
  butterLight: '#FFE39E',
  butterDark: '#B86E10',

  sky: '#3292CE',
  skyLight: '#A8DCFA',
  skyDark: '#1C6291',

  lavender: '#8B5FD6',
  lavenderLight: '#D5C0FA',
  lavenderDark: '#5E38A3',

  coral: '#E05666',
  coralLight: '#FFAEB8',
  coralDark: '#AD2E3F',

  blush: '#F48B9B',

  // Cozy warm cream-wood & sand architecture
  woodLight: '#FFFBF2',
  woodDark: '#DFD1BA',
  woodBorder: '#C7B497',
  woodShadow: '#D2C2A8',
} as const;

export const CONFETTI_COLORS: readonly string[] = [
  PALETTE.mint,
  PALETTE.butter,
  PALETTE.sky,
  PALETTE.lavender,
  PALETTE.coral,
  PALETTE.blush,
] as const;

/** Convert a 6-digit hex color to rgba() with given alpha (0..1). */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface SpeakerTheme {
  accent: string;
  badgeBg: string;
  badgeText: string;
  border: string;
  dot: string;
}

export const SPEAKER_THEMES: Readonly<Record<BubbleSpeaker, SpeakerTheme>> = {
  buddy: {
    accent: PALETTE.butterDark,
    badgeBg: '#FFF2CF',
    badgeText: '#8E5206',
    border: '#DCA034',
    dot: PALETTE.butter,
  },
  cloud: {
    accent: PALETTE.skyDark,
    badgeBg: '#E4F4FF',
    badgeText: '#175A86',
    border: '#5BA9DB',
    dot: PALETTE.sky,
  },
  guard: {
    accent: PALETTE.mintDark,
    badgeBg: '#E1F7EF',
    badgeText: '#126B50',
    border: '#42B793',
    dot: PALETTE.mint,
  },
  ai: {
    accent: PALETTE.lavenderDark,
    badgeBg: '#F0E8FF',
    badgeText: '#5A349E',
    border: '#9C75E0',
    dot: PALETTE.lavender,
  },
  system: {
    accent: PALETTE.textPrimary,
    badgeBg: '#F3E9D8',
    badgeText: '#4F4035',
    border: '#C5B092',
    dot: PALETTE.textSecondary,
  },
};
