import { useEffect } from 'react';

/**
 * ESC 키로 모달/드로어를 닫는 훅.
 * - document keydown 'Escape' 리스너를 등록하고 cleanup에서 제거한다.
 * - IME(한글 등) 조합 중 ESC는 무시한다.
 * - isDirty()가 true면 confirm 후에만 onClose를 호출한다.
 *
 * 중첩 모달은 다루지 않는다(이 앱에서는 발생하지 않음).
 */
export function useEscClose(
  onClose: () => void,
  opts?: { enabled?: boolean; isDirty?: () => boolean; confirmMessage?: string }
): void {
  const enabled = opts?.enabled;
  const isDirty = opts?.isDirty;
  const confirmMessage = opts?.confirmMessage;

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (enabled === false) return;
      // IME 조합 중 ESC 무시
      if (e.isComposing || e.keyCode === 229) return;

      if (isDirty?.()) {
        if (!window.confirm(confirmMessage ?? '작성 중인 내용이 있습니다. 닫으시겠습니까?')) {
          return;
        }
      }
      onClose();
    }

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, enabled, isDirty, confirmMessage]);
}
