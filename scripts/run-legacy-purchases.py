"""
legacy-import/purchases-*.sql 33개를 순차 실행.

사용법:
  1. Supabase Dashboard → Project Settings → Database → Connection String
     "Transaction" 모드 (포트 6543) 또는 "Session" 모드 (포트 5432) 의
     URI 를 복사 (예: postgresql://postgres.xxxx:[PASSWORD]@aws-0-...pooler.supabase.com:6543/postgres)

  2. 환경변수로 전달:
     (PowerShell)  $env:DATABASE_URL = "postgresql://..."
     (bash/zsh)    export DATABASE_URL="postgresql://..."
     또는 .env 파일에 DATABASE_URL=postgresql://... 추가

  3. 실행:
     python3 scripts/run-legacy-purchases.py

  옵션 — 특정 파일부터 재개:
     python3 scripts/run-legacy-purchases.py --start 17
     (purchases-17.sql 부터 33까지 실행)

  옵션 — purchases 외 다른 패턴:
     python3 scripts/run-legacy-purchases.py --pattern "customers-*.sql"
"""

import os
import sys
import argparse
import time
from pathlib import Path

try:
    import psycopg
    PG_LIB = 'psycopg'
except ImportError:
    try:
        import psycopg2 as psycopg
        PG_LIB = 'psycopg2'
    except ImportError:
        print('❌ psycopg(또는 psycopg2)가 필요합니다.')
        print('   pip install --user "psycopg[binary]"  (권장)')
        print('   또는 pip install --user psycopg2-binary')
        sys.exit(1)

# .env 자동 로드 (있으면)
def load_dotenv():
    for name in ('.env.local', '.env'):
        p = Path(name)
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

load_dotenv()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', type=int, default=1, help='시작 인덱스 (기본 1)')
    ap.add_argument('--end', type=int, default=None, help='끝 인덱스 (기본 마지막)')
    ap.add_argument('--pattern', default='purchases-*.sql', help='파일 패턴 (기본 purchases-*.sql)')
    ap.add_argument('--dir', default='legacy-import', help='파일 폴더')
    args = ap.parse_args()

    db_url = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')
    if not db_url:
        print('❌ DATABASE_URL 환경변수가 필요합니다.')
        print('   Supabase Dashboard → Project Settings → Database → Connection String 복사')
        print('   예) export DATABASE_URL="postgresql://postgres.xxxx:[PWD]@aws-0-...pooler.supabase.com:6543/postgres"')
        sys.exit(1)

    folder = Path(args.dir)
    files = sorted(folder.glob(args.pattern))
    if not files:
        print(f'❌ {folder}/{args.pattern} 에 매칭되는 파일이 없습니다.')
        sys.exit(1)

    # 인덱스 필터링
    def file_idx(p):
        # purchases-07.sql → 7
        try:
            return int(p.stem.split('-')[-1])
        except ValueError:
            return -1

    files = [f for f in files
             if file_idx(f) >= args.start and (args.end is None or file_idx(f) <= args.end)]

    print(f'🔌 라이브러리: {PG_LIB}')
    print(f'📂 실행 대상 ({len(files)} 파일):')
    for f in files:
        print(f'   - {f.name}')

    print(f'\n⏳ 연결 시도...')
    conn = psycopg.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()
    print(f'✅ 연결 성공\n')

    started = time.time()
    failed = []
    for i, f in enumerate(files, start=1):
        sql = f.read_text(encoding='utf-8')
        t0 = time.time()
        try:
            cur.execute(sql)
            conn.commit()
            elapsed = time.time() - t0
            print(f'  [{i:2}/{len(files)}] {f.name:<25} ✅  ({elapsed:.1f}s)')
        except Exception as e:
            conn.rollback()
            elapsed = time.time() - t0
            print(f'  [{i:2}/{len(files)}] {f.name:<25} ❌  ({elapsed:.1f}s) — {e}')
            failed.append(f.name)
            # 첫 실패에서 멈출지 / 계속 진행할지 — 진행
            # break  # 멈추려면 주석 해제

    cur.close()
    conn.close()
    total = time.time() - started
    print(f'\n총 {len(files)} 파일, 실패 {len(failed)}건, {total:.1f}s')
    if failed:
        print('실패 파일:')
        for n in failed:
            print(f'  - {n}')
        sys.exit(2)


if __name__ == '__main__':
    main()
