export default function BranchesPage() {
  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-semibold text-lg">지점 목록</h3>
        <button className="btn-primary">+ 지점 추가</button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>지점코드</th>
            <th>지점명</th>
            <th>채널</th>
            <th>연락처</th>
            <th>주소</th>
            <th>상태</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="font-mono">HQ</td>
            <td>본사</td>
            <td><span className="badge badge-info">STORE</span></td>
            <td>02-0000-0000</td>
            <td>경옥채 본사</td>
            <td><span className="badge badge-success">활성</span></td>
            <td>
              <button className="text-blue-600 hover:underline mr-2">수정</button>
            </td>
          </tr>
          <tr>
            <td className="font-mono">PHA</td>
            <td>한약국</td>
            <td><span className="badge badge-info">STORE</span></td>
            <td>02-1111-1111</td>
            <td>한약국 주소</td>
            <td><span className="badge badge-success">활성</span></td>
            <td>
              <button className="text-blue-600 hover:underline mr-2">수정</button>
            </td>
          </tr>
          <tr>
            <td className="font-mono">DS-GN</td>
            <td>백화점 강남점</td>
            <td><span className="badge badge-warning">DEPT_STORE</span></td>
            <td>02-2222-2222</td>
            <td>백화점 강남점</td>
            <td><span className="badge badge-success">활성</span></td>
            <td>
              <button className="text-blue-600 hover:underline mr-2">수정</button>
            </td>
          </tr>
          <tr>
            <td className="font-mono">DS-HD</td>
            <td>백화점 홍대점</td>
            <td><span className="badge badge-warning">DEPT_STORE</span></td>
            <td>02-3333-3333</td>
            <td>백화점 홍대점</td>
            <td><span className="badge badge-success">활성</span></td>
            <td>
              <button className="text-blue-600 hover:underline mr-2">수정</button>
            </td>
          </tr>
          <tr>
            <td className="font-mono">ONLINE</td>
            <td>자사몬</td>
            <td><span className="badge badge-info">ONLINE</span></td>
            <td>02-4444-4444</td>
            <td>자사몬</td>
            <td><span className="badge badge-success">활성</span></td>
            <td>
              <button className="text-blue-600 hover:underline mr-2">수정</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
