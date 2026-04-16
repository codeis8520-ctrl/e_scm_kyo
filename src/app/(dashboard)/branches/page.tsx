'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createBranch, updateBranch, deleteBranch } from '@/lib/actions';
import { setHeadquarters, unsetHeadquarters } from '@/lib/oem-actions';
import { validators } from '@/lib/validators';
import { generateQrDataUrl } from '@/lib/qr-actions';

interface Branch {
  id: string;
  name: string;
  code: string;
  channel: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  is_headquarters?: boolean;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const map = document.cookie.split(';').reduce((acc, c) => {
    const [k, v] = c.trim().split('=');
    acc[k] = decodeURIComponent(v || '');
    return acc;
  }, {} as Record<string, string>);
  return map[name] || null;
}

const CHANNEL_OPTIONS = [
  { value: 'STORE', label: '한약국' },
  { value: 'DEPT_STORE', label: '백화점' },
  { value: 'ONLINE', label: '자사몰' },
  { value: 'EVENT', label: '이벤트' },
];

const CHANNEL_COLORS: Record<string, string> = {
  STORE: 'bg-emerald-100 text-emerald-700',
  DEPT_STORE: 'bg-purple-100 text-purple-700',
  ONLINE: 'bg-blue-100 text-blue-700',
  EVENT: 'bg-amber-100 text-amber-700',
};

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [qrBranch, setQrBranch] = useState<Branch | null>(null);
  const [role] = useState<string | null>(() => getCookie('user_role'));
  const canConfigureHq = role === 'SUPER_ADMIN' || role === 'HQ_OPERATOR';

  useEffect(() => {
    fetchBranches();
  }, []);

  const fetchBranches = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from('branches').select('*').order('created_at', { ascending: true });
    setBranches(data || []);
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    await deleteBranch(id);
    fetchBranches();
  };

  const handleToggleHq = async (b: Branch) => {
    if (!canConfigureHq) return;
    if (b.is_headquarters) {
      if (!confirm(`"${b.name}"을(를) 본사에서 해제하시겠습니까? 해제 시 생산 지시 기본 입고 지점이 비워집니다.`)) return;
      const r = await unsetHeadquarters(b.id);
      if (r.error) { alert(r.error); return; }
    } else {
      const current = branches.find(x => x.is_headquarters);
      const msg = current
        ? `현재 본사 "${current.name}"이 해제되고 "${b.name}"이 본사로 지정됩니다. 계속할까요?`
        : `"${b.name}"을(를) 본사로 지정할까요?`;
      if (!confirm(msg)) return;
      const r = await setHeadquarters(b.id);
      if (r.error) { alert(r.error); return; }
    }
    fetchBranches();
  };

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <h3 className="font-semibold text-lg">지점 목록</h3>
        <button
          onClick={() => { setEditingBranch(null); setShowModal(true); }}
          className="btn-primary"
        >
          + 지점 추가
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-400">불러오는 중...</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="table min-w-[680px]">
          <thead>
            <tr>
              <th>지점코드</th>
              <th>지점명</th>
              <th>채널</th>
              <th>연락처</th>
              <th>주소</th>
              <th>상태</th>
              <th>본사</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <tr key={branch.id}>
                <td className="font-mono">{branch.code}</td>
                <td className="font-medium">
                  {branch.name}
                  {branch.is_headquarters && <span className="ml-2 inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">본사</span>}
                </td>
                <td>
                  <span className={`badge ${CHANNEL_COLORS[branch.channel] || 'bg-slate-100'}`}>
                    {CHANNEL_OPTIONS.find(c => c.value === branch.channel)?.label || branch.channel}
                  </span>
                </td>
                <td>{branch.phone || '-'}</td>
                <td className="text-slate-500 text-sm max-w-xs truncate">{branch.address || '-'}</td>
                <td>
                  <span className={`badge ${branch.is_active ? 'badge-success' : 'badge-error'}`}>
                    {branch.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td>
                  {canConfigureHq ? (
                    <button
                      onClick={() => handleToggleHq(branch)}
                      className={`text-xs px-2 py-1 rounded font-medium ${
                        branch.is_headquarters
                          ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                      title={branch.is_headquarters ? '본사 해제' : '본사로 지정'}
                    >
                      {branch.is_headquarters ? '본사 ✓' : '지정'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">{branch.is_headquarters ? '본사' : '-'}</span>
                  )}
                </td>
                <td>
                  <button
                    onClick={() => setQrBranch(branch)}
                    className="text-emerald-600 hover:underline mr-2"
                    title="고객 셀프 가입 QR"
                  >
                    QR
                  </button>
                  <button
                    onClick={() => { setEditingBranch(branch); setShowModal(true); }}
                    className="text-blue-600 hover:underline mr-2"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => handleDelete(branch.id)}
                    className="text-red-600 hover:underline"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {branches.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 py-8">
                  등록된 지점이 없습니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {showModal && (
        <BranchModal
          branch={editingBranch}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); fetchBranches(); }}
        />
      )}

      {qrBranch && (
        <BranchQrModal
          branch={qrBranch}
          onClose={() => setQrBranch(null)}
        />
      )}
    </div>
  );
}

function BranchModal({ branch, onClose, onSuccess }: { branch: Branch | null; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: branch?.name || '',
    channel: branch?.channel || 'STORE',
    address: branch?.address || '',
    phone: branch?.phone || '',
    is_active: branch?.is_active ?? true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const errors: Record<string, string> = {};
    const nameError = validators.required(formData.name, '지점명');
    if (nameError) errors.name = nameError;
    if (formData.phone) {
      const phoneError = validators.phone(formData.phone);
      if (phoneError) errors.phone = phoneError;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      return;
    }

    const form = new FormData();
    Object.entries(formData).forEach(([key, value]) => {
      form.append(key, String(value));
    });

    const result = branch
      ? await updateBranch(branch.id, form)
      : await createBranch(form);

    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg mx-4 sm:mx-auto max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">{branch ? '지점 수정' : '지점 추가'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">지점명 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => { setFormData({ ...formData, name: e.target.value }); setFieldErrors({ ...fieldErrors, name: '' }); }}
              className={`mt-1 input ${fieldErrors.name ? 'border-red-500' : ''}`}
            />
            {fieldErrors.name && <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>}
          </div>

          {branch && (
            <div>
              <label className="block text-sm font-medium text-gray-700">지점코드</label>
              <input type="text" value={branch.code} disabled className="mt-1 input bg-slate-50 text-slate-500" />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">채널 *</label>
            <select
              value={formData.channel}
              onChange={(e) => setFormData({ ...formData, channel: e.target.value })}
              className="mt-1 input"
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">연락처</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => { setFormData({ ...formData, phone: e.target.value }); setFieldErrors({ ...fieldErrors, phone: '' }); }}
              placeholder="02-1234-5678"
              className={`mt-1 input ${fieldErrors.phone ? 'border-red-500' : ''}`}
            />
            {fieldErrors.phone && <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">주소</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="mt-1 input"
            />
          </div>

          {branch && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">활성 상태</label>
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? '처리 중...' : (branch ? '수정' : '추가')}
            </button>
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// QR 코드 모달 — 고객 셀프 가입 URL
// ═══════════════════════════════════════════════════════════════════════

function BranchQrModal({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // URL 생성
  const joinUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/join/${branch.id}`
    : `/join/${branch.id}`;

  useEffect(() => {
    (async () => {
      const res = await generateQrDataUrl(joinUrl, 512);
      if (res.dataUrl) setQrDataUrl(res.dataUrl);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch.id]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('클립보드 복사 실패 — 수동으로 복사해주세요.');
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `경옥채_${branch.name}_가입QR.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;
    w.document.write(`
      <html>
        <head>
          <title>${branch.name} 가입 QR</title>
          <style>
            body { font-family: -apple-system, sans-serif; padding: 40px; text-align: center; }
            h1 { color: #065f46; font-size: 32px; margin-bottom: 8px; }
            h2 { color: #059669; font-size: 20px; font-weight: normal; margin-top: 0; }
            .qr { margin: 32px auto; }
            .qr img { border: 2px solid #065f46; border-radius: 12px; padding: 16px; background: white; }
            .guide { margin-top: 24px; padding: 20px; background: #ecfdf5; border-radius: 12px; max-width: 400px; margin-left: auto; margin-right: auto; }
            .guide h3 { margin: 0 0 12px; color: #065f46; }
            .guide ol { text-align: left; color: #475569; line-height: 1.8; }
            .footer { margin-top: 32px; font-size: 12px; color: #94a3b8; }
          </style>
        </head>
        <body>
          <h1>🌿 경옥채</h1>
          <h2>${branch.name} 회원 가입</h2>
          <div class="qr"><img src="${qrDataUrl}" width="360" /></div>
          <div class="guide">
            <h3>가입 방법</h3>
            <ol>
              <li>휴대폰 카메라로 QR 코드를 비춰주세요</li>
              <li>링크를 눌러 가입 폼을 엽니다</li>
              <li>이름과 휴대폰 번호를 입력합니다</li>
              <li>가입 완료 후 직원에게 알려주세요</li>
            </ol>
          </div>
          <div class="footer">구매 시 포인트 적립 · 생일 축하 혜택 · VIP 등급 제공</div>
          <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
        </body>
      </html>
    `);
    w.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white w-full max-w-md mx-auto max-h-[92vh] overflow-y-auto rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-emerald-800">고객 셀프 가입 QR</h2>
            <p className="text-sm text-slate-500 mt-0.5">{branch.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400">QR 생성 중...</div>
        ) : qrDataUrl ? (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center">
              <img src={qrDataUrl} alt="가입 QR" className="mx-auto w-56 h-56" />
              <p className="mt-4 text-xs text-slate-500">
                고객이 휴대폰 카메라로 스캔하여 가입할 수 있습니다
              </p>
            </div>

            <div className="mt-4">
              <label className="text-xs text-slate-500 font-medium">가입 페이지 URL</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={joinUrl}
                  readOnly
                  className="input text-xs font-mono flex-1"
                />
                <button
                  onClick={handleCopy}
                  className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap ${
                    copied ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {copied ? '복사됨' : '복사'}
                </button>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={handleDownload}
                className="flex-1 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                📥 다운로드
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
                🖨️ 인쇄
              </button>
            </div>

            <p className="text-xs text-slate-400 mt-4 text-center leading-relaxed">
              인쇄 후 매장 계산대나 입구에 부착해주세요<br />
              고객이 스캔하면 {branch.name} 회원으로 등록됩니다
            </p>
          </>
        ) : (
          <div className="py-10 text-center text-red-500">QR 생성에 실패했습니다.</div>
        )}
      </div>
    </div>
  );
}
