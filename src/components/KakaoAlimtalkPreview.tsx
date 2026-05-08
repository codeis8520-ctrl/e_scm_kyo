'use client';

// 카카오톡 알림톡 카드 스타일 미리보기
// 실제 카톡 채팅창에서 보이는 모양을 단순화한 레이아웃 (노란 헤더 + 흰 카드)

interface Props {
  /** 변수 치환된 본문 텍스트. 줄바꿈은 \n */
  message: string;
  /** 채널/발신자 표시명 (생략 시 "경옥채") */
  channelName?: string;
  /** 카드 위 배지 라벨 (생략 시 "알림톡 도착") */
  badge?: string;
}

export default function KakaoAlimtalkPreview({
  message,
  channelName = '경옥채',
  badge = '알림톡 도착',
}: Props) {
  const isEmpty = !message?.trim();

  return (
    <div className="rounded-2xl bg-[#9bbbd4] p-3 sm:p-4 select-none">
      <div className="text-[11px] font-medium text-white/80 mb-1.5 px-1">{badge}</div>

      <div className="flex gap-2">
        {/* 채널 프로필 원 */}
        <div className="shrink-0 w-9 h-9 rounded-full bg-yellow-300 flex items-center justify-center text-base shadow">
          💬
        </div>

        <div className="flex-1 min-w-0">
          {/* 채널명 */}
          <div className="text-[12px] text-white mb-1 px-0.5">{channelName}</div>

          {/* 알림톡 카드 */}
          <div className="rounded-2xl rounded-tl-md bg-white shadow-sm overflow-hidden max-w-full">
            {/* 노란 헤더 */}
            <div className="bg-[#fae100] text-[#3c1e1e] text-xs font-semibold px-4 py-2 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M12 3C6.5 3 2 6.6 2 11c0 2.7 1.7 5.1 4.4 6.6L5.6 21l3.7-2.1c.9.2 1.8.3 2.7.3 5.5 0 10-3.6 10-8s-4.5-8-10-8z" />
              </svg>
              알림톡
            </div>

            {/* 본문 */}
            <div className="px-4 py-3 text-[13.5px] leading-[1.55] text-slate-800 whitespace-pre-wrap break-words min-h-[60px]">
              {isEmpty ? (
                <span className="text-slate-300">템플릿을 선택하면 미리보기가 표시됩니다</span>
              ) : (
                message
              )}
            </div>

            {/* 채널 추가 안내 (실제 알림톡 하단 영역 흉내) */}
            <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 flex justify-between">
              <span>채널 추가하고 혜택받기</span>
              <span>차단</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
