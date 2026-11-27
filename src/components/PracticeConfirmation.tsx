import { useEffect, useRef } from 'react';
import { STAGE_MAP } from '../engine';
import { usePixelStore } from '../store/usePixelStore';

export function PracticeConfirmation() {
  const confirmation = usePixelStore((state) => state.confirmation);
  const resolve = usePixelStore((state) => state.resolveConfirmation);
  const chapter = usePixelStore((state) => STAGE_MAP[state.stageId].number);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

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
  const replaceDraft = confirmation?.kind === 'replace-draft';
  const undoDraft = confirmation?.kind === 'undo-draft';
  return (
    <dialog
      ref={dialog}
      aria-labelledby="practice-confirm-title"
      aria-describedby="practice-confirm-description"
      onCancel={(event) => { event.preventDefault(); resolve(false); }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const from = event.shiftKey ? cancelButton.current : confirmButton.current;
        const to = event.shiftKey ? confirmButton.current : cancelButton.current;
        if (event.target !== from) return;
        event.preventDefault();
        to?.focus();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#CDBCA3] bg-[#FFFDF8] p-5 text-[#2F241D] shadow-xl backdrop:bg-[#2F241D]/45"
    >
      <h2 id="practice-confirm-title" className="text-lg font-bold">
        {hardReset ? `${confirmation.target}로 복원할까요?`
          : replaceDraft ? '예시 문장으로 바꿀까요?'
            : undoDraft ? '저장하지 않은 초안이 있어요' : '현재 장을 초기화할까요?'}
      </h2>
      <p id="practice-confirm-description" className="mt-2 break-keep text-sm leading-relaxed text-[#59483B]">
        {hardReset
          ? '작업 파일과 스테이징 영역을 대상 커밋에 맞춰요. 커밋하지 않은 변경이 사라질 수 있어요.'
          : replaceDraft ? '저장하지 않은 수정이 예시 문장으로 바뀌어요.'
            : undoDraft ? '되돌리면 편집기에 입력 중인 저장하지 않은 초안이 바뀔 수 있어요. 초안을 지키려면 취소하고 먼저 문서를 저장하세요.'
              : `${chapter}장의 진행 상태와 파일 변경, 작성 중인 초안이 지워져요. 다른 장의 기록은 유지돼요.`}
      </p>
      {hardReset && <code className="mt-2 block break-all text-sm">{confirmation.command}</code>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button ref={cancelButton} type="button" onClick={() => resolve(false)} className="rounded-md border border-[#CDBCA3] px-3 py-2 text-sm font-semibold">
          취소
        </button>
        <button ref={confirmButton} type="button" onClick={() => resolve(true)} className="rounded-md bg-[#A9303F] px-3 py-2 text-sm font-bold text-white">
          {hardReset ? '대상 커밋으로 복원' : replaceDraft ? '예시로 바꾸기' : undoDraft ? '초안 버리고 되돌리기' : '현재 장 초기화'}
        </button>
      </div>
    </dialog>
  );
}
