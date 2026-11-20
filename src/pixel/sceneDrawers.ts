import type { PixelAnimKind, PixelSimState } from '../types/sim';
import { commitById, reachableCommits } from '../engine/repoVersions';
import { PALETTE, withAlpha } from './palette';
import {
  AI_BOT,
  AI_BOT_COLORS,
  AI_BOT_HOVER,
  BASKET_SPRITE,
  BUDDY_COLORS,
  CASTLE_TOWER,
  CLOUD_CASTLE,
  CLOUD_CASTLE_COLORS,
  COMMIT_GEM,
  FILE_SPRITE,
  GITDOT_BUDDY,
  KEY_CLASSIC,
  KEY_CLASSIC_COLORS,
  KEY_FINE,
  KEY_FINE_COLORS,
  LOCK_ICON,
  REMOTE_COLORS,
  REMOTE_ICON,
  ROCKET_PR,
  SHIELD_ICON,
  SPARKLE_ICON,
  drawPixelSprite,
  makeBasketColors,
  makeCastleColors,
  makeFileColors,
  makeGemColors,
  makeLockColors,
  makeRocketColors,
  makeShieldColors,
  type BuddyPose,
} from './sprites';
import {
  drawCommitHash,
  drawDottedTrack,
  drawPixelBadge,
  drawZonePad,
} from './dotMatrixRenderer';

export interface SceneMotionState {
  stageId: string;
  buddyX: number;
  buddyY: number;
  facingLeft: boolean;
  initialized: boolean;
}

export function createSceneMotion(): SceneMotionState {
  return {
    stageId: '',
    buddyX: 0.2,
    buddyY: 0.68,
    facingLeft: false,
    initialized: false,
  };
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeDotSize(w: number, h: number): number {
  return clamp(Math.min(w / 225, h / 118), 2.5, 4.4);
}

function moveBuddySmooth(
  motion: SceneMotionState,
  stageId: string,
  targetX: number,
  targetY: number,
): { x: number; y: number; walking: boolean; flipX: boolean } {
  if (!motion.initialized || motion.stageId !== stageId) {
    motion.stageId = stageId;
    motion.buddyX = targetX;
    motion.buddyY = targetY;
    motion.facingLeft = false;
    motion.initialized = true;
    return { x: targetX, y: targetY, walking: false, flipX: false };
  }

  const dx = targetX - motion.buddyX;
  const dy = targetY - motion.buddyY;
  const dist = Math.hypot(dx, dy);

  if (Math.abs(dx) > 0.008) {
    motion.facingLeft = dx < 0;
  }

  motion.buddyX += dx * 0.14;
  motion.buddyY += dy * 0.14;

  return {
    x: motion.buddyX,
    y: motion.buddyY,
    walking: dist > 0.012,
    flipX: motion.facingLeft,
  };
}

function drawBuddyWithIdleLife(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  dot: number,
  pose: BuddyPose,
  walking: boolean,
  flipX: boolean,
  time: number,
): void {
  // Subtle cozy warm shadow under Buddy
  ctx.save();
  ctx.fillStyle = 'rgba(104, 82, 58, 0.22)';
  ctx.beginPath();
  ctx.ellipse(px, py + dot * 5.8, dot * 4.5, dot * 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  let activePose: BuddyPose = pose;
  let bobY = Math.sin(time * 3.4) * 2.2;

  if (walking && pose === 'idle') {
    activePose = Math.floor(time * 8) % 2 === 0 ? 'hop' : 'idle';
    bobY = -Math.abs(Math.sin(time * 12)) * 6;
  } else if (pose === 'idle') {
    // Periodic adorable eye blink every ~3.5 seconds
    const blinkCycle = time % 3.6;
    if (blinkCycle > 3.42) {
      activePose = 'blink';
    }
  } else if (pose === 'happy') {
    bobY = -Math.abs(Math.sin(time * 9)) * 8;
  } else if (pose === 'shocked') {
    bobY = 0;
    px += Math.sin(time * 42) * 2.2;
  }

  drawPixelSprite(ctx, GITDOT_BUDDY[activePose], BUDDY_COLORS, px, py + bobY, dot, 'dot', flipX);
}

// ===========================================================================
// CH1: 동작 원리 — 4개 공간 (Working -> Staging -> Local -> Remote GitHub)
// ===========================================================================

function drawCh1Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const padY = h * 0.72;
  const padW = clamp(w * 0.165, 96, 152);
  const xs = [w * 0.16, w * 0.39, w * 0.62, w * 0.85];
  const kind = sim.lastAnim.kind;

  // Connecting marching tracks
  drawDottedTrack(ctx, xs[0] + padW * 0.48, padY, xs[1] - padW * 0.48, padY, PALETTE.mint, time, kind === 'ADD');
  drawDottedTrack(ctx, xs[1] + padW * 0.48, padY, xs[2] - padW * 0.48, padY, PALETTE.sky, time, kind === 'COMMIT');
  drawDottedTrack(
    ctx,
    xs[2] + padW * 0.48,
    padY,
    xs[3] - padW * 0.48,
    padY,
    PALETTE.lavender,
    time,
    kind === 'PUSH' || kind === 'PULL' || kind === 'FETCH',
  );

  // Determine highlighted pad
  const activeIdx =
    kind === 'ADD'
      ? 1
      : kind === 'COMMIT'
        ? 2
        : kind === 'PUSH' || kind === 'PULL' || kind === 'FETCH'
          ? 3
          : 0;

  const workingCount = sim.files.filter((f) => f.status === 'modified' || f.status === 'untracked').length;
  const remoteHead = sim.remoteBranches[sim.headBranch];
  const shared = Boolean(remoteHead && remoteHead === sim.branches[sim.headBranch]);

  drawZonePad(
    ctx,
    xs[0],
    padY,
    padW,
    '작업 폴더',
    workingCount > 0 ? `변경 ${workingCount}개` : '변경 없음',
    PALETTE.butter,
    activeIdx === 0,
    time,
  );
  drawZonePad(
    ctx,
    xs[1],
    padY,
    padW,
    '스테이징',
    sim.staged.length > 0 ? `선택 ${sim.staged.length}개` : '선택 없음',
    PALETTE.mint,
    activeIdx === 1,
    time,
  );
  drawZonePad(
    ctx,
    xs[2],
    padY,
    padW,
    '내 저장소',
    `커밋 ${sim.commits.length}개`,
    PALETTE.sky,
    activeIdx === 2,
    time,
  );
  drawZonePad(
    ctx,
    xs[3],
    padY,
    padW,
    '팀 저장소',
    shared ? '같은 커밋' : remoteHead ? '푸시 대기' : '원격 브랜치 없음',
    PALETTE.lavender,
    activeIdx === 3,
    time,
  );

  // Pad 1 props: working files
  const visibleFiles = sim.files.slice(0, 3);
  visibleFiles.forEach((f, idx) => {
    const fx = xs[0] + (idx - (visibleFiles.length - 1) * 0.5) * (dot * 8.5);
    const fy = padY - dot * 7.5 + Math.sin(time * 2.5 + idx) * 1.5;
    const lineColor =
      f.status === 'staged'
        ? PALETTE.mint
        : f.status === 'committed'
          ? PALETTE.sky
          : PALETTE.butter;
    drawPixelSprite(ctx, FILE_SPRITE, makeFileColors(lineColor), fx, fy, dot * 0.85, 'dot');
  });

  // Pad 2 props: staging basket + peeking staged files
  const basketY = padY - dot * 6.5;
  drawPixelSprite(
    ctx,
    BASKET_SPRITE,
    makeBasketColors(sim.staged.length > 0 ? PALETTE.mint : PALETTE.woodBorder, PALETTE.woodDark),
    xs[1],
    basketY,
    dot * 0.92,
    'dot',
  );
  if (sim.staged.length > 0) {
    const showStaged = Math.min(sim.staged.length, 3);
    for (let i = 0; i < showStaged; i++) {
      const sx = xs[1] + (i - (showStaged - 1) * 0.5) * (dot * 5.2);
      drawPixelSprite(
        ctx,
        FILE_SPRITE,
        makeFileColors(PALETTE.mint, PALETTE.mintLight),
        sx,
        basketY - dot * 5.2 + Math.sin(time * 4 + i) * 1.5,
        dot * 0.62,
        'dot',
      );
    }
  }

  // Pad 3 props: local vault commit gems
  const visibleGems = Math.min(sim.commits.length, 4);
  for (let i = 0; i < visibleGems; i++) {
    const gx = xs[2] + (i - (visibleGems - 1) * 0.5) * (dot * 7.2);
    const gy = padY - dot * 7 - (i % 2) * (dot * 2.5) + Math.sin(time * 3 + i * 0.8) * 2;
    drawPixelSprite(
      ctx,
      COMMIT_GEM,
      makeGemColors(PALETTE.sky, PALETTE.skyLight, PALETTE.skyDark),
      gx,
      gy,
      dot * 0.85,
      'dot',
    );
  }

  // Pad 4 props: floating Cloud Castle
  const cloudY = padY - dot * 13 + Math.sin(time * 2.1) * 4;
  drawPixelSprite(ctx, CLOUD_CASTLE, CLOUD_CASTLE_COLORS, xs[3], cloudY, dot * 0.92, 'dot');

  // Action animations!
  const t = easeOutCubic(animProgress);
  if (kind === 'ADD' && animProgress < 0.95) {
    const px = xs[0] + (xs[1] - xs[0]) * t;
    const py = padY - dot * 9 - Math.sin(animProgress * Math.PI) * (h * 0.14);
    drawPixelSprite(ctx, FILE_SPRITE, makeFileColors(PALETTE.mint, PALETTE.cream), px, py, dot * 0.95, 'dot');
  }

  if (kind === 'COMMIT' && animProgress < 0.85) {
    // Camera flash ring + dropping gem!
    const flashAlpha = (1 - animProgress / 0.85) * 0.55;
    ctx.save();
    ctx.fillStyle = withAlpha(PALETTE.cream, flashAlpha);
    ctx.beginPath();
    ctx.arc(xs[2], padY - dot * 9, dot * (8 + animProgress * 14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const dropY = padY - dot * 22 + dot * 15 * t;
    drawPixelSprite(
      ctx,
      COMMIT_GEM,
      makeGemColors(PALETTE.butter, PALETTE.cream, PALETTE.butterDark),
      xs[2],
      dropY,
      dot,
      'dot',
    );
  }

  if (kind === 'PUSH' && animProgress < 0.95) {
    const rx = xs[2] + (xs[3] - xs[2]) * t;
    const ry = padY - dot * 10 - Math.sin(animProgress * Math.PI) * (h * 0.16);
    drawPixelSprite(ctx, ROCKET_PR, makeRocketColors(PALETTE.sky), rx, ry, dot * 0.95, 'dot');
  }

  if ((kind === 'PULL' || kind === 'FETCH') && animProgress < 0.95) {
    const rx = xs[3] + (xs[2] - xs[3]) * t;
    const ry = cloudY + (padY - dot * 9 - cloudY) * t - Math.sin(animProgress * Math.PI) * (h * 0.1);
    drawPixelSprite(
      ctx,
      COMMIT_GEM,
      makeGemColors(PALETTE.mint, PALETTE.cream, PALETTE.mintDark),
      rx,
      ry,
      dot * 0.85,
      'dot',
    );
  }

  // Buddy smoothly hops to the active zone!
  const buddyTargets = [0.16, 0.39, 0.62, 0.77];
  const targetX = buddyTargets[activeIdx];
  const targetY = 0.635;
  const b = moveBuddySmooth(motion, 'ch1', targetX, targetY);
  const pose: BuddyPose =
    kind === 'ADD' && animProgress < 0.65
      ? 'carry'
      : (kind === 'COMMIT' || kind === 'PUSH') && animProgress < 0.85
        ? 'happy'
        : 'idle';

  drawBuddyWithIdleLife(ctx, b.x * w, b.y * h - dot * 4.5, dot, pose, b.walking, b.flipX, time);
}

// ===========================================================================
// CH2: 필수 명령어 — 타임라인 & 임시 보관함 (Stash / Revert / Reset)
// ===========================================================================

export function recentTimelineCommits(sim: PixelSimState) {
  const history = reachableCommits(sim, sim.branches[sim.headBranch]);
  const previousHead = commitById(sim, sim.origHead);
  const ghost = previousHead?.ghost && !history.has(previousHead.id) ? previousHead : undefined;
  const recent = sim.commits.filter((commit) => history.has(commit.id)).slice(ghost ? -3 : -4);
  const visible = new Set(recent.map((commit) => commit.id));
  if (ghost) visible.add(ghost.id);
  return sim.commits.filter((commit) => visible.has(commit.id))
    .map((commit) => ({ commit, rewound: !history.has(commit.id) }));
}

function drawCh2Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const railY = h * 0.7;
  const railLeft = w * 0.16;
  const railRight = w * 0.86;
  const kind = sim.lastAnim.kind;

  // Main horizontal dotted commit timeline rail
  drawDottedTrack(
    ctx,
    railLeft,
    railY,
    railRight,
    railY,
    PALETTE.sky,
    time,
    kind === 'COMMIT' || kind === 'REVERT' || kind === 'RESET',
  );

  // Draw commit gems along the rail
  const commits = recentTimelineCommits(sim);
  const headCommitId = sim.branches[sim.headBranch];
  let headX = railLeft + (railRight - railLeft) * 0.35;

  commits.forEach(({ commit: c, rewound }, idx) => {
    const frac = commits.length <= 1 ? 0.5 : idx / Math.max(commits.length - 1, 1);
    const gx = railLeft + 24 + frac * (railRight - railLeft - 48);
    const gy = rewound ? railY - dot * 6.5 : railY;
    const isHead = c.id === headCommitId;
    if (isHead) headX = gx;

    ctx.save();
    if (rewound) {
      ctx.globalAlpha = 0.42;
    }

    const gemColors = rewound
      ? makeGemColors(PALETTE.slateMuted, PALETTE.slate, PALETTE.woodDark, PALETTE.slate)
      : c.isRevert
        ? makeGemColors(PALETTE.mint, PALETTE.mintLight, PALETTE.mintDark)
        : makeGemColors(PALETTE.sky, PALETTE.skyLight, PALETTE.skyDark);

    // Glow halo under active HEAD or revert shield gem
    if (isHead || c.isRevert) {
      const aura = ctx.createRadialGradient(gx, gy, 2, gx, gy, dot * 9);
      aura.addColorStop(0, withAlpha(c.isRevert ? PALETTE.mint : PALETTE.butter, 0.35));
      aura.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(gx, gy, dot * 9, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPixelSprite(ctx, COMMIT_GEM, gemColors, gx, gy, dot * 0.95, 'dot');

    if (c.isRevert) {
      drawPixelSprite(ctx, SHIELD_ICON, makeShieldColors(PALETTE.mint, PALETTE.mintDark), gx + dot * 5.2, gy - dot * 5.2, dot * 0.45, 'dot');
    }

    ctx.restore();
    drawCommitHash(ctx, c.hash, gx, gy + dot * 4.5 + 8, PALETTE.textPrimary);
  });

  const stashX = w * 0.2;
  const stashY = h * 0.32;
  const stashActive = kind === 'STASH' || kind === 'STASH_POP';
  drawZonePad(
    ctx,
    stashX,
    stashY,
    clamp(w * 0.2, 118, 165),
    '임시 보관',
    sim.stashCount > 0 ? `보관 중 ${sim.stashCount}개` : '비어 있음',
    PALETTE.butter,
    stashActive || sim.stashCount > 0,
    time,
  );
  drawPixelSprite(
    ctx,
    BASKET_SPRITE,
    makeBasketColors(sim.stashCount > 0 ? PALETTE.butter : PALETTE.woodBorder, PALETTE.woodDark),
    stashX,
    stashY - dot * 6.5,
    dot * 0.9,
    'dot',
  );

  // Flying file arc for STASH / STASH_POP
  if (stashActive && animProgress < 0.92) {
    const t = easeOutCubic(animProgress);
    const fromX = kind === 'STASH' ? headX : stashX;
    const fromY = kind === 'STASH' ? railY - dot * 4 : stashY - dot * 8;
    const toX = kind === 'STASH' ? stashX : headX;
    const toY = kind === 'STASH' ? stashY - dot * 8 : railY - dot * 4;
    const fx = fromX + (toX - fromX) * t;
    const fy = fromY + (toY - fromY) * t - Math.sin(animProgress * Math.PI) * 48;
    drawPixelSprite(ctx, FILE_SPRITE, makeFileColors(PALETTE.butter, PALETTE.cream), fx, fy, dot * 0.9, 'dot');
  }

  // Buddy stands near Stash during stash ops, otherwise alongside HEAD
  const targetNormX = stashActive ? 0.39 : clamp(headX / w, 0.44, 0.85);
  const targetNormY = 0.32;
  const b = moveBuddySmooth(motion, 'ch2', targetNormX, targetNormY);
  const pose: BuddyPose =
    kind === 'RESET' && animProgress < 0.8
      ? 'shocked'
      : (kind === 'REVERT' || kind === 'STASH_POP' || kind === 'COMMIT') && animProgress < 0.85
        ? 'happy'
        : kind === 'STASH' && animProgress < 0.75
          ? 'carry'
          : 'idle';

  drawBuddyWithIdleLife(ctx, b.x * w, b.y * h, dot, pose, b.walking, b.flipX, time);
}

// ===========================================================================
// CH3: 브랜치·충돌 — 평행우주 기찻길 (Main & Feature Tracks + Conflict Bonk)
// ===========================================================================

function firstParentHistory(sim: PixelSimState, tip: string | undefined) {
  const commits: PixelSimState['commits'] = [];
  for (let commit = commitById(sim, tip); commit; commit = commitById(sim, commit.parents[0])) {
    commits.push(commit);
  }
  return commits.reverse();
}

function drawCh3Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const mainY = h * 0.67;
  const featY = h * 0.33;
  const kind = sim.lastAnim.kind;
  const featureName = 'feature/ui' in sim.branches ? 'feature/ui'
    : Object.keys(sim.branches).find((name) => name !== 'main');
  const lowerBranch = sim.headBranch === featureName ? 'main' : sim.headBranch;

  const lowerHistory = firstParentHistory(sim, sim.branches[lowerBranch]);
  const upperHistory = firstParentHistory(sim, featureName ? sim.branches[featureName] : undefined);
  const lowerIds = new Set(lowerHistory.map((commit) => commit.id));
  const split = upperHistory.findIndex((commit) => !lowerIds.has(commit.id));
  const forkCommit = upperHistory[split === -1 ? upperHistory.length - 1 : split - 1];
  const lowerCommits = lowerHistory.slice(-4);
  if (forkCommit && !lowerCommits.includes(forkCommit)) lowerCommits.splice(0, 1, forkCommit);
  const mainNodes = lowerCommits.map((commit, index) => ({ commit, x: w * (0.19 + index * 0.16) }));
  const fork = mainNodes.find((node) => node.commit.id === forkCommit?.id);

  const featureCommits = split === -1 ? [] : upperHistory.slice(split).slice(-3);
  const featureStart = Math.min((fork?.x ?? w * 0.12) + w * 0.23, w * 0.65);
  const featureGap = Math.min(w * 0.19, (w * 0.85 - featureStart) / Math.max(1, featureCommits.length - 1));
  const featureNodes = featureCommits.map((commit, index) => ({ commit, x: featureStart + index * featureGap }));
  const featureTip = featureNodes.at(-1);
  const hasConflict = Boolean(sim.conflict && sim.conflict.resolvedChoice === 'none');
  const mergeNode = mainNodes.filter(({ commit }) => commit.parents.slice(1).some((parent) =>
    upperHistory.some((ancestor) => ancestor.id === parent))).at(-1);
  const hasMerged = Boolean(mergeNode) || kind === 'MERGE_OK' || kind === 'RESOLVE';

  drawDottedTrack(ctx, w * 0.12, mainY, w * 0.9, mainY, PALETTE.sky, time, sim.headBranch === lowerBranch);
  if (fork && featureNodes.length > 0) {
    drawDottedTrack(ctx, fork.x, mainY, featureStart, featY, PALETTE.lavender, time, true, -10);
  }
  if (featureTip) {
    drawDottedTrack(ctx, featureStart, featY, featureTip.x, featY, PALETTE.lavender, time, sim.headBranch === featureName);
    if (hasConflict || mergeNode) {
      drawDottedTrack(ctx, featureTip.x, featY, mergeNode?.x ?? w * 0.86, mainY,
        hasConflict ? PALETTE.coral : PALETTE.mint, time, true, -9);
    }
  }

  for (const { commit, x } of mainNodes) {
    const colors = commit.isMerge
      ? makeGemColors(PALETTE.mint, PALETTE.cream, PALETTE.mintDark, PALETTE.butter)
      : makeGemColors(PALETTE.sky, PALETTE.skyLight, PALETTE.skyDark);
    const gemSize = dot * (commit.isMerge ? 1.12 : 0.9);
    drawPixelSprite(ctx, COMMIT_GEM, colors, x, mainY, gemSize, 'dot');
    drawCommitHash(ctx, commit.hash, x, mainY + gemSize * 4.5 + 6, PALETTE.textPrimary);
  }
  for (const { commit, x } of featureNodes) {
    drawPixelSprite(ctx, COMMIT_GEM, makeGemColors(PALETTE.lavender, PALETTE.lavenderLight, PALETTE.lavenderDark),
      x, featY, dot * 0.9, 'dot');
    drawCommitHash(ctx, commit.hash, x, featY + dot * 4.05 + 6, PALETTE.lavenderDark);
  }

  const lowerLabel = lowerBranch === sim.headBranch ? `HEAD · ${lowerBranch}` : lowerBranch;
  drawPixelBadge(ctx, mainNodes.at(-1)?.x ?? w * 0.37, mainY + dot * 5 + 39, lowerLabel,
    PALETTE.cream, PALETTE.skyDark, PALETTE.sky, 12, true);
  if (featureName && (featureTip || fork)) {
    const upperLabel = featureName === sim.headBranch ? `HEAD · ${featureName}` : featureName;
    drawPixelBadge(ctx, featureTip?.x ?? fork?.x ?? featureStart, (featureTip ? featY : mainY) - dot * 5 - 15, upperLabel,
      PALETTE.cream, PALETTE.lavenderDark, PALETTE.lavender, 12, true);
  }

  // CONFLICT BONK ANIMATION at x = 70%
  if (hasConflict) {
    const clashX = w * 0.77;
    const clashY = h * 0.43;
    const shake = Math.sin(time * 28) * 3.5;

    // Pulsing coral alarm glow
    const grad = ctx.createRadialGradient(clashX, clashY, 4, clashX, clashY, dot * 15);
    grad.addColorStop(0, withAlpha(PALETTE.coral, 0.45));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(clashX, clashY, dot * 15, 0, Math.PI * 2);
    ctx.fill();

    // Two gems bonking!
    drawPixelSprite(
      ctx,
      COMMIT_GEM,
      makeGemColors(PALETTE.sky, PALETTE.skyLight, PALETTE.skyDark, PALETTE.coral),
      clashX - dot * 5.2 + shake,
      clashY + dot * 1.2,
      dot * 0.95,
      'dot',
    );
    drawPixelSprite(
      ctx,
      COMMIT_GEM,
      makeGemColors(PALETTE.lavender, PALETTE.lavenderLight, PALETTE.lavenderDark, PALETTE.coral),
      clashX + dot * 5.2 - shake,
      clashY - dot * 1.2,
      dot * 0.95,
      'dot',
    );

    // Animated coral sparks around bonk
    for (let i = 0; i < 4; i++) {
      const ang = time * 4 + (Math.PI * 0.5 * i);
      const sx = clashX + Math.cos(ang) * dot * 8;
      const sy = clashY + Math.sin(ang) * dot * 7;
      drawPixelSprite(
        ctx,
        SPARKLE_ICON,
        { c: PALETTE.coral, l: PALETTE.butter, w: PALETTE.cream },
        sx,
        sy,
        dot * 0.65,
        'dot',
      );
    }

    drawPixelBadge(ctx, clashX, clashY - dot * 8, '같은 줄이 바뀌었어요', PALETTE.coralDark, PALETTE.cream, PALETTE.coral);
  }

  // Buddy hops cleanly between main & feature railways!
  const onFeature = sim.headBranch !== 'main';
  const targetX = hasConflict ? 0.58 : onFeature ? 0.7 : hasMerged ? 0.82 : 0.73;
  const targetY = hasConflict ? 0.43 : onFeature ? 0.37 : 0.56;
  const b = moveBuddySmooth(motion, 'ch3', targetX, targetY);
  const pose: BuddyPose = hasConflict
    ? 'shocked'
    : (kind === 'MERGE_OK' || kind === 'RESOLVE' || kind === 'REBASE') && animProgress < 0.9
      ? 'happy'
      : 'idle';

  drawBuddyWithIdleLife(ctx, b.x * w, b.y * h, dot, pose, b.walking, b.flipX, time);
}

// ===========================================================================
// CH4: GitHub·PR — 구름 우주정거장 (Local -> CI Ring Gate -> GitHub Cloud)
// ===========================================================================

function drawCh4Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const padY = h * 0.74;
  const xLocal = w * 0.18;
  const xCi = w * 0.5;
  const xCloud = w * 0.82;
  const padW = clamp(w * 0.19, 108, 162);
  const kind = sim.lastAnim.kind;
  const latestPr = sim.prs[sim.prs.length - 1] ?? null;
  const ciPass = latestPr?.ci === 'pass' || latestPr?.status === 'merged';
  const prMerged = latestPr?.status === 'merged';

  // Connecting tracks
  drawDottedTrack(
    ctx,
    xLocal + padW * 0.45,
    padY,
    xCi - padW * 0.42,
    padY,
    PALETTE.sky,
    time,
    kind === 'PUSH' || kind === 'PR_CREATE',
  );
  drawDottedTrack(
    ctx,
    xCi + padW * 0.42,
    padY,
    xCloud - padW * 0.45,
    padY,
    ciPass ? PALETTE.mint : PALETTE.lavender,
    time,
    kind === 'PR_CREATE' || kind === 'PR_MERGE' || prMerged,
  );

  // 3 Cozy station pads
  drawZonePad(ctx, xLocal, padY, padW, '내 브랜치', sim.headBranch, PALETTE.sky, kind === 'PUSH', time, true);
  drawZonePad(
    ctx,
    xCi,
    padY,
    padW,
    '자동 검사',
    ciPass ? '검사 통과' : latestPr ? '검사 대기 중' : 'PR 대기 중',
    ciPass ? PALETTE.mint : PALETTE.butter,
    Boolean(latestPr),
    time,
  );
  drawZonePad(
    ctx,
    xCloud,
    padY,
    padW,
    'GitHub 저장소',
    prMerged ? 'PR 병합 완료!' : '원격 저장소',
    PALETTE.lavender,
    prMerged || kind === 'PR_MERGE',
    time,
  );

  // Center holographic LED pixel CI Gate ring
  const gateY = h * 0.58;
  const ringR = dot * 10.5;
  const ringDots = 16;
  const ringColor = ciPass ? PALETTE.mint : latestPr ? PALETTE.butter : PALETTE.woodBorder;

  for (let i = 0; i < ringDots; i++) {
    const ang = (Math.PI * 2 * i) / ringDots + time * (ciPass ? 0.8 : 2.2);
    const rx = xCi + Math.cos(ang) * ringR;
    const ry = gateY + Math.sin(ang) * ringR;
    ctx.fillStyle = i % 2 === 0 ? ringColor : withAlpha(PALETTE.cream, ciPass ? 0.85 : 0.45);
    ctx.fillRect(rx - 2.5, ry - 2.5, 5, 5);
  }
  drawPixelBadge(
    ctx,
    xCi,
    gateY,
    ciPass ? 'CI PASS' : latestPr ? `PR #${latestPr.number}` : 'CI GATE',
    PALETTE.cream,
    ciPass ? PALETTE.mintDark : PALETTE.butterDark,
    ringColor,
    10.5,
    true,
  );

  // Floating GitHub Cloud Castle on the right
  const cloudY = h * 0.58 + Math.sin(time * 2.2) * 4;
  drawPixelSprite(ctx, CLOUD_CASTLE, CLOUD_CASTLE_COLORS, xCloud, cloudY, dot * 1.02, 'dot');

  // Animated PR Rocket flight
  const t = easeOutCubic(animProgress);
  if (kind === 'PR_CREATE') {
    const rx = xLocal + (xCi + w * 0.08 - xLocal) * t;
    const ry = gateY - Math.sin(animProgress * Math.PI) * 28;
    drawPixelSprite(ctx, ROCKET_PR, makeRocketColors(PALETTE.lavender), rx, ry, dot * 1.05, 'dot');
  } else if (kind === 'PR_MERGE' && animProgress < 0.95) {
    const rx = xCi + (xCloud - xCi) * t;
    const ry = gateY + (cloudY - gateY) * t - Math.sin(animProgress * Math.PI) * 24;
    drawPixelSprite(ctx, ROCKET_PR, makeRocketColors(PALETTE.mint), rx, ry, dot * 1.08, 'dot');
  } else if (latestPr && !prMerged) {
    // Rocket hovering neatly beside CI Gate waiting to merge
    drawPixelSprite(
      ctx,
      ROCKET_PR,
      makeRocketColors(PALETTE.lavender),
      xCi + dot * 12,
      gateY - dot * 3 + Math.sin(time * 4) * 3,
      dot * 0.95,
      'dot',
    );
  }

  // Buddy cheers from local computer / hops toward gate
  const targetX = prMerged ? 0.68 : latestPr ? 0.33 : 0.18;
  const b = moveBuddySmooth(motion, 'ch4', targetX, 0.65);
  const pose: BuddyPose = (kind === 'PR_MERGE' || kind === 'PR_CREATE') && animProgress < 0.9 ? 'happy' : 'idle';
  drawBuddyWithIdleLife(ctx, b.x * w, b.y * h, dot, pose, b.walking, b.flipX, time);
}

// ===========================================================================
// CH5: gh CLI — 터미널 리모컨 허브 (Remote Buddy -> 4 Pixel Islands)
// ===========================================================================

function detectGhTargetIsland(sim: PixelSimState): number {
  const haystack = `${sim.lastAnim.label} ${sim.lastAnim.detail ?? ''} ${
    sim.terminal[sim.terminal.length - 1]?.command ?? ''
  }`.toLowerCase();
  if (haystack.includes('pr')) return 1;
  if (haystack.includes('issue')) return 2;
  if (haystack.includes('run') || haystack.includes('action') || haystack.includes('workflow')) return 3;
  if (haystack.includes('repo') || haystack.includes('clone') || haystack.includes('browse')) return 0;
  return sim.lastAnim.kind === 'IDLE' ? -1 : 0;
}

function drawCh5Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const hubX = w * 0.2;
  const hubY = h * 0.6;
  const padW = clamp(w * 0.175, 102, 148);
  const activeIsland = detectGhTargetIsland(sim);

  const islands = [
    { x: w * 0.56, y: h * 0.34, label: '저장소', sub: sim.ghUser || 'gitdots/app', color: PALETTE.sky },
    { x: w * 0.83, y: h * 0.34, label: '검토 요청', sub: `열린 PR ${sim.prs.length}개`, color: PALETTE.lavender },
    { x: w * 0.56, y: h * 0.76, label: '이슈', sub: `열린 글 ${sim.issues.length}개`, color: PALETTE.butter },
    { x: w * 0.83, y: h * 0.76, label: '자동 검사', sub: '실행 결과', color: PALETTE.mint },
  ] as const;

  // Dot laser beams from Buddy's remote to each island
  islands.forEach((isl, idx) => {
    const isHit = activeIsland === idx;
    drawDottedTrack(
      ctx,
      hubX + dot * 11,
      hubY - dot * 4,
      isl.x - padW * 0.45,
      isl.y - dot * 2,
      isl.color,
      time,
      isHit,
      idx < 2 ? -18 : 14,
    );
  });

  // Left hub pad + Buddy with pixel remote
  drawZonePad(ctx, hubX, hubY, clamp(w * 0.19, 108, 152), '내 터미널', 'gh 명령어', PALETTE.butter, true, time);
  const b = moveBuddySmooth(motion, 'ch5', 0.18, 0.48);
  drawBuddyWithIdleLife(
    ctx,
    b.x * w,
    b.y * h,
    dot,
    sim.lastAnim.kind === 'GH_CMD' && animProgress < 0.8 ? 'happy' : 'idle',
    false,
    false,
    time,
  );
  // Floating pixel remote right beside Buddy
  drawPixelSprite(
    ctx,
    REMOTE_ICON,
    REMOTE_COLORS,
    hubX + dot * 8.5,
    hubY - dot * 8 + Math.sin(time * 4.5) * 2,
    dot * 0.9,
    'dot',
  );

  // Draw the 4 islands & their icons
  islands.forEach((isl, idx) => {
    const isHit = activeIsland === idx;
    drawZonePad(ctx, isl.x, isl.y, padW, isl.label, isl.sub, isl.color, isHit, time, idx === 0);
    const iconY = isl.y - dot * 7.2 + Math.sin(time * 2.8 + idx) * 2;
    if (idx === 0) {
      drawPixelSprite(ctx, CLOUD_CASTLE, CLOUD_CASTLE_COLORS, isl.x, iconY - dot * 2, dot * 0.56, 'dot');
    } else if (idx === 1) {
      drawPixelSprite(ctx, ROCKET_PR, makeRocketColors(PALETTE.lavender), isl.x, iconY, dot * 0.85, 'dot');
    } else if (idx === 2) {
      drawPixelSprite(ctx, FILE_SPRITE, makeFileColors(PALETTE.butter, PALETTE.cream), isl.x, iconY, dot * 0.82, 'dot');
    } else {
      drawPixelSprite(ctx, SHIELD_ICON, makeShieldColors(PALETTE.mint, PALETTE.mintDark), isl.x, iconY, dot * 0.72, 'dot');
    }
  });
}

// ===========================================================================
// CH6: 토큰 보안 — 마스터키 vs 카드키 문지기 (3 Pixel Repo Doors)
// ===========================================================================

function drawCh6Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const isClassic = sim.token.mode === 'classic';
  const kind = sim.lastAnim.kind;
  const padY = h * 0.76;

  // Left: Buddy holding Classic Master Key vs Fine-grained Cardkey
  const buddyZoneX = w * 0.18;
  drawZonePad(
    ctx,
    buddyZoneX,
    padY,
    clamp(w * 0.21, 120, 168),
    isClassic ? '클래식 토큰' : '세분화 토큰',
    isClassic ? '넓은 권한' : '한 곳에 쓰기',
    isClassic ? PALETTE.coral : PALETTE.mint,
    true,
    time,
  );

  const b = moveBuddySmooth(motion, 'ch6', 0.16, 0.66);
  drawBuddyWithIdleLife(
    ctx,
    b.x * w,
    b.y * h,
    dot,
    isClassic ? 'shocked' : kind === 'TOKEN_FINE' && animProgress < 0.85 ? 'happy' : 'idle',
    false,
    false,
    time,
  );

  // Floating active key sprite next to Buddy
  const keyX = buddyZoneX + dot * 10.5;
  const keyY = padY - dot * 10 + Math.sin(time * 4) * 2.5;
  if (isClassic) {
    drawPixelSprite(ctx, KEY_CLASSIC, KEY_CLASSIC_COLORS, keyX, keyY, dot * 0.9, 'dot');
  } else {
    drawPixelSprite(ctx, KEY_FINE, KEY_FINE_COLORS, keyX, keyY, dot * 0.95, 'dot');
  }

  // Right: 3 Pixel Repo Vault Doors
  const doors = [
    { x: w * 0.46, name: '내 앱', sub: 'my-app', open: true, danger: false },
    { x: w * 0.65, name: '회사 결제', sub: 'billing-api', open: isClassic, danger: isClassic },
    { x: w * 0.84, name: '비밀 설정', sub: 'infra-secrets', open: isClassic, danger: isClassic },
  ] as const;

  const doorW = clamp(w * 0.145, 86, 124);
  const doorH = dot * 19;

  doors.forEach((door, idx) => {
    const doorTopY = padY - doorH - dot * 2.5;
    const accent = door.danger ? PALETTE.coral : door.open ? PALETTE.mint : PALETTE.sky;

    // Connecting access beam from Buddy's key
    drawDottedTrack(
      ctx,
      keyX + dot * 6,
      keyY,
      door.x,
      doorTopY + doorH * 0.5,
      accent,
      time,
      door.open,
      idx === 1 ? -10 : idx === 2 ? -22 : 6,
    );

    // Door frame
    ctx.save();
    ctx.fillStyle = door.open ? withAlpha(accent, 0.16) : PALETTE.woodDark;
    ctx.beginPath();
    ctx.roundRect(door.x - doorW * 0.5, doorTopY, doorW, doorH, 8);
    ctx.fill();

    ctx.strokeStyle = accent;
    ctx.lineWidth = door.danger ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.roundRect(door.x - doorW * 0.5, doorTopY, doorW, doorH, 8);
    ctx.stroke();
    ctx.restore();

    // Padlock & Shield icon inside door
    const lockGrid = door.open ? LOCK_ICON.open : LOCK_ICON.closed;
    const lockColors = door.danger
      ? makeLockColors(PALETTE.coral, PALETTE.coralDark)
      : door.open
        ? makeLockColors(PALETTE.mint, PALETTE.mintDark)
        : makeLockColors(PALETTE.sky, PALETTE.skyDark);

    drawPixelSprite(ctx, lockGrid, lockColors, door.x, doorTopY + doorH * 0.48, dot * 0.88, 'dot');

    // Warning flashing `!` dots for exposed classic doors OR green shields for protected doors!
    if (door.danger) {
      const blink = Math.sin(time * 8 + idx) > 0;
      if (blink) {
        drawPixelBadge(ctx, door.x, doorTopY - dot * 3.2, '권한 과다', PALETTE.coral, PALETTE.ink, PALETTE.cream, 10);
      }
    } else if (!door.open) {
      drawPixelSprite(
        ctx,
        SHIELD_ICON,
        makeShieldColors(PALETTE.mint, PALETTE.mintDark),
        door.x + doorW * 0.34,
        doorTopY + dot * 2,
        dot * 0.55,
        'dot',
      );
    }

    drawZonePad(ctx, door.x, padY, doorW + 10, door.name, door.open ? '열림' : '안전 잠금', accent, door.danger || idx === 0, time);
  });

  // SSO & SSH glowing badges above the vault doors
  if (sim.token.ssoAuthorized) {
    drawPixelBadge(ctx, w * 0.52, h * 0.45, '조직 인증', PALETTE.cream, PALETTE.skyDark, PALETTE.sky);
  }
  if (sim.token.sshReady) {
    drawPixelBadge(ctx, w * 0.77, h * 0.45, 'SSH 연결', PALETTE.cream, PALETTE.mintDark, PALETTE.mint);
  }
}

// ===========================================================================
// CH7: GHES 사내망 — 공용 구름 vs 방화벽 성벽 vs 사내 GHES 벽돌 성
// ===========================================================================

function drawCh7Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const publicX = w * 0.19;
  const wallX = w * 0.47;
  const castleX = w * 0.76;
  const baseY = h * 0.71;
  const kind = sim.lastAnim.kind;
  const connected = sim.ghes.connected;

  // Left: Public GitHub.com Cloud
  drawPixelSprite(
    ctx,
    CLOUD_CASTLE,
    CLOUD_CASTLE_COLORS,
    publicX,
    h * 0.58 + Math.sin(time * 2) * 3,
    dot * 0.9,
    'dot',
  );
  drawZonePad(
    ctx,
    publicX,
    baseY,
    clamp(w * 0.19, 104, 152),
    '공용 GitHub',
    'github.com',
    PALETTE.sky,
    kind === 'GHES_BLOCK',
    time,
  );

  // Center: Tall dotted Firewall Wall (y = 45%..75%) + Lower VPN Tunnel (y = 78%)
  const wallTop = h * 0.46;
  const wallBot = h * 0.73;
  const wallW = dot * 7.5;

  ctx.save();
  ctx.fillStyle = PALETTE.woodDark;
  ctx.beginPath();
  ctx.roundRect(wallX - wallW * 0.5, wallTop, wallW, wallBot - wallTop, 5);
  ctx.fill();
  ctx.strokeStyle = PALETTE.coral;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(wallX - wallW * 0.5, wallTop, wallW, wallBot - wallTop, 5);
  ctx.stroke();

  // Glowing coral firewall barrier LED dots
  for (let py = wallTop + 8; py < wallBot - 6; py += 12) {
    ctx.fillStyle = Math.sin(time * 6 + py * 0.1) > 0 ? PALETTE.coral : PALETTE.coralDark;
    ctx.fillRect(wallX - 2.5, py, 5, 5);
  }
  ctx.restore();

  drawPixelSprite(
    ctx,
    SHIELD_ICON,
    makeShieldColors(PALETTE.coral, PALETTE.coralDark),
    wallX,
    (wallTop + wallBot) * 0.5,
    dot * 0.78,
    'dot',
  );
  drawPixelBadge(ctx, wallX, wallTop - 14, '방화벽', PALETTE.cream, PALETTE.coralDark, PALETTE.coral);

  // Lower VPN/SAML tunnel under the wall
  const tunnelY = h * 0.94;
  drawDottedTrack(
    ctx,
    publicX + w * 0.08,
    tunnelY,
    castleX - w * 0.09,
    tunnelY,
    connected ? PALETTE.mint : PALETTE.slateMuted,
    time,
    connected,
  );
  drawPixelBadge(
    ctx,
    wallX,
    tunnelY + 14,
    connected ? 'VPN 연결' : 'VPN 인증 필요',
    PALETTE.cream,
    connected ? PALETTE.mintDark : PALETTE.textSecondary,
    connected ? PALETTE.mint : PALETTE.woodBorder,
    9.5,
  );

  // Right: Corporate GHES Castle Fortress
  drawPixelSprite(
    ctx,
    CASTLE_TOWER,
    makeCastleColors(connected),
    castleX,
    h * 0.59,
    dot * 1.05,
    'dot',
  );
  drawZonePad(
    ctx,
    castleX,
    baseY,
    clamp(w * 0.39, 148, 202),
    '사내 GitHub',
    sim.ghes.host,
    connected ? PALETTE.mint : PALETTE.woodBorder,
    connected,
    time,
    true,
  );

  // Private Runner mini pod beside castle
  const runnerX = w * 0.9;
  const runnerY = h * 0.36;
  const runnerActive = kind === 'GHES_RUNNER' || sim.ghes.lastFlow === 'runner';
  drawPixelSprite(
    ctx,
    AI_BOT,
    {
      ...AI_BOT_COLORS,
      v: runnerActive ? PALETTE.mint : PALETTE.woodLight,
      l: runnerActive ? PALETTE.mintLight : PALETTE.slate,
    },
    runnerX,
    runnerY + Math.sin(time * (runnerActive ? 6 : 2)) * 2.5,
    dot * 0.65,
    'dot',
  );
  drawPixelBadge(
    ctx,
    runnerX,
    runnerY + dot * 6.2,
    '사내 실행기',
    PALETTE.cream,
    runnerActive ? PALETTE.mintDark : PALETTE.textSecondary,
    runnerActive ? PALETTE.mint : PALETTE.woodBorder,
    9.5,
  );

  // Blocked intruder packet bouncing off firewall on GHES_BLOCK!
  if ((kind === 'GHES_BLOCK' || sim.ghes.lastFlow === 'blocked') && animProgress < 0.95) {
    const bounceT = animProgress < 0.45 ? animProgress / 0.45 : 1 - (animProgress - 0.45) / 0.5;
    const pktX = publicX + (wallX - dot * 7 - publicX) * clamp(bounceT, 0, 1);
    const pktY = h * 0.59 - Math.sin(bounceT * Math.PI) * 16;
    drawPixelSprite(ctx, FILE_SPRITE, makeFileColors(PALETTE.coral, PALETTE.coralLight), pktX, pktY, dot * 0.8, 'dot');
    if (animProgress > 0.35 && animProgress < 0.85) {
      drawPixelBadge(ctx, wallX - dot * 12, h * 0.52, '차단됨!', PALETTE.coral, PALETTE.ink, PALETTE.cream, 10);
    }
  }

  // Encrypted /api/v3 packet cruising through lower VPN tunnel!
  if (kind === 'GHES_API' && animProgress < 0.95) {
    const t = easeOutCubic(animProgress);
    const px = publicX + w * 0.1 + (castleX - publicX - w * 0.16) * t;
    drawPixelSprite(
      ctx,
      COMMIT_GEM,
      makeGemColors(PALETTE.mint, PALETTE.cream, PALETTE.mintDark),
      px,
      tunnelY - dot * 2,
      dot * 0.78,
      'dot',
    );
  }

  // Buddy puts on hardhat & walks through the VPN tunnel into the GHES Castle!
  const targetX = connected ? 0.64 : 0.3;
  const targetY = connected ? 0.72 : 0.69;
  const b = moveBuddySmooth(motion, 'ch7', targetX, targetY);
  const pose: BuddyPose =
    kind === 'GHES_BLOCK' && animProgress < 0.85
      ? 'shocked'
      : connected
        ? 'hardhat'
        : 'idle';
  drawBuddyWithIdleLife(ctx, b.x * w, b.y * h, dot, pose, b.walking, b.flipX, time);
}

// ===========================================================================
// CH8: AI 에이전트 — 워크트리 작업실 & 사람 승인 문
// ===========================================================================

function drawCh8Scene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  const dot = computeDotSize(w, h);
  const kind = sim.lastAnim.kind;
  const ai = sim.ai;

  const mainX = w * 0.18;
  const mainY = h * 0.56;
  const wtX = w * 0.18;
  const wtY = h * 0.8;
  const shieldX = w * 0.46;
  const shieldY = h * 0.56;
  const gateX = w * 0.67;
  const gateY = h * 0.72;
  const ghX = w * 0.87;
  const ghY = h * 0.62;
  const padW = clamp(w * 0.18, 102, 150);

  // Left-Upper: Human main workspace (stays clean!)
  drawZonePad(ctx, mainX, mainY, padW, '내 작업 폴더', 'main 보호 중', PALETTE.sky, true, time);
  drawPixelSprite(ctx, FILE_SPRITE, makeFileColors(PALETTE.sky, PALETTE.skyLight), mainX - dot * 5, mainY - dot * 6.5, dot * 0.75, 'dot');

  // Left-Lower: AI dedicated Worktree room with dotted lavender walls
  if (ai.worktreeActive) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = PALETTE.lavender;
    ctx.lineWidth = 2;
    ctx.fillStyle = withAlpha(PALETTE.lavender, 0.08);
    ctx.beginPath();
    ctx.roundRect(wtX - padW * 0.58, wtY - dot * 14, padW * 1.16, dot * 17, 10);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  drawZonePad(
    ctx,
    wtX,
    wtY,
    padW,
    'AI 작업 폴더',
    ai.worktreeActive ? ai.worktreeBranch : '생성 대기 중',
    PALETTE.lavender,
    ai.worktreeActive,
    time,
    ai.worktreeActive,
  );

  // Center-Upper: main protection shield barrier!
  drawDottedTrack(
    ctx,
    mainX + padW * 0.5,
    mainY,
    shieldX - dot * 7,
    shieldY,
    PALETTE.sky,
    time,
    false,
  );
  drawPixelSprite(
    ctx,
    SHIELD_ICON,
    makeShieldColors(PALETTE.coral, PALETTE.coralDark),
    shieldX,
    shieldY - dot * 1.5,
    dot * 0.95,
    'dot',
  );
  drawPixelBadge(ctx, shieldX, shieldY + dot * 8, 'main 보호 방어막', PALETTE.cream, PALETTE.coralDark, PALETTE.coral, 10);

  // Dotted PR track: Worktree -> Human Approval Gate -> GitHub Cloud
  drawDottedTrack(
    ctx,
    wtX + padW * 0.5,
    wtY - dot * 2,
    gateX - padW * 0.42,
    gateY,
    PALETTE.lavender,
    time,
    Boolean(ai.prNumber) || kind === 'AI_PR',
    -14,
  );
  drawDottedTrack(
    ctx,
    gateX + padW * 0.42,
    gateY,
    ghX - dot * 10,
    ghY + dot * 4,
    ai.humanApproved ? PALETTE.mint : PALETTE.woodBorder,
    time,
    ai.humanApproved || kind === 'AI_APPROVE',
    -12,
  );

  // Center-Right: Human Approval Gate
  drawZonePad(
    ctx,
    gateX,
    gateY,
    clamp(w * 0.175, 102, 148),
    '사람 승인',
    ai.humanApproved ? '승인 완료' : ai.prNumber ? `PR #${ai.prNumber} 검토 중` : '검토 대기',
    ai.humanApproved ? PALETTE.mint : PALETTE.butter,
    Boolean(ai.prNumber) || ai.humanApproved,
    time,
  );

  // Far Right: GitHub Cloud Castle
  drawPixelSprite(ctx, CLOUD_CASTLE, CLOUD_CASTLE_COLORS, ghX, ghY + Math.sin(time * 2.2) * 3, dot * 0.88, 'dot');
  drawPixelBadge(
    ctx,
    ghX,
    ghY + dot * 10,
    ai.merged ? '병합 완료' : 'GitHub',
    PALETTE.cream,
    ai.merged ? PALETTE.mintDark : PALETTE.skyDark,
    ai.merged ? PALETTE.mint : PALETTE.sky,
    10,
  );

  // Cute lavender AI Mini-Bot position & animations
  let aiX = wtX;
  let aiY = wtY - dot * 8 + Math.sin(time * 4.2) * 3.5;

  if (kind === 'AI_BLOCK_MAIN' && animProgress < 0.95) {
    // AI bot zips toward main shield, BONKS off, and bounces back!
    const rush = animProgress < 0.4 ? animProgress / 0.4 : 1 - (animProgress - 0.4) / 0.55;
    const clampedRush = clamp(rush, 0, 1);
    aiX = wtX + (shieldX - dot * 9 - wtX) * clampedRush;
    aiY = wtY - dot * 8 + (shieldY - (wtY - dot * 8)) * clampedRush;
    if (animProgress > 0.35 && animProgress < 0.82) {
      drawPixelBadge(ctx, shieldX, shieldY - dot * 10, '직접 푸시 차단!', PALETTE.coral, PALETTE.ink, PALETTE.cream, 10);
      drawPixelSprite(ctx, SPARKLE_ICON, { c: PALETTE.butter, l: PALETTE.coral, w: PALETTE.cream }, aiX + dot * 5, aiY - dot * 5, dot * 0.7, 'dot');
    }
  }

  if (ai.worktreeActive || kind === 'AI_BLOCK_MAIN') {
    const botFrame = Math.floor(time * 6) % 2 === 0 ? AI_BOT : AI_BOT_HOVER;
    drawPixelSprite(ctx, botFrame, AI_BOT_COLORS, aiX, aiY, dot * 0.95, 'dot');
    if (ai.codeWritten) {
      drawPixelSprite(
        ctx,
        FILE_SPRITE,
        makeFileColors(PALETTE.lavender, PALETTE.cream),
        wtX + dot * 9.5,
        wtY - dot * 7 + Math.sin(time * 3.5) * 2,
        dot * 0.72,
        'dot',
      );
    }
  }

  // Draft PR rocket flight from Worktree -> Human Approval Gate -> GitHub Cloud
  const t = easeOutCubic(animProgress);
  if (kind === 'AI_PR' && animProgress < 0.95) {
    const rx = wtX + (gateX - wtX) * t;
    const ry = wtY - dot * 8 + (gateY - dot * 10 - (wtY - dot * 8)) * t - Math.sin(animProgress * Math.PI) * 32;
    drawPixelSprite(ctx, ROCKET_PR, makeRocketColors(PALETTE.lavender), rx, ry, dot * 0.95, 'dot');
  } else if (kind === 'AI_APPROVE' && animProgress < 0.95) {
    const rx = gateX + (ghX - gateX) * t;
    const ry = gateY - dot * 9 + (ghY - (gateY - dot * 9)) * t - Math.sin(animProgress * Math.PI) * 28;
    drawPixelSprite(ctx, ROCKET_PR, makeRocketColors(PALETTE.mint), rx, ry, dot * 1.0, 'dot');
  } else if (ai.prNumber && !ai.merged) {
    drawPixelSprite(
      ctx,
      ROCKET_PR,
      makeRocketColors(PALETTE.lavender),
      gateX - dot * 10,
      gateY - dot * 8 + Math.sin(time * 4) * 2.5,
      dot * 0.85,
      'dot',
    );
  }

  // GitDot Buddy stands proudly at the Human Approval Gate!
  const b = moveBuddySmooth(motion, 'ch8', 0.67, 0.635);
  const pose: BuddyPose =
    kind === 'AI_BLOCK_MAIN' && animProgress < 0.8
      ? 'shocked'
      : (ai.humanApproved || kind === 'AI_APPROVE') && animProgress < 0.95
        ? 'happy'
        : 'idle';
  drawBuddyWithIdleLife(ctx, b.x * w, b.y * h, dot, pose, b.walking, b.flipX, time);
}

// ===========================================================================
// Public Stage Dispatcher + Particle Event Coordinate Helper
// ===========================================================================

export function drawStageScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: PixelSimState,
  animProgress: number,
  time: number,
  motion: SceneMotionState,
): void {
  switch (sim.stageId) {
    case 'ch1':
      drawCh1Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch2':
      drawCh2Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch3':
      drawCh3Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch4':
      drawCh4Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch5':
      drawCh5Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch6':
      drawCh6Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch7':
      drawCh7Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
    case 'ch8':
      drawCh8Scene(ctx, w, h, sim, animProgress, time, motion);
      break;
  }
}

export interface ParticleCue {
  kind: 'sparkles' | 'confetti' | 'sweat' | 'smoke' | 'shockwave' | 'parcel';
  x: number;
  y: number;
  x1?: number;
  y1?: number;
  color: string;
}

/** Returns tailored pixel-particle cues whenever a new terminal command executes. */
export function getParticleCuesForAnim(
  stageId: PixelSimState['stageId'],
  animKind: PixelAnimKind,
  w: number,
  h: number,
): ParticleCue[] {
  switch (animKind) {
    case 'EDIT':
      return [{ kind: 'sparkles', x: w * 0.16, y: h * 0.65, color: PALETTE.butter }];
    case 'ADD':
      return [
        { kind: 'parcel', x: w * 0.16, y: h * 0.66, x1: w * 0.39, y1: h * 0.66, color: PALETTE.mint },
        { kind: 'sparkles', x: w * 0.39, y: h * 0.64, color: PALETTE.mint },
      ];
    case 'COMMIT':
      return [
        { kind: 'shockwave', x: w * (stageId === 'ch1' ? 0.62 : 0.56), y: h * 0.64, color: PALETTE.cream },
        { kind: 'sparkles', x: w * (stageId === 'ch1' ? 0.62 : 0.56), y: h * 0.64, color: PALETTE.sky },
      ];
    case 'PUSH':
      return [
        { kind: 'parcel', x: w * (stageId === 'ch1' ? 0.62 : 0.18), y: h * 0.64, x1: w * 0.84, y1: h * 0.56, color: PALETTE.sky },
        { kind: 'confetti', x: w * 0.84, y: h * 0.56, color: PALETTE.butter },
      ];
    case 'PULL':
    case 'FETCH':
      return [
        { kind: 'parcel', x: w * 0.84, y: h * 0.56, x1: w * 0.62, y1: h * 0.66, color: PALETTE.mint },
        { kind: 'sparkles', x: w * 0.62, y: h * 0.66, color: PALETTE.mint },
      ];
    case 'STASH':
      return [
        { kind: 'parcel', x: w * 0.5, y: h * 0.65, x1: w * 0.2, y1: h * 0.28, color: PALETTE.butter },
        { kind: 'smoke', x: w * 0.2, y: h * 0.28, color: PALETTE.butter },
      ];
    case 'STASH_POP':
      return [
        { kind: 'parcel', x: w * 0.2, y: h * 0.28, x1: w * 0.5, y1: h * 0.65, color: PALETTE.mint },
        { kind: 'sparkles', x: w * 0.5, y: h * 0.6, color: PALETTE.mint },
      ];
    case 'RESET':
      return [
        { kind: 'smoke', x: w * 0.72, y: h * 0.6, color: PALETTE.slate },
        { kind: 'sweat', x: w * 0.52, y: h * 0.56, color: PALETTE.sky },
      ];
    case 'REVERT':
      return [
        { kind: 'shockwave', x: w * 0.78, y: h * 0.62, color: PALETTE.mint },
        { kind: 'sparkles', x: w * 0.78, y: h * 0.62, color: PALETTE.mint },
      ];
    case 'BRANCH':
    case 'SWITCH':
      return [{ kind: 'sparkles', x: w * 0.46, y: h * 0.54, color: PALETTE.lavender }];
    case 'CONFLICT':
      return [
        { kind: 'shockwave', x: w * 0.7, y: h * 0.64, color: PALETTE.coral },
        { kind: 'sweat', x: w * 0.58, y: h * 0.6, color: PALETTE.sky },
      ];
    case 'RESOLVE':
    case 'MERGE_OK':
    case 'REBASE':
      return [
        { kind: 'confetti', x: w * 0.72, y: h * 0.68, color: PALETTE.mint },
        { kind: 'shockwave', x: w * 0.72, y: h * 0.72, color: PALETTE.mint },
      ];
    case 'PR_CREATE':
      return [
        { kind: 'parcel', x: w * 0.18, y: h * 0.68, x1: w * 0.5, y1: h * 0.58, color: PALETTE.lavender },
        { kind: 'shockwave', x: w * 0.5, y: h * 0.58, color: PALETTE.mint },
      ];
    case 'PR_MERGE':
      return [
        { kind: 'confetti', x: w * 0.82, y: h * 0.56, color: PALETTE.mint },
        { kind: 'sparkles', x: w * 0.82, y: h * 0.56, color: PALETTE.butter },
      ];
    case 'GH_CMD':
      return [
        { kind: 'sparkles', x: w * 0.25, y: h * 0.66, color: PALETTE.butter },
        { kind: 'sparkles', x: w * 0.68, y: h * 0.64, color: PALETTE.sky },
      ];
    case 'TOKEN_CLASSIC':
      return [
        { kind: 'shockwave', x: w * 0.65, y: h * 0.66, color: PALETTE.coral },
        { kind: 'sweat', x: w * 0.18, y: h * 0.62, color: PALETTE.sky },
      ];
    case 'TOKEN_FINE':
    case 'TOKEN_SSO':
    case 'TOKEN_SSH':
      return [
        { kind: 'sparkles', x: w * 0.46, y: h * 0.64, color: PALETTE.mint },
        { kind: 'confetti', x: w * 0.65, y: h * 0.58, color: PALETTE.mint },
      ];
    case 'TOKEN_BLOCK':
      return [{ kind: 'shockwave', x: w * 0.65, y: h * 0.64, color: PALETTE.coral }];
    case 'GHES_BLOCK':
      return [
        { kind: 'shockwave', x: w * 0.47, y: h * 0.59, color: PALETTE.coral },
        { kind: 'sweat', x: w * 0.3, y: h * 0.66, color: PALETTE.sky },
      ];
    case 'GHES_LOGIN':
    case 'GHES_API':
    case 'GHES_RUNNER':
      return [
        { kind: 'parcel', x: w * 0.28, y: h * 0.81, x1: w * 0.74, y1: h * 0.81, color: PALETTE.mint },
        { kind: 'sparkles', x: w * 0.76, y: h * 0.58, color: PALETTE.mint },
      ];
    case 'AI_WORKTREE':
    case 'AI_CODE':
      return [{ kind: 'sparkles', x: w * 0.18, y: h * 0.74, color: PALETTE.lavender }];
    case 'AI_BLOCK_MAIN':
      return [
        { kind: 'shockwave', x: w * 0.46, y: h * 0.56, color: PALETTE.coral },
        { kind: 'sweat', x: w * 0.67, y: h * 0.6, color: PALETTE.sky },
      ];
    case 'AI_PR':
      return [
        { kind: 'parcel', x: w * 0.22, y: h * 0.76, x1: w * 0.67, y1: h * 0.66, color: PALETTE.lavender },
        { kind: 'sparkles', x: w * 0.67, y: h * 0.66, color: PALETTE.butter },
      ];
    case 'AI_APPROVE':
      return [
        { kind: 'confetti', x: w * 0.86, y: h * 0.58, color: PALETTE.mint },
        { kind: 'shockwave', x: w * 0.67, y: h * 0.68, color: PALETTE.mint },
      ];
    default:
      return [];
  }
}
