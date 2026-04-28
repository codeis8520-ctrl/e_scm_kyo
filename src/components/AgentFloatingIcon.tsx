'use client';

import { useState, useRef, useEffect } from 'react';

interface PendingAction {
  tool: string;
  args: Record<string, any>;
  description: string;
}

// 클라이언트가 보유하는 첨부 (전송 시 base64로 인코딩)
interface Attachment {
  id: string;             // UI key
  kind: 'image' | 'pdf';
  media_type: string;     // image/png, application/pdf, ...
  name: string;
  size: number;           // bytes
  previewUrl?: string;    // object URL (이미지만)
  data: string;           // base64 (헤더 제외)
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'info' | 'confirm' | 'error' | 'success';
  pending_action?: PendingAction;
  attachmentSummary?: string;   // "[첨부: 이미지 2장]" 같은 표기 (UI용)
}

const MAX_IMAGES = 5;
const MAX_PDFS = 2;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ALLOWED_PDF_TYPES = new Set(['application/pdf']);

// File → base64 (헤더 제외)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const QUICK_ACTIONS = [
  '재고 부족 품목 알려줘',
  '이번달 매출 요약해줘',
  '진행중인 생산 지시서 보여줘',
  '확정 대기 중인 발주서 있어?',
];

// 간단한 마크다운 → JSX 렌더러 (볼드, 줄바꿈)
function renderContent(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // **bold** 처리
    const parts = line.split(/\*\*(.*?)\*\*/g);
    const rendered = parts.map((part, j) =>
      j % 2 === 1 ? <strong key={j}>{part}</strong> : <span key={j}>{part}</span>
    );
    return (
      <span key={i}>
        {rendered}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>)[name] || null;
}

const WELCOME_MSG: Message = {
  role: 'assistant',
  content: '안녕하세요! 경옥채 AI 어시스턴트입니다.\n\n재고 조회, 고객 관리, 발주/생산 처리, SMS 발송 등 시스템의 모든 업무를 자연어로 지시할 수 있습니다.',
  type: 'info',
};

export default function AgentFloatingIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MSG]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 첨부 카운트
  const imageCount = attachments.filter(a => a.kind === 'image').length;
  const pdfCount = attachments.filter(a => a.kind === 'pdf').length;

  // 파일 추가 (드롭, 선택, paste 모두 이걸 호출)
  const addFiles = async (files: FileList | File[]) => {
    setAttachError('');
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      let kind: 'image' | 'pdf' | null = null;
      if (ALLOWED_IMAGE_TYPES.has(file.type)) kind = 'image';
      else if (ALLOWED_PDF_TYPES.has(file.type)) kind = 'pdf';
      else { setAttachError(`지원하지 않는 형식: ${file.name} (${file.type || 'unknown'})`); continue; }
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(`${file.name}: 8MB 초과 (실제 ${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }
      // 카운트 가드 (현재 + 새로 추가될 것까지)
      const willImg = imageCount + next.filter(a => a.kind === 'image').length + (kind === 'image' ? 1 : 0);
      const willPdf = pdfCount + next.filter(a => a.kind === 'pdf').length + (kind === 'pdf' ? 1 : 0);
      if (willImg > MAX_IMAGES) { setAttachError(`이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`); continue; }
      if (willPdf > MAX_PDFS) { setAttachError(`PDF는 최대 ${MAX_PDFS}건까지 첨부할 수 있습니다.`); continue; }

      try {
        const data = await fileToBase64(file);
        next.push({
          id: crypto.randomUUID(),
          kind, media_type: file.type, name: file.name || (kind === 'image' ? 'image.png' : 'document.pdf'),
          size: file.size,
          previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
          data,
        });
      } catch (err: any) {
        setAttachError(`${file.name}: 인코딩 실패 (${err?.message || '알 수 없음'})`);
      }
    }
    if (next.length > 0) setAttachments(prev => [...prev, ...next]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const target = prev.find(a => a.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  };

  // 언마운트 시 object URL 해제
  useEffect(() => () => {
    attachments.forEach(a => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 세션 ID (브라우저 세션 유지, 새로고침해도 대화 복원) ─────────────────
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return '';
    let id = sessionStorage.getItem('agent_session_id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('agent_session_id', id);
    }
    return id;
  });

  // ── 대화 이력 복원 (마운트 시) ──────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/agent?session_id=${sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.conversations?.length) {
          const restored: Message[] = data.conversations.flatMap((c: any) => [
            { role: 'user' as const, content: c.user_message },
            { role: 'assistant' as const, content: c.assistant_response || '', type: c.success ? 'success' as const : 'error' as const },
          ]);
          setMessages([WELCOME_MSG, ...restored]);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  const sendMessage = async (userMessage: string, confirmAction?: { confirm: boolean; pending_action: PendingAction }) => {
    setLoading(true);

    // 첨부 스냅샷(전송 후 입력창은 비움)
    const attsToSend = confirmAction ? [] : attachments;
    const attachmentSummary = attsToSend.length > 0
      ? ` [첨부: ${[
          imageCount > 0 ? `이미지 ${imageCount}장` : '',
          pdfCount > 0 ? `PDF ${pdfCount}건` : '',
        ].filter(Boolean).join(', ')}]`
      : '';

    if (!confirmAction) {
      setMessages(prev => [...prev, {
        role: 'user',
        content: userMessage,
        attachmentSummary: attachmentSummary || undefined,
      }]);
    }

    try {
      const history = messages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && m.type !== 'confirm'))
        .slice(-6)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const body: any = {
        message: userMessage,
        history,
        session_id: sessionId,
        context: {
          userId: getCookie('user_id'),
          userRole: getCookie('user_role'),
          branchId: getCookie('user_branch_id'),
        },
      };

      if (attsToSend.length > 0) {
        body.attachments = attsToSend.map(a => ({
          kind: a.kind, media_type: a.media_type, data: a.data, name: a.name,
        }));
      }

      if (confirmAction) {
        body.confirm = confirmAction.confirm;
        body.pending_action = confirmAction.pending_action;
      }

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.type === 'confirm') {
        setMessages(prev => [...prev, {
          role: 'assistant', content: data.message,
          type: 'confirm', pending_action: data.pending_action,
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.message || '처리 완료',
          type: data.type === 'error' ? 'error' : 'success',
        }]);
      }
    } catch (error: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `오류: ${error.message}`,
        type: 'error',
      }]);
    }

    setLoading(false);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    const msg = input.trim();
    if (!msg && attachments.length === 0) return;
    const sentAtts = attachments;
    setInput('');
    setAttachments([]);
    setAttachError('');
    await sendMessage(msg);
    // 전송 후 첨부 미리보기 URL 정리
    sentAtts.forEach(a => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
  };

  // Enter: 전송, Shift+Enter: 줄바꿈
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // 클립보드 paste — 이미지가 있으면 첨부에 추가
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addFiles(files);
    }
  };

  const handleConfirm = async (msg: Message) => {
    if (!msg.pending_action) return;
    setMessages(prev => [...prev, { role: 'user', content: '✅ 확인. 실행해주세요.' }]);
    await sendMessage(msg.pending_action.description, { confirm: true, pending_action: msg.pending_action });
  };

  const handleCancel = (msg: Message) => {
    setMessages(prev => prev.map(m => m === msg ? { ...m, pending_action: undefined } : m));
    setMessages(prev => [...prev,
      { role: 'user', content: '취소' },
      { role: 'assistant', content: '취소했습니다.', type: 'info' },
    ]);
  };

  const clearChat = () => {
    setMessages([{
      role: 'assistant',
      content: '대화가 초기화되었습니다.',
      type: 'info',
    }]);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
        title="AI 어시스턴트"
      >
        {isOpen ? <span className="text-xl font-bold">✕</span> : <span className="text-2xl">🤖</span>}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-[440px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-10rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col">
          {/* 헤더 */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 rounded-t-xl flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sm">경옥채 AI 어시스턴트</h3>
              <p className="text-xs text-blue-100">재고·고객·발주·생산·SMS 전 업무 처리</p>
            </div>
            <button onClick={clearChat} title="대화 초기화" className="text-blue-200 hover:text-white text-xs px-2 py-1 rounded hover:bg-blue-500 transition-colors">
              초기화
            </button>
          </div>

          {/* 메시지 영역 */}
          <div className="flex-1 overflow-auto p-3 space-y-2 text-sm">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[88%] space-y-1.5">
                  <div className={`px-3 py-2 rounded-xl leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : msg.type === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-sm'
                      : msg.type === 'confirm'
                      ? 'bg-amber-50 text-amber-900 border border-amber-200 rounded-bl-sm'
                      : msg.type === 'success'
                      ? 'bg-green-50 text-green-800 border border-green-200 rounded-bl-sm'
                      : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                  }`}>
                    {renderContent(msg.content)}
                    {msg.attachmentSummary && (
                      <div className={`mt-1 text-[10px] ${msg.role === 'user' ? 'text-blue-100' : 'text-slate-400'}`}>
                        {msg.attachmentSummary}
                      </div>
                    )}
                  </div>

                  {msg.type === 'confirm' && msg.pending_action && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleConfirm(msg)}
                        disabled={loading}
                        className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        ✅ 실행
                      </button>
                      <button
                        onClick={() => handleCancel(msg)}
                        disabled={loading}
                        className="flex-1 px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-500 px-3 py-2 rounded-xl rounded-bl-sm text-xs flex items-center gap-1">
                  <span className="animate-bounce">●</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.15s' }}>●</span>
                  <span className="animate-bounce" style={{ animationDelay: '0.3s' }}>●</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 빠른 질문 칩 */}
          <div className="px-3 py-2 border-t border-slate-100 flex gap-1.5 overflow-x-auto scrollbar-hide">
            {QUICK_ACTIONS.map(action => (
              <button
                key={action}
                onClick={() => { if (!loading) sendMessage(action); }}
                disabled={loading}
                className="flex-shrink-0 px-2.5 py-1 bg-slate-100 text-slate-600 text-xs rounded-full hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {action}
              </button>
            ))}
          </div>

          {/* 입력 영역 */}
          <form onSubmit={handleSubmit} className="border-t p-2 space-y-2">
            {/* 첨부 미리보기 */}
            {attachments.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {attachments.map(a => (
                  <div key={a.id} className="relative group">
                    {a.kind === 'image' && a.previewUrl ? (
                      <img
                        src={a.previewUrl}
                        alt={a.name}
                        className="w-12 h-12 object-cover rounded border border-slate-200"
                        title={`${a.name} (${(a.size / 1024).toFixed(0)}KB)`}
                      />
                    ) : (
                      <div
                        className="w-12 h-12 flex flex-col items-center justify-center rounded border border-slate-200 bg-red-50 text-red-700 text-[10px] font-medium"
                        title={`${a.name} (${(a.size / 1024).toFixed(0)}KB)`}
                      >
                        <span>📄</span>
                        <span className="truncate w-full text-center px-0.5">PDF</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-slate-700 text-white rounded-full text-[10px] leading-none opacity-90 hover:opacity-100"
                      title="제거"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {attachError && (
              <p className="text-[11px] text-red-600">⚠ {attachError}</p>
            )}
            <div className="flex gap-2 items-end">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                title="이미지·PDF 첨부 (또는 클립보드에서 붙여넣기 가능)"
              >
                📎
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                multiple
                hidden
                onChange={async e => {
                  if (e.target.files && e.target.files.length > 0) {
                    await addFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={loading ? '처리 중...' : '무엇을 도와드릴까요? (Shift+Enter 줄바꿈, 이미지 붙여넣기 가능)'}
                rows={1}
                className="flex-1 input text-sm resize-none min-h-[36px] max-h-32 py-1.5"
                style={{ overflow: 'auto' }}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || (!input.trim() && attachments.length === 0)}
                className="btn-primary px-4 text-sm disabled:opacity-50 shrink-0"
              >
                전송
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
