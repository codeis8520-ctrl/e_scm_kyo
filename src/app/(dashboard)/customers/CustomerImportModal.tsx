'use client';

import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { bulkImportCustomers, type CustomerImportRow } from '@/lib/actions';

// 헤더 라벨 → 내부 키 매핑 (가이드 양식과 동일)
const HEADER_MAP: Record<string, keyof CustomerImportRow> = {
  '이름': 'name',
  '연락처': 'phone',
  '전화번호': 'phone',
  '휴대폰': 'phone',
  '이메일': 'email',
  '주소': 'address',
  '등급': 'grade',
  '건강 메모': 'health_note',
  '건강메모': 'health_note',
  '메모': 'health_note',
  '담당 지점': 'primary_branch_name',
  '담당지점': 'primary_branch_name',
  '지점': 'primary_branch_name',
};

const PHONE_RE = /^(0\d{7,10}|1\d{7,8})$/;

interface PreviewRow extends CustomerImportRow {
  _row: number;
  _error?: string;
}

export default function CustomerImportModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<'idle' | 'preview' | 'importing' | 'done'>('idle');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState('');
  const [result, setResult] = useState<{ created: number; updated: number; skipped: { row: number; reason: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setParseError('');
    setRows([]);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (aoa.length < 2) {
        setParseError('데이터 행이 없습니다. 헤더 행 + 최소 1행이 필요합니다.');
        return;
      }
      const header = aoa[0].map((h: any) => String(h || '').trim());

      // 헤더 → 키 매핑
      const colKeys: (keyof CustomerImportRow | null)[] = header.map(h => {
        // 정확 매칭 우선, 없으면 공백 제거 후 시도
        if (HEADER_MAP[h]) return HEADER_MAP[h];
        const compact = h.replace(/\s+/g, '');
        for (const key in HEADER_MAP) {
          if (key.replace(/\s+/g, '') === compact) return HEADER_MAP[key];
        }
        return null;
      });

      if (!colKeys.includes('name') || !colKeys.includes('phone')) {
        setParseError('"이름"과 "연락처" 열이 필요합니다. 양식 다운로드를 참고해 주세요.');
        return;
      }

      const parsed: PreviewRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i];
        // 빈 행 skip
        if (r.every((v: any) => String(v || '').trim() === '')) continue;
        // 가이드 영역(※ 입력 가이드 등) skip
        const first = String(r[0] || '').trim();
        if (first.startsWith('※') || /^\d+\.\s/.test(first)) continue;

        const obj: PreviewRow = { name: '', phone: '', _row: i + 1 };
        colKeys.forEach((key, j) => {
          if (!key) return;
          const v = String(r[j] || '').trim();
          if (v) (obj as any)[key] = v;
        });

        // 행 단위 검증
        if (!obj.name) obj._error = '이름 누락';
        else if (!obj.phone) obj._error = '연락처 누락';
        else if (!PHONE_RE.test(obj.phone.replace(/[\s-]/g, ''))) obj._error = '연락처 형식 오류';
        else if (obj.grade && !['NORMAL', 'VIP', 'VVIP'].includes(obj.grade.toUpperCase())) obj._error = '등급 값 오류 (NORMAL/VIP/VVIP)';

        parsed.push(obj);
      }

      if (parsed.length === 0) {
        setParseError('처리할 데이터 행이 없습니다.');
        return;
      }

      setRows(parsed);
      setStep('preview');
    } catch (err: any) {
      setParseError(`파일 읽기 실패: ${err?.message || '알 수 없는 오류'}`);
    }
  };

  const handleImport = async () => {
    const valid = rows.filter(r => !r._error).map(r => {
      const { _row, _error, ...rest } = r;
      return rest as CustomerImportRow;
    });
    if (valid.length === 0) {
      alert('등록 가능한 행이 없습니다.');
      return;
    }
    setStep('importing');
    const res = await bulkImportCustomers(valid);
    if ((res as any).error) {
      alert(`실패: ${(res as any).error}`);
      setStep('preview');
      return;
    }
    setResult({ created: res.created, updated: res.updated, skipped: res.skipped });
    setStep('done');
  };

  const reset = () => {
    setStep('idle');
    setRows([]);
    setParseError('');
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validCount = rows.filter(r => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-bold text-base">고객 엑셀 일괄 등록</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 가이드 + 양식 다운로드 */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs space-y-1.5">
            <p className="text-blue-900 font-medium">📌 사용 안내</p>
            <ul className="text-blue-800 list-disc pl-4 space-y-0.5">
              <li>필수 항목: <b>이름</b>, <b>연락처</b></li>
              <li>연락처가 이미 등록된 고객은 빈 칸이 아닌 항목만 업데이트됩니다.</li>
              <li>등급은 NORMAL / VIP / VVIP 중 하나로 입력 (공란 시 NORMAL).</li>
              <li>담당 지점은 지점명으로 입력 — 매칭 안 되면 자동으로 비워집니다.</li>
              <li>한 번에 최대 1,000행까지 처리 가능.</li>
            </ul>
            <a
              href="/api/customers/import-template"
              download
              className="inline-flex items-center gap-1 mt-1 text-blue-700 hover:text-blue-900 font-medium"
            >
              📥 엑셀 양식 다운로드
            </a>
          </div>

          {step === 'idle' && (
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
              <p className="text-sm text-slate-500 mb-3">.xlsx 파일을 선택하세요</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary px-4 text-sm"
              >
                파일 선택
              </button>
              {parseError && (
                <p className="mt-3 text-xs text-red-600">⚠ {parseError}</p>
              )}
            </div>
          )}

          {step === 'preview' && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  총 <b>{rows.length}</b>행 — 등록 가능 <b className="text-green-600">{validCount}</b>건
                  {errorCount > 0 && <> · 오류 <b className="text-red-500">{errorCount}</b>건</>}
                </div>
                <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-700 underline">다시 선택</button>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="max-h-[40vh] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr className="text-slate-500">
                        <th className="px-2 py-1.5 text-left">#</th>
                        <th className="px-2 py-1.5 text-left">상태</th>
                        <th className="px-2 py-1.5 text-left">이름</th>
                        <th className="px-2 py-1.5 text-left">연락처</th>
                        <th className="px-2 py-1.5 text-left">등급</th>
                        <th className="px-2 py-1.5 text-left">지점</th>
                        <th className="px-2 py-1.5 text-left">이메일</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r, i) => (
                        <tr key={i} className={r._error ? 'bg-red-50' : ''}>
                          <td className="px-2 py-1 text-slate-400">{r._row}</td>
                          <td className="px-2 py-1">
                            {r._error
                              ? <span className="text-[10px] text-red-700 bg-red-100 rounded px-1.5 py-0.5">⚠ {r._error}</span>
                              : <span className="text-[10px] text-green-700 bg-green-100 rounded px-1.5 py-0.5">OK</span>}
                          </td>
                          <td className="px-2 py-1 truncate max-w-[80px]" title={r.name}>{r.name}</td>
                          <td className="px-2 py-1 truncate max-w-[110px]" title={r.phone}>{r.phone}</td>
                          <td className="px-2 py-1">{r.grade || '-'}</td>
                          <td className="px-2 py-1 truncate max-w-[100px]" title={r.primary_branch_name || ''}>{r.primary_branch_name || '-'}</td>
                          <td className="px-2 py-1 truncate max-w-[140px]" title={r.email || ''}>{r.email || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {step === 'importing' && (
            <div className="py-8 text-center text-slate-500 text-sm">처리 중...</div>
          )}

          {step === 'done' && result && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm space-y-1">
                <p className="font-semibold text-green-800">✓ 등록 완료</p>
                <p>신규 등록: <b>{result.created}</b>건</p>
                <p>업데이트: <b>{result.updated}</b>건</p>
                {result.skipped.length > 0 && (
                  <p className="text-red-600">제외: <b>{result.skipped.length}</b>건</p>
                )}
              </div>
              {result.skipped.length > 0 && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-1.5 bg-red-50 text-xs text-red-700 font-medium">제외된 행 ({result.skipped.length}건)</div>
                  <div className="max-h-40 overflow-auto text-xs divide-y divide-red-100">
                    {result.skipped.map((s, i) => (
                      <div key={i} className="px-3 py-1 flex justify-between">
                        <span className="text-slate-500">행 {s.row}</span>
                        <span className="text-red-600">{s.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-slate-50">
          {step === 'preview' && (
            <button
              onClick={handleImport}
              disabled={validCount === 0}
              className="btn-primary px-4 text-sm disabled:opacity-50"
            >
              {validCount}건 등록
            </button>
          )}
          {step === 'done' && (
            <button onClick={() => { onSuccess(); onClose(); }} className="btn-primary px-4 text-sm">
              닫기
            </button>
          )}
          {step !== 'done' && (
            <button onClick={onClose} className="px-4 py-2 text-sm rounded border border-slate-200 text-slate-600 hover:bg-slate-50">
              취소
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
