import { useEffect, useRef } from 'react';
import { usePixelStore } from '../store/usePixelStore';

export function PracticeConfirmation() {
  const confirmation = usePixelStore((state) => state.confirmation);
  const resolve = usePixelStore((state) => state.resolveConfirmation);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (confirmation && !element.open) {
      element.showModal();
      cancelButton.current?.focus();
    } else if (!confirmation && element.open) {
      element.close();
    }
  }, [confirmation]);

  const hardReset = confirmation?.kind === 'hard-reset';
  return (
    <dialog
      ref={dialog}
      aria-labelledby="practice-confirm-title"
      aria-describedby="practice-confirm-description"
      onCancel={(event) => { event.preventDefault(); resolve(false); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#CDBCA3] bg-[#FFFDF8] p-5 text-[#2F241D] shadow-xl backdrop:bg-[#2F241D]/45"
    >
      <h2 id="practice-confirm-title" className="text-lg font-bold">
        {hardReset ? `${confirmation.target}로 복원할까요?` : '현재 장을 초기화할까요?'}
      </h2>
      <p id="practice-confirm-description" className="mt-2 break-keep text-sm leading-relaxed text-[#59483B]">
        {hardReset
          ? '작업 파일과 스테이징 영역을 대상 커밋에 맞춥니다. 커밋하지 않은 변경이 사라질 수 있어요.'
          : '작성 중인 문서와 이 장에서 진행한 실습을 시작 상태로 돌립니다.'}
      </p>
      {hardReset && <code className="mt-2 block break-all text-sm">{confirmation.command}</code>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button ref={cancelButton} type="button" onClick={() => resolve(false)} className="rounded-md border border-[#CDBCA3] px-3 py-2 text-sm font-semibold">
          취소
        </button>
        <button type="button" onClick={() => resolve(true)} className="rounded-md bg-[#A9303F] px-3 py-2 text-sm font-bold text-white">
          {hardReset ? '대상 커밋으로 복원' : '현재 장 초기화'}
        </button>
      </div>
    </dialog>
  );
}
