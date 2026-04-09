'use client';

import { useState } from 'react';
import { publicRegisterCustomer } from '@/lib/public-registration-actions';

interface Props {
  branchId: string;
  branchName: string;
}

function formatPhone(value: string): string {
  const d = value.replace(/[^0-9]/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

export default function JoinForm({ branchId, branchName }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthday, setBirthday] = useState('');
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [marketingAgreed, setMarketingAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!privacyAgreed) {
      setResult({ success: false, message: '개인정보 수집 및 이용 동의가 필요합니다.' });
      return;
    }

    setSubmitting(true);
    setResult(null);

    const res = await publicRegisterCustomer({
      branchId,
      name,
      phone,
      email: email || null,
      birthday: birthday || null,
      privacyAgreed,
      marketingAgreed,
    });

    setSubmitting(false);

    if (res.error) {
      setResult({ success: false, message: res.error });
    } else {
      setResult({
        success: true,
        message: res.reactivated
          ? `${branchName} 회원 정보가 업데이트되었습니다.`
          : `${branchName} 회원 가입이 완료되었습니다!`,
      });
    }
  };

  // 가입 완료 화면
  if (result?.success) {
    return (
      <div className="card text-center py-10 bg-emerald-50 border border-emerald-200">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-emerald-800 mb-2">가입 완료!</h2>
        <p className="text-sm text-slate-600 mb-6 whitespace-pre-line">{result.message}</p>
        <div className="text-xs text-slate-500 mb-6">
          매장 직원에게 가입 완료를 알려주시면<br />
          바로 혜택을 받으실 수 있습니다.
        </div>
        <button
          onClick={() => {
            setResult(null);
            setName('');
            setPhone('');
            setEmail('');
            setBirthday('');
            setPrivacyAgreed(false);
            setMarketingAgreed(false);
          }}
          className="text-xs text-slate-500 underline"
        >
          다른 회원 등록하기
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          이름 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="홍길동"
          required
          minLength={2}
          maxLength={50}
          className="input text-base"
          autoComplete="name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          휴대폰 번호 <span className="text-red-500">*</span>
        </label>
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={e => setPhone(formatPhone(e.target.value))}
          placeholder="010-1234-5678"
          required
          className="input text-base font-mono"
          autoComplete="tel"
        />
        <p className="text-xs text-slate-400 mt-1">- 없이 입력해도 자동 하이픈</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          생일 <span className="text-slate-400 text-xs">(선택)</span>
        </label>
        <input
          type="date"
          value={birthday}
          onChange={e => setBirthday(e.target.value)}
          className="input text-base"
          max={new Date().toISOString().slice(0, 10)}
        />
        <p className="text-xs text-slate-400 mt-1">생일 축하 메시지와 혜택을 받을 수 있습니다</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          이메일 <span className="text-slate-400 text-xs">(선택)</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="example@domain.com"
          className="input text-base"
          autoComplete="email"
        />
      </div>

      {/* 동의 */}
      <div className="pt-2 space-y-3 border-t border-slate-100">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={privacyAgreed}
            onChange={e => setPrivacyAgreed(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0"
            required
          />
          <span className="text-sm text-slate-700">
            <span className="font-medium">[필수]</span> 개인정보 수집 · 이용 동의
            <details className="mt-1">
              <summary className="text-xs text-emerald-600 cursor-pointer">자세히 보기</summary>
              <div className="text-xs text-slate-500 mt-1 p-2 bg-slate-50 rounded leading-relaxed">
                경옥채는 회원 관리 · 포인트 적립 · 구매 이력 조회 · 고객 상담을 위해
                이름, 휴대폰 번호, 이메일, 생일을 수집합니다.
                수집된 정보는 회원 탈퇴 시까지 보관되며, 법령에 따라 보관 기간이 달라질 수 있습니다.
                동의하지 않으실 수 있으나, 동의하지 않으면 회원 가입이 불가합니다.
              </div>
            </details>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={marketingAgreed}
            onChange={e => setMarketingAgreed(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0"
          />
          <span className="text-sm text-slate-700">
            <span className="font-medium text-slate-500">[선택]</span> 마케팅 정보 수신 동의
            <div className="text-xs text-slate-400 mt-0.5">
              신제품 · 이벤트 · 할인 정보를 알림톡/SMS로 받습니다
            </div>
          </span>
        </label>
      </div>

      {result?.success === false && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-200">
          ⚠️ {result.message}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !name || !phone || !privacyAgreed}
        className="w-full py-3 rounded-lg bg-emerald-600 text-white font-semibold text-base hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? '등록 중...' : '회원 가입하기'}
      </button>

      <p className="text-xs text-center text-slate-400">
        가입 즉시 일반 등급으로 시작됩니다
      </p>
    </form>
  );
}
