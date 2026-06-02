# -*- coding: utf-8 -*-
"""
LEGACY 상담을 "날짜별"로 재적재 (옵션 B).

기존: (전화, 텍스트) 중복제거 → consulted_at=NULL → 화면이 임포트일로 표시.
변경: (전화, 텍스트, 일자) 단위 → 각 상담을 그 주문의 실제 일자로.
      상담 텍스트에 [YYYY/MM/DD] 블록이 있으면 그 날짜, 없으면 주문 일자(일자 컬럼).

절차: 백업 → DELETE consultation_type='LEGACY' → 재삽입(phone JOIN customers).
UI 변경 불필요 — customers/[id] 가 이미 content.consulted_at 우선 표시.

사용: PYTHONIOENCODING=utf-8 PYTHONUTF8=1 python scripts/reimport_consultations_dated.py
DATABASE_URL 은 .env.local.
"""
import os, re, sys, io, json
from pathlib import Path
from datetime import date
import openpyxl, psycopg

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = Path.home() / 'Documents' / '카카오톡 받은 파일' / '경옥채판매DATA(~260518)_작업최종완료.xlsx'
if not SRC.exists():
    SRC = Path(r"C:\dev\e_sem_kyo\경옥채판매DATA(~260518)_작업최종완료 (1).xlsx")
SOURCE_TAG = '경옥채판매DATA(~260518)'
BACKUP = Path('legacy-import-v2/_backup-legacy-consultations.sql')

VALID_KR = ('010','011','016','017','018','019','02','031','032','033','041','042','043','044',
            '051','052','053','054','055','061','062','063','064','070','0303','0507','0508')
def digits(s): return re.sub(r'\D','', s or '')
def norm_phone(*raws):
    for raw in raws:
        d = digits(str(raw) if raw is not None else '')
        if not d or set(d) == {'0'}: continue
        if len(d) in (10,11) and d.startswith(VALID_KR):
            return f'{d[:3]}-{d[3:7]}-{d[7:]}' if len(d)==11 else f'{d[:3]}-{d[3:6]}-{d[6:]}'
        if 9 <= len(d) <= 13: return d
    return None
def parse_date(v):
    if v is None: return None
    if hasattr(v,'isoformat'):
        try: return (v.date() if hasattr(v,'date') else v).isoformat()
        except Exception: return None
    s = re.sub(r'\D','', str(v))
    if len(s)==8:
        try: return date(int(s[:4]),int(s[4:6]),int(s[6:8])).isoformat()
        except ValueError: return None
    return None
def clean_text(v):
    if v is None: return None
    s = str(v).replace('_x000D_','').strip()
    return s or None
DATE_PAT = re.compile(r'\[(\d{4})/(\d{1,2})/(\d{1,2})\]')
def parse_blocks(text, order_date):
    """[date] 블록 분해. 없으면 통째. consulted_at = 블록날짜 or 주문일자."""
    s = clean_text(text)
    if not s: return []
    ms = list(DATE_PAT.finditer(s))
    if not ms:
        return [(order_date, s)]
    out = []
    for i,m in enumerate(ms):
        try: dt = date(int(m.group(1)),int(m.group(2)),int(m.group(3))).isoformat()
        except ValueError: dt = order_date
        body = s[m.end(): ms[i+1].start() if i+1 < len(ms) else len(s)].strip()
        if body: out.append((dt or order_date, body))
    return out

def load_env():
    for n in ('.env.local','.env'):
        p = Path(n)
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                line=line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip())

def main():
    print('[1/4] Excel 읽기:', SRC.name)
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb['판매현황']; it = ws.iter_rows(min_row=1, values_only=True)
    hdr = list(next(it)); H = {h:i for i,h in enumerate(hdr)}
    def g(r,name):
        if name not in H: return ''
        v = r[H[name]]; return '' if v is None else str(v).strip()
    rows = set()  # (phone, consulted_at, text)
    for r in it:
        od = parse_date(g(r,'일자'))
        if not od: continue
        raw = g(r,'상담내역')
        if not raw: continue
        phone = norm_phone(g(r,'마이그레이션_핸드폰번호_1'), g(r,'연락처(원본)'), g(r,'마이그레이션_핸드폰번호_2'))
        if not phone: continue
        for dt, body in parse_blocks(raw, od):
            rows.add((phone, dt, body))
    print(f'  날짜별 상담 {len(rows):,}건 (이전 8,844 대비)')

    load_env()
    url = os.environ['DATABASE_URL']
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        # 백업
        BACKUP.parent.mkdir(exist_ok=True)
        cur.execute("SELECT id, customer_id, content, created_at FROM customer_consultations WHERE consultation_type='LEGACY'")
        bk = cur.fetchall()
        with open(BACKUP,'w',encoding='utf-8') as f:
            f.write('-- 백업: 재적재 직전 LEGACY 상담 (복구용)\n')
            for cid, custid, content, ca in bk:
                cj = json.dumps(content, ensure_ascii=False).replace("'","''")
                f.write(f"INSERT INTO customer_consultations (id,customer_id,consultation_type,content,created_at) "
                        f"VALUES ('{cid}','{custid}','LEGACY','{cj}'::jsonb,'{ca}') ON CONFLICT (id) DO NOTHING;\n")
        print(f'[2/4] 백업 {len(bk):,}건 → {BACKUP}')

        cur.execute("DELETE FROM customer_consultations WHERE consultation_type='LEGACY'")
        print(f'[3/4] 기존 LEGACY 상담 삭제 {cur.rowcount:,}')

        data = list(rows)
        BATCH = 500; inserted = 0
        for i in range(0, len(data), BATCH):
            chunk = data[i:i+BATCH]
            vals = []
            for phone, dt, body in chunk:
                pb = phone.replace("'","''"); bb = body.replace("'","''")
                dd = f"'{dt}'" if dt else 'NULL'
                vals.append(f"('{pb}',{dd},'{bb}')")
            cur.execute(
                "INSERT INTO customer_consultations (customer_id,consultation_type,content) "
                "SELECT c.id,'LEGACY',jsonb_build_object('text',s.body,'consulted_at',s.dt,'source','legacy') "
                "FROM (VALUES " + ",".join(vals) + ") AS s(phone,dt,body) "
                "JOIN customers c ON c.phone=s.phone"
            )
            inserted += cur.rowcount
        conn.commit()
        print(f'[4/4] 재삽입 {inserted:,} (phone 매칭 안 된 익명 상담은 제외)')

        cur.execute("SELECT count(*), count(*) FILTER(WHERE nullif(content->>'consulted_at','') IS NOT NULL) FROM customer_consultations WHERE consultation_type='LEGACY'")
        t, dated = cur.fetchone()
        print(f'검증: LEGACY {t:,} 중 일자 채워짐 {dated:,}')
        cur.execute("SELECT content->>'consulted_at', left(content->>'text',24) FROM customer_consultations WHERE consultation_type='LEGACY' AND nullif(content->>'consulted_at','') IS NOT NULL ORDER BY content->>'consulted_at' DESC LIMIT 5")
        print('샘플(최근 일자):')
        for r in cur.fetchall(): print('  ', r[0], '|', r[1])

if __name__ == '__main__':
    main()
