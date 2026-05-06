'use client';

import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { bulkImportProducts, type ProductImportRow } from '@/lib/actions';

const HEADER_MAP: Record<string, keyof ProductImportRow> = {
  '제품명': 'name',
  '품목명': 'name',
  '코드': 'code',
  '제품코드': 'code',
  '유형': 'product_type',
  '제품유형': 'product_type',
  '단위': 'unit',
  '판매가': 'price',
  '가격': 'price',
  '원가': 'cost',
  '바코드': 'barcode',
  '부가세': 'is_taxable',
  '과세구분': 'is_taxable',
  '재고관리': 'track_inventory',
  '재고 관리': 'track_inventory',
  '카테고리': 'category',
  '분류': 'category',
  '설명': 'description',
};

// 화면 라벨(한국어) + 영문 enum 둘 다 허용
const VALID_TYPE_LABELS = new Set(['완제품', '원자재', '부자재', '무형상품', '서비스', '']);
const VALID_TYPE_ENUMS = new Set(['FINISHED', 'RAW', 'SUB', 'SERVICE', '']);
function isValidType(v: string): boolean {
  if (VALID_TYPE_LABELS.has(v)) return true;
  return VALID_TYPE_ENUMS.has(v.toUpperCase());
}
function displayType(v?: string): string {
  if (!v) return '완제품';
  // 영문이면 한국어로 변환해 표시
  const upper = v.toUpperCase();
  if (upper === 'FINISHED') return '완제품';
  if (upper === 'RAW') return '원자재';
  if (upper === 'SUB') return '부자재';
  if (upper === 'SERVICE') return '무형상품';
  return v;
}

interface PreviewRow extends ProductImportRow {
  _row: number;
  _error?: string;
  _existingCode?: boolean; // 코드가 비어있지 않을 때만 의미
}

export default function ProductImportModal({
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
  // 진행률: 클라이언트에서 chunk 단위로 끊어 호출하므로 N/M 표시
  const [progress, setProgress] = useState<{ current: number; total: number; partial: { created: number; updated: number; skipped: number } } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Vercel Hobby(10초 함수 timeout) 안전 마진 — 한 번에 200행씩.
  //   서버 측 batch upsert 처리 능력은 약 100행/초이므로 200행 chunk는 2~3초 내 완료.
  const CHUNK_SIZE = 200;

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

      const colKeys: (keyof ProductImportRow | null)[] = header.map(h => {
        if (HEADER_MAP[h]) return HEADER_MAP[h];
        const compact = h.replace(/\s+/g, '');
        for (const key in HEADER_MAP) {
          if (key.replace(/\s+/g, '') === compact) return HEADER_MAP[key];
        }
        return null;
      });

      if (!colKeys.includes('name')) {
        setParseError('"제품명" 열이 필요합니다. 양식 다운로드를 참고해 주세요.');
        return;
      }

      const parsed: PreviewRow[] = [];
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i];
        if (r.every((v: any) => String(v || '').trim() === '')) continue;
        const first = String(r[0] || '').trim();
        if (first.startsWith('※') || /^\d+\.\s/.test(first)) continue;

        const obj: PreviewRow = { name: '', _row: i + 1 };
        colKeys.forEach((key, j) => {
          if (!key) return;
          const v = String(r[j] || '').trim();
          if (v) (obj as any)[key] = v;
        });

        // 검증
        if (!obj.name) obj._error = '제품명 누락';
        else if (obj.product_type && !isValidType(obj.product_type)) {
          obj._error = `유형 값 오류 (${obj.product_type}) — 완제품/원자재/부자재/무형상품 중 하나`;
        }

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
    // PreviewRow에 매겨진 _row(엑셀 행 번호) 보존 → 서버에서 받는 row 번호를 원본 엑셀 행으로 보정
    const validWithRowNo = rows.filter(r => !r._error);
    if (validWithRowNo.length === 0) { alert('등록 가능한 행이 없습니다.'); return; }

    setStep('importing');

    const totalChunks = Math.ceil(validWithRowNo.length / CHUNK_SIZE);
    setProgress({ current: 0, total: totalChunks, partial: { created: 0, updated: 0, skipped: 0 } });

    let agg = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };

    for (let c = 0; c < totalChunks; c++) {
      const startIdx = c * CHUNK_SIZE;
      const sliceWithRowNo = validWithRowNo.slice(startIdx, startIdx + CHUNK_SIZE);
      const slice = sliceWithRowNo.map(r => {
        const { _row, _error, _existingCode, ...rest } = r;
        return rest as ProductImportRow;
      });

      try {
        const res = await bulkImportProducts(slice);

        if ((res as any).error) {
          // chunk 전체 실패 — 행 번호와 사유 누적, 다음 chunk 계속
          for (const r of sliceWithRowNo) {
            agg.skipped.push({ row: r._row, reason: (res as any).error });
          }
        } else {
          agg.created += res.created;
          agg.updated += res.updated;
          // 서버가 반환한 row 번호(1-based, chunk 내)를 원본 엑셀 행 번호로 변환
          for (const s of res.skipped) {
            const local = s.row - 1;
            const original = sliceWithRowNo[local];
            agg.skipped.push({
              row: original ? original._row : s.row,
              reason: s.reason,
            });
          }
        }
      } catch (err: any) {
        // 네트워크/timeout 등 — 해당 chunk 전체를 실패로 기록하고 진행 계속
        for (const r of sliceWithRowNo) {
          agg.skipped.push({ row: r._row, reason: `네트워크/타임아웃: ${err?.message || '알 수 없음'}` });
        }
      }

      setProgress({
        current: c + 1,
        total: totalChunks,
        partial: { created: agg.created, updated: agg.updated, skipped: agg.skipped.length },
      });
    }

    setResult(agg);
    setStep('done');
  };

  const reset = () => {
    setStep('idle');
    setRows([]);
    setParseError('');
    setResult(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validCount = rows.filter(r => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-bold text-base">제품 엑셀 일괄 등록</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs space-y-1.5">
            <p className="text-blue-900 font-medium">📌 사용 안내</p>
            <ul className="text-blue-800 list-disc pl-4 space-y-0.5">
              <li>필수: <b>제품명</b>. 코드는 비우면 자동 생성(KYO-XXXX-XXXXXX).</li>
              <li>유형: <b>완제품 / 원자재 / 부자재 / 무형상품</b> (비우면 완제품).</li>
              <li>부가세: "과세" / "면세". 재고관리: "예" / "아니오" (무형상품 기본값 "아니오").</li>
              <li>카테고리는 <b>시스템 코드 → 카테고리 탭</b>에서 등록한 항목을 다음 중 하나로:
                전체 경로명("제품 / 더경옥 제품 / 단지") · 위치 코드("[1-1-1]") · 잎 이름.</li>
              <li>동일 코드가 이미 있으면 빈 칸이 아닌 항목만 업데이트.</li>
              <li>신규 + 재고관리="예" → 모든 활성 지점에 재고 0 자동 생성.</li>
              <li>한 번에 최대 1,000행.</li>
            </ul>
            <a
              href="/api/products/import-template"
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
                <div className="max-h-[42vh] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr className="text-slate-500">
                        <th className="px-2 py-1.5 text-left">#</th>
                        <th className="px-2 py-1.5 text-left">상태</th>
                        <th className="px-2 py-1.5 text-left">제품명</th>
                        <th className="px-2 py-1.5 text-left">코드</th>
                        <th className="px-2 py-1.5 text-left">유형</th>
                        <th className="px-2 py-1.5 text-right">판매가</th>
                        <th className="px-2 py-1.5 text-right">원가</th>
                        <th className="px-2 py-1.5 text-left">카테고리</th>
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
                          <td className="px-2 py-1 truncate max-w-[140px]" title={r.name}>{r.name}</td>
                          <td className="px-2 py-1 truncate max-w-[120px] text-slate-500 font-mono" title={r.code}>{r.code || <span className="text-slate-300">자동</span>}</td>
                          <td className="px-2 py-1">{displayType(r.product_type)}</td>
                          <td className="px-2 py-1 text-right">{r.price ?? <span className="text-slate-300">-</span>}</td>
                          <td className="px-2 py-1 text-right">{r.cost ?? <span className="text-slate-300">-</span>}</td>
                          <td className="px-2 py-1 truncate max-w-[160px]" title={r.category || ''}>{r.category || <span className="text-slate-300">-</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {step === 'importing' && (
            <div className="py-8 px-4">
              <div className="text-center text-sm text-slate-700 font-medium mb-3">
                {progress ? (
                  <>처리 중... <span className="text-blue-600">{progress.current}/{progress.total}</span> 묶음 완료</>
                ) : '처리 시작...'}
              </div>
              {progress && (
                <>
                  <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden mb-3">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-center gap-4 text-xs text-slate-600">
                    <span>신규 <b className="text-green-600">{progress.partial.created}</b></span>
                    <span>·</span>
                    <span>업데이트 <b className="text-blue-600">{progress.partial.updated}</b></span>
                    {progress.partial.skipped > 0 && (
                      <>
                        <span>·</span>
                        <span>제외 <b className="text-red-500">{progress.partial.skipped}</b></span>
                      </>
                    )}
                  </div>
                </>
              )}
              <p className="text-center text-[11px] text-slate-400 mt-3">
                {CHUNK_SIZE}행씩 끊어서 안전하게 처리합니다 (Vercel 함수 timeout 보호).
              </p>
            </div>
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
