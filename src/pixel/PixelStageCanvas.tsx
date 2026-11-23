import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { FileText, X } from 'lucide-react';
import { getNextPendingStep, STAGE_MAP } from '../engine';
import { remoteRelation } from '../engine/repoVersions';
import { usePixelStore } from '../store/usePixelStore';
import type { BubbleAction, PixelSimState } from '../types/sim';
import { SPEAKER_THEMES } from './palette';
import { buildStageFileItems, type StageFileBadge } from './stageFileItems';
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

// 비개발자가 권한 이름을 바로 읽을 수 있게 짧은 풀이를 붙여요.
const SCOPE_LABELS: Readonly<Record<string, string>> = {
  'repo': '저장소 읽기·쓰기',
  'admin:org': '조직 설정 관리',
  'delete_repo': '저장소 삭제',
  'workflow': '자동 검사(워크플로) 설정 수정',
  'contents:write (gitdots/app)': 'gitdots/app 파일 쓰기',
  'expires:30d': '30일 뒤 만료',
};

const FILE_STATUS_BADGES: Readonly<Record<StageFileBadge, { label: string; className: string }>> = {
  modified: { label: '수정됨', className: 'border-[#D69B61] bg-[#FFF2D7] text-[#7A4A0B]' },
  untracked: { label: '새 파일', className: 'border-[#E08A95] bg-[#FDE9E8] text-[#8C2630]' },
  staged: { label: '장바구니', className: 'border-[#4D8C6E] bg-[#E2F3E8] text-[#145439]' },
  committed: { label: '커밋됨', className: 'border-[#8BB9D9] bg-[#EEF7FD] text-[#174669]' },
  stashed: { label: '임시보관', className: 'border-[#B69AD9] bg-[#F4EEFC] text-[#5B3E9E]' },
  'extra-edit': { label: '추가 수정', className: 'border-[#D18D20] bg-[#FFF2D7] text-[#7A4A0B]' },
  deleted: { label: '삭제됨', className: 'border-[#CDBCA3] bg-[#F2EADD] text-[#6B5743]' },
  conflict: { label: '충돌', className: 'border-[#E05666] bg-[#FDE9E8] text-[#8C2630]' },
};

const SHARE_STATUS_TEXT: Readonly<Record<string, string>> = {
  none: '아직 팀 저장소에 공유하지 않았어요',
  ahead: '공유 대기 · 내 컴퓨터에만 있는 커밋이 있어요',
  behind: '원격이 앞섬 · 팀 저장소에 내 기록에 없는 커밋이 있어요',
  diverged: '갈라진 기록 · 내 컴퓨터와 팀 저장소에 서로 다른 커밋이 있어요',
  synced: '동기화 완료 · 팀 저장소와 같은 기록이에요',
};

const CONFLICT_RESOLUTION_ACTIONS: readonly BubbleAction[] = [
  { label: '현재 브랜치 내용 유지', command: 'resolve ours', tone: 'primary' },
  { label: '상대 브랜치 내용 사용', command: 'resolve theirs', tone: 'amber' },
  { label: '두 변경 함께 남기기', command: 'resolve both', tone: 'mint' },
];

export function PixelStageCanvas() {
  const stageId = usePixelStore((s) => s.stageId);
  const sim = usePixelStore((s) => s.sim);
  const runCommand = usePixelStore((s) => s.runCommand);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const fileButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusGuidedAfterResolve = useRef(false);

  useEffect(() => {
    setSelectedFile(null);
  }, [stageId]);

  // 충돌 해결 뒤 새로 나타난 '합친 내용 기록하기' 버튼으로 포커스를 이어 줘요.
  // requestAnimationFrame은 CI처럼 느린 환경에서 React 렌더보다 먼저 끝날 수 있어 effect로 처리해요.
  useEffect(() => {
    if (!focusGuidedAfterResolve.current) return;
    if (!sim.conflict || sim.conflict.resolvedChoice === 'none') return;
    focusGuidedAfterResolve.current = false;
    document.querySelector<HTMLButtonElement>('[data-testid="guided-command"]')?.focus();
  }, [sim.conflict]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const queueDraw = useRef<(() => void) | null>(null);
  const replayNonce = useRef(0);

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
    let lastReplay = 0;

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

      // Spawn the pixel particle burst for the current command's animation.
      const burst = () => {
        const cues = getParticleCuesForAnim(currentSim.stageId, currentSim.lastAnim.kind, sceneWidth, sceneHeight);
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
      };

      // Trigger fresh animation curve + pixel particle bursts on every new command!
      if (reduced) {
        particles.clear();
        motion = createSceneMotion();
        lastSeq = currentSim.lastAnim.seq;
        animProgress = 1;
      } else if (currentSim.lastAnim.seq !== lastSeq) {
        lastSeq = currentSim.lastAnim.seq;
        animProgress = 0;
        burst();
      }

      // '다시 보기'는 상태를 바꾸지 않고 지난 명령의 애니메이션만 다시 재생해요.
      if (!reduced && replayNonce.current !== lastReplay) {
        lastReplay = replayNonce.current;
        animProgress = 0;
        burst();
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
  const showFileStatusCard = stageId === 'ch1' || stageId === 'ch2' || stageId === 'ch4';
  const hasActiveMergeConflict = Boolean(sim.conflict && sim.conflict.resolvedChoice === 'none' && !sim.conflict.revert);
  const conflict = sim.conflict;
  const stageFileItems = showFileStatusCard ? buildStageFileItems(sim, stageId) : [];
  const activePreviewFile = selectedFile ? stageFileItems.find((item) => item.id === selectedFile) ?? null : null;
  const shareRelation = stageId === 'ch2' || stageId === 'ch1' ? remoteRelation(sim) : null;

  function closePreview() {
    const lastId = selectedFile;
    setSelectedFile(null);
    // 닫기 버튼이 사라져도 포커스가 body로 튀지 않게 원래 파일 카드로 돌려놔요.
    window.requestAnimationFrame(() => {
      if (lastId) fileButtons.current[lastId]?.focus();
    });
  }

  function resolveConflict(command: string) {
    focusGuidedAfterResolve.current = true;
    runCommand(command);
  }
  const canvasMinHeight = stageId === 'ch2' ? 'min-h-[215px] sm:min-h-[245px]'
    : stageId === 'ch3' ? 'min-h-[192px] sm:min-h-[245px]' : 'min-h-[225px] sm:min-h-[260px]';

  return (
    <div className="relative flex flex-1 flex-col bg-[#F6EFE2]">
      <div className="px-3 pt-2.5 sm:px-6 sm:pt-3" aria-live="polite">
        {sim.bubbles.map((bubble) => {
          const theme = SPEAKER_THEMES[bubble.speaker];
          const actions = bubble.actions?.filter((action) => {
            if (hasActiveMergeConflict && action.command.startsWith('resolve ')) return false;
            return (bubble.actions?.length ?? 0) > 1 || (action.command !== nextStep?.command && action.command !== 'reset');
          });
          const actionHiddenAsDuplicate = (bubble.actions?.length ?? 0) > 0 && (!actions || actions.length === 0) && !hasActiveMergeConflict;
          const rawHint = nextStep && bubble.nextHint && !bubble.nextHint.includes(nextStep.command)
            && !bubble.actions?.some((action) => bubble.nextHint?.includes(action.command))
            ? bubble.nextHint : null;
          const hint = rawHint
            ? actionHiddenAsDuplicate && /아래\s*(추천\s*)?버튼/.test(rawHint)
              ? rawHint.replace(/아래\s*(추천\s*)?버튼/g, '위쪽의 노란 버튼')
              : rawHint
            : null;

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
                <h2 className="min-w-0 break-keep text-sm font-bold text-[#2F241D] [overflow-wrap:anywhere]">
                  {bubble.title}
                </h2>
              </div>

              {/* Warm 1-2 line Korean explanation */}
              <p className="break-keep text-sm leading-relaxed text-[#4E3E33] [overflow-wrap:anywhere]">
                {bubble.message}
              </p>

              {hint && <p className="mt-1.5 break-words text-xs leading-relaxed text-[#79521D] [overflow-wrap:anywhere]">{hint}</p>}

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
      {hasActiveMergeConflict && sim.conflict && (
        <div
          id="conflict-comparison"
          tabIndex={-1}
          className="mx-auto mt-1.5 w-full max-w-3xl rounded-xl px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#80613B] sm:px-6"
          data-testid="conflict-preview"
        >
          <div className="rounded-xl border border-[#D69B61] bg-[#FFFDF8] px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h2 className="break-keep text-sm font-bold text-[#2F241D]">{sim.conflict.file}에서 겹친 내용이에요</h2>
              <p className="break-keep text-xs text-[#59483B]">내용을 비교한 뒤 아래 버튼에서 남길 것을 골라 주세요.</p>
            </div>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              <div className="rounded-md border border-[#3292CE] bg-[#F0F8FE] px-2 py-1.5">
                <p className="text-xs font-semibold text-[#174669]">내 브랜치 ({sim.conflict.oursLabel})</p>
                <code className="font-mono-code mt-0.5 block whitespace-pre-wrap text-xs text-[#2F241D]">{sim.conflict.oursCode}</code>
              </div>
              <div className="rounded-md border border-[#9B72CF] bg-[#F6F0FC] px-2 py-1.5">
                <p className="text-xs font-semibold text-[#623AA8]">상대 브랜치 ({sim.conflict.theirsLabel})</p>
                <code className="font-mono-code mt-0.5 block whitespace-pre-wrap text-xs text-[#2F241D]">{sim.conflict.theirsCode}</code>
              </div>
            </div>
            <div className="mt-1.5 rounded-md border border-[#22A882] bg-[#E0F4E9] px-2 py-1">
              <p className="text-xs font-semibold text-[#115843]">두 변경 함께 남기기 미리보기 <span className="font-normal text-[#2D5E4A]">(항상 정답은 아니니 결과를 확인하세요)</span></p>
              <code className="font-mono-code mt-0.5 block whitespace-pre-wrap text-xs text-[#2F241D]">{sim.conflict.bothCode}</code>
              {sim.conflict.bothCode.includes('alternateTheme') && (
                <p className="mt-1 break-keep text-[11px] text-[#2D5E4A]">
                  같은 이름이 두 번 선언되지 않도록 상대 줄의 이름만 alternateTheme으로 바꿔 함께 담아요. 앱은 첫 번째 theme 색을 계속 쓰고, 실제 Git은 이렇게 이름을 자동으로 바꿔 주지 않아요.
                </p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-[#E9DFCE] pt-1.5">
              {CONFLICT_RESOLUTION_ACTIONS.map((act) => {
                const toneCls = ACTION_TONE_CLASSES[act.tone ?? 'amber'];
                return (
                  <button
                    key={act.command}
                    type="button"
                    onClick={() => resolveConflict(act.command)}
                    className={`pixel-btn cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold ${toneCls}`}
                  >
                    {act.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {stageId === 'ch2' || stageId === 'ch1' ? shareRelation && (
        <div className="mx-auto mt-1.5 w-full max-w-3xl px-3 sm:px-6" data-testid="stage-sync-status" role="status">
          <p className="break-keep rounded-md border border-[#D8C9B0] bg-[#FAF4E8] px-2.5 py-1 text-xs font-semibold text-[#59483B]">
            팀 저장소: {SHARE_STATUS_TEXT[shareRelation]}
          </p>
          {(sim.lastAnim.kind === 'PUSH' || sim.lastAnim.kind === 'UNSTAGE' || sim.lastAnim.kind === 'COMMIT') && (
            <p data-testid="stage-command-status" className="mt-1 break-keep text-xs text-[#715A43]">
              {sim.lastAnim.label}{sim.lastAnim.detail ? ` · ${sim.lastAnim.detail}` : ''} 완료
            </p>
          )}
        </div>
      ) : null}
      {stageId === 'ch3' && conflict && conflict.resolvedChoice !== 'none' && (
        <div className="mx-auto mt-3 w-full max-w-3xl px-3 sm:px-6" data-testid="resolved-preview">
          <div className="rounded-xl border border-[#22A882] bg-[#E0F4E9] px-3 py-2">
            <h2 className="break-keep text-sm font-bold text-[#115843]">해결한 최종 파일 내용이에요</h2>
            <p className="mt-1 break-keep text-xs text-[#2D5E4A]">
              버튼을 누르기 전에 이 내용을 확인하세요. 커밋하면 이 내용이 기록돼요.
            </p>
            <pre className="font-mono-code mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[#FFFDF8] px-2 py-1.5 text-xs text-[#2F241D]">
              {sim.files.find((file) => file.name === conflict.file)?.content ?? ''}
            </pre>
            <p className="mt-1 break-keep text-xs text-[#2D5E4A]">
              실제 Git에서는 이 파일에 남은 충돌 표시(&lt;&lt;&lt;&lt;&lt;&lt;&lt;)를 직접 지운 뒤 git add로 해결을 표시해요.
            </p>
          </div>
        </div>
      )}
      {stageId === 'ch5' && sim.completedActions.includes('RUN_WATCH') && (
        <div className="mx-auto mt-3 w-full max-w-3xl px-3 sm:px-6" data-testid="ci-target">
          <div className="rounded-xl border border-[#D8C9B0] bg-[#FFFDF8] px-3 py-2">
            <h2 className="break-keep text-sm font-bold text-[#2F241D]">이번에 지켜본 자동 검사 대상</h2>
            <ul className="mt-1 space-y-0.5 break-keep text-xs text-[#59483B]">
              <li>· 브랜치: feat/darkmode</li>
              <li>· 변경 파일: darkmode.css (다크 모드 색상 설정)</li>
              <li>· 실행 workflow: CI Build &amp; Test — 코드 가져오기 → 설치·형식 검사 → 단위 테스트</li>
            </ul>
          </div>
        </div>
      )}
      {stageId === 'ch7' && (
        <div className="mx-auto mt-3 grid w-full max-w-3xl gap-2 px-3 sm:px-6" data-testid="ghes-status">
          {sim.ghes.mode === 'cloud' && (
            <div className="rounded-xl border border-[#3292CE] bg-[#F0F8FE] px-3 py-2">
              <h2 className="break-keep text-sm font-bold text-[#174669]">공용 클라우드와 사내 GHES 비교</h2>
              <ul className="mt-1 space-y-0.5 break-keep text-xs text-[#2F4B63]">
                <li>· GitHub.com(클라우드): 주소 github.com · API api.github.com · GitHub-hosted runner</li>
                <li>· 사내 GHES: 주소 {sim.ghes.host} · API /api/v3 · 사내 Private Runner</li>
              </ul>
            </div>
          )}
          <div className="rounded-xl border border-[#D8C9B0] bg-[#FFFDF8] px-3 py-2">
            <h2 className="break-keep text-sm font-bold text-[#2F241D]">사내 보안 로그 (최근 기록)</h2>
            <ul className="font-mono-code mt-1 space-y-0.5 break-keep text-[11px] text-[#59483B]">
              {sim.ghes.auditLogs.slice(-3).map((log, index) => <li key={index}>· {log}</li>)}
            </ul>
          </div>
        </div>
      )}
      {stageId === 'ch8' && sim.ai.codeWritten && (
        <div className="mx-auto mt-3 w-full max-w-3xl px-3 sm:px-6" data-testid="ai-diff">
          <div className="rounded-xl border border-[#8BB9D9] bg-[#EEF7FD] px-3 py-2">
            <h2 className="break-keep text-sm font-bold text-[#174669]">사람이 검토할 코드 변경</h2>
            <p className="mt-1 break-keep text-xs text-[#2F4B63]">버그: 2 + 3을 -1로 계산했어요. AI가 아래처럼 고쳤어요.</p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              <div className="rounded-md border border-[#E08A95] bg-[#FDE9E8] px-2 py-1.5">
                <p className="text-xs font-semibold text-[#8C2630]">고치기 전 (main)</p>
                <code className="font-mono-code mt-0.5 block whitespace-pre-wrap text-xs text-[#2F241D]">
                  {sim.commits.find((commit) => commit.id === sim.branches.main)?.tree['buggy.ts'] ?? 'export const sum = (a, b) => a - b;'}
                </code>
              </div>
              <div className="rounded-md border border-[#22A882] bg-[#E0F4E9] px-2 py-1.5">
                <p className="text-xs font-semibold text-[#115843]">고친 후 ({sim.ai.worktreeBranch})</p>
                <code className="font-mono-code mt-0.5 block whitespace-pre-wrap text-xs text-[#2F241D]">
                  {sim.commits.find((commit) => commit.id === sim.branches[sim.ai.worktreeBranch])?.tree['buggy.ts'] ?? ''}
                </code>
              </div>
            </div>
            <p className="mt-1 break-keep text-xs text-[#2F4B63]">터미널에서 git diff main {sim.ai.worktreeBranch}로 같은 변경을 직접 비교할 수 있어요.</p>
          </div>
        </div>
      )}
      {stageId === 'ch6' && (
        <div className="mx-auto mt-3 w-full max-w-3xl px-3 sm:px-6" data-testid="token-scopes">
          <div className="rounded-xl border border-[#D8C9B0] bg-[#FFFDF8] p-3">
            <h2 className="break-keep text-sm font-bold text-[#2F241D]">지금 토큰에 준 권한</h2>
            <p className="mt-1 break-keep text-xs leading-relaxed text-[#59483B]">
              {sim.token.mode === 'fine-grained'
                ? 'Fine-grained 토큰은 고른 저장소에만 필요한 권한을 줘요.'
                : 'Classic 토큰은 계정에 넓은 권한을 줘요. 저장소 삭제 권한도 포함될 수 있어요.'}
            </p>
            <ul className="mt-2 space-y-1 break-keep text-xs leading-relaxed text-[#59483B]">
              {sim.token.scopes.map((scope) => (
                <li key={scope}>· {scope}{SCOPE_LABELS[scope] ? ` — ${SCOPE_LABELS[scope]}` : ''}</li>
              ))}
            </ul>
            {sim.token.expires && (
              <p className="mt-1 break-keep text-xs text-[#59483B]">· 만료: {sim.token.expires} (권한이 아니라 토큰 속성이에요)</p>
            )}
            <div className="mt-2">
              <p className="break-keep text-xs font-semibold text-[#59483B]">
                위험도 {sim.token.riskScore}/100 {sim.token.riskScore < 30 ? '— 안전한 최소 권한' : '— 넓은 권한'}
              </p>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#E7DCCB]">
                <div
                  className={`h-full ${sim.token.riskScore < 30 ? 'bg-[#22A882]' : 'bg-[#E05666]'}`}
                  style={{ width: `${sim.token.riskScore}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {stageId === 'ch8' && sim.ai.codeWritten && (
        <div className="mx-auto mt-3 w-full max-w-3xl px-3 sm:px-6" data-testid="ai-tests">
          <div className="rounded-xl border border-[#D8C9B0] bg-[#FFFDF8] p-3">
            <h2 className="break-keep text-sm font-bold text-[#2F241D]">자동 테스트 결과</h2>
            <p className="mt-1 break-keep text-xs leading-relaxed text-[#59483B]">2와 3을 더한 결과가 5인지 자동으로 확인했고, 통과했어요.</p>
            <ul className="font-mono-code mt-2 space-y-1 text-xs text-[#147A5B]">
              <li>✓ unit test: sum(2, 3) === 5 PASS</li>
              {sim.ai.prNumber !== null && <li>✓ PR #{sim.ai.prNumber} 자동 검사: 코드 형식(Lint) · 단위 테스트(Unit Test) · 비밀키 검사(Secret Scan) 통과</li>}
            </ul>
            <p className="mt-2 break-keep text-xs leading-relaxed text-[#59483B]">buggy.ts 변경: a - b → a + b (빼기를 더하기로 고침)</p>
          </div>
        </div>
      )}
      {visibleHistory && (
        <ol aria-label="최근 커밋" className="mx-auto mt-3 flex w-full max-w-5xl flex-wrap justify-center gap-2 px-3 pb-2 text-sm">
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

      <div ref={containerRef} className={`relative flex-1 ${canvasMinHeight}`}>
        <canvas
          ref={canvasRef}
          data-testid="pixel-stage-canvas"
          className="absolute inset-0 block h-full w-full"
          role="img"
          aria-label={`${scenario.title} · 현재 브랜치 ${sim.headBranch} · ${sim.prs.length > 0 ? `PR ${sim.prs.length}건` : 'PR 없음'} · ${sim.lastAnim.label}`}
        />
        {sim.lastAnim.kind !== 'IDLE' && (
          <button
            type="button"
            onClick={() => { replayNonce.current += 1; queueDraw.current?.(); }}
            aria-label="지난 애니메이션 다시 보기"
            className="pixel-btn absolute right-2 top-2 z-10 cursor-pointer rounded-md border border-[#CDBCA3] bg-[#FFFDF8]/90 px-2 py-1 text-xs font-semibold text-[#59483B] hover:bg-[#F0E5CF]"
          >
            다시 보기
          </button>
        )}
      </div>
      {showFileStatusCard && stageFileItems.length > 0 && (
        <section
          aria-label="현재 파일 상태"
          data-testid="stage-files-card"
          className="mx-auto w-full max-w-5xl px-3 pb-2.5 pt-1 sm:px-6"
        >
          <div className="rounded-lg border border-[#D8C9B0] bg-[#FFFDF8] px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#59483B]">
                <FileText aria-hidden="true" className="h-3.5 w-3.5 text-[#886237]" />
                현재 파일 상태
              </span>
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
                {stageFileItems.map((file) => {
                  const isSelected = selectedFile === file.id;
                  return (
                    <button
                      key={file.id}
                      ref={(node) => { fileButtons.current[file.id] = node; }}
                      type="button"
                      data-file-name={file.name}
                      aria-expanded={isSelected}
                      onClick={() => setSelectedFile(isSelected ? null : file.id)}
                      className={`inline-flex max-w-full min-w-0 cursor-pointer flex-wrap items-center gap-1.5 rounded-md border px-2 py-0.5 text-left text-xs transition-colors ${isSelected
                        ? 'border-[#80613B] bg-[#F6EDDB] font-semibold'
                        : 'border-[#DFD1BA] bg-[#FAF4E8] hover:bg-[#F3E9D6]'}`}
                    >
                      <code className="font-mono-code min-w-0 max-w-full text-[#2F241D] [overflow-wrap:anywhere]">{file.name}</code>
                      {file.stash && (
                        <span className="rounded-full border border-[#B69AD9] bg-[#F4EEFC] px-1.5 py-0 text-[10px] font-semibold leading-4 text-[#5B3E9E]">
                          {file.stash.label}
                        </span>
                      )}
                      {file.badges.map((badgeKey) => (
                        <span key={badgeKey} className={`rounded-full border px-1.5 py-0 text-[10px] font-semibold leading-4 ${FILE_STATUS_BADGES[badgeKey].className}`}>
                          {FILE_STATUS_BADGES[badgeKey].label}
                        </span>
                      ))}
                    </button>
                  );
                })}
              </div>
              <span className="ml-auto text-[11px] text-[#715A43]">파일을 눌러 내용 미리보기</span>
            </div>
            {activePreviewFile && (
              <div
                data-testid="stage-file-preview"
                className="mt-2 min-w-0 max-w-full rounded-md border border-[#E3D5BE] bg-[#FAF4E8] p-2.5 text-xs"
              >
                <div className="mb-1 flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 font-semibold text-[#2F241D]">
                    <code className="font-mono-code block min-w-0 max-w-full [overflow-wrap:anywhere]">{activePreviewFile.name}</code>
                    <span className="mt-0.5 flex flex-wrap gap-1 text-[11px] font-normal text-[#715A43]">
                      {activePreviewFile.badges.map((badgeKey) => (
                        <span key={badgeKey}>({FILE_STATUS_BADGES[badgeKey].label})</span>
                      ))}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label="파일 미리보기 닫기"
                    onClick={closePreview}
                    className="shrink-0 rounded border border-[#D8C9B0] bg-[#FFFDF8] p-0.5 text-[#59483B] hover:bg-white"
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                </div>
                {activePreviewFile.stash ? (
                  <div className="mt-1 space-y-1.5">
                    <p className="break-keep text-[11px] font-semibold text-[#5B3E9E]">
                      {activePreviewFile.stash.label}에 보관된 사본이에요. stash@{'{'}0{'}'}이 가장 최근 항목이에요.
                    </p>
                    {([
                      ['보관 기준(base)', activePreviewFile.stash.base],
                      ['장바구니 사본(index)', activePreviewFile.stash.index],
                      ['작업 파일 사본(working)', activePreviewFile.stash.working],
                    ] as const).map(([label, content], index) => (
                      <div key={label}>
                        <p className="text-[11px] font-semibold text-[#59483B]">{label}</p>
                        {content === undefined ? (
                          <p className="mt-0.5 rounded border border-[#D9C8EE] bg-[#F8F3FD] px-2 py-1 text-[11px] text-[#6B5743]">
                            {index === 0 ? '기준 커밋에는 없던 파일이에요(새로 추가됨).' : '이 사본에는 파일이 없어요(삭제 상태).'}
                          </p>
                        ) : (
                          <pre className={`font-mono-code mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap rounded p-2 text-xs leading-relaxed text-[#2F241D] ${index === 2 ? 'border border-[#D9C8EE] bg-[#F8F3FD]' : 'bg-[#FFFDF8]'}`}>
                            {content}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 space-y-1.5">
                    <div>
                      <p className="text-[11px] font-semibold text-[#59483B]">작업 파일(working)</p>
                      {activePreviewFile.workingContent === undefined ? (
                        <p className="mt-0.5 rounded bg-[#FFFDF8] px-2 py-1 text-[11px] text-[#6B5743]">작업 폴더에 파일이 없어요(삭제 상태).</p>
                      ) : (
                        <pre className="font-mono-code mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[#FFFDF8] p-2 text-xs leading-relaxed text-[#2F241D]">
                          {activePreviewFile.workingContent}
                        </pre>
                      )}
                    </div>
                    {activePreviewFile.stagedContent !== undefined ? (
                      <div>
                        <p className="text-[11px] font-semibold text-[#5B3E9E]">
                          {activePreviewFile.badges.includes('staged')
                            ? '장바구니 사본(index) · 다음 커밋에 들어갈 내용'
                            : '최근 커밋과 같은 사본(index) · 아직 담은 변경 없음'}
                        </p>
                        <pre className="font-mono-code mt-0.5 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[#D9C8EE] bg-[#F8F3FD] p-2 text-xs leading-relaxed text-[#2F241D]">
                          {activePreviewFile.stagedContent}
                        </pre>
                      </div>
                    ) : activePreviewFile.badges.includes('staged') && (
                      <p className="text-[11px] text-[#5B3E9E]">장바구니 사본이 작업 파일과 같아요. 사라진 게 아니라 똑같이 담겨 있어요.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
