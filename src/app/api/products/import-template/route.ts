import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// 제품 일괄 등록 템플릿
//   필수: 제품명
//   선택: 코드(자동), 유형, 단위, 판매가, 원가, 바코드, 부가세, 재고관리, 카테고리, 설명
export async function GET() {
  const header = ['제품명', '코드', '유형', '단위', '판매가', '원가', '바코드', '부가세', '재고관리', '카테고리', '설명'];
  const example1 = [
    '플러스골드 600',
    '',                // 비우면 자동 생성 (KYO-XXXX-XXXXXX)
    'FINISHED',
    '개',
    105000,
    32000,
    '8801234567890',
    '과세',
    '예',
    '제품 / 더경옥 제품 / 단지',  // pathName 형식
    '대표 완제품 예시',
  ];
  const example2 = [
    '홍삼정',
    '',
    'RAW',
    'g',
    0,
    18000,
    '',
    '면세',
    '예',
    '[2-1-1]',                     // pathCode 형식도 허용
    '원자재 예시',
  ];
  const example3 = [
    '복약 컨설팅 30분',
    '',
    'SERVICE',
    '회',
    50000,
    0,
    '',
    '과세',
    '아니오',                       // 재고 관리 X
    '',
    '무형상품 예시',
  ];

  const guide = [
    [],
    ['※ 입력 가이드'],
    ['1. 제품명은 필수. 코드는 비워두면 자동 생성됩니다 (KYO-XXXX-XXXXXX).'],
    ['2. 유형: FINISHED(완제품), RAW(원자재), SUB(부자재), SERVICE(무형상품). 비우면 FINISHED.'],
    ['3. 부가세: "과세" 또는 "면세". 비우면 과세. 면세 품목은 한약류·식품류 등.'],
    ['4. 재고관리: "예" 또는 "아니오". 비우면 SERVICE는 "아니오", 그 외는 "예".'],
    ['5. 바코드는 FINISHED 유형만 저장됩니다 — 그 외 유형의 입력은 무시.'],
    ['6. 판매가/원가는 숫자(원). 콤마는 자동 제거됨.'],
    ['7. 카테고리는 다음 중 하나 형식으로:'],
    ['   • 전체 경로명 — 제품 / 더경옥 제품 / 단지'],
    ['   • 위치 코드 — [1-1-1] 또는 1-1-1'],
    ['   • 잎 이름 — "단지" (중복 시 첫 번째 매칭). 모호하면 경로명 권장.'],
    ['8. 동일 코드가 이미 등록돼 있으면 빈 칸이 아닌 항목만 업데이트됩니다.'],
    ['9. 신규 등록 시 재고관리=예이면 모든 활성 지점에 재고 0 레코드 자동 생성.'],
    ['10. 한 번에 최대 1,000행까지 처리 가능.'],
  ];

  const rows: any[][] = [header, example1, example2, example3, ...guide];
  const ws = XLSX.utils.aoa_to_sheet(rows);

  ws['!cols'] = [
    { wch: 24 }, // 제품명
    { wch: 22 }, // 코드
    { wch: 10 }, // 유형
    { wch: 8 },  // 단위
    { wch: 10 }, // 판매가
    { wch: 10 }, // 원가
    { wch: 18 }, // 바코드
    { wch: 8 },  // 부가세
    { wch: 10 }, // 재고관리
    { wch: 30 }, // 카테고리
    { wch: 30 }, // 설명
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '제품 등록');
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="product_import_template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
