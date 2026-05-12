"""
전화번호_검색결과_최종.xlsx → Supabase SQL Editor 에 붙여넣을 INSERT 문 생성.

생성물:
  - legacy-import-customers.sql        (customers UPSERT, 500행/청크)
  - legacy-import-consultations.sql    (customer_consultations INSERT, 500행/청크)
  - legacy-import-skipped.csv          (전화번호 정규화 실패로 스킵한 행 로그)

UPSERT 정책:
  - phone(UNIQUE) 기준 충돌 시 기존 NULL/빈 필드만 신규 값으로 채움.
  - metadata JSONB 는 기존 || 신규 머지 (legacy_* 키 누적).

전화번호 정규화:
  - 숫자만 추출 후 10/11자리 + (010/011/016~19/02/03/...) 시작 → valid
  - 길이가 12 이상이면 두 번호 합쳐진 케이스로 보고 앞 11자리만 사용 시도
    (앞 11자리가 valid 가 아니면 skip)
  - 11자리 외 미식별 형식은 skip → CSV 로그

상담내역:
  - "[YYYY/MM/DD] 내용\n[YYYY/MM/DD] 내용..." 패턴을 블록 단위로 분리
  - 날짜 못 찾으면 전체를 1건으로, consulted_at = null (import 날짜로 created_at 만 기록)
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

SRC_FILE = '전화번호_검색결과_최종.xlsx'
OUT_DIR = Path('legacy-import')
OUT_DIR.mkdir(exist_ok=True)
SKIPPED_CSV = OUT_DIR / 'skipped.csv'

CHUNK_SIZE = 500           # 1개 INSERT 문에 들어가는 행 수
FILE_BLOCKS = 2            # 1개 .sql 파일에 들어가는 INSERT 블록 수 → 파일당 ≈ 500KB


# ── 안전한 SQL 문자열 이스케이프 ─────────────────────────────────────────
def sql_str(v):
    if v is None:
        return 'NULL'
    s = str(v).replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'"


def sql_jsonb(d):
    if d is None or d == {}:
        return "'{}'::jsonb"
    s = json.dumps(d, ensure_ascii=False).replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'::jsonb"


# ── 전화번호 정규화 ─────────────────────────────────────────────────────
VALID_PREFIX = ('010', '011', '016', '017', '018', '019',
                '02', '031', '032', '033', '041', '042', '043', '044',
                '051', '052', '053', '054', '055',
                '061', '062', '063', '064', '070', '0303', '0507', '0508')


def normalize_phone(raw):
    """raw → '01012345678' or None"""
    if raw is None:
        return None
    digits = re.sub(r'\D', '', str(raw))
    if not digits:
        return None
    # 더미
    if set(digits) == {'0'}:
        return None
    # 정상 길이
    if len(digits) in (10, 11):
        for p in VALID_PREFIX:
            if digits.startswith(p):
                return digits
        return None
    # 길이 12+ → 두 번호 합쳐진 케이스 시도: 앞 11자리만 사용
    if len(digits) >= 11:
        cand = digits[:11]
        for p in VALID_PREFIX:
            if cand.startswith(p):
                return cand
    return None


def format_phone(digits):
    """01012345678 → 010-1234-5678 (표시용)"""
    if not digits:
        return ''
    if len(digits) == 11:
        return f'{digits[:3]}-{digits[3:7]}-{digits[7:]}'
    if len(digits) == 10:
        return f'{digits[:3]}-{digits[3:6]}-{digits[6:]}'
    return digits


# ── 상담내역 파싱 ───────────────────────────────────────────────────────
DATE_PAT = re.compile(r'\[(\d{4})/(\d{1,2})/(\d{1,2})\]')


def parse_consultations(text):
    """[YYYY/MM/DD] 블록 단위로 분리. 못 찾으면 전체 1건."""
    if not text or not str(text).strip():
        return []
    s = str(text).strip()
    matches = list(DATE_PAT.finditer(s))
    if not matches:
        return [{'consulted_at': None, 'text': s}]
    blocks = []
    for i, m in enumerate(matches):
        y, mo, d = m.group(1), m.group(2), m.group(3)
        try:
            dt = date(int(y), int(mo), int(d)).isoformat()
        except ValueError:
            dt = None
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(s)
        body = s[start:end].strip()
        if body:
            blocks.append({'consulted_at': dt, 'text': body})
    return blocks


# ── 메타데이터 구성 ─────────────────────────────────────────────────────
def build_metadata(relation, name_memo, src_file, kind):
    meta = {
        'legacy_imported_at': date.today().isoformat(),
        'legacy_source_file': '전화번호_검색결과_최종.xlsx',
    }
    if src_file:
        meta['legacy_source_year'] = str(src_file)
    if kind:
        meta['legacy_kind'] = str(kind)
    if relation:
        meta['legacy_relation'] = str(relation).strip()
    if name_memo:
        meta['legacy_name_memo'] = str(name_memo).strip()
    return meta


# ── INSERT 청크 작성기 ──────────────────────────────────────────────────
CUSTOMER_HEADER = """\
-- ═════════════════════════════════════════════════════════════════
-- Legacy 고객 마스터 임포트 — 전화번호_검색결과_최종.xlsx
-- 정책:
--   · phone(UNIQUE) 기준 ON CONFLICT → 비어있는 필드만 채우고
--     metadata 는 기존 || 신규로 머지
-- ═════════════════════════════════════════════════════════════════

"""

CUSTOMER_UPSERT_TAIL = """\
ON CONFLICT (phone) DO UPDATE SET
  name      = COALESCE(NULLIF(customers.name, ''), EXCLUDED.name),
  address   = COALESCE(NULLIF(customers.address, ''), EXCLUDED.address),
  metadata  = COALESCE(customers.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();
"""

CONSULT_HEADER = """\
-- ═════════════════════════════════════════════════════════════════
-- Legacy 상담내역 임포트
-- content JSONB: { text, consulted_at, source: "legacy" }
-- consultation_type = 'LEGACY'
-- ═════════════════════════════════════════════════════════════════

"""


def main():
    print(f'[1/3] Excel 로딩...')
    wb = openpyxl.load_workbook(SRC_FILE, read_only=True, data_only=True)
    ws = wb['전화번호 검색결과']

    customer_rows = []      # (phone, name, address, metadata_json_str)
    consult_rows = []        # (phone, consulted_at, text)
    skipped = []             # (raw_phone, name, reason)

    seen_phones = set()
    total = 0
    dup_in_file = 0

    for r in ws.iter_rows(min_row=2, values_only=True):
        total += 1
        phone, name, relation, name_memo, addr, src_file, consult, kind = r

        norm = normalize_phone(phone)
        if not norm:
            skipped.append((str(phone or ''), str(name or ''), 'phone_invalid'))
            continue

        nm = str(name or '').strip()
        if not nm:
            skipped.append((str(phone), '', 'name_empty'))
            continue

        formatted = format_phone(norm)

        if formatted in seen_phones:
            # 파일 내 중복 — 첫 행만 사용 (이미 위에서 stat 11825 unique 였지만 정규화 후 중복 발생 가능)
            dup_in_file += 1
            # 상담내역은 추가 가능
            blocks = parse_consultations(consult)
            for b in blocks:
                consult_rows.append((formatted, b['consulted_at'], b['text']))
            continue
        seen_phones.add(formatted)

        meta = build_metadata(relation, name_memo, src_file, kind)
        customer_rows.append((formatted, nm, str(addr or '').strip() or None, meta))

        blocks = parse_consultations(consult)
        for b in blocks:
            consult_rows.append((formatted, b['consulted_at'], b['text']))

    print(f'  total={total}, customers={len(customer_rows)}, consultations={len(consult_rows)}, '
          f'skipped={len(skipped)}, dup_in_file_after_normalize={dup_in_file}')

    # ── customers SQL — 여러 파일로 분할 ────────────────────────────────
    print(f'\n[2/3] customers SQL 분할 생성...')
    cust_files = []
    block_idx = 0
    file_idx = 0
    blocks_in_file = 0
    f = None
    for chunk_start in range(0, len(customer_rows), CHUNK_SIZE):
        if blocks_in_file == 0:
            file_idx += 1
            file_path = OUT_DIR / f'customers-{file_idx:02d}.sql'
            cust_files.append(file_path)
            if f:
                f.close()
            f = file_path.open('w', encoding='utf-8')
            f.write(CUSTOMER_HEADER)
            f.write(f'-- 파일 {file_idx}, 행 범위 {chunk_start + 1} ~ ?\n\n')

        chunk = customer_rows[chunk_start:chunk_start + CHUNK_SIZE]
        f.write('INSERT INTO customers (phone, name, address, metadata, is_active) VALUES\n')
        values = []
        for phone, nm, addr, meta in chunk:
            values.append(f'  ({sql_str(phone)}, {sql_str(nm)}, {sql_str(addr)}, {sql_jsonb(meta)}, true)')
        f.write(',\n'.join(values))
        f.write('\n')
        f.write(CUSTOMER_UPSERT_TAIL)
        f.write('\n')

        blocks_in_file += 1
        block_idx += 1
        if blocks_in_file >= FILE_BLOCKS:
            blocks_in_file = 0
    if f:
        f.close()

    # ── consultations SQL — 여러 파일로 분할 ───────────────────────────
    print(f'\n[3/3] consultations SQL 분할 생성...')
    cons_files = []
    block_idx = 0
    file_idx = 0
    blocks_in_file = 0
    f = None
    for chunk_start in range(0, len(consult_rows), CHUNK_SIZE):
        if blocks_in_file == 0:
            file_idx += 1
            file_path = OUT_DIR / f'consultations-{file_idx:02d}.sql'
            cons_files.append(file_path)
            if f:
                f.close()
            f = file_path.open('w', encoding='utf-8')
            f.write(CONSULT_HEADER)
            f.write(f'-- 파일 {file_idx}\n\n')

        chunk = consult_rows[chunk_start:chunk_start + CHUNK_SIZE]
        f.write('WITH src(phone, consulted_at, body) AS (VALUES\n')
        values = []
        for phone, consulted_at, text in chunk:
            ca = sql_str(consulted_at)
            ca_typed = f'{ca}::date' if consulted_at else 'NULL::date'
            values.append(f'  ({sql_str(phone)}, {ca_typed}, {sql_str(text)})')
        f.write(',\n'.join(values))
        f.write('\n)\n')
        f.write("""INSERT INTO customer_consultations (customer_id, consultation_type, content)
SELECT c.id, 'LEGACY', jsonb_build_object('text', s.body, 'consulted_at', s.consulted_at, 'source', 'legacy')
FROM src s
JOIN customers c ON c.phone = s.phone;
""")
        f.write('\n')
        blocks_in_file += 1
        block_idx += 1
        if blocks_in_file >= FILE_BLOCKS:
            blocks_in_file = 0
    if f:
        f.close()

    # ── skipped CSV ────────────────────────────────────────────────────
    with SKIPPED_CSV.open('w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['raw_phone', 'name', 'reason'])
        w.writerows(skipped)

    print(f'\n생성 완료 ({OUT_DIR}/)')
    print(f'  customers SQL ({len(cust_files)} 파일):')
    for p in cust_files:
        print(f'    - {p.name}: {p.stat().st_size / 1024:.0f} KB')
    print(f'  consultations SQL ({len(cons_files)} 파일):')
    for p in cons_files:
        print(f'    - {p.name}: {p.stat().st_size / 1024:.0f} KB')
    print(f'  skipped: {SKIPPED_CSV.name} ({len(skipped)} rows)')


if __name__ == '__main__':
    main()
