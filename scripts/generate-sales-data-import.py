# -*- coding: utf-8 -*-
"""
경옥채판매DATA(~260518)_작업최종완료.xlsx → 재적재 SQL 생성.

산출물 (legacy-import-v2/):
  customers-NN.sql        customers UPSERT(phone). 1전화=1고객(dedup).
  consultations-NN.sql    customer_consultations(LEGACY). (phone,text) dedup.
  purchases-NN.sql        legacy_purchases 라인아이템 단위. phone JOIN, 지점명 매칭.
  review-customers.csv     공유전화(한 번호 여러 이름) 검수 목록.
  skipped-rows.csv         날짜/품목 무효로 스킵한 라인.

정책
  · 고객 키 = 정규화 전화(마이그_1 → 연락처원본). 이름 아님.
    한국: 10~11자리 valid prefix → '010-1234-5678' 포맷 저장.
    해외: 9~13자리 → digits 그대로 저장 + metadata.legacy_foreign_phone=true.
    무효(len<9 등): 고객 생성 안 함 → 구매는 customer_id=NULL 익명 보존.
  · 이름 정규화: 같은 폰 최빈→동률시 최장. 나머지는 metadata.legacy_name_variants.
  · 주소: 같은 폰 중 최장 비어있지 않은 값.
  · 구매: 라인아이템 1행. legacy_order_no=일자+순번+거래처코드 로 주문 묶음.
"""

import openpyxl, re, csv, json, sys, io
from pathlib import Path
from datetime import date
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC_FILE = Path.home() / 'Documents' / '카카오톡 받은 파일' / '경옥채판매DATA(~260518)_작업최종완료.xlsx'
SOURCE_TAG = '경옥채판매DATA(~260518)'
OUT_DIR = Path('legacy-import-v2'); OUT_DIR.mkdir(exist_ok=True)
CHUNK = 500
FILE_BLOCKS = 2

VALID_KR_PREFIX = ('010','011','016','017','018','019',
                   '02','031','032','033','041','042','043','044',
                   '051','052','053','054','055','061','062','063','064',
                   '070','0303','0507','0508')

def sql_str(v):
    if v is None or v == '': return 'NULL'
    s = str(v).replace("\\","\\\\").replace("'","''")
    return f"'{s}'"

def sql_num(v):
    return str(v) if v is not None else 'NULL'

def sql_jsonb(d):
    if not d: return "'{}'::jsonb"
    s = json.dumps(d, ensure_ascii=False).replace("\\","\\\\").replace("'","''")
    return f"'{s}'::jsonb"

def digits(s): return re.sub(r'\D','', s or '')

def normalize_phone(*raws):
    """여러 후보 중 첫 유효 전화 → (kind, stored_str) | None"""
    for raw in raws:
        d = digits(str(raw) if raw is not None else '')
        if not d or set(d) == {'0'}: continue
        if len(d) in (10,11) and d.startswith(VALID_KR_PREFIX):
            if len(d) == 11: stored = f'{d[:3]}-{d[3:7]}-{d[7:]}'
            else:            stored = f'{d[:3]}-{d[3:6]}-{d[6:]}'
            return ('KR', stored)
        if 9 <= len(d) <= 13:
            return ('FOREIGN', d)
    return None

def parse_date(v):
    """'YYYYMMDD' or datetime → 'YYYY-MM-DD' | None"""
    if v is None: return None
    if hasattr(v, 'isoformat'):
        try: return (v.date() if hasattr(v,'date') else v).isoformat()
        except Exception: return None
    s = re.sub(r'\D','', str(v))
    if len(s) == 8:
        try: return date(int(s[:4]), int(s[4:6]), int(s[6:8])).isoformat()
        except ValueError: return None
    return None

def clean_text(v):
    if v is None: return None
    s = str(v).replace('_x000D_','').strip()
    return s or None

DATE_PAT = re.compile(r'\[(\d{4})/(\d{1,2})/(\d{1,2})\]')
def parse_consultations(text):
    if not text or not str(text).strip(): return []
    s = clean_text(text)
    if not s: return []
    ms = list(DATE_PAT.finditer(s))
    if not ms: return [{'consulted_at': None, 'text': s}]
    out = []
    for i,m in enumerate(ms):
        try: dt = date(int(m.group(1)),int(m.group(2)),int(m.group(3))).isoformat()
        except ValueError: dt = None
        body = s[m.end(): ms[i+1].start() if i+1 < len(ms) else len(s)].strip()
        if body: out.append({'consulted_at': dt, 'text': body})
    return out


def write_chunks(out_prefix, header, rows, render_block):
    """rows 를 CHUNK*FILE_BLOCKS 단위로 .sql 파일들에 기록."""
    files = []; fidx = 0; blocks_in_file = 0; f = None
    for start in range(0, len(rows), CHUNK):
        if blocks_in_file == 0:
            fidx += 1
            p = OUT_DIR / f'{out_prefix}-{fidx:02d}.sql'; files.append(p)
            if f: f.close()
            f = p.open('w', encoding='utf-8'); f.write(header)
        f.write(render_block(rows[start:start+CHUNK])); f.write('\n')
        blocks_in_file += 1
        if blocks_in_file >= FILE_BLOCKS: blocks_in_file = 0
    if f: f.close()
    return files


def main():
    print('[1/5] Excel 로딩...', SRC_FILE.name)
    wb = openpyxl.load_workbook(SRC_FILE, read_only=True, data_only=True)
    ws = wb['판매현황']
    it = ws.iter_rows(min_row=1, values_only=True)
    hdr = list(next(it)); H = {h:i for i,h in enumerate(hdr)}
    def g(r,name):
        v = r[H[name]]; return '' if v is None else str(v).strip()

    # ── per-customer 집계 ───────────────────────────────────────────────
    cust = defaultdict(lambda: {'kind':None,'names':Counter(),'addrs':[],'consults':[]})
    purchase_rows = []   # dict per line item
    skipped = []         # (order, reason)

    for r in it:
        d_ordered = parse_date(g(r,'일자'))
        if not d_ordered:                       # 임베디드 헤더/무효일자
            skipped.append((g(r,'일자'), 'invalid_date')); continue
        item_name = clean_text(g(r,'품목명'))
        if not item_name:
            skipped.append((d_ordered, 'item_empty')); continue

        ph = normalize_phone(g(r,'마이그레이션_핸드폰번호_1'), g(r,'연락처(원본)'),
                             g(r,'마이그레이션_핸드폰번호_2'))
        kind, phone = (ph if ph else (None, None))
        name = clean_text(g(r,'고객명'))
        addr = clean_text(g(r,'주소'))

        if phone:
            c = cust[phone]; c['kind'] = kind
            if name: c['names'][name] += 1
            if addr: c['addrs'].append(addr)
            for blk in parse_consultations(g(r,'상담내역')):
                c['consults'].append((blk['consulted_at'], blk['text']))

        order_no = f"{re.sub(chr(92)+'D','',g(r,'일자'))}-{g(r,'순번')}-{g(r,'거래처코드')}"

        def to_num(name, cast=float):
            v = g(r,name)
            if v == '': return None
            try: return cast(float(v))
            except (ValueError, TypeError): return None

        purchase_rows.append({
            'order_no': order_no,
            'phone': phone,
            'ordered_at': d_ordered,
            'channel_text': clean_text(g(r,'거래처명')),
            'branch_code_raw': g(r,'거래처코드') or None,
            'branch_name': clean_text(g(r,'거래처명')),
            'item_code': clean_text(g(r,'품목코드')),
            'item_text': item_name,
            'option_text': clean_text(g(r,'주문 옵션')),
            'quantity': to_num('수량', float),
            'unit_price_vat': to_num('단가(vat포함)', float),
            'supply_amount': to_num('공급가액', int),
            'vat_amount': to_num('부가세', int),
            'discount_amount': to_num('할인', int),
            'total_amount': to_num('합계', int),
            'staff_code': g(r,'담당자') or None,
            'recipient_name': clean_text(g(r,'받는 분')),
            'recipient_phone': (normalize_phone(g(r,'받는 분 연락처'))[1]
                                if normalize_phone(g(r,'받는 분 연락처')) else clean_text(g(r,'받는 분 연락처'))),
            'recipient_address': clean_text(g(r,'받는 분 주소')),
            'received_at': parse_date(g(r,'수령일자')),
            'payment_status': clean_text(g(r,'결제정보')),
            'note': clean_text(g(r,'특이사항')),
            'source_file': SOURCE_TAG,
        })

    print(f'  라인 {len(purchase_rows)}, 스킵 {len(skipped)}, 고유고객(폰) {len(cust)}')

    # ── 고객 dedup → 대표 이름/주소 ────────────────────────────────────
    print('[2/5] 고객 정규화...')
    customer_rows = []   # (phone, name, addr, metadata)
    consult_rows = []    # (phone, consulted_at, text)
    review = []          # 공유전화 검수
    for phone, c in cust.items():
        names = c['names']
        if names:
            best = max(names.items(), key=lambda kv: (kv[1], len(kv[0])))[0]
            variants = [n for n in names if n != best]
        else:
            best, variants = '(이름미상)', []
        best = best[:100]
        addr = max(c['addrs'], key=len) if c['addrs'] else None
        meta = {'legacy_imported_at': date.today().isoformat(),
                'legacy_source_file': SOURCE_TAG}
        if c['kind'] == 'FOREIGN': meta['legacy_foreign_phone'] = True
        if variants: meta['legacy_name_variants'] = variants[:20]
        customer_rows.append((phone, best, addr, meta))
        if len(names) > 1:
            review.append((phone, best, ' | '.join(f'{n}×{cnt}' for n,cnt in names.most_common())))
        # 상담 dedup
        seen = set()
        for ca, tx in c['consults']:
            k = (ca, tx)
            if k in seen: continue
            seen.add(k); consult_rows.append((phone, ca, tx))

    n_foreign = sum(1 for _,_,_,m in customer_rows if m.get('legacy_foreign_phone'))
    print(f'  고객 {len(customer_rows)} (해외 {n_foreign}), 상담 {len(consult_rows)}, 공유전화검수 {len(review)}')

    # ── customers SQL ──────────────────────────────────────────────────
    print('[3/5] customers SQL...')
    CUST_HEADER = ('-- Legacy 고객 (경옥채판매DATA) — phone UNIQUE UPSERT, 1전화=1고객\n\n')
    CUST_TAIL = ("ON CONFLICT (phone) DO UPDATE SET\n"
                 "  name=COALESCE(NULLIF(customers.name,''),EXCLUDED.name),\n"
                 "  address=COALESCE(NULLIF(customers.address,''),EXCLUDED.address),\n"
                 "  metadata=COALESCE(customers.metadata,'{}'::jsonb)||EXCLUDED.metadata,\n"
                 "  updated_at=NOW();\n")
    def render_cust(chunk):
        vals = [f"  ({sql_str(p)}, {sql_str(nm)}, {sql_str(ad)}, {sql_jsonb(mt)}, true)"
                for p,nm,ad,mt in chunk]
        return ('INSERT INTO customers (phone,name,address,metadata,is_active) VALUES\n'
                + ',\n'.join(vals) + '\n' + CUST_TAIL)
    cfiles = write_chunks('customers', CUST_HEADER, customer_rows, render_cust)

    # ── consultations SQL ──────────────────────────────────────────────
    print('[4/5] consultations SQL...')
    CONS_HEADER = ('-- Legacy 상담 (경옥채판매DATA) — consultation_type=LEGACY\n\n')
    def render_cons(chunk):
        vals = []
        for phone, ca, tx in chunk:
            ca_typed = f'{sql_str(ca)}::date' if ca else 'NULL::date'
            vals.append(f'  ({sql_str(phone)}, {ca_typed}, {sql_str(tx)})')
        return ('WITH src(phone,consulted_at,body) AS (VALUES\n' + ',\n'.join(vals) + '\n)\n'
                "INSERT INTO customer_consultations (customer_id,consultation_type,content)\n"
                "SELECT c.id,'LEGACY',jsonb_build_object('text',s.body,'consulted_at',s.consulted_at,'source','legacy')\n"
                "FROM src s JOIN customers c ON c.phone=s.phone;\n")
    consfiles = write_chunks('consultations', CONS_HEADER, consult_rows, render_cons)

    # ── purchases SQL (라인아이템) ─────────────────────────────────────
    print('[5/5] purchases SQL...')
    PUR_HEADER = ('-- Legacy 구매 라인아이템 (경옥채판매DATA)\n'
                  '-- customer_id: customers.phone JOIN. branch_id: branches.name 매칭(불일치 NULL).\n\n')
    cols = ('legacy_order_no,phone,ordered_at,channel_text,branch_code_raw,branch_name,'
            'item_code,item_text,option_text,quantity,unit_price_vat,supply_amount,vat_amount,'
            'discount_amount,total_amount,staff_code,recipient_name,recipient_phone,'
            'recipient_address,received_at,payment_status,note,source_file')
    def render_pur(chunk):
        vals = []
        for r in chunk:
            vals.append('  (' + ', '.join([
                sql_str(r['order_no']), sql_str(r['phone']), f"{sql_str(r['ordered_at'])}::date",
                sql_str(r['channel_text']), sql_str(r['branch_code_raw']), sql_str(r['branch_name']),
                sql_str(r['item_code']), sql_str(r['item_text']), sql_str(r['option_text']),
                f"{sql_num(r['quantity'])}::numeric", f"{sql_num(r['unit_price_vat'])}::numeric",
                f"{sql_num(r['supply_amount'])}::numeric", f"{sql_num(r['vat_amount'])}::numeric",
                f"{sql_num(r['discount_amount'])}::numeric", f"{sql_num(r['total_amount'])}::numeric",
                sql_str(r['staff_code']), sql_str(r['recipient_name']), sql_str(r['recipient_phone']),
                sql_str(r['recipient_address']),
                f"{sql_str(r['received_at'])}::date" if r['received_at'] else 'NULL::date',
                sql_str(r['payment_status']), sql_str(r['note']), sql_str(r['source_file']),
            ]) + ')')
        return ('WITH src(' + cols + ') AS (VALUES\n' + ',\n'.join(vals) + '\n)\n'
                "INSERT INTO legacy_purchases (\n"
                "  legacy_order_no,customer_id,phone,ordered_at,channel_text,branch_id,branch_code_raw,\n"
                "  item_code,item_text,option_text,quantity,unit_price_vat,supply_amount,vat_amount,\n"
                "  discount_amount,total_amount,staff_code,recipient_name,recipient_phone,\n"
                "  recipient_address,received_at,payment_status,note,source_file)\n"
                "SELECT s.legacy_order_no, c.id, s.phone, s.ordered_at, s.channel_text, b.id, s.branch_code_raw,\n"
                "  s.item_code, s.item_text, s.option_text, s.quantity, s.unit_price_vat, s.supply_amount, s.vat_amount,\n"
                "  s.discount_amount, s.total_amount, s.staff_code, s.recipient_name, s.recipient_phone,\n"
                "  s.recipient_address, s.received_at, s.payment_status, s.note, s.source_file\n"
                "FROM src s\n"
                "LEFT JOIN customers c ON c.phone = s.phone\n"
                "LEFT JOIN branches  b ON btrim(b.name) = btrim(s.branch_name);\n")
    pfiles = write_chunks('purchases', PUR_HEADER, purchase_rows, render_pur)

    # ── CSV ────────────────────────────────────────────────────────────
    with (OUT_DIR/'review-customers.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w = csv.writer(f); w.writerow(['phone','대표이름','이름들(빈도)']); w.writerows(review)
    with (OUT_DIR/'skipped-rows.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w = csv.writer(f); w.writerow(['ref','reason']); w.writerows(skipped)

    print(f'\n생성 완료 ({OUT_DIR}/)')
    print(f'  customers : {len(cfiles)}파일 / {len(customer_rows)}명')
    print(f'  consultations: {len(consfiles)}파일 / {len(consult_rows)}건')
    print(f'  purchases : {len(pfiles)}파일 / {len(purchase_rows)}라인')
    print(f'  review-customers.csv: {len(review)}, skipped-rows.csv: {len(skipped)}')


if __name__ == '__main__':
    main()
