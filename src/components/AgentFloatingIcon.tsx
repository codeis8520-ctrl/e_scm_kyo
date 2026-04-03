'use client';

import { useState, useRef, useEffect } from 'react';

interface PendingAction {
  tool: string;
  args: Record<string, any>;
  description: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'info' | 'action' | 'confirm' | 'error' | 'success';
  pending_action?: PendingAction;
}

export default function AgentFloatingIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '안녕하세요! 경옥채 AI 어시스턴트입니다.\n\n무엇이든 자연어로 질문하세요:\n• "강남점 재고 현황 알려줘"\n• "홍길동 고객 포인트 얼마야?"\n• "VIP 적립률 알려줘"\n• "강남점에서 백화점으로 제품A 5개 이동해줘"',
      type: 'info',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (userMessage: string, confirmAction?: { confirm: boolean; pending_action: PendingAction }) => {
    setLoading(true);

    if (!confirmAction) {
      setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    }

    try {
      const body: any = {
        message: userMessage,
        context: {
          userId: getCookie('user_id'),
          userRole: getCookie('user_role'),
          branchId: getCookie('user_branch_id'),
        },
      };

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
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.message,
            type: 'confirm',
            pending_action: data.pending_action,
          },
        ]);
      } else if (data.type === 'success') {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.message,
            type: 'success',
          },
        ]);
      } else if (data.type === 'error') {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.message,
            type: 'error',
          },
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.message || '응답을 이해하지 못했습니다.',
            type: 'info',
          },
        ]);
      }
    } catch (error: any) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: `오류가 발생했습니다: ${error.message}`,
          type: 'error',
        },
      ]);
    }

    setLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput('');
    await sendMessage(userMessage);
  };

  const handleConfirm = async (msg: Message) => {
    if (!msg.pending_action) return;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: '✅ 확인했습니다. 실행해주세요.' },
    ]);
    await sendMessage(msg.pending_action.description, {
      confirm: true,
      pending_action: msg.pending_action,
    });
  };

  const handleCancel = () => {
    setMessages(prev => [
      ...prev,
      { role: 'user', content: '취소했습니다.' },
      { role: 'assistant', content: '작업이 취소되었습니다.', type: 'info' },
    ]);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110"
        title="AI 어시스턴트"
      >
        {isOpen ? (
          <span className="text-2xl">✕</span>
        ) : (
          <span className="text-2xl">💬</span>
        )}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] h-[520px] max-h-[calc(100vh-12rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col">
          <div className="bg-blue-600 text-white px-4 py-3 rounded-t-xl">
            <h3 className="font-semibold">AI 어시스턴트</h3>
            <p className="text-xs text-blue-100">자연어로 업무를 지시하세요</p>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className="max-w-[85%] space-y-2">
                  <div
                    className={`px-4 py-2 rounded-lg text-sm ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : msg.type === 'error'
                        ? 'bg-red-100 text-red-700'
                        : msg.type === 'success'
                        ? 'bg-green-100 text-green-700'
                        : msg.type === 'confirm'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {msg.content}
                  </div>
                  {msg.type === 'confirm' && msg.pending_action && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleConfirm(msg)}
                        disabled={loading}
                        className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        확인 (실행)
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={loading}
                        className="flex-1 px-3 py-1.5 bg-slate-200 text-slate-700 text-xs rounded-lg hover:bg-slate-300 disabled:opacity-50"
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
                <div className="bg-slate-100 text-slate-500 px-4 py-2 rounded-lg text-sm animate-pulse">
                  처리 중...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="무엇을 도와드릴까요?"
              className="flex-1 input text-sm"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="btn-primary px-4"
            >
              전송
            </button>
          </form>

          <div className="border-t px-4 py-2 bg-slate-50 rounded-b-xl">
            <p className="text-xs text-slate-400">
              예시: "강남점 재고" | "홍길동 포인트" | "VIP 적립률" | "재고 이동"
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {} as Record<string, string>);
  return cookies[name] || null;
}
