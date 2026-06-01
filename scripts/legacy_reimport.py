#!/usr/bin/env python3
"""
Legacy 판매데이터 재적재 오케스트레이터 (경옥채판매DATA v2).

서브커맨드:
  check    현재 영향 테이블 카운트 출력 (연결 확인 겸용)
  backup   영향 테이블을 로컬 .sql 로 덤프 (reset 전 안전망) — 방법 B
  migrate  supabase/migrations/069_legacy_purchases_line_items.sql 실행
  reset    legacy-import/reset-before-reimport.sql 실행 (전량 초기화)
  load     legacy-import-v2/<pattern> 파일들을 인덱스 순서로 실행
  verify   재적재 후 카운트 검증

DATABASE_URL 은 .env.local / .env 에서 읽음. 비밀번호는 절대 출력하지 않음.

사용 예:
  python scripts/legacy_reimport.py check
  python scripts/legacy_reimport.py backup
  python scripts/legacy_reimport.py migrate
  python scripts/legacy_reimport.py reset
  python scripts/legacy_reimport.py load "customers-*.sql"
  python scripts/legacy_reimport.py load "consultations-*.sql"
  python scripts/legacy_reimport.py load "purchases-*.sql"
  python scripts/legacy_reimport.py verify
"""
import os
import sys
import time
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
V2_DIR = ROOT / "legacy-import-v2"

# reset 가 건드리는 테이블 (방법 B 백업 대상)
AFFECTED = [
    "customers",
    "point_history",
    "customer_consultations",
    "customer_tag_map",
    "legacy_purchases",
]


def load_dotenv():
    for name in (".env.local", ".env"):
        p = ROOT / name
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


def db_url():
    load_dotenv()
    url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not url:
        print("❌ DATABASE_URL 없음 (.env.local 확인)")
        sys.exit(1)
    return url


def connect():
    return psycopg.connect(db_url(), autocommit=False)


def counts(cur):
    out = {}
    for t in AFFECTED:
        cur.execute(f"SELECT count(*) FROM {t}")
        out[t] = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM sales_orders WHERE customer_id IS NOT NULL")
    out["sales_orders(w/customer)"] = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM branches")
    out["branches"] = cur.fetchone()[0]
    return out


def print_counts(label, c):
    print(f"\n── {label} ──")
    for k, v in c.items():
        print(f"  {k:<28} {v:,}")


def cmd_check():
    with connect() as conn, conn.cursor() as cur:
        print("✅ 연결 성공")
        print_counts("현재 카운트", counts(cur))


def _sql_literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    # dict/list(jsonb) or str → escape single quotes
    if isinstance(v, (dict, list)):
        import json
        s = json.dumps(v, ensure_ascii=False)
    else:
        s = str(v)
    return "'" + s.replace("'", "''") + "'"


def dump_table(cur, table, out, where=None):
    q = f"SELECT * FROM {table}"
    if where:
        q += f" WHERE {where}"
    cur.execute(q)
    cols = [d.name for d in cur.description]
    rows = cur.fetchall()
    out.write(f"\n-- {table}: {len(rows)} rows\n")
    if not rows:
        return len(rows)
    collist = ",".join(cols)
    BATCH = 500
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        out.write(f"INSERT INTO {table} ({collist}) VALUES\n")
        vals = []
        for r in chunk:
            vals.append("  (" + ",".join(_sql_literal(x) for x in r) + ")")
        out.write(",\n".join(vals) + "\nON CONFLICT DO NOTHING;\n")
    return len(rows)


def cmd_backup():
    ts_file = V2_DIR / "_backup-before-reset.sql"
    with connect() as conn, conn.cursor() as cur:
        print("✅ 연결 성공 — 백업 시작 (방법 B)")
        with open(ts_file, "w", encoding="utf-8") as out:
            out.write("-- 방법 B 백업: reset 직전 영향 테이블 스냅샷\n")
            out.write("-- 복구 시: 이 파일을 그대로 실행하면 INSERT 복원 (ON CONFLICT DO NOTHING)\n")
            out.write("-- ⚠️ sales_orders/return_orders/notifications 의 customer_id 는 별도 매핑 섹션 참조\n")
            total = 0
            for t in AFFECTED:
                n = dump_table(cur, t, out)
                total += n
                print(f"  {t:<28} {n:,} rows")
            # 고객 링크 복구용 매핑 (UPDATE 문)
            for t in ("sales_orders", "return_orders", "notifications"):
                cur.execute(f"SELECT id, customer_id FROM {t} WHERE customer_id IS NOT NULL")
                rows = cur.fetchall()
                out.write(f"\n-- {t} customer_id 매핑 복구: {len(rows)} rows\n")
                for rid, cid in rows:
                    out.write(
                        f"UPDATE {t} SET customer_id={_sql_literal(cid)} "
                        f"WHERE id={_sql_literal(rid)};\n"
                    )
                print(f"  {t}.customer_id 매핑        {len(rows):,} rows")
    size = ts_file.stat().st_size
    print(f"\n💾 저장: {ts_file}  ({size:,} bytes)")


def cmd_run_file(path: Path, label=None):
    label = label or path.name
    sql = path.read_text(encoding="utf-8")
    with connect() as conn, conn.cursor() as cur:
        # NOTICE 출력 캡처
        notices = []
        conn.add_notice_handler(lambda diag: notices.append(diag.message_primary))
        t0 = time.time()
        cur.execute(sql)
        conn.commit()
        dt = time.time() - t0
        print(f"  {label:<32} ✅ ({dt:.1f}s)")
        for n in notices:
            print(f"     ℹ️  {n}")


def cmd_migrate():
    f = ROOT / "supabase" / "migrations" / "069_legacy_purchases_line_items.sql"
    print("▶ 069 마이그레이션")
    cmd_run_file(f)


def cmd_reset():
    f = ROOT / "legacy-import" / "reset-before-reimport.sql"
    print("▶ reset-before-reimport (전량 초기화)")
    cmd_run_file(f)


def _idx(p):
    try:
        return int(p.stem.split("-")[-1])
    except ValueError:
        return -1


def cmd_load(pattern):
    files = sorted(V2_DIR.glob(pattern), key=_idx)
    if not files:
        print(f"❌ {V2_DIR}/{pattern} 매칭 없음")
        sys.exit(1)
    print(f"▶ load {pattern} — {len(files)} 파일")
    started = time.time()
    failed = []
    for i, f in enumerate(files, 1):
        sql = f.read_text(encoding="utf-8")
        with connect() as conn, conn.cursor() as cur:
            t0 = time.time()
            try:
                cur.execute(sql)
                conn.commit()
                print(f"  [{i:2}/{len(files)}] {f.name:<24} ✅ ({time.time()-t0:.1f}s)")
            except Exception as e:
                conn.rollback()
                print(f"  [{i:2}/{len(files)}] {f.name:<24} ❌ — {e}")
                failed.append(f.name)
    print(f"\n총 {len(files)} 파일, 실패 {len(failed)}, {time.time()-started:.1f}s")
    if failed:
        for n in failed:
            print("  실패:", n)
        sys.exit(2)


def cmd_verify():
    with connect() as conn, conn.cursor() as cur:
        c = counts(cur)
        print_counts("재적재 후 카운트", c)
        cur.execute(
            "SELECT count(DISTINCT legacy_order_no) FROM legacy_purchases "
            "WHERE legacy_order_no IS NOT NULL"
        )
        print(f"  legacy_purchases 고유주문(legacy_order_no)  {cur.fetchone()[0]:,}")
        cur.execute("SELECT count(*) FROM legacy_purchases WHERE customer_id IS NULL")
        print(f"  legacy_purchases 익명(customer_id NULL)      {cur.fetchone()[0]:,}")
        cur.execute("SELECT count(*) FROM legacy_purchases WHERE branch_id IS NULL")
        print(f"  legacy_purchases 지점 미매칭(branch_id NULL) {cur.fetchone()[0]:,}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "check":
        cmd_check()
    elif cmd == "backup":
        cmd_backup()
    elif cmd == "migrate":
        cmd_migrate()
    elif cmd == "reset":
        cmd_reset()
    elif cmd == "load":
        cmd_load(sys.argv[2])
    elif cmd == "verify":
        cmd_verify()
    else:
        print(f"알 수 없는 명령: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
