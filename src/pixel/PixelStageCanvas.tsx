import { useEffect, useRef, type CSSProperties } from 'react';
import { getNextPendingStep, STAGE_MAP } from '../engine';
import { usePixelStore } from '../store/usePixelStore';
import type { BubbleAction, PixelSimState } from '../types/sim';
import { SPEAKER_THEMES } from './palette';
import { PIXEL_FONT, PixelParticlePool, drawDotGridBackground } from './dotMatrixRenderer';
import {
  createSceneMotion,
  drawStageScene,
  getParticleCuesForAnim,
  recentTimelineCommits,
} from './sceneDrawers';

const ACTION_TONE_CLASSES: Readonly<Record<NonNullable<BubbleAction['tone']>, string>> = {
  primary: 'bg-[#A8DCFA] hover:bg-[#8ED0F8] text-[#174669] border-[#3292CE]',
  mint: 'bg-[#9BEED5] hover:bg-[#7DE5C6] text-[#115843] border-[#22A882]',
  coral: 'bg-[#FFAEB8] hover:bg-[#FF94A2] text-[#781B27] border-[#E05666]',
  amber: 'bg-[#FFE08A] hover:bg-[#FFD363] text-[#6E4004] border-[#D18D20]',
};

export function PixelStageCanvas() {
  const stageId = usePixelStore((s) => s.stageId);
  const sim = usePixelStore((s) => s.sim);
  const runCommand = usePixelStore((s) => s.runCommand);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const queueDraw = useRef<(() => void) | null>(null);

  const simRef = useRef<PixelSimState>(sim);
  simRef.current = sim;

  const stageSizeRef = useRef({ width: 960, height: 420 });

  // Track container dimensions cleanly via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      stageSizeRef.current = { width, height };
      queueDraw.current?.();
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    queueDraw.current?.();
  }, [sim]);

  // 60fps HiDPI Canvas Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const particles = new PixelParticlePool();
    let motion = createSceneMotion();
    const motionSetting = window.matchMedia('(prefers-reduced-motion: reduce)');

    let rafId = 0;
    let mounted = true;
    let prevTs = performance.now();
    let elapsed = 0;
    let animProgress = 1;
    let lastSeq = simRef.current.lastAnim.seq;
    let lastStageId = simRef.current.stageId;

    const renderFrame = (now: number) => {
      rafId = 0;
      const reduced = motionSetting.matches;
      const dt = Math.min((now - prevTs) / 1000, 0.05);
      prevTs = now;
      elapsed = reduced ? 0 : elapsed + dt;

      const currentSim = simRef.current;
      const { width, height } = stageSizeRef.current;
      const sceneScale = Math.min(1, width / 520);
      const sceneWidth = width / sceneScale;
      const bottomPadding = currentSim.stageId === 'ch6' || currentSim.stageId === 'ch7' ? 32 : 16;
      const sceneHeight = Math.max(1, height - bottomPadding) / sceneScale;

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
      if (reduced) {
        particles.clear();
        motion = createSceneMotion();
        lastSeq = currentSim.lastAnim.seq;
        animProgress = 1;
      } else if (currentSim.lastAnim.seq !== lastSeq) {
        lastSeq = currentSim.lastAnim.seq;
        animProgress = 0;

        const cues = getParticleCuesForAnim(
          currentSim.stageId,
          currentSim.lastAnim.kind,
          sceneWidth,
          sceneHeight,
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
      ctx.scale(sceneScale, sceneScale);
      drawStageScene(ctx, sceneWidth, sceneHeight, currentSim, animProgress, elapsed, motion);

      // 3. Foreground celebratory pixel particles
      particles.draw(ctx);

      ctx.restore();

      if (!reduced) scheduleDraw();
    };

    function scheduleDraw() {
      if (mounted && !rafId) rafId = window.requestAnimationFrame(renderFrame);
    }

    queueDraw.current = scheduleDraw;
    motionSetting.addEventListener('change', scheduleDraw);
    document.fonts.addEventListener('loadingdone', scheduleDraw);
    void document.fonts.load(`400 13px ${PIXEL_FONT}`)
      .catch(() => [])
      .then(() => document.fonts.ready)
      .then(scheduleDraw);
    scheduleDraw();
    return () => {
      mounted = false;
      queueDraw.current = null;
      motionSetting.removeEventListener('change', scheduleDraw);
      document.fonts.removeEventListener('loadingdone', scheduleDraw);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  const scenario = STAGE_MAP[stageId];
  const nextStep = getNextPendingStep(sim);
  const head = sim.branches[sim.headBranch];
  const visibleHistory = stageId === 'ch2' ? recentTimelineCommits(sim) : null;
  const canvasMinHeight = stageId === 'ch2' ? 'min-h-[186px]'
    : stageId === 'ch3' ? 'min-h-[192px] sm:min-h-[245px]' : 'min-h-[225px] sm:min-h-[260px]';

  return (
    <div className="relative flex flex-1 flex-col bg-[#F6EFE2]">
      <div ref={containerRef} className={`relative order-3 flex-1 ${canvasMinHeight}`}>
        <canvas
          ref={canvasRef}
          data-testid="pixel-stage-canvas"
          className="absolute inset-0 block h-full w-full"
          role="img"
          aria-label={`${scenario.title} · ${sim.lastAnim.label}`}
        />
      </div>
      <div className="order-1 px-3 pt-3 sm:px-6" aria-live="polite">
        {sim.bubbles.map((bubble) => {
          const theme = SPEAKER_THEMES[bubble.speaker];
          const actions = bubble.actions?.filter((action) =>
            (bubble.actions?.length ?? 0) > 1 || (action.command !== nextStep?.command && action.command !== 'reset')
          );
          const hint = nextStep && bubble.nextHint && !bubble.nextHint.includes(nextStep.command)
            && !bubble.actions?.some((action) => bubble.nextHint?.includes(action.command))
            ? bubble.nextHint : null;

          return (
            <div
              key={bubble.id}
              data-testid="speech-bubble"
              style={{ borderColor: theme.border } as CSSProperties}
              className="scene-bubble pixel-bubble mx-auto max-w-[70ch] rounded-xl bg-[#FFFDF8] px-3.5 py-2.5 text-left"
            >
              {/* Speaker Pill + Title */}
              <div className="flex items-center gap-2 mb-1">
                <span
                  style={{
                    backgroundColor: theme.badgeBg,
                    color: theme.badgeText,
                    borderColor: theme.border,
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-pixel text-xs shrink-0"
                >
                  <span
                    style={{ backgroundColor: theme.dot }}
                    className="w-1.5 h-1.5 rounded-[1px] shrink-0"
                  />
                  {bubble.speakerName}
                </span>
                <h2 className="min-w-0 break-keep text-sm font-bold text-[#2F241D]">
                  {bubble.title}
                </h2>
              </div>

              {/* Warm 1-2 line Korean explanation */}
              <p className="break-keep text-sm leading-relaxed text-[#4E3E33]">
                {bubble.message}
              </p>

              {hint && <p className="mt-1.5 break-words text-xs leading-relaxed text-[#79521D]">{hint}</p>}

              {actions && actions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {actions.map((act) => {
                    const toneCls = ACTION_TONE_CLASSES[act.tone ?? 'amber'];
                    return (
                      <button
                        key={`${act.label}-${act.command}`}
                        type="button"
                        onClick={() => runCommand(act.command)}
                        className={`pixel-btn cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold ${toneCls}`}
                      >
                        {act.label}
                      </button>
                    );
                  })}
                </div>
              )}

            </div>
          );
        })}
      </div>
      {sim.conflict && sim.conflict.resolvedChoice === 'none' && !sim.conflict.revert && (
        <div className="order-2 mx-auto mt-3 w-full max-w-3xl px-3 sm:px-6" data-testid="conflict-preview">
          <div className="rounded-xl border border-[#D69B61] bg-[#FFFDF8] p-3">
            <h2 className="break-keep text-sm font-bold text-[#2F241D]">{sim.conflict.file}에서 겹친 내용이에요</h2>
            <p className="mt-1 break-keep text-xs leading-relaxed text-[#59483B]">두 브랜치가 같은 줄을 다르게 고쳤어요. 아래 내용을 보고 남길 것을 골라 주세요.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-[#3292CE] bg-[#F0F8FE] p-2">
                <p className="text-xs font-semibold text-[#174669]">내 브랜치 ({sim.conflict.oursLabel})</p>
                <code className="font-mono-code mt-1 block whitespace-pre-wrap text-xs text-[#2F241D]">{sim.conflict.oursCode}</code>
              </div>
              <div className="rounded-md border border-[#9B72CF] bg-[#F6F0FC] p-2">
                <p className="text-xs font-semibold text-[#623AA8]">상대 브랜치 ({sim.conflict.theirsLabel})</p>
                <code className="font-mono-code mt-1 block whitespace-pre-wrap text-xs text-[#2F241D]">{sim.conflict.theirsCode}</code>
              </div>
            </div>
            <ul className="mt-2 space-y-1 break-keep text-xs leading-relaxed text-[#59483B]">
              <li>· 현재 브랜치 내용 유지 → 내 브랜치 줄만 남아요.</li>
              <li>· 상대 브랜치 내용 사용 → 상대 브랜치 줄만 남아요.</li>
              <li>· 두 내용 함께 담기 → 두 줄을 모두 남해요.</li>
            </ul>
          </div>
        </div>
      )}
      {visibleHistory && (
        <ol aria-label="최근 커밋" className="order-2 mx-auto mt-3 flex w-full max-w-5xl flex-wrap justify-center gap-2 px-3 pb-2 text-sm">
          {visibleHistory.map(({ commit, rewound }) => (
            <li key={commit.id} className="max-w-full rounded-md border border-[#D8C9B0] bg-[#FFFDF8] px-2.5 py-1.5 [overflow-wrap:anywhere]">
              {commit.id === head && <strong className="mr-2 text-[#79521D]">HEAD · {sim.headBranch}</strong>}
              <code className="mr-2 text-xs text-[#14694F]">{commit.hash}</code>
              {commit.message}
              {rewound && <span className="ml-2 text-xs text-[#715A43]">되감기 전 기록</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
