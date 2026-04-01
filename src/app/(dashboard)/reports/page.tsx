export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">보고서</h3>
        <div className="flex gap-2">
          <select className="input">
            <option value="daily">일별</option>
            <option value="weekly">주별</option>
            <option value="monthly">월별</option>
          </select>
          <input type="date" className="input" />
          <input type="date" className="input" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-sm text-slate-500">총 매출</p>
          <p className="text-2xl font-bold text-slate-800">0원</p>
          <p className="text-xs text-slate-400">0건</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">평균 객단가</p>
          <p className="text-2xl font-bold text-slate-800">0원</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">신규 고객</p>
          <p className="text-2xl font-bold text-green-600">0명</p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-slate-500">재구매 고객</p>
          <p className="text-2xl font-bold text-blue-600">0명</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-4">채널별 매출</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-600">매장 (STORE)</span>
              <span className="font-semibold">0원 (0%)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">백화점 (DEPT_STORE)</span>
              <span className="font-semibold">0원 (0%)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">자사몬 (ONLINE)</span>
              <span className="font-semibold">0원 (0%)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">행사 (EVENT)</span>
              <span className="font-semibold">0원 (0%)</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold mb-4">지점별 매출</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-600">본사</span>
              <span className="font-semibold">0원</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">한약국</span>
              <span className="font-semibold">0원</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">백화점 강남점</span>
              <span className="font-semibold">0원</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">백화점 홍대점</span>
              <span className="font-semibold">0원</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-4">인기 제품</h3>
        <table className="table">
          <thead>
            <tr>
              <th>순위</th>
              <th>제품명</th>
              <th>판매수량</th>
              <th>판매금액</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="text-center text-slate-400 py-8">
                데이터가 없습니다
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
