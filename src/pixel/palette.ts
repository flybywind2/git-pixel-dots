import type { BubbleSpeaker } from '../types/sim';

export const PALETTE = {
  // Warm cozy Pixel-Dots canvas backdrop
  bg: '#161B2B',
  bgDeep: '#101422',
  bgCenterGlow: '#202842',
  gridDot: '#232B42',
  gridDotTwinkle: '#374569',

  // Core warm neutrals
  cream: '#FFF8EB',
  creamSoft: '#EDE2CE',
  slate: '#94A3B8',
  slateMuted: '#64748B',
  slateDark: '#475569',
  ink: '#171C2C',

  // Semantic cozy candy accents
  mint: '#5CE1B8',
  mintLight: '#9BF2D6',
  mintDark: '#2E9F7D',

  butter: '#FFD166',
  butterLight: '#FFE6A3',
  butterDark: '#D19A2E',

  sky: '#6BCBFF',
  skyLight: '#ADE3FF',
  skyDark: '#368DC4',

  lavender: '#C39BFF',
  lavenderLight: '#DFC9FF',
  lavenderDark: '#875ED1',

  coral: '#FF7B89',
  coralLight: '#FFB0B9',
  coralDark: '#C94B5A',

  blush: '#FF9EAA',

  // Cozy wood & stone architecture
  woodLight: '#36415E',
  woodDark: '#273049',
  woodBorder: '#4A587D',
  woodShadow: '#121726',
} as const;

export const CONFETTI_COLORS: readonly string[] = [
  PALETTE.mint,
  PALETTE.butter,
  PALETTE.sky,
  PALETTE.lavender,
  PALETTE.coral,
  PALETTE.cream,
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
    accent: PALETTE.butter,
    badgeBg: 'rgba(255, 209, 102, 0.16)',
    badgeText: PALETTE.butter,
    border: 'rgba(255, 209, 102, 0.55)',
    dot: PALETTE.butter,
  },
  cloud: {
    accent: PALETTE.sky,
    badgeBg: 'rgba(107, 203, 255, 0.16)',
    badgeText: PALETTE.sky,
    border: 'rgba(107, 203, 255, 0.55)',
    dot: PALETTE.sky,
  },
  guard: {
    accent: PALETTE.mint,
    badgeBg: 'rgba(92, 225, 184, 0.16)',
    badgeText: PALETTE.mint,
    border: 'rgba(92, 225, 184, 0.55)',
    dot: PALETTE.mint,
  },
  ai: {
    accent: PALETTE.lavender,
    badgeBg: 'rgba(195, 155, 255, 0.18)',
    badgeText: PALETTE.lavender,
    border: 'rgba(195, 155, 255, 0.58)',
    dot: PALETTE.lavender,
  },
  system: {
    accent: PALETTE.cream,
    badgeBg: 'rgba(255, 248, 235, 0.14)',
    badgeText: PALETTE.cream,
    border: 'rgba(148, 163, 184, 0.5)',
    dot: PALETTE.cream,
  },
};
