export default function CustomersPage() {
  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">고객 목록</h3>
        <button className="btn-primary">+ 고객 추가</button>
      </div>

      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder="이름 또는 연락처 검색..."
          className="input max-w-md"
        />
        <select className="input w-40">
          <option value="">전체 등급</option>
          <option value="NORMAL">일반</option>
          <option value="VIP">VIP</option>
          <option value="VVIP">VVIP</option>
        </select>
        <select className="input w-40">
          <option value="">전체 지점</option>
          <option value="HQ">본사</option>
          <option value="PHA">한약국</option>
          <option value="DS-GN">백화점 강남점</option>
        </select>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>연락처</th>
            <th>등급</th>
            <th>담당 지점</th>
            <th>적립포인트</th>
            <th>최근 구매</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={7} className="text-center text-slate-400 py-8">
              고객 데이터를 불러오는 중...
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
