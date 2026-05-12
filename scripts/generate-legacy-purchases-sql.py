"""
구매내역.xlsx → legacy_purchases INSERT SQL 분할 생성.

매핑:
  - phone 정규화 (앞서 customers 임포트와 동일 규칙)
  - branch_code_raw (예: "A1(본사)") → branches.code 매핑은 SQL 내 CASE WHEN 으로 처리
  - customer_id 는 customers.phone JOIN 으로 자동 lookup. 매칭 안 되면 NULL.

청크 분할:
  - 1 INSERT 문에 500행, 파일당 2 INSERT 블록 → 약 250KB/파일, ~33개 파일.

품목/단가는 원본 텍스트 그대로 저장. 자동 분해 안 함.
"""

import openpyxl
import re
import csv
import json
import sys
import io
from pathlib import Path
from datetime import date

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC_FILE = '구매내역.xlsx'
OUT_DIR = Path('legacy-import')
OUT_DIR.mkdir(exist_ok=True)
SKIPPED_CSV = OUT_DIR / 'purchases-skipped.csv'

CHUNK_SIZE = 500    # 1 INSERT 의 VALUES 행 수
FILE_BLOCKS = 2     # 1 .sql 파일에 INSERT 블록 수


def sql_str(v):
    if v is None or v == '':
        return 'NULL'
    s = str(v).replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'"


VALID_PREFIX = ('010', '011', '016', '017', '018', '019',
                '02', '031', '032', '033', '041', '042', '043', '044',
                '051', '052', '053', '054', '055',
                '061', '062', '063', '064', '070', '0303', '0507', '0508')


def normalize_phone(raw):
    if raw is None:
        return None
    digits = re.sub(r'\D', '', str(raw))
    if not digits or set(digits) == {'0'}:
        return None
    if len(digits) in (10, 11):
        for p in VALID_PREFIX:
            if digits.startswith(p):
                return digits
        return None
    if len(digits) >= 11:
        cand = digits[:11]
        for p in VALID_PREFIX:
            if cand.startswith(p):
                return cand
    return None


def format_phone(digits):
    if not digits:
        return None
    if len(digits) == 11:
        return f'{digits[:3]}-{digits[3:7]}-{digits[7:]}'
    if len(digits) == 10:
        return f'{digits[:3]}-{digits[3:6]}-{digits[6:]}'
    return digits


HEADER = """\
-- ═════════════════════════════════════════════════════════════════
-- Legacy 구매내역 임포트 — 구매내역.xlsx
--
-- branch_code_raw → branches.code 매핑:
--   A1(본사)              → HQ
--   B1(한약국(청담))      → CD
--   B2(한약국(한남))      → DS-HD
--   C1(대전신세계)        → C1
--   C2(강남신세계)        → C2
--   C2(도곡SSG)           → C2D
--   C3(명동신세계)        → C3
--   C3(광교갤러리아)      → C3K
--   C4(잠실롯데)          → C4
--   C4(대구신세계)        → C4D
--   D2(부산신세계)        → D2
--
-- customer_id: customers.phone JOIN. 매칭 안 되면 NULL (익명 거래).
-- ═════════════════════════════════════════════════════════════════

"""

INSERT_TAIL = """\
)
INSERT INTO legacy_purchases (
  legacy_purchase_no, customer_id, phone, ordered_at, channel_text,
  branch_id, branch_code_raw, item_text, quantity, total_amount,
  payment_status, source_file
)
SELECT
  s.legacy_no,
  c.id,
  s.phone,
  s.ordered_at,
  s.channel_text,
  b.id,
  s.branch_code_raw,
  s.item_text,
  s.quantity,
  s.total_amount,
  s.payment_status,
  s.source_file
FROM src s
LEFT JOIN customers c ON c.phone = s.phone
LEFT JOIN LATERAL (
  SELECT CASE s.branch_code_raw
    WHEN 'A1(본사)'              THEN 'HQ'
    WHEN 'B1(한약국(청담))'      THEN 'CD'
    WHEN 'B2(한약국(한남))'      THEN 'DS-HD'
    WHEN 'C1(대전신세계)'        THEN 'C1'
    WHEN 'C2(강남신세계)'        THEN 'C2'
    WHEN 'C2(도곡SSG)'           THEN 'C2D'
    WHEN 'C3(명동신세계)'        THEN 'C3'
    WHEN 'C3(광교갤러리아)'      THEN 'C3K'
    WHEN 'C4(잠실롯데)'          THEN 'C4'
    WHEN 'C4(대구신세계)'        THEN 'C4D'
    WHEN 'D2(부산신세계)'        THEN 'D2'
  END AS code
) cm ON true
LEFT JOIN branches b ON b.code = cm.code;
"""


def main():
    print('[1/2] Excel 로딩...')
    wb = openpyxl.load_workbook(SRC_FILE, read_only=True, data_only=True)
    ws = wb['구매내역']

    rows_out = []
    skipped = []

    for r in ws.iter_rows(min_row=2, values_only=True):
        pid, phone_raw, dt, channel, branch_raw, item, qty, total_amt, pay_st, src_file = r

        # 날짜 — 필수
        if hasattr(dt, 'isoformat'):
            ordered_at = dt.date().isoformat() if hasattr(dt, 'date') else dt.isoformat()
        elif dt and re.match(r'\d{4}-\d{2}-\d{2}', str(dt)):
            ordered_at = str(dt)[:10]
        else:
            skipped.append((str(pid), str(phone_raw or ''), str(dt or ''), 'invalid_date'))
            continue

        # 품목 — 필수
        if not item or not str(item).strip():
            skipped.append((str(pid), str(phone_raw or ''), ordered_at, 'item_empty'))
            continue

        # 전화 정규화 (실패 시 NULL 로 둠 — customer_id JOIN 안 됨, 익명으로 보존)
        norm = normalize_phone(phone_raw)
        phone_fmt = format_phone(norm) if norm else None

        rows_out.append({
            'legacy_no': str(pid or '').strip() or None,
            'phone': phone_fmt,
            'ordered_at': ordered_at,
            'channel_text': str(channel or '').strip() or None,
            'branch_code_raw': str(branch_raw or '').strip() or None,
            'item_text': str(item).strip(),
            'quantity': float(qty) if qty is not None else None,
            'total_amount': int(round(float(total_amt))) if total_amt is not None else None,
            'payment_status': str(pay_st or '').strip() or None,
            'source_file': str(src_file or '').strip() or None,
        })

    print(f'  total={len(rows_out)}, skipped={len(skipped)}')

    print('\n[2/2] SQL 분할 생성...')
    files = []
    file_idx = 0
    blocks_in_file = 0
    f = None

    for chunk_start in range(0, len(rows_out), CHUNK_SIZE):
        if blocks_in_file == 0:
            file_idx += 1
            file_path = OUT_DIR / f'purchases-{file_idx:02d}.sql'
            files.append(file_path)
            if f:
                f.close()
            f = file_path.open('w', encoding='utf-8')
            f.write(HEADER)
            f.write(f'-- 파일 {file_idx}\n\n')

        chunk = rows_out[chunk_start:chunk_start + CHUNK_SIZE]
        f.write('WITH src(legacy_no, phone, ordered_at, channel_text, branch_code_raw, item_text, quantity, total_amount, payment_status, source_file) AS (VALUES\n')
        values = []
        for r in chunk:
            values.append(
                f"  ({sql_str(r['legacy_no'])}, "
                f"{sql_str(r['phone'])}, "
                f"{sql_str(r['ordered_at'])}::date, "
                f"{sql_str(r['channel_text'])}, "
                f"{sql_str(r['branch_code_raw'])}, "
                f"{sql_str(r['item_text'])}, "
                f"{r['quantity'] if r['quantity'] is not None else 'NULL'}::numeric, "
                f"{r['total_amount'] if r['total_amount'] is not None else 'NULL'}::numeric, "
                f"{sql_str(r['payment_status'])}, "
                f"{sql_str(r['source_file'])})"
            )
        f.write(',\n'.join(values))
        f.write('\n')
        f.write(INSERT_TAIL)
        f.write('\n')

        blocks_in_file += 1
        if blocks_in_file >= FILE_BLOCKS:
            blocks_in_file = 0
    if f:
        f.close()

    with SKIPPED_CSV.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['legacy_purchase_no', 'raw_phone', 'date', 'reason'])
        w.writerows(skipped)

    print(f'\n생성 완료 ({OUT_DIR}/)')
    print(f'  purchases SQL ({len(files)} 파일):')
    total_size = 0
    for p in files:
        sz = p.stat().st_size
        total_size += sz
        print(f'    - {p.name}: {sz / 1024:.0f} KB')
    print(f'  합계: {total_size / 1024 / 1024:.2f} MB')
    print(f'  skipped: {SKIPPED_CSV.name} ({len(skipped)} rows)')


if __name__ == '__main__':
    main()
