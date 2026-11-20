import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { STAGE_MAP } from '../engine';
import { usePixelStore } from '../store/usePixelStore';
import {
  ALL_STAGE_IDS,
  type BubbleAction,
  type PixelAnimKind,
  type PixelSimState,
  type StageStep,
} from '../types/sim';
import { SPEAKER_THEMES } from './palette';
import { PixelParticlePool, drawDotGridBackground } from './dotMatrixRenderer';
import {
  createSceneMotion,
  drawStageScene,
  getParticleCuesForAnim,
} from './sceneDrawers';

function isStepDone(step: StageStep, completed: PixelAnimKind[]): boolean {
  if (Array.isArray(step.doneAction)) {
    return step.doneAction.some((act) => completed.includes(act));
  }
  return completed.includes(step.doneAction);
}

const ACTION_TONE_CLASSES: Readonly<Record<NonNullable<BubbleAction['tone']>, string>> = {
  primary: 'bg-[#6BCBFF] hover:bg-[#8ED8FF] text-[#131722] border-[#368DC4]',
  mint: 'bg-[#5CE1B8] hover:bg-[#7EEAC8] text-[#131722] border-[#2E9F7D]',
  coral: 'bg-[#FF7B89] hover:bg-[#FF96A1] text-[#131722] border-[#C94B5A]',
  amber: 'bg-[#FFD166] hover:bg-[#FFDD87] text-[#131722] border-[#C99B32]',
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function PixelStageCanvas() {
  const stageId = usePixelStore((s) => s.stageId);
  const sim = usePixelStore((s) => s.sim);
  const runCommand = usePixelStore((s) => s.runCommand);
  const setStage = usePixelStore((s) => s.setStage);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const simRef = useRef<PixelSimState>(sim);
  simRef.current = sim;

  const [stageSize, setStageSize] = useState({ width: 960, height: 420 });
  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;

  // Track container dimensions cleanly via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(240, Math.round(rect.width));
      const height = Math.max(220, Math.round(rect.height));
      setStageSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 60fps HiDPI Canvas Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles = new PixelParticlePool();
    const motion = createSceneMotion();

    let rafId = 0;
    let prevTs = performance.now();
    let elapsed = 0;
    let animProgress = 1;
    let lastSeq = simRef.current.lastAnim.seq;
    let lastStageId = simRef.current.stageId;

    const renderFrame = (now: number) => {
      const dt = Math.min((now - prevTs) / 1000, 0.05);
      prevTs = now;
      elapsed += dt;

      const currentSim = simRef.current;
      const { width, height } = stageSizeRef.current;

      // Sync HiDPI backing store only when size or DPR changes
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      // Reset motion & particles cleanly on stage switch
      if (currentSim.stageId !== lastStageId) {
        lastStageId = currentSim.stageId;
        lastSeq = currentSim.lastAnim.seq;
        animProgress = 1;
        particles.clear();
      }

      // Trigger fresh animation curve + pixel particle bursts on every new command!
      if (currentSim.lastAnim.seq !== lastSeq) {
        lastSeq = currentSim.lastAnim.seq;
        animProgress = 0;

        const cues = getParticleCuesForAnim(
          currentSim.stageId,
          currentSim.lastAnim.kind,
          width,
          height,
        );
        for (const cue of cues) {
          if (cue.kind === 'sparkles') {
            particles.spawnSparkles(cue.x, cue.y, cue.color, 14);
          } else if (cue.kind === 'confetti') {
            particles.spawnConfetti(cue.x, cue.y, 26);
          } else if (cue.kind === 'sweat') {
            particles.spawnSweat(cue.x, cue.y, 6);
          } else if (cue.kind === 'smoke') {
            particles.spawnSmoke(cue.x, cue.y, cue.color, 8);
          } else if (cue.kind === 'shockwave') {
            particles.spawnShockwave(cue.x, cue.y, cue.color, 52);
          } else if (cue.kind === 'parcel' && cue.x1 !== undefined && cue.y1 !== undefined) {
            particles.spawnParcel(cue.x, cue.y, cue.x1, cue.y1, cue.color, 58, 0.65);
          }
        }
      }

      // Smoothly advance action transition (0..1 over ~0.88s)
      if (animProgress < 1) {
        animProgress = Math.min(1, animProgress + dt * 1.15);
      }

      particles.update(dt);

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 1. Cozy LED dot-matrix background
      drawDotGridBackground(ctx, width, height, elapsed);

      // 2. Live 8-stage Pixel-Dots scene
      drawStageScene(ctx, width, height, currentSim, animProgress, elapsed, motion);

      // 3. Foreground celebratory pixel particles
      particles.draw(ctx);

      ctx.restore();

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  // Step progress & next-chapter celebration logic
  const scenario = STAGE_MAP[stageId];
  const { totalSteps, doneCount, allDone, nextStageId } = useMemo(() => {
    const steps = scenario?.steps ?? [];
    const done = steps.filter((step) => isStepDone(step, sim.completedActions)).length;
    const total = steps.length;
    const completedAll = total > 0 && done >= total;
    const currentIdx = ALL_STAGE_IDS.indexOf(stageId);
    const nextId =
      currentIdx >= 0 && currentIdx < ALL_STAGE_IDS.length - 1
        ? ALL_STAGE_IDS[currentIdx + 1]
        : null;
    return {
      totalSteps: total,
      doneCount: done,
      allDone: completedAll,
      nextStageId: nextId,
    };
  }, [scenario, sim.completedActions, stageId]);

  const currentStepDisplay = totalSteps > 0 ? Math.min(doneCount + (allDone ? 0 : 1), totalSteps) : 1;

  // Position floating Korean pixel speech bubbles safely inside top airy sky (never clipped!)
  const positionedBubbles = useMemo(() => {
    const list = sim.bubbles.slice(0, 2);
    const minSafeBottomPct =
      stageSize.height > 0 ? Math.min(52, (150 / stageSize.height) * 100) : 38;

    return list.map((bubble, idx) => {
      let leftPct = clamp(bubble.anchorX, 18, 82);
      // Prevent two simultaneous bubbles from overlapping horizontally
      if (list.length === 2) {
        leftPct = idx === 0 ? clamp(leftPct, 22, 42) : clamp(leftPct, 58, 78);
      }
      const rawTopPct = clamp(bubble.anchorY, 22, 52);
      const topPct = Math.max(rawTopPct, minSafeBottomPct);
      return { bubble, leftPct, topPct };
    });
  }, [sim.bubbles, stageSize.height]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#161B2B] select-none"
    >
      {/* Full-bleed HiDPI Pixel-Dots Canvas */}
      <canvas
        ref={canvasRef}
        data-testid="pixel-stage-canvas"
        className="block w-full h-full"
        aria-label={scenario ? `${scenario.title} 픽셀 애니메이션 무대` : '픽셀 애니메이션 무대'}
      />

      {/* Top-Left: Compact Step Tracker Badge */}
      {scenario && totalSteps > 0 && (
        <div
          data-testid="stage-step-badge"
          className="absolute top-3 left-3 z-20 flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-[#111626]/90 border-2 border-[#2B3553] shadow-[0_4px_0_rgba(9,12,20,0.65)] backdrop-blur-xs"
        >
          <div className="flex items-center gap-1" aria-hidden="true">
            {scenario.steps.map((step, idx) => {
              const done = isStepDone(step, sim.completedActions);
              const isCurrent = !done && idx === doneCount;
              return (
                <span
                  key={step.id}
                  className={[
                    'w-2 h-2 rounded-[2px] transition-all duration-200',
                    done
                      ? 'bg-[#5CE1B8] shadow-[0_0_6px_rgba(92,225,184,0.8)]'
                      : isCurrent
                        ? 'bg-[#FFD166] animate-pulse'
                        : 'bg-[#36415E]',
                  ].join(' ')}
                />
              );
            })}
          </div>
          <span className="font-pixel text-[11px] sm:text-xs font-bold text-[#FFF8EB] whitespace-nowrap">
            {allDone ? (
              <span className="text-[#5CE1B8] inline-flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {totalSteps}단계 / {totalSteps}단계 완료
              </span>
            ) : (
              <span>
                {currentStepDisplay}단계 / {totalSteps}단계
              </span>
            )}
          </span>
        </div>
      )}

      {/* Top-Right: Celebratory "다음 챕터로 →" Pill ONLY when chapter completed */}
      {allDone && (
        <div className="absolute top-3 right-3 z-20">
          {nextStageId ? (
            <button
              type="button"
              data-testid="next-chapter-btn"
              onClick={() => setStage(nextStageId)}
              className="pixel-btn px-3.5 py-1.5 rounded-full bg-[#5CE1B8] hover:bg-[#7EEAC8] text-[#131722] border-[#2E9F7D] font-pixel text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-[0_4px_0_#0A0D16,0_0_16px_rgba(92,225,184,0.35)]"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>다음 챕터로</span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="all-chapters-done-btn"
              onClick={() => setStage('ch1')}
              className="pixel-btn px-3.5 py-1.5 rounded-full bg-[#FFD166] hover:bg-[#FFDD87] text-[#131722] border-[#C99B32] font-pixel text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-[0_4px_0_#0A0D16,0_0_16px_rgba(255,209,102,0.35)]"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>모든 챕터 완주!</span>
            </button>
          )}
        </div>
      )}

      {/* Floating Crisp Korean Pixel Speech Bubbles Overlay */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {positionedBubbles.map(({ bubble, leftPct, topPct }) => {
          const theme = SPEAKER_THEMES[bubble.speaker];
          const cleanHint = bubble.nextHint
            ? bubble.nextHint.replace(/^(👉\s*)?(다음\s*:\s*)?/, '')
            : null;

          return (
            <div
              key={`${bubble.id}-${sim.lastAnim.seq}`}
              data-testid="speech-bubble"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                borderColor: theme.border,
              }}
              className="pointer-events-auto animate-bubble-pop pixel-bubble absolute w-[min(90vw,365px)] rounded-xl bg-[#1A2136]/95 backdrop-blur-xs px-3.5 py-2.5 text-left"
            >
              {/* Speaker Pill + Title */}
              <div className="flex items-center gap-2 mb-1">
                <span
                  style={{
                    backgroundColor: theme.badgeBg,
                    color: theme.badgeText,
                    borderColor: theme.border,
                  }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10.5px] font-pixel font-bold shrink-0"
                >
                  <span
                    style={{ backgroundColor: theme.dot }}
                    className="w-1.5 h-1.5 rounded-[1px] shrink-0"
                  />
                  {bubble.speakerName}
                </span>
                <h3 className="font-pixel text-[12.5px] sm:text-[13px] font-bold text-[#FFF8EB] truncate">
                  {bubble.title}
                </h3>
              </div>

              {/* Warm 1-2 line Korean explanation */}
              <p className="text-[12px] sm:text-[12.5px] leading-snug text-[#D9E2F5] break-keep">
                {bubble.message}
              </p>

              {/* Gentle Next Hint Pill */}
              {cleanHint && (
                <div className="mt-2 flex items-start gap-1.5 px-2.5 py-1 rounded-md bg-[#111626]/90 border border-[#2D3859] text-[11px] text-[#FFE8A3]">
                  <span className="shrink-0">👉 다음:</span>
                  <code className="font-mono-code font-semibold text-[#5CE1B8] break-words min-w-0">
                    {cleanHint}
                  </code>
                </div>
              )}

              {/* Optional Clickable Quick Action Buttons */}
              {bubble.actions && bubble.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {bubble.actions.map((act) => {
                    const toneCls = ACTION_TONE_CLASSES[act.tone ?? 'amber'];
                    return (
                      <button
                        key={`${act.label}-${act.command}`}
                        type="button"
                        onClick={() => runCommand(act.command)}
                        className={`pixel-btn px-2.5 py-1 rounded-md font-pixel text-[11px] font-bold cursor-pointer ${toneCls}`}
                      >
                        {act.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Crisp Pixel Speech-Bubble Pointer Triangle */}
              <div
                aria-hidden="true"
                className="absolute left-1/2 -bottom-[9px] -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[9px]"
                style={{ borderTopColor: theme.border }}
              />
              <div
                aria-hidden="true"
                className="absolute left-1/2 -bottom-[6px] -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[7px] border-t-[#1A2136]"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
