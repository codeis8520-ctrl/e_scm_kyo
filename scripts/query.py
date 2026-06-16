"""
읽기 전용 SELECT 실행. DATABASE_URL(.env.local) 사용.
사용: python scripts/query.py "SELECT ..."
"""
import os, sys
from pathlib import Path
try:
    import psycopg
except ImportError:
    import psycopg2 as psycopg

def load_dotenv():
    for name in ('.env.local', '.env'):
        p = Path(name)
        if p.exists():
            for line in p.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line: continue
                k, v = line.split('=', 1)
                k = k.strip(); v = v.strip().strip('"').strip("'")
                if k and k not in os.environ: os.environ[k] = v

def main():
    if len(sys.argv) < 2:
        print('사용: python scripts/query.py "SELECT ..."'); sys.exit(1)
    sql = sys.argv[1]
    load_dotenv()
    db_url = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')
    if not db_url:
        print('DATABASE_URL 필요'); sys.exit(1)
    conn = psycopg.connect(db_url)
    cur = conn.cursor()
    cur.execute(sql)
    if cur.description:
        cols = [d[0] for d in cur.description]
        print(' | '.join(cols))
        print('-' * 60)
        for row in cur.fetchall():
            print(' | '.join('' if v is None else str(v) for v in row))
    else:
        print(f'rows affected: {cur.rowcount}')
    cur.close(); conn.close()

if __name__ == '__main__':
    main()
