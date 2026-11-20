import { PALETTE } from './palette';

export type SpriteGrid = readonly string[];
export type SpriteColorMap = Readonly<Record<string, string>>;
export type SpriteDrawStyle = 'dot' | 'pixel';

// ---------------------------------------------------------------------------
// 1. GITDOT_BUDDY (12x12) — Cute rounded pixel cat-bot with blinking dot eyes,
//    tiny antenna dot, rosy cheeks, 2-frame hopping legs & expressive poses!
// ---------------------------------------------------------------------------

export const GITDOT_BUDDY_IDLE: SpriteGrid = [
  '.....aa.....',
  '.dd..ss..dd.',
  '.dyyyyyyyyd.',
  '.yyyyyyyyyy.',
  '.yyeyyyyeyy.',
  '.ypyyddyypy.',
  '.yyyyyyyyyy.',
  'dyyyllllyyyd',
  '.dyyllllyyd.',
  '..dyyyyyyd..',
  '...dd..dd...',
  '............',
];

export const GITDOT_BUDDY_HOP: SpriteGrid = [
  '.....aa.....',
  '.dd..ss..dd.',
  '.dyyyyyyyyd.',
  '.yyyyyyyyyy.',
  '.yyeyyyyeyy.',
  '.ypyyddyypy.',
  'dyyyyyyyyyyd',
  '.dyyllllyyd.',
  '..dyylllyd..',
  '..dd....dd..',
  '............',
  '............',
];

export const GITDOT_BUDDY_BLINK: SpriteGrid = [
  '.....aa.....',
  '.dd..ss..dd.',
  '.dyyyyyyyyd.',
  '.yyyyyyyyyy.',
  '.yddyyyyddy.',
  '.ypyyddyypy.',
  '.yyyyyyyyyy.',
  'dyyyllllyyyd',
  '.dyyllllyyd.',
  '..dyyyyyyd..',
  '...dd..dd...',
  '............',
];

export const GITDOT_BUDDY_HAPPY: SpriteGrid = [
  '.....aa.....',
  '.dd..ss..dd.',
  '.dyyyyyyyyd.',
  'dyyeyyyyeyyd',
  'dypyyddyypyd',
  '.yyyyyyyyyy.',
  '.dyyllllyyd.',
  '..dyllllyd..',
  '..dyyyyyyd..',
  '..dd....dd..',
  '............',
  '............',
];

export const GITDOT_BUDDY_SHOCKED: SpriteGrid = [
  '.....aa....w',
  '.dd..ss..ddw',
  '.dyyyyyyyyd.',
  '.yyeeyyeeyy.',
  'dyyewyyewyyd',
  'dypyyeeyypyd',
  '.yyyyyyyyyy.',
  '.dyyllllyyd.',
  '..dyyyyyyd..',
  '..dd....dd..',
  '............',
  '............',
];

export const GITDOT_BUDDY_CARRY: SpriteGrid = [
  '.....aa.....',
  '.dd..ss..dd.',
  '.dyyyyyyyyd.',
  '.yyeyyyyeyy.',
  '.ypyyddyypy.',
  '.yymmmmmmyy.',
  'dyymllllmyyd',
  '.dymmmmmmyd.',
  '..dyyyyyyd..',
  '...dd..dd...',
  '............',
  '............',
];

export const GITDOT_BUDDY_HARDHAT: SpriteGrid = [
  '...hhhhhh...',
  '..hbbbbbbh..',
  '.hhhhhhhhhh.',
  '.yyyyyyyyyy.',
  '.yyeyyyyeyy.',
  '.ypyyddyypy.',
  '.yyyyyyyyyy.',
  'dyyyllllyyyd',
  '.dyyllmmyyd.',
  '..dyyyyyyd..',
  '...dd..dd...',
  '............',
];

export type BuddyPose = 'idle' | 'hop' | 'blink' | 'happy' | 'shocked' | 'carry' | 'hardhat';

export const GITDOT_BUDDY: Readonly<Record<BuddyPose, SpriteGrid>> = {
  idle: GITDOT_BUDDY_IDLE,
  hop: GITDOT_BUDDY_HOP,
  blink: GITDOT_BUDDY_BLINK,
  happy: GITDOT_BUDDY_HAPPY,
  shocked: GITDOT_BUDDY_SHOCKED,
  carry: GITDOT_BUDDY_CARRY,
  hardhat: GITDOT_BUDDY_HARDHAT,
};

export const BUDDY_COLORS: SpriteColorMap = {
  a: PALETTE.mint,
  s: PALETTE.slate,
  y: PALETTE.butter,
  d: PALETTE.butterDark,
  l: PALETTE.cream,
  e: PALETTE.ink,
  p: PALETTE.blush,
  w: PALETTE.sky,
  m: PALETTE.mint,
  h: PALETTE.cream,
  b: PALETTE.sky,
};

// ---------------------------------------------------------------------------
// 2. AI_BOT (10x10) — Cute lavender floating mini AI robot with glowing mint
//    visor eyes & hovering dot thrusters!
// ---------------------------------------------------------------------------

export const AI_BOT: SpriteGrid = [
  '....mm....',
  '..vvvvvv..',
  '.vllllllv.',
  '.veeeeeev.',
  '.vemeeemv.',
  '.veeeeeev.',
  '..vvvvvv..',
  '.svvmmvvs.',
  '...d..d...',
  '...m..m...',
];

export const AI_BOT_HOVER: SpriteGrid = [
  '....ll....',
  '..vvvvvv..',
  '.vllllllv.',
  '.veeeeeev.',
  '.vemeeemv.',
  '.veeeeeev.',
  '..vvvvvv..',
  's.vvmmvv.s',
  '...d..d...',
  '..m....m..',
];

export const AI_BOT_COLORS: SpriteColorMap = {
  v: PALETTE.lavender,
  l: PALETTE.lavenderLight,
  d: PALETTE.lavenderDark,
  e: PALETTE.ink,
  m: PALETTE.mint,
  s: PALETTE.sky,
};

// ---------------------------------------------------------------------------
// 3. FILE_SPRITE (8x9) — Tiny pixel document with folded corner & color lines
// ---------------------------------------------------------------------------

export const FILE_SPRITE: SpriteGrid = [
  'pppppp..',
  'pccccpf.',
  'pccccpff',
  'pcbbbccp',
  'pccccccp',
  'pcbbbbcp',
  'pccccccp',
  'pcbbbccp',
  'pppppppp',
];

export function makeFileColors(
  lineAccent: string,
  borderColor: string = PALETTE.slate,
): SpriteColorMap {
  return {
    p: borderColor,
    c: PALETTE.cream,
    f: PALETTE.creamSoft,
    b: lineAccent,
  };
}

// ---------------------------------------------------------------------------
// 4. BASKET_SPRITE (12x9) — Cozy pixel staging tray / box
// ---------------------------------------------------------------------------

export const BASKET_SPRITE: SpriteGrid = [
  '..mmmmmmmm..',
  '.mllllllllm.',
  'mddddddddddm',
  'mmddddddddmm',
  '.mddddddddm.',
  '.mdmmddmmdm.',
  '.mddddddddm.',
  '..mddddddm..',
  '..mmmmmmmm..',
];

export function makeBasketColors(
  accent: string = PALETTE.mint,
  dark: string = PALETTE.mintDark,
): SpriteColorMap {
  return {
    m: accent,
    l: PALETTE.cream,
    d: dark,
  };
}

// ---------------------------------------------------------------------------
// 5. COMMIT_GEM (9x9) — Sparkling pixel diamond/coin
// ---------------------------------------------------------------------------

export const COMMIT_GEM: SpriteGrid = [
  '....b....',
  '...blb...',
  '..bllcb..',
  '.bllcccb.',
  'bllccccdb',
  '.bccccdb.',
  '..bccdb..',
  '...bdb...',
  '....b....',
];

export function makeGemColors(
  main: string,
  light: string,
  dark: string,
  border: string = PALETTE.cream,
): SpriteColorMap {
  return {
    b: border,
    l: light,
    c: main,
    d: dark,
  };
}

// ---------------------------------------------------------------------------
// 6. CLOUD_CASTLE (18x12) — Cozy pixel GitHub cloud station with tiny flag!
// ---------------------------------------------------------------------------

export const CLOUD_CASTLE: SpriteGrid = [
  '........pfff......',
  '........pff.......',
  '......t.tt.t......',
  '......tttttt......',
  '.....stylltys.....',
  '...sssttttttsss...',
  '..sccccccccccccs..',
  '.scccllccccllcccs.',
  'sccccccccccccccccs',
  'sccccccccccccccccs',
  '.sdddddddddddddds.',
  '..ssssssssssssss..',
];

export const CLOUD_CASTLE_COLORS: SpriteColorMap = {
  f: PALETTE.butter,
  p: PALETTE.cream,
  t: PALETTE.woodLight,
  y: PALETTE.butter,
  l: PALETTE.cream,
  c: PALETTE.sky,
  s: PALETTE.skyLight,
  d: PALETTE.skyDark,
};

// ---------------------------------------------------------------------------
// 7. ROCKET_PR (10x8) — Cute pixel paper-airplane / PR rocket pointing right
// ---------------------------------------------------------------------------

export const ROCKET_PR: SpriteGrid = [
  '..vv......',
  '...vvv....',
  'f.vvvvvv..',
  'ffvvllvvvr',
  'ffvvllvvvr',
  'f.vvvvvv..',
  '...vvv....',
  '..vv......',
];

export function makeRocketColors(body: string = PALETTE.lavender): SpriteColorMap {
  return {
    v: body,
    l: PALETTE.cream,
    r: PALETTE.mint,
    f: PALETTE.butter,
  };
}

// ---------------------------------------------------------------------------
// 8. KEY_CLASSIC (14x7) vs KEY_FINE (11x7)
// ---------------------------------------------------------------------------

export const KEY_CLASSIC: SpriteGrid = [
  '.kkk..........',
  'klllk.........',
  'kl.lkrrrrrrrrr',
  'kl.lkkkkkkkkkk',
  'klllk....kk.kk',
  '.kkk.....k..kk',
  '..........k...',
];

export const KEY_CLASSIC_COLORS: SpriteColorMap = {
  k: PALETTE.butter,
  l: PALETTE.butterLight,
  r: PALETTE.coral,
};

export const KEY_FINE: SpriteGrid = [
  '.mmmmmmmmm.',
  'mlllllllllm',
  'mlccclllllm',
  'mlccclmmmlm',
  'mlllllllllm',
  'mdddddddddm',
  '.mmmmmmmmm.',
];

export const KEY_FINE_COLORS: SpriteColorMap = {
  m: PALETTE.mint,
  l: PALETTE.cream,
  c: PALETTE.butter,
  d: PALETTE.mintDark,
};

// ---------------------------------------------------------------------------
// 9. LOCK_ICON (9x10) — Open & closed pixel padlock
// ---------------------------------------------------------------------------

export const LOCK_CLOSED: SpriteGrid = [
  '..sssss..',
  '.ss...ss.',
  '.s.....s.',
  '.s.....s.',
  'bbbbbbbbb',
  'bcccccccb',
  'bccckcccb',
  'bccckcccb',
  'bdddddddb',
  '.bbbbbbb.',
];

export const LOCK_OPEN: SpriteGrid = [
  '....ssss.',
  '...ss..ss',
  '...s....s',
  '........s',
  'bbbbbbbbb',
  'bcccccccb',
  'bccckcccb',
  'bccckcccb',
  'bdddddddb',
  '.bbbbbbb.',
];

export const LOCK_ICON = {
  closed: LOCK_CLOSED,
  open: LOCK_OPEN,
} as const;

export function makeLockColors(body: string, dark: string): SpriteColorMap {
  return {
    s: PALETTE.slate,
    b: PALETTE.cream,
    c: body,
    d: dark,
    k: PALETTE.ink,
  };
}

// ---------------------------------------------------------------------------
// 10. SHIELD_ICON (10x11) — Pixel security shield with checkmark
// ---------------------------------------------------------------------------

export const SHIELD_ICON: SpriteGrid = [
  '.bbbbbbbb.',
  'bccccccccb',
  'bccccccwcb',
  'bcccccwwcb',
  'bcwccwwccb',
  'bcwwwwwccb',
  '.bcwwwccb.',
  '.bccwccdb.',
  '..bccddb..',
  '...bddb...',
  '....bb....',
];

export function makeShieldColors(
  body: string = PALETTE.mint,
  dark: string = PALETTE.mintDark,
): SpriteColorMap {
  return {
    b: PALETTE.cream,
    c: body,
    d: dark,
    w: PALETTE.cream,
  };
}

// ---------------------------------------------------------------------------
// 11. CASTLE_TOWER (14x14) — Pixel corporate GHES fortress with battlements
// ---------------------------------------------------------------------------

export const CASTLE_TOWER: SpriteGrid = [
  'bb..bb..bb..bb',
  'bb..bb..bb..bb',
  'bbbbbbbbbbbbbb',
  'bwwwwwwwwwwwwb',
  '.bwllwwwwllwb.',
  '.bwllwwwwllwb.',
  '.bwwwwwwwwwwb.',
  '.bwwddddddwwb.',
  '.bwwwwwwwwwwb.',
  '.bwwwddddwwwb.',
  '.bwwddggddwwb.',
  '.bwwddggddwwb.',
  'bwwwddggddwwwb',
  'bbbbbbbbbbbbbb',
];

export function makeCastleColors(connected: boolean): SpriteColorMap {
  return {
    b: connected ? PALETTE.sky : PALETTE.woodBorder,
    w: PALETTE.woodLight,
    d: PALETTE.woodDark,
    l: connected ? PALETTE.butter : PALETTE.slateMuted,
    g: connected ? PALETTE.mint : PALETTE.coralDark,
  };
}

// ---------------------------------------------------------------------------
// Bonus cute mini-sprites: SPARKLE_ICON (5x5) & REMOTE_ICON (6x8)
// ---------------------------------------------------------------------------

export const SPARKLE_ICON: SpriteGrid = [
  '..c..',
  '..l..',
  'clwlc',
  '..l..',
  '..c..',
];

export const REMOTE_ICON: SpriteGrid = [
  '.bbbb.',
  'bddddb',
  'bdrddb',
  'bdggdb',
  'bdyydb',
  'bdssdb',
  'bddddb',
  '.bbbb.',
];

export const REMOTE_COLORS: SpriteColorMap = {
  b: PALETTE.slate,
  d: PALETTE.woodDark,
  r: PALETTE.coral,
  g: PALETTE.mint,
  y: PALETTE.butter,
  s: PALETTE.sky,
};

// ---------------------------------------------------------------------------
// Helper: Rounded rect fill for crisp LED pixel-dots
// ---------------------------------------------------------------------------

function fillRoundedDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, size, size);
  }
}

/**
 * Draws a hand-crafted pixel-dot sprite centered at (cx, cy).
 * - `style = 'dot'` (default): slightly rounded LED dot-matrix tiles with a 1px gap
 *   and subtle inner specular shine for authentic GitDots cozy charm!
 * - `style = 'pixel'`: crisp solid square pixels.
 */
export function drawPixelSprite(
  ctx: CanvasRenderingContext2D,
  grid: SpriteGrid,
  colorMap: SpriteColorMap,
  cx: number,
  cy: number,
  dotSize: number,
  style: SpriteDrawStyle = 'dot',
  flipX = false,
): void {
  const rows = grid.length;
  if (rows === 0) return;
  const cols = grid[0].length;
  const totalW = cols * dotSize;
  const totalH = rows * dotSize;
  const startX = cx - totalW / 2;
  const startY = cy - totalH / 2;

  const isDot = style === 'dot';
  const gap = isDot ? Math.max(0.75, dotSize * 0.16) : 0;
  const cellSize = Math.max(1.2, dotSize - gap);
  const radius = isDot ? cellSize * 0.34 : 0;
  const showSpecular = isDot && dotSize >= 3.2;

  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    for (let c = 0; c < cols; c++) {
      const ch = row[c];
      if (!ch || ch === '.' || ch === ' ') continue;
      const color = colorMap[ch];
      if (!color) continue;

      const drawCol = flipX ? cols - 1 - c : c;
      const px = startX + drawCol * dotSize + gap * 0.5;
      const py = startY + r * dotSize + gap * 0.5;

      ctx.fillStyle = color;
      if (isDot) {
        fillRoundedDot(ctx, px, py, cellSize, radius);
        if (showSpecular && color !== PALETTE.ink) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
          const shine = Math.max(1, cellSize * 0.32);
          ctx.fillRect(px + cellSize * 0.16, py + cellSize * 0.14, shine, shine);
        }
      } else {
        ctx.fillRect(Math.round(px), Math.round(py), Math.ceil(dotSize), Math.ceil(dotSize));
      }
    }
  }
}
