"""
단일 SQL 파일(마이그레이션)을 DATABASE_URL 대상에 적용.

사용법:
  python scripts/apply_one_sql.py supabase/migrations/078_sales_payments_allow_refund.sql

DATABASE_URL 은 .env.local / .env 에서 자동 로드.
적용 전후로 대상 테이블 CHECK 제약을 출력해 검증한다(기본: sales_order_payments).
"""
import os
import sys
from pathlib import Path

try:
    import psycopg
    PG_LIB = 'psycopg'
except ImportError:
    try:
        import psycopg2 as psycopg
        PG_LIB = 'psycopg2'
    except ImportError:
        print('psycopg(또는 psycopg2)가 필요합니다. pip install --user "psycopg[binary]"')
        sys.exit(1)


def load_dotenv():
    for name in ('.env.local', '.env'):
        p = Path(name)
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k = k.strip(); v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v


def show_constraints(cur, table):
    # to_regclass: 테이블 없으면 NULL (예외 없이) → 생성 전 마이그 적용에도 안전
    cur.execute("SELECT to_regclass(%s)", (table,))
    if cur.fetchone()[0] is None:
        print(f'  [{table}] 아직 없음(생성 예정)')
        return
    cur.execute(
        """
        SELECT conname, pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE conrelid = %s::regclass AND contype = 'c'
        ORDER BY conname
        """, (table,))
    rows = cur.fetchall()
    print(f'  [{table}] CHECK 제약 {len(rows)}건:')
    for name, defn in rows:
        print(f'    - {name}: {defn}')


def main():
    if len(sys.argv) < 2:
        print('사용법: python scripts/apply_one_sql.py <sql파일경로> [검증테이블]')
        sys.exit(1)
    sql_path = Path(sys.argv[1])
    verify_table = sys.argv[2] if len(sys.argv) > 2 else 'sales_order_payments'
    if not sql_path.exists():
        print(f'파일 없음: {sql_path}')
        sys.exit(1)

    load_dotenv()
    db_url = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')
    if not db_url:
        print('DATABASE_URL 환경변수가 필요합니다 (.env.local).')
        sys.exit(1)

    sql = sql_path.read_text(encoding='utf-8')
    print(f'라이브러리: {PG_LIB}')
    print(f'적용 파일 : {sql_path}')
    masked = db_url.split('@')[-1] if '@' in db_url else db_url
    print(f'대상 DB   : ...@{masked}\n')

    conn = psycopg.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()
    print('── 적용 전 ──')
    show_constraints(cur, verify_table)
    print()

    try:
        cur.execute(sql)
        conn.commit()
        print('✅ 적용 성공 (commit)\n')
    except Exception as e:
        conn.rollback()
        print(f'❌ 적용 실패 (rollback) — {e}')
        cur.close(); conn.close()
        sys.exit(2)

    print('── 적용 후 ──')
    show_constraints(cur, verify_table)
    cur.close(); conn.close()


if __name__ == '__main__':
    main()
