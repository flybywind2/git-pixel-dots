import { useEffect, useRef } from 'react';
import { STAGE_SCENARIOS } from '../engine';

export function CertificateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) drawCertificate(canvasRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'gitdots-certificate.png';
    link.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2F241D]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="certificate-title"
        className="w-full max-w-[600px] rounded-xl border-2 border-[#CDBCA3] bg-[#FFFDF8] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="certificate-title" className="text-lg font-bold">수료증</h2>
        <p className="mt-1 break-keep text-sm text-[#59483B]">9장 실습을 모두 마쳤어요. 축하해요! 🎉</p>
        <canvas ref={canvasRef} width={720} height={480} className="mt-3 w-full rounded-md border border-[#D7C7AE]" />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-[#CDBCA3] px-3 py-1.5 text-sm font-semibold">
            닫기
          </button>
          <button type="button" onClick={download}
            className="pixel-btn rounded-md border-[#116349] bg-[#197957] px-3 py-1.5 text-sm font-semibold text-white">
            PNG로 저장
          </button>
        </div>
      </div>
    </div>
  );
}

// 수료증 PNG는 시스템 글꼴로 그려요(픽셀 서브셋 폰트는 캔버스 라벨 전용).
function drawCertificate(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#FFFDF8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2F241D';
  ctx.fillRect(8, 8, w - 16, 4);
  ctx.fillRect(8, h - 12, w - 16, 4);
  ctx.fillRect(8, 8, 4, h - 16);
  ctx.fillRect(w - 12, 8, 4, h - 16);
  ctx.fillStyle = '#F4B942';
  for (const [x, y] of [[20, 20], [w - 32, 20], [20, h - 32], [w - 32, h - 32]]) {
    ctx.fillRect(x, y, 12, 12);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#14694F';
  ctx.font = 'bold 44px ui-monospace, Menlo, monospace';
  ctx.fillText('GitDots', w / 2, 96);
  ctx.fillStyle = '#2F241D';
  ctx.font = 'bold 34px system-ui, "Noto Sans KR", sans-serif';
  ctx.fillText('Git·GitHub 입문 수료증', w / 2, 160);
  ctx.fillStyle = '#59483B';
  ctx.font = '20px system-ui, "Noto Sans KR", sans-serif';
  ctx.fillText('비개발자를 위한 브라우저 Git 실습', w / 2, 205);
  ctx.fillText('기본 4장 + 심화 5장 · 총 9장 완주', w / 2, 235);
  const cell = 26;
  const gap = 10;
  let x = (w - (STAGE_SCENARIOS.length * cell + (STAGE_SCENARIOS.length - 1) * gap)) / 2;
  STAGE_SCENARIOS.forEach((_, index) => {
    ctx.fillStyle = index % 2 === 0 ? '#198361' : '#22A882';
    ctx.fillRect(x, 280, cell, cell);
    x += cell + gap;
  });
  ctx.fillStyle = '#715A43';
  ctx.font = '16px system-ui, "Noto Sans KR", sans-serif';
  ctx.fillText(new Date().toLocaleDateString('ko-KR'), w / 2, 350);
  ctx.font = '14px ui-monospace, Menlo, monospace';
  ctx.fillText('flybywind2.github.io/git-pixel-dots', w / 2, 420);
}
