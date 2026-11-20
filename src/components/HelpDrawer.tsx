import { useEffect } from 'react';
import { BookOpen, Bot, GitBranch, KeyRound, Play, Shield, X } from 'lucide-react';
import { STAGE_MAP } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

const BEGINNER_CARDS = [
  {
    id: 'git-vs-github',
    icon: GitBranch,
    accent: 'text-[#5CE1B8]',
    badgeBg: 'bg-[#5CE1B8]/12 border-[#5CE1B8]/35',
    title: 'Git vs GitHub',
    body: 'Git은 내 컴퓨터에서 코드 변경 이력을 저장하는 타임머신이고, GitHub는 그 기록을 클라우드에 올려 팀원과 협업하는 공간이에요.',
  },
  {
    id: 'classic-vs-fine',
    icon: KeyRound,
    accent: 'text-[#FFD166]',
    badgeBg: 'bg-[#FFD166]/12 border-[#FFD166]/35',
    title: 'Classic vs Fine-Grained 토큰',
    body: 'Classic은 모든 저장소를 여는 만능열쇠라 유출 시 위험해요. Fine-Grained는 꼭 필요한 저장소·권한·만료일만 딱 지정해 안전해요.',
  },
  {
    id: 'ghes',
    icon: Shield,
    accent: 'text-[#6BCBFF]',
    badgeBg: 'bg-[#6BCBFF]/12 border-[#6BCBFF]/35',
    title: 'GHES (Enterprise Server)',
    body: '사내 방화벽과 VPN 안에 설치하는 우리 회사 전용 GitHub예요. 소스코드가 외부 인터넷으로 나가지 않고 사내에서 관리돼요.',
  },
  {
    id: 'ai-worktree',
    icon: Bot,
    accent: 'text-[#C4A5FF]',
    badgeBg: 'bg-[#C4A5FF]/12 border-[#C4A5FF]/35',
    title: 'AI Worktree 안전 협업',
    body: 'git worktree로 AI 에이전트에게 독립 폴더와 브랜치를 내어주고, main 직접 푸시는 막은 뒤 사람이 PR을 리뷰·승인해 합쳐요.',
  },
] as const;

export function HelpDrawer() {
  const helpOpen = usePixelStore((s) => s.helpOpen);
  const stageId = usePixelStore((s) => s.stageId);
  const setHelpOpen = usePixelStore((s) => s.setHelpOpen);
  const runCommand = usePixelStore((s) => s.runCommand);

  useEffect(() => {
    if (!helpOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, setHelpOpen]);

  if (!helpOpen) return null;

  const scenario = STAGE_MAP[stageId];

  const handleRunAndClose = (cmd: string) => {
    runCommand(cmd);
    setHelpOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="명령어 사전 및 입문 가이드"
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* Backdrop */}
      <div
        onClick={() => setHelpOpen(false)}
        className="absolute inset-0 bg-[#070A12]/65 backdrop-blur-[2px]"
      />

      {/* Slide-over Panel */}
      <aside className="relative z-10 w-full max-w-md h-full bg-[#111624] border-l-2 border-[#2E3752] shadow-[-12px_0_32px_rgba(0,0,0,0.45)] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3.5 border-b-2 border-[#232C46] bg-[#0E1320] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 text-[#FFD166] shrink-0" />
            <div className="min-w-0">
              <h2 className="font-pixel text-sm font-bold text-[#FFF8EB] truncate">
                명령어 사전
              </h2>
              {scenario && (
                <p className="text-[11px] text-[#8E9DC0] truncate">
                  Stage {scenario.number} · {scenario.title}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="명령어 사전 닫기"
            onClick={() => setHelpOpen(false)}
            className="w-8 h-8 rounded-md bg-[#181F33] border border-[#2C3757] text-[#B8C4DF] hover:text-[#FFF8EB] hover:border-[#4A5A88] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
          {/* Current Stage Cheat Sheet */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide text-[#FFE8A3]">
                이번 스테이지 핵심 명령어
              </h3>
              <span className="text-[11px] text-[#7F8EAE]">클릭하면 바로 실행돼요</span>
            </div>

            {scenario && scenario.cheatSheet.length > 0 ? (
              <div className="space-y-2">
                {scenario.cheatSheet.map((item) => (
                  <div
                    key={item.cmd}
                    className="rounded-lg bg-[#161C2E] border border-[#27314E] px-3 py-2.5 flex items-center justify-between gap-3 hover:border-[#3B4A73] transition-colors"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <code className="block font-mono-code text-xs font-semibold text-[#FFE8A3] break-all">
                        {item.cmd}
                      </code>
                      <p className="text-xs text-[#B6C2DF] leading-snug">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRunAndClose(item.cmd)}
                      className="pixel-btn shrink-0 px-2.5 py-1 rounded-md bg-[#FFD166] hover:bg-[#FFDD87] text-[#131722] border-[#C99B32] font-pixel text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>실행</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#8E9DC0]">표시할 명령어가 없습니다.</p>
            )}
          </section>

          {/* 4 Bite-Sized Beginner Quick-Guide Cards */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold tracking-wide text-[#5CE1B8]">
              1분 핵심 개념 카드
            </h3>
            <div className="grid grid-cols-1 gap-2.5">
              {BEGINNER_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.id}
                    className="rounded-lg bg-[#151B2B] border border-[#25304C] p-3 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${card.badgeBg}`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${card.accent}`} />
                      </span>
                      <h4 className="text-xs font-bold text-[#FFF8EB]">{card.title}</h4>
                    </div>
                    <p className="text-xs text-[#B3C0DC] leading-relaxed">{card.body}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[#222B43] bg-[#0E1320] flex items-center justify-between text-[11px] text-[#7D8AA8] shrink-0">
          <span>터미널에서 help 입력으로도 볼 수 있어요</span>
          <span className="font-mono-code">ESC 닫기</span>
        </div>
      </aside>
    </div>
  );
}
