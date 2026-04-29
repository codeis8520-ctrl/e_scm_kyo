import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

// 고객 일괄 등록 템플릿 — 헤더 + 예시 1줄
//   필수: 이름, 연락처
//   선택: 이메일, 주소, 등급, 건강 메모, 담당 지점
export async function GET() {
  const header = ['이름', '연락처', '이메일', '주소', '등급', '건강 메모', '담당 지점'];
  const example = [
    '홍길동',
    '010-1234-5678',
    'hong@example.com',
    '서울시 강남구 청담동 11-1',
    'NORMAL',
    '갱년기 관련 상담',
    '청담점',
  ];
  const guide = [
    [],
    ['※ 입력 가이드'],
    ['1. 이름·연락처는 필수.'],
    ['2. 연락처는 010-0000-0000 또는 02-000-0000 등 휴대폰/유선 모두 허용.'],
    ['3. 등급은 NORMAL / VIP / VVIP 중 하나(공란 시 NORMAL).'],
    ['4. 담당 지점은 지점명을 그대로 입력 (예: 청담점). 일치하지 않으면 비워둡니다.'],
    ['5. 동일한 연락처가 이미 등록돼 있으면 빈 칸이 아닌 항목만 업데이트됩니다(이름·이메일·주소·건강 메모 등).'],
  ];

  const rows: any[][] = [header, example, ...guide];
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 컬럼 너비
  ws['!cols'] = [
    { wch: 12 }, // 이름
    { wch: 18 }, // 연락처
    { wch: 24 }, // 이메일
    { wch: 36 }, // 주소
    { wch: 10 }, // 등급
    { wch: 30 }, // 건강 메모
    { wch: 14 }, // 담당 지점
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '고객 등록');

  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="customer_import_template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
