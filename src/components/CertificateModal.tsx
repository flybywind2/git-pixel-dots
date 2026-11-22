import { useEffect, useRef, useState } from 'react';
import { STAGE_SCENARIOS } from '../engine';
import { readCertificateMeta, writeCertificateMeta } from '../store/certificateMeta';

interface CertificateModalProps {
  open: boolean;
  onClose: () => void;
  completed: boolean[];
  allComplete: boolean;
}

export function CertificateModal({ open, onClose, completed, allComplete }: CertificateModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [dateLabel, setDateLabel] = useState('');

  useEffect(() => {
    if (!open) return;
    const meta = readCertificateMeta();
    setName(meta.name);
    const at = (allComplete ? meta.allAt : meta.basicAt) ?? new Date().toISOString();
    setDateLabel(new Date(at).toLocaleDateString('ko-KR'));
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, allComplete, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) drawCertificate(canvasRef.current, { name, dateLabel, completed, allComplete });
    });
    return () => {
      cancelled = true;
    };
  }, [open, name, dateLabel, completed, allComplete]);

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
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="certificate-title"
        className="w-full max-w-[600px] rounded-xl border-2 border-[#CDBCA3] bg-[#FFFDF8] p-4 outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="certificate-title" className="text-lg font-bold">{allComplete ? '수료증' : '기본 과정 수료증'}</h2>
        <p className="mt-1 break-keep text-sm text-[#59483B]">
          {allComplete ? '9장 실습을 모두 마쳤어요. 축하해요! 🎉' : '기본 과정 4장을 마쳤어요. 축하해요! 🎉 심화 5~9장은 선택이에요.'}
        </p>
        <label className="mt-2 block text-xs font-semibold text-[#715A43]">
          이름 (선택)
          <input
            value={name}
            maxLength={20}
            placeholder="수료증에 넣을 이름"
            onChange={(event) => {
              setName(event.target.value);
              writeCertificateMeta({ name: event.target.value });
            }}
            className="mt-1 w-full rounded-md border border-[#CDBCA3] bg-white px-2 py-1 text-sm font-normal text-[#2F241D]"
          />
        </label>
        <canvas
          ref={canvasRef}
          width={720}
          height={480}
          role="img"
          aria-label={`수료증 그림: ${allComplete ? '기본 4장과 심화 5장 완주' : '기본 과정 4장 완주'}, ${dateLabel}${name ? `, ${name}` : ''}`}
          className="mt-3 w-full rounded-md border border-[#D7C7AE]"
        />
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
function drawCertificate(
  canvas: HTMLCanvasElement | null,
  { name, dateLabel, completed, allComplete }: { name: string; dateLabel: string; completed: boolean[]; allComplete: boolean },
) {
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
  ctx.fillText(allComplete ? '기본 4장 + 심화 5장 · 총 9장 완주' : '기본 과정 4장 완주 · 심화 5~9장은 선택이에요', w / 2, 235);
  const cell = 26;
  const gap = 10;
  let x = (w - (STAGE_SCENARIOS.length * cell + (STAGE_SCENARIOS.length - 1) * gap)) / 2;
  STAGE_SCENARIOS.forEach((_, index) => {
    ctx.fillStyle = completed[index] ? (index % 2 === 0 ? '#198361' : '#22A882') : '#DED1B8';
    ctx.fillRect(x, 280, cell, cell);
    x += cell + gap;
  });
  const trimmed = name.trim();
  if (trimmed) {
    ctx.fillStyle = '#2F241D';
    ctx.font = 'bold 22px system-ui, "Noto Sans KR", sans-serif';
    ctx.fillText(`${trimmed} 님`, w / 2, 340);
  }
  ctx.fillStyle = '#715A43';
  ctx.font = '16px system-ui, "Noto Sans KR", sans-serif';
  ctx.fillText(dateLabel, w / 2, trimmed ? 372 : 350);
  ctx.font = '14px ui-monospace, Menlo, monospace';
  ctx.fillText('flybywind2.github.io/git-pixel-dots', w / 2, 420);
}
