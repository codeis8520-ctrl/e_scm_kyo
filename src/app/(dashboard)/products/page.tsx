export default function ProductsPage() {
  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">제품 목록</h3>
        <button className="btn-primary">+ 제품 추가</button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="제품명 또는 코드 검색..."
          className="input max-w-md"
        />
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>제품코드</th>
            <th>제품명</th>
            <th>카테고리</th>
            <th>판매가</th>
            <th>원가</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={7} className="text-center text-slate-400 py-8">
              제품 데이터를 불러오는 중...
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
