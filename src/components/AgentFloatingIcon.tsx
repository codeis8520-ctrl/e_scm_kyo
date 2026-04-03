'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'info' | 'action' | 'confirm' | 'error' | 'success';
  data?: any;
}

export default function AgentFloatingIcon() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '안녕하세요! 경옥채 AI 어시스턴트입니다.\n\n예시 명령어:\n• "강남점에 있는 홍길동 고객 정보 조회"\n• "한약국에서 백화점으로 재고 이동"\n• "010-1234-5678 고객에게 1000포인트 적립"\n• "VIP 고객 목록 조회"',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          context: {
            userId: getCookie('user_id'),
            userRole: getCookie('user_role'),
            branchId: getCookie('user_branch_id'),
          },
        }),
      });

      const data = await res.json();

      if (data.type === 'confirm') {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.message,
            type: 'confirm',
            data,
          },
        ]);
      } else if (data.type === 'success') {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: data.message + (data.data ? `\n\n${JSON.stringify(data.data, null, 2)}` : ''),
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
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] h-[500px] max-h-[calc(100vh-12rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col">
          <div className="bg-blue-600 text-white px-4 py-3 rounded-t-xl flex justify-between items-center">
            <div>
              <h3 className="font-semibold">AI 어시스턴트</h3>
              <p className="text-xs text-blue-100">명령을 입력하여 시스템을 조작하세요</p>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-lg text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.type === 'error'
                      ? 'bg-red-100 text-red-700'
                      : msg.type === 'success'
                      ? 'bg-green-100 text-green-700'
                      : msg.type === 'confirm'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 text-slate-500 px-4 py-2 rounded-lg text-sm">
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
              placeholder="명령어 입력 (예: 강남점에 제품A 10개 이동)"
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
              예시: "강남점 재고 확인" | "고객 010-1234-5678 조회" | "VIP 고객 목록"
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
