import Link from 'next/link';

export default async function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-sm text-slate-500">오늘 매출</p>
          <p className="text-2xl font-bold text-slate-800">0원</p>
          <p className="text-xs text-slate-400">0건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">재고 부족 품목</p>
          <p className="text-2xl font-bold text-orange-600">0</p>
          <p className="text-xs text-slate-400">건</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">이번 달 매출</p>
          <p className="text-2xl font-bold text-slate-800">0원</p>
          <p className="text-xs text-slate-400">목표 대비 0%</p>
        </div>

        <div className="stat-card">
          <p className="text-sm text-slate-500">오늘的新型 고객</p>
          <p className="text-2xl font-bold text-green-600">0</p>
          <p className="text-xs text-slate-400">명</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">최근 거래</h3>
            <Link href="/pos" className="text-sm text-blue-600 hover:underline">
              더보기
            </Link>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>전표번호</th>
                <th>지점</th>
                <th>금액</th>
                <th>시간</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="text-center text-slate-400 py-8">
                  거래 데이터를 불러오는 중...
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-slate-800">재고 부족 알림</h3>
            <Link href="/inventory" className="text-sm text-blue-600 hover:underline">
              더보기
            </Link>
          </div>
          <p className="text-center text-slate-400 py-8">
            재고 부족 품목이 없습니다
          </p>
        </div>
      </div>
    </div>
  );
}
