import { useEffect } from 'react';
import { BookOpen, Bot, GitBranch, KeyRound, Play, Shield, X } from 'lucide-react';
import { STAGE_MAP } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

const BEGINNER_CARDS = [
  {
    id: 'git-vs-github',
    icon: GitBranch,
    accent: 'text-[#147A5B]',
    badgeBg: 'bg-[#E1F7EF] border-[#78D0B3]',
    title: 'Git vs GitHub',
    body: 'Git은 내 컴퓨터에서 코드 변경 이력을 저장하는 타임머신이고, GitHub는 그 기록을 클라우드에 올려 팀원과 협업하는 공간이에요.',
  },
  {
    id: 'classic-vs-fine',
    icon: KeyRound,
    accent: 'text-[#A66008]',
    badgeBg: 'bg-[#FFF2CF] border-[#E3B45A]',
    title: 'Classic vs Fine-Grained 토큰',
    body: 'Classic은 모든 저장소를 여는 만능열쇠라 유출 시 위험해요. Fine-Grained는 꼭 필요한 저장소·권한·만료일만 딱 지정해 안전해요.',
  },
  {
    id: 'ghes',
    icon: Shield,
    accent: 'text-[#1C6291]',
    badgeBg: 'bg-[#E4F4FF] border-[#7DC0EB]',
    title: 'GHES (Enterprise Server)',
    body: '사내 방화벽과 VPN 안에 설치하는 우리 회사 전용 GitHub예요. 소스코드가 외부 인터넷으로 나가지 않고 사내에서 관리돼요.',
  },
  {
    id: 'ai-worktree',
    icon: Bot,
    accent: 'text-[#5E38A3]',
    badgeBg: 'bg-[#F0E8FF] border-[#B899EC]',
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
        className="absolute inset-0 bg-[#2F241D]/30 backdrop-blur-[2px]"
      />

      {/* Slide-over Panel */}
      <aside className="relative z-10 w-full max-w-md h-full bg-[#FAF4E8] border-l-2 border-[#D4C3A8] shadow-[-12px_0_30px_rgba(92,70,48,0.18)] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3.5 border-b-2 border-[#DFD1BA] bg-[#EFE6D5] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="w-4 h-4 text-[#B86E10] shrink-0" />
            <div className="min-w-0">
              <h2 className="font-pixel text-sm font-bold text-[#2F241D] truncate">
                명령어 사전
              </h2>
              {scenario && (
                <p className="text-[11px] text-[#6F5E4F] truncate">
                  Stage {scenario.number} · {scenario.title}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="명령어 사전 닫기"
            onClick={() => setHelpOpen(false)}
            className="w-8 h-8 rounded-md bg-[#FAF4E8] border border-[#D4C3A8] text-[#5D4C3E] hover:text-[#2F241D] hover:bg-[#FFFDF8] flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
          {/* Current Stage Cheat Sheet */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide text-[#8E5206]">
                이번 스테이지 핵심 명령어
              </h3>
              <span className="text-[11px] text-[#7D6B5A]">클릭하면 바로 실행돼요</span>
            </div>

            {scenario && scenario.cheatSheet.length > 0 ? (
              <div className="space-y-2">
                {scenario.cheatSheet.map((item) => (
                  <div
                    key={item.cmd}
                    className="rounded-lg bg-[#FFFDF8] border border-[#DDD0BA] px-3 py-2.5 flex items-center justify-between gap-3 hover:border-[#C2AD8E] transition-colors"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <code className="block font-mono-code text-xs font-semibold text-[#147A5B] break-all">
                        {item.cmd}
                      </code>
                      <p className="text-xs text-[#59483B] leading-snug">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRunAndClose(item.cmd)}
                      className="pixel-btn shrink-0 px-2.5 py-1 rounded-md bg-[#F4B942] hover:bg-[#F7C55D] text-[#2F241D] border-[#C78B1E] font-pixel text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>실행</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#786758]">표시할 명령어가 없습니다.</p>
            )}
          </section>

          {/* 4 Bite-Sized Beginner Quick-Guide Cards */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-bold tracking-wide text-[#147A5B]">
              1분 핵심 개념 카드
            </h3>
            <div className="grid grid-cols-1 gap-2.5">
              {BEGINNER_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.id}
                    className="rounded-lg bg-[#FFFDF8] border border-[#DDD0BA] p-3 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 ${card.badgeBg}`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${card.accent}`} />
                      </span>
                      <h4 className="text-xs font-bold text-[#2F241D]">{card.title}</h4>
                    </div>
                    <p className="text-xs text-[#59483B] leading-relaxed">{card.body}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[#DFD1BA] bg-[#EFE6D5] flex items-center justify-between text-[11px] text-[#786758] shrink-0">
          <span>터미널에서 help 입력으로도 볼 수 있어요</span>
          <span className="font-mono-code">ESC 닫기</span>
        </div>
      </aside>
    </div>
  );
}
