import { CONFETTI_COLORS, PALETTE, withAlpha } from './palette';

export const PIXEL_FONT = '"GitDots Pixel", system-ui, sans-serif';
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function setLabelFont(ctx: CanvasRenderingContext2D, size: number, mono = false): number {
  const sceneScale = ctx.getTransform().a / Math.min(globalThis.devicePixelRatio || 1, 2);
  const fontSize = Math.max(size, 12 / sceneScale);
  ctx.font = `400 ${fontSize}px ${mono ? MONO_FONT : PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  return fontSize;
}

export function drawCommitHash(ctx: CanvasRenderingContext2D, hash: string, x: number, y: number, color: string) {
  ctx.save();
  setLabelFont(ctx, 12, true);
  ctx.fillStyle = color;
  ctx.fillText(hash, x, y);
  ctx.restore();
}

function drawWrappedLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number): number {
  let line = '';
  for (const word of text.split(' ')) {
    const combined = line ? `${line} ${word}` : word;
    if (ctx.measureText(combined).width <= width) {
      line = combined;
      continue;
    }
    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
    line = '';
    for (const character of word) {
      if (line && ctx.measureText(line + character).width > width) {
        ctx.fillText(line, x, y);
        y += lineHeight;
        line = '';
      }
      line += character;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

/**
 * Draws the warm LED dot-matrix canvas background with gentle twinkling ambient dots.
 */
export function drawDotGridBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
): void {
  // Base warm sunlit oat-beige fill
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, w, h);

  // Subtle cozy center parchment warmth
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.56, 20, w * 0.5, h * 0.56, Math.max(w, h) * 0.65);
  grad.addColorStop(0, withAlpha(PALETTE.bgCenterGlow, 0.7));
  grad.addColorStop(1, withAlpha(PALETTE.bgDeep, 0.45));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Warm sand dot-matrix grid
  const spacing = 18;
  const cols = Math.ceil(w / spacing);
  const rows = Math.ceil(h / spacing);
  const offsetX = (w - (cols - 1) * spacing) * 0.5;
  const offsetY = (h - (rows - 1) * spacing) * 0.5;

  ctx.fillStyle = PALETTE.gridDot;
  for (let r = 0; r < rows; r++) {
    const py = offsetY + r * spacing;
    for (let c = 0; c < cols; c++) {
      const px = offsetX + c * spacing;
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  // Gentle floating warm pastel pixel speckles
  const starCount = 22;
  for (let i = 0; i < starCount; i++) {
    const hashA = ((i * 73 + 19) % 97) / 97;
    const hashB = ((i * 41 + 11) % 89) / 89;
    const sx = Math.round((hashA * 0.92 + 0.04) * w);
    const sy = Math.round((hashB * 0.44 + 0.06) * h);
    const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * (1.4 + (i % 4) * 0.45) + i * 2.1));
    const starColor =
      i % 4 === 0
        ? PALETTE.butter
        : i % 4 === 1
          ? PALETTE.sky
          : i % 4 === 2
            ? PALETTE.mint
            : PALETTE.blush;
    ctx.fillStyle = withAlpha(starColor, twinkle * 0.38);
    const sz = i % 3 === 0 ? 3 : 2;
    ctx.fillRect(sx, sy, sz, sz);
  }
}

/**
 * Animated marching pixel-dot track connecting (x1, y1) to (x2, y2).
 * Optional `curveOffsetY` bends the track gently upward (negative) or downward (positive).
 */
export function drawDottedTrack(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  time: number,
  active: boolean,
  curveOffsetY = 0,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) return;

  const step = 11;
  const count = Math.max(3, Math.floor(dist / step));
  const phase = active ? (time * 3.8) % 1 : (time * 0.45) % 1;
  const mx = (x1 + x2) * 0.5;
  const my = (y1 + y2) * 0.5 + curveOffsetY;

  const evalPoint = (t: number): [number, number] => {
    if (curveOffsetY === 0) {
      return [x1 + dx * t, y1 + dy * t];
    }
    const inv = 1 - t;
    return [
      inv * inv * x1 + 2 * inv * t * mx + t * t * x2,
      inv * inv * y1 + 2 * inv * t * my + t * t * y2,
    ];
  };

  // Subtle base glow line when active
  if (active) {
    ctx.save();
    ctx.strokeStyle = withAlpha(color, 0.22);
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (curveOffsetY === 0) {
      ctx.lineTo(x2, y2);
    } else {
      ctx.quadraticCurveTo(mx, my, x2, y2);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Marching LED pixel dots
  const pulsePos = (time * 1.15) % 1;
  for (let i = 0; i < count; i++) {
    const t = Math.min(1, Math.max(0, (i + phase) / count));
    const [px, py] = evalPoint(t);

    const distToPulse = Math.abs(t - pulsePos);
    const isPulse = active && distToPulse < 0.12;
    const dotSz = isPulse ? 5.2 : active ? 4 : 3;

    ctx.fillStyle = isPulse
      ? PALETTE.cream
      : active
        ? withAlpha(color, 0.92)
        : withAlpha(color, 0.36);

    const half = dotSz * 0.5;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(px - half, py - half, dotSz, dotSz, dotSz * 0.35);
      ctx.fill();
    } else {
      ctx.fillRect(px - half, py - half, dotSz, dotSz);
    }
  }
}

/**
 * Cozy rounded pixel-dot platform pad with crisp Korean pixel caption underneath.
 */
export function drawZonePad(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  label: string,
  sublabel: string,
  accentColor: string,
  highlighted: boolean,
  time = 0,
  monoSublabel = false,
): void {
  const padH = 22;
  const x = cx - width * 0.5;
  const y = cy - padH * 0.5;

  ctx.save();

  // Soft pulsing glow aura when highlighted
  if (highlighted) {
    const pulse = 0.72 + 0.28 * Math.sin(time * 5.2);
    const aura = ctx.createRadialGradient(cx, cy, 4, cx, cy, width * 0.7);
    aura.addColorStop(0, withAlpha(accentColor, 0.34 * pulse));
    aura.addColorStop(1, withAlpha(accentColor, 0));
    ctx.fillStyle = aura;
    ctx.fillRect(cx - width * 0.75, cy - padH * 2.2, width * 1.5, padH * 4.4);
  }

  // Deep drop shadow
  ctx.fillStyle = PALETTE.woodShadow;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 6, width, padH, 7);
  ctx.fill();

  // Bottom 3D platform bevel
  ctx.fillStyle = PALETTE.woodDark;
  ctx.beginPath();
  ctx.roundRect(x, y + 4, width, padH, 7);
  ctx.fill();

  // Top cozy platform deck
  ctx.fillStyle = highlighted ? withAlpha(accentColor, 0.16) : PALETTE.woodLight;
  ctx.beginPath();
  ctx.roundRect(x, y, width, padH, 7);
  ctx.fill();

  // Crisp border
  ctx.strokeStyle = highlighted ? accentColor : PALETTE.woodBorder;
  ctx.lineWidth = highlighted ? 2.2 : 1.6;
  ctx.beginPath();
  ctx.roundRect(x, y, width, padH, 7);
  ctx.stroke();

  // Tiny LED pixel dots inlaid across top rim
  const rimDots = Math.max(3, Math.floor((width - 20) / 14));
  const rimStart = cx - ((rimDots - 1) * 12) * 0.5;
  for (let i = 0; i < rimDots; i++) {
    ctx.fillStyle = highlighted
      ? withAlpha(accentColor, 0.9)
      : withAlpha(PALETTE.woodBorder, 0.65);
    ctx.fillRect(rimStart + i * 12 - 1.5, y + padH * 0.5 - 1.5, 3, 3);
  }

  // Korean pixel label underneath
  const labelSize = setLabelFont(ctx, 13);
  ctx.fillStyle = PALETTE.textPrimary;
  const nextY = drawWrappedLabel(ctx, label, cx, y + padH + 6, width + 4, labelSize * 1.2);

  if (sublabel) {
    const sublabelSize = setLabelFont(ctx, 12, monoSublabel);
    ctx.fillStyle = PALETTE.textSecondary;
    drawWrappedLabel(ctx, sublabel, cx, nextY, width + 4, sublabelSize * 1.2);
  }

  ctx.restore();
}

/**
 * Crisp pixel pill badge (for branch names, HEAD flags, hashes, door names, status tags).
 */
export function drawPixelBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  bgColor: string,
  textColor: string,
  borderColor: string,
  fontSize = 11,
  useMono = false,
): void {
  ctx.save();
  const labelSize = setLabelFont(ctx, fontSize, useMono);
  const metrics = ctx.measureText(text);
  const padX = 8;
  const boxW = Math.ceil(metrics.width + padX * 2);
  const boxH = labelSize + 9;
  const width = ctx.canvas.width / ctx.getTransform().a;
  const x = Math.max(4, Math.min(cx - boxW * 0.5, width - boxW - 4));
  const y = cy - boxH * 0.5;

  // Soft warm pixel drop shadow
  ctx.fillStyle = 'rgba(104, 82, 58, 0.24)';
  ctx.beginPath();
  ctx.roundRect(x, y + 2, boxW, boxH, 5);
  ctx.fill();

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 5);
  ctx.fill();

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, 5);
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + boxW * 0.5, cy + 0.5);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pixel Particle Burst System
// ---------------------------------------------------------------------------

export type ParticleKind = 'sparkle' | 'confetti' | 'sweat' | 'smoke' | 'parcel' | 'shockwave';

export interface PixelParticle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  arcHeight: number;
  color: string;
  size: number;
  age: number;
  maxAge: number;
}

export class PixelParticlePool {
  private particles: PixelParticle[] = [];

  clear(): void {
    this.particles = [];
  }

  spawnSparkles(cx: number, cy: number, color: string, count = 12): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 38 + Math.random() * 75;
      this.particles.push({
        kind: 'sparkle',
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        x0: cx,
        y0: cy,
        x1: cx,
        y1: cy,
        arcHeight: 0,
        color: i % 3 === 0 ? PALETTE.cream : color,
        size: 3 + Math.random() * 2.5,
        age: 0,
        maxAge: 0.45 + Math.random() * 0.4,
      });
    }
  }

  spawnConfetti(cx: number, cy: number, count = 26): void {
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI * 0.15 - Math.random() * Math.PI * 0.7;
      const speed = 90 + Math.random() * 140;
      this.particles.push({
        kind: 'confetti',
        x: cx + (Math.random() - 0.5) * 28,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        x0: cx,
        y0: cy,
        x1: cx,
        y1: cy,
        arcHeight: 0,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 4 + (i % 3),
        age: 0,
        maxAge: 0.9 + Math.random() * 0.65,
      });
    }
  }

  spawnSweat(cx: number, cy: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      this.particles.push({
        kind: 'sweat',
        x: cx + side * 14,
        y: cy - 16,
        vx: side * (32 + Math.random() * 36),
        vy: -45 - Math.random() * 35,
        x0: cx,
        y0: cy,
        x1: cx,
        y1: cy,
        arcHeight: 0,
        color: PALETTE.sky,
        size: 4.5,
        age: 0,
        maxAge: 0.65 + Math.random() * 0.25,
      });
    }
  }

  spawnSmoke(cx: number, cy: number, color: string = PALETTE.slate, count = 7): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        kind: 'smoke',
        x: cx + (Math.random() - 0.5) * 18,
        y: cy + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 24,
        vy: -22 - Math.random() * 22,
        x0: cx,
        y0: cy,
        x1: cx,
        y1: cy,
        arcHeight: 0,
        color,
        size: 4 + Math.random() * 3.5,
        age: 0,
        maxAge: 0.5 + Math.random() * 0.35,
      });
    }
  }

  spawnParcel(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    arcHeight = 68,
    duration = 0.65,
  ): void {
    this.particles.push({
      kind: 'parcel',
      x: x0,
      y: y0,
      vx: 0,
      vy: 0,
      x0,
      y0,
      x1,
      y1,
      arcHeight,
      color,
      size: 6.5,
      age: 0,
      maxAge: duration,
    });
  }

  spawnShockwave(cx: number, cy: number, color: string, maxRadius = 48): void {
    this.particles.push({
      kind: 'shockwave',
      x: cx,
      y: cy,
      vx: maxRadius,
      vy: 0,
      x0: cx,
      y0: cy,
      x1: cx,
      y1: cy,
      arcHeight: 0,
      color,
      size: 4,
      age: 0,
      maxAge: 0.52,
    });
  }

  update(dt: number): void {
    const safeDt = Math.min(dt, 0.05);
    const next: PixelParticle[] = [];

    for (const p of this.particles) {
      p.age += safeDt;
      if (p.age >= p.maxAge) continue;

      if (p.kind === 'parcel') {
        const t = p.age / p.maxAge;
        const ease = 1 - Math.pow(1 - t, 2.2);
        p.x = p.x0 + (p.x1 - p.x0) * ease;
        p.y = p.y0 + (p.y1 - p.y0) * ease - Math.sin(t * Math.PI) * p.arcHeight;
      } else if (p.kind === 'confetti' || p.kind === 'sweat') {
        p.vy += 260 * safeDt;
        p.x += p.vx * safeDt;
        p.y += p.vy * safeDt;
      } else if (p.kind === 'sparkle' || p.kind === 'smoke') {
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.x += p.vx * safeDt;
        p.y += p.vy * safeDt;
      }

      next.push(p);
    }

    this.particles = next;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      const t = p.age / p.maxAge;
      const alpha = Math.max(0, 1 - t);

      if (p.kind === 'shockwave') {
        const radius = 8 + p.vx * (1 - Math.pow(1 - t, 2));
        const dotCount = 16;
        ctx.fillStyle = withAlpha(p.color, alpha * 0.95);
        for (let i = 0; i < dotCount; i++) {
          const ang = (Math.PI * 2 * i) / dotCount;
          const dx = p.x + Math.cos(ang) * radius;
          const dy = p.y + Math.sin(ang) * radius;
          const sz = Math.max(2, p.size * (1 - t * 0.4));
          ctx.fillRect(dx - sz * 0.5, dy - sz * 0.5, sz, sz);
        }
        continue;
      }

      if (p.kind === 'parcel') {
        // Draw glowing dot + 3 trailing parcel dots along the arc
        for (let k = 0; k < 4; k++) {
          const trailT = Math.max(0, t - k * 0.055);
          const ease = 1 - Math.pow(1 - trailT, 2.2);
          const tx = p.x0 + (p.x1 - p.x0) * ease;
          const ty = p.y0 + (p.y1 - p.y0) * ease - Math.sin(trailT * Math.PI) * p.arcHeight;
          const sz = Math.max(2.5, p.size - k * 1.2);
          ctx.fillStyle = k === 0 ? PALETTE.cream : withAlpha(p.color, 0.85 - k * 0.22);
          ctx.beginPath();
          ctx.roundRect(tx - sz * 0.5, ty - sz * 0.5, sz, sz, sz * 0.35);
          ctx.fill();
        }
        continue;
      }

      if (p.kind === 'sparkle') {
        ctx.fillStyle = withAlpha(p.color, alpha);
        const s = p.size * (0.6 + 0.5 * Math.sin(t * Math.PI));
        ctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s);
        if (s > 3) {
          ctx.fillStyle = withAlpha(PALETTE.cream, alpha * 0.8);
          ctx.fillRect(p.x - 1, p.y - s, 2, s * 2);
          ctx.fillRect(p.x - s, p.y - 1, s * 2, 2);
        }
        continue;
      }

      // confetti / sweat / smoke
      ctx.fillStyle = withAlpha(p.color, alpha * (p.kind === 'smoke' ? 0.55 : 0.95));
      const sz = p.kind === 'smoke' ? p.size * (1 + t * 0.6) : p.size;
      ctx.beginPath();
      ctx.roundRect(p.x - sz * 0.5, p.y - sz * 0.5, sz, sz, sz * 0.35);
      ctx.fill();
    }
    ctx.restore();
  }
}
