const puppeteer = require('puppeteer');
const path = require('path');

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 10pt; color: #1a1a2e; background: #fff; }

  .cover { width: 100%; min-height: 100vh; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); color: white; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 60px 40px; page-break-after: always; }
  .cover .logo { font-size: 48pt; font-weight: 900; letter-spacing: 4px; margin-bottom: 16px; }
  .cover .subtitle { font-size: 14pt; color: #a8c0d6; margin-bottom: 60px; letter-spacing: 2px; }
  .cover .doc-title { font-size: 22pt; font-weight: 700; margin-bottom: 12px; }
  .cover .doc-version { display: inline-block; background: #e94560; color: white; padding: 6px 20px; border-radius: 20px; font-size: 11pt; margin-bottom: 40px; }
  .cover .meta { font-size: 9pt; color: #8899aa; line-height: 2; }

  .page { padding: 30px 36px; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  h1 { font-size: 16pt; font-weight: 800; color: #0f3460; border-bottom: 3px solid #e94560; padding-bottom: 10px; margin-bottom: 20px; }
  h2 { font-size: 13pt; font-weight: 700; color: #16213e; border-left: 4px solid #0f3460; padding-left: 12px; margin: 22px 0 12px; }
  h3 { font-size: 11pt; font-weight: 700; color: #0f3460; margin: 16px 0 8px; }
  h4 { font-size: 10pt; font-weight: 700; color: #333; margin: 12px 0 6px; }

  p { line-height: 1.7; margin-bottom: 8px; color: #333; }

  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9pt; }
  th { background: #0f3460; color: white; padding: 8px 10px; text-align: left; font-weight: 600; }
  td { padding: 7px 10px; border-bottom: 1px solid #e8ecf0; vertical-align: top; }
  tr:nth-child(even) td { background: #f7f9fc; }
  tr:hover td { background: #eef2f8; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8pt; font-weight: 600; }
  .badge-done { background: #d1fae5; color: #065f46; }
  .badge-partial { background: #fef3c7; color: #92400e; }
  .badge-todo { background: #fee2e2; color: #991b1b; }
  .badge-new { background: #dbeafe; color: #1e40af; }
  .badge-p0 { background: #ffe4e6; color: #9f1239; }
  .badge-p1 { background: #fef9c3; color: #854d0e; }
  .badge-p2 { background: #f0fdf4; color: #166534; }

  .info-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 16px; margin: 12px 0; }
  .info-box.yellow { background: #fffbeb; border-color: #fde68a; }
  .info-box.green { background: #f0fdf4; border-color: #bbf7d0; }
  .info-box.red { background: #fff1f2; border-color: #fecdd3; }
  .info-box.purple { background: #faf5ff; border-color: #e9d5ff; }

  .toc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px 24px; }
  .toc li { line-height: 2.2; list-style: none; border-bottom: 1px dotted #cbd5e0; }
  .toc li:last-child { border-bottom: none; }
  .toc .chapter { font-weight: 700; color: #0f3460; font-size: 10.5pt; }
  .toc .section { color: #475569; font-size: 9.5pt; padding-left: 16px; }

  ul, ol { padding-left: 20px; margin: 8px 0; }
  li { line-height: 1.8; color: #333; margin-bottom: 2px; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 12px 0; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 12px 0; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
  .card h4 { color: #0f3460; margin-bottom: 8px; }

  .flow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
  .flow-step { background: #0f3460; color: white; padding: 6px 14px; border-radius: 6px; font-size: 9pt; font-weight: 600; }
  .flow-arrow { color: #94a3b8; font-size: 14pt; }

  .section-divider { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }

  .footer { text-align: center; font-size: 8pt; color: #94a3b8; margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>

<!-- 표지 -->
<div class="cover">
  <div class="logo">경옥채</div>
  <div class="subtitle">사내 통합시스템</div>
  <div class="doc-title">제품 요구사항 명세서</div>
  <div class="doc-title">Product Requirements Document</div>
  <div style="margin: 16px 0;"><span class="doc-version">Version 2.0</span></div>
  <div class="meta">
    작성일: 2026년 4월 3일<br>
    검토: 경옥채 개발팀<br>
    분류: 내부용 (Confidential)<br>
    이전 버전: PRD v1.0 (2026년 3월)
  </div>
</div>

<!-- 목차 -->
<div class="page">
  <h1>목차 (Table of Contents)</h1>
  <ul class="toc">
    <li class="chapter">1. 프로젝트 개요</li>
    <li class="section">1.1 배경 및 목적</li>
    <li class="section">1.2 v1 → v2 주요 변경사항</li>
    <li class="section">1.3 시스템 범위</li>

    <li class="chapter">2. 기술 스택 및 아키텍처</li>
    <li class="section">2.1 기술 스택</li>
    <li class="section">2.2 인증 및 권한</li>
    <li class="section">2.3 데이터 흐름</li>

    <li class="chapter">3. 구현 현황</li>
    <li class="section">3.1 완료된 기능</li>
    <li class="section">3.2 부분 구현</li>
    <li class="section">3.3 미구현 항목</li>

    <li class="chapter">4. 기능 명세 — 핵심 모듈</li>
    <li class="section">4.1 대시보드</li>
    <li class="section">4.2 POS (판매 처리)</li>
    <li class="section">4.3 제품 관리</li>
    <li class="section">4.4 재고 관리</li>
    <li class="section">4.5 생산 관리</li>
    <li class="section">4.6 고객 CRM</li>
    <li class="section">4.7 알림 관리 (카카오채널톡 / SMS)</li>
    <li class="section">4.8 보고서</li>
    <li class="section">4.9 AI 에이전트</li>

    <li class="chapter">5. 시스템 코드 관리</li>
    <li class="chapter">6. 외부 연동</li>
    <li class="section">6.1 Cafe24 통합</li>
    <li class="section">6.2 Toss Place POS</li>

    <li class="chapter">7. 매입(원재료 구매) 관리 — 신규</li>
    <li class="chapter">8. 고객용 앱 — 신규 계획</li>
    <li class="chapter">9. 비기능 요구사항</li>
  </ul>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 1. 프로젝트 개요 -->
<div class="page">
  <h1>1. 프로젝트 개요</h1>

  <h2>1.1 배경 및 목적</h2>
  <p>경옥채는 한약국 매장, 백화점 입점, 온라인 자사몰(Cafe24)을 운영하는 멀티채널 건강식품 기업입니다. 기존 이카운트 ERP를 완전히 대체하는 사내 통합시스템을 구축하여 재고, 판매, 고객, 생산을 일원화합니다.</p>
  <div class="info-box green">
    <strong>✅ v2 핵심 방향</strong>
    <ul style="margin-top: 8px;">
      <li>취급 품목 약 <strong>30종</strong> 기준으로 단순화 — 불필요한 복잡도 제거</li>
      <li>이카운트 완전 대체 — 모든 재고/판매/고객 관리를 이 시스템으로 처리</li>
      <li>Cafe24 온라인몰과 오프라인 데이터 통합</li>
      <li>AI 에이전트를 통한 자연어 업무 처리</li>
    </ul>
  </div>

  <h2>1.2 v1 → v2 주요 변경사항</h2>
  <table>
    <thead><tr><th>항목</th><th>v1</th><th>v2 (현재)</th></tr></thead>
    <tbody>
      <tr><td>취급 품목</td><td>불특정 다수</td><td>약 30종으로 확정 (단순화)</td></tr>
      <tr><td>이카운트 연동</td><td>연동 계획 포함</td><td>완전 대체 (연동 없음)</td></tr>
      <tr><td>AI 에이전트</td><td>SQL 텍스트 생성 방식</td><td>Function Calling 기반 실제 업무 처리</td></tr>
      <tr><td>알림 관리</td><td>언급 없음</td><td><span class="badge badge-new">NEW</span> 카카오채널톡 + SMS 발송 관리 추가</td></tr>
      <tr><td>매입 관리</td><td>미포함</td><td><span class="badge badge-new">NEW</span> 공급업체·발주서·입고 처리 신규 계획</td></tr>
      <tr><td>고객용 앱</td><td>미포함</td><td><span class="badge badge-new">NEW</span> (customer) route group 계획</td></tr>
    </tbody>
  </table>

  <h2>1.3 시스템 범위</h2>
  <div class="grid-2">
    <div class="card">
      <h4>📦 포함 범위</h4>
      <ul>
        <li>다채널 판매 (POS, 온라인)</li>
        <li>재고 관리 (지점별, 입출고, 이동)</li>
        <li>고객 CRM (등급, 포인트)</li>
        <li>생산 관리 (BOM 기반)</li>
        <li>알림 (카카오채널톡, SMS)</li>
        <li>매입 관리 (신규)</li>
        <li>AI 에이전트 (자연어 업무)</li>
      </ul>
    </div>
    <div class="card">
      <h4>🚫 제외 범위</h4>
      <ul>
        <li>이카운트 연동 (완전 대체)</li>
        <li>급여/인사 관리</li>
        <li>회계/세무 (별도 시스템)</li>
        <li>복잡한 BOM (30종 단순 구조)</li>
      </ul>
    </div>
  </div>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 2. 기술 스택 -->
<div class="page">
  <h1>2. 기술 스택 및 아키텍처</h1>

  <h2>2.1 기술 스택</h2>
  <table>
    <thead><tr><th>구분</th><th>기술</th><th>비고</th></tr></thead>
    <tbody>
      <tr><td>프레임워크</td><td>Next.js 16 (App Router)</td><td>TypeScript</td></tr>
      <tr><td>UI</td><td>Tailwind CSS v4</td><td>Responsive (모바일 우선)</td></tr>
      <tr><td>데이터베이스</td><td>Supabase (PostgreSQL)</td><td>RLS 적용</td></tr>
      <tr><td>인증</td><td>Custom Session (SHA-256)</td><td>Supabase Auth 미사용</td></tr>
      <tr><td>AI</td><td>MiniMax API (chatcompletion_v2)</td><td>Function Calling</td></tr>
      <tr><td>외부 연동</td><td>Cafe24 API / Toss Place POS</td><td>Webhook + OAuth</td></tr>
    </tbody>
  </table>

  <h2>2.2 인증 및 권한</h2>
  <p>SHA-256 비밀번호 검증 후 httpOnly 쿠키 세션. Supabase Auth를 사용하지 않는 커스텀 방식.</p>
  <table>
    <thead><tr><th>역할</th><th>설명</th><th>데이터 범위</th></tr></thead>
    <tbody>
      <tr><td>SUPER_ADMIN</td><td>본부대표</td><td>전체</td></tr>
      <tr><td>HQ_OPERATOR</td><td>본부운영자</td><td>전체</td></tr>
      <tr><td>EXECUTIVE</td><td>임원</td><td>전체 (읽기)</td></tr>
      <tr><td>PHARMACY_STAFF</td><td>약사</td><td>담당 지점만</td></tr>
      <tr><td>BRANCH_STAFF</td><td>지점직원</td><td>담당 지점만</td></tr>
    </tbody>
  </table>

  <h2>2.3 데이터 흐름</h2>
  <h3>쓰기 (Mutation)</h3>
  <div class="flow">
    <div class="flow-step">클라이언트</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">Server Action (actions.ts)</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">Supabase SSR Client</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">DB + revalidatePath()</div>
  </div>
  <h3>읽기 (Query)</h3>
  <div class="flow">
    <div class="flow-step">Client Component</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">Browser Supabase Client</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">useEffect 직접 조회</div>
  </div>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 3. 구현 현황 -->
<div class="page">
  <h1>3. 구현 현황 (2026년 4월 기준)</h1>

  <h2>3.1 완료된 기능</h2>
  <table>
    <thead><tr><th>모듈</th><th>상태</th><th>주요 기능</th></tr></thead>
    <tbody>
      <tr><td>대시보드</td><td><span class="badge badge-done">완료</span></td><td>채널/지점별 실데이터, 역할별 뷰 전환</td></tr>
      <tr><td>POS</td><td><span class="badge badge-done">완료</span></td><td>바코드, 포인트 사용/적립, 재고 자동 차감</td></tr>
      <tr><td>제품 관리</td><td><span class="badge badge-done">완료</span></td><td>CRUD, 바코드 스캐너, 자동 코드 생성</td></tr>
      <tr><td>재고 관리</td><td><span class="badge badge-done">완료</span></td><td>입출고, 지점 간 이동, 부족 알림</td></tr>
      <tr><td>생산 관리</td><td><span class="badge badge-done">완료</span></td><td>BOM 기반 원재료 자동 차감</td></tr>
      <tr><td>고객 CRM</td><td><span class="badge badge-done">완료</span></td><td>이력, 상담기록 5종, 등급/태그, 주소검색</td></tr>
      <tr><td>알림 관리</td><td><span class="badge badge-done">완료</span></td><td>카카오채널톡, SMS 발송, 템플릿 관리</td></tr>
      <tr><td>보고서</td><td><span class="badge badge-done">완료</span></td><td>기간/채널/지점 필터, PDF 다운로드</td></tr>
      <tr><td>AI 에이전트</td><td><span class="badge badge-done">완료</span></td><td>Function Calling, 자연어 조회/업무처리</td></tr>
      <tr><td>Cafe24 웹훅</td><td><span class="badge badge-done">완료</span></td><td>주문 자동 수집, 상태 업데이트</td></tr>
      <tr><td>권한 관리</td><td><span class="badge badge-done">완료</span></td><td>5개 역할 RBAC, screen_permissions</td></tr>
      <tr><td>시스템 코드</td><td><span class="badge badge-done">완료</span></td><td>지점, 등급, 태그, 카테고리, 직원</td></tr>
    </tbody>
  </table>

  <h2>3.2 부분 구현</h2>
  <table>
    <thead><tr><th>항목</th><th>상태</th><th>잔여 작업</th></tr></thead>
    <tbody>
      <tr><td>Cafe24 고객 동기화</td><td><span class="badge badge-partial">부분</span></td><td>Mall ID, OAuth 자격증명 연결 필요</td></tr>
      <tr><td>can_edit 권한 UI</td><td><span class="badge badge-partial">부분</span></td><td>DB 컬럼 있으나 UI 제어 미적용</td></tr>
    </tbody>
  </table>

  <h2>3.3 미구현 항목</h2>
  <table>
    <thead><tr><th>항목</th><th>우선순위</th><th>설명</th></tr></thead>
    <tbody>
      <tr><td>매입 관리</td><td><span class="badge badge-p0">P0</span></td><td>공급업체, 발주서, 원재료 입고 처리</td></tr>
      <tr><td>고객용 앱</td><td><span class="badge badge-p1">P1</span></td><td>(customer) route group — 통합 구매내역, 포인트</td></tr>
    </tbody>
  </table>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 4.1~4.6 -->
<div class="page">
  <h1>4. 기능 명세 — 핵심 모듈</h1>

  <h2>4.1 대시보드</h2>
  <p>역할별로 다른 집계 화면을 제공. SUPER_ADMIN/HQ_OPERATOR/EXECUTIVE는 전체 채널 및 지점 데이터 조회. BRANCH_STAFF/PHARMACY_STAFF는 자신의 지점 데이터만 표시.</p>
  <table>
    <thead><tr><th>위젯</th><th>설명</th></tr></thead>
    <tbody>
      <tr><td>오늘 매출</td><td>당일 완료 주문 합계</td></tr>
      <tr><td>이번 달 매출</td><td>월간 누계</td></tr>
      <tr><td>채널별 매출</td><td>STORE / DEPT_STORE / ONLINE / EVENT</td></tr>
      <tr><td>재고 부족 알림</td><td>안전재고 미만 품목</td></tr>
      <tr><td>최근 주문</td><td>최신 10건</td></tr>
    </tbody>
  </table>

  <h2>4.2 POS (판매 처리)</h2>
  <div class="info-box">
    <strong>결제 흐름:</strong> 바코드/제품 검색 → 장바구니 → 고객 조회 (선택) → 포인트 사용 선택 → 결제 수단 선택 → 완료
  </div>
  <ul>
    <li>바코드 스캔 또는 제품명 검색으로 추가</li>
    <li>고객 포인트 조회 및 사용 (사용 시 차감, 미사용 시 등급별 적립률로 적립)</li>
    <li>결제 완료 시 inventories 자동 차감 + inventory_movements 기록</li>
    <li>결제 수단: 현금, 카드, 카카오페이</li>
  </ul>

  <h2>4.3 제품 관리</h2>
  <ul>
    <li>약 30종 취급 — 단순 목록 구조</li>
    <li>제품 코드 자동 생성 (KYO-XXXX-XXXXXX)</li>
    <li>바코드 스캐너 지원</li>
    <li>카테고리 분류</li>
    <li>제품 생성 시 모든 활성 지점에 inventories 레코드 자동 생성 (수량 0)</li>
  </ul>

  <h2>4.4 재고 관리</h2>
  <ul>
    <li>지점별 재고 현황 — 안전재고 미만 시 경고 표시</li>
    <li>입고 처리 (IN), 출고 처리 (OUT), 재고 조정 (ADJUST)</li>
    <li>지점 간 이동 (TRANSFER) — 출발지 차감 + 도착지 증가 + 양방향 이력</li>
    <li>이동 이력 전체 audit log (inventory_movements)</li>
  </ul>

  <h2>4.5 생산 관리</h2>
  <ul>
    <li>생산 지시 등록 → BOM 기반 원재료 자동 차감</li>
    <li>생산 완료 시 완제품 재고 증가</li>
    <li>movement_type = PRODUCTION으로 이력 기록</li>
  </ul>

  <h2>4.6 고객 CRM</h2>
  <table>
    <thead><tr><th>기능</th><th>설명</th></tr></thead>
    <tbody>
      <tr><td>고객 등록/수정</td><td>이름, 전화, 이메일, 주소 (Daum 팝업), 등급, 담당 지점, 건강메모</td></tr>
      <tr><td>등급 관리</td><td>NORMAL(1%), VIP(2%), VVIP(3%) — 시스템 코드에서 관리</td></tr>
      <tr><td>포인트 시스템</td><td>등급별 적립률 자동 적립, 수동 조정, 사용 차감</td></tr>
      <tr><td>상담 기록</td><td>5종 (내방, 전화, 문자, 카카오, 기타) — 이력 관리</td></tr>
      <tr><td>구매 이력</td><td>판매 주문 연결 — 오프라인/온라인 통합 (예정)</td></tr>
      <tr><td>Cafe24 연동</td><td>cafe24_member_id로 온라인 회원 매핑 (부분 구현)</td></tr>
    </tbody>
  </table>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 4.7 알림 관리 — 신규 상세 -->
<div class="page">
  <h1>4.7 알림 관리 — 카카오채널톡 / SMS</h1>
  <div class="info-box purple">
    <strong>📣 v2 신규 섹션</strong> — 고객 대상 마케팅 및 업무 알림 발송 관리. 카카오 알림톡과 문자(SMS)를 통합 관리.
  </div>

  <h2>개요</h2>
  <p>경옥채 직원이 고객에게 카카오 알림톡 또는 SMS를 직접 발송하고 이력을 관리하는 기능입니다. 단체 발송(등급별, 전체)과 개별 발송을 모두 지원합니다.</p>

  <h2>4.7.1 카카오 알림톡 (KAKAO)</h2>
  <h3>주요 기능</h3>
  <ul>
    <li>카카오 비즈니스 채널 연동 — 사전 승인된 템플릿 기반 발송</li>
    <li>템플릿 변수 지원: <code>{{customer_name}}</code>, <code>{{product_name}}</code>, <code>{{amount}}</code>, <code>{{event_name}}</code></li>
    <li>단체 발송: 고객 목록에서 다중 선택 또는 전체 선택</li>
    <li>단일 발송: 전화번호 직접 입력</li>
    <li>발송 이력 조회 (상태: 대기중 / 발송완료 / 실패)</li>
  </ul>

  <h3>템플릿 관리 (/notifications/templates)</h3>
  <table>
    <thead><tr><th>필드</th><th>설명</th><th>예시</th></tr></thead>
    <tbody>
      <tr><td>template_code</td><td>고유 템플릿 코드 (수정 불가)</td><td>ORDER_COMPLETE</td></tr>
      <tr><td>template_name</td><td>템플릿 이름</td><td>주문 완료 알림</td></tr>
      <tr><td>message_template</td><td>발송 메시지 (변수 포함 가능)</td><td>{{customer_name}}님, 주문이 완료되었습니다.</td></tr>
      <tr><td>is_active</td><td>활성/비활성</td><td>true</td></tr>
    </tbody>
  </table>

  <h3>발송 시나리오</h3>
  <div class="grid-2">
    <div class="card">
      <h4>📋 단체 발송</h4>
      <ol>
        <li>알림 메뉴 → 알림톡 발송 버튼</li>
        <li>단체 발송 탭 선택</li>
        <li>고객 검색/선택 (등급·이름 필터)</li>
        <li>템플릿 선택 (선택사항)</li>
        <li>메시지 확인/수정</li>
        <li>발송 버튼</li>
      </ol>
    </div>
    <div class="card">
      <h4>👤 단일 발송</h4>
      <ol>
        <li>알림 메뉴 → 알림톡 발송 버튼</li>
        <li>단일 발송 탭 선택</li>
        <li>전화번호 직접 입력</li>
        <li>메시지 작성 또는 템플릿 선택</li>
        <li>발송 버튼</li>
      </ol>
    </div>
  </div>

  <h2>4.7.2 SMS 발송</h2>
  <h3>주요 기능</h3>
  <ul>
    <li>단문 문자(SMS) 직접 발송 — 별도 템플릿 승인 불필요</li>
    <li>80자 이내 권장 (초과 시 LMS 처리)</li>
    <li>단체/단일 발송 동일 지원</li>
    <li>알림톡 수신 불가 고객 대상 대체 발송 수단</li>
  </ul>

  <h3>발송 탭 구분</h3>
  <p>알림 페이지 상단에 <strong>알림톡 발송</strong> / <strong>SMS 발송</strong> 탭으로 구분. 각 탭에서 발송 및 이력 조회 모두 가능.</p>

  <h2>4.7.3 발송 이력</h2>
  <table>
    <thead><tr><th>컬럼</th><th>설명</th></tr></thead>
    <tbody>
      <tr><td>발송일시</td><td>created_at</td></tr>
      <tr><td>수신자</td><td>고객 이름 (비회원은 전화번호만)</td></tr>
      <tr><td>연락처</td><td>발송 대상 전화번호</td></tr>
      <tr><td>메시지</td><td>발송된 실제 메시지</td></tr>
      <tr><td>유형</td><td>알림톡 / SMS</td></tr>
      <tr><td>상태</td><td>대기중 / 발송완료 / 실패</td></tr>
    </tbody>
  </table>

  <h2>4.7.4 DB 스키마</h2>
  <table>
    <thead><tr><th>테이블</th><th>주요 컬럼</th></tr></thead>
    <tbody>
      <tr><td>notifications</td><td>id, customer_id, notification_type(KAKAO/SMS), template_id, phone, message, status, sent_by, created_at</td></tr>
      <tr><td>notification_templates</td><td>id, template_code(PK), template_name, message_template, is_active</td></tr>
    </tbody>
  </table>

  <h2>4.7.5 향후 과제</h2>
  <div class="info-box yellow">
    <ul>
      <li><strong>실제 발송 API 연동</strong>: 현재는 DB 기록만. 카카오 비즈니스 채널 API 또는 SMS 중계사(예: 알리고, 솔라피) 연동 필요</li>
      <li><strong>발송 예약</strong>: 특정 일시에 자동 발송 기능</li>
      <li><strong>발송 결과 수신</strong>: Webhook으로 실제 전달 여부 확인</li>
      <li><strong>AI 에이전트 연동</strong>: "VIP 고객에게 신제품 알림 보내줘" 형태의 자연어 발송 지시</li>
    </ul>
  </div>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 4.8~4.9 -->
<div class="page">
  <h2>4.8 보고서</h2>
  <ul>
    <li>기간 선택 (일간/주간/월간/커스텀)</li>
    <li>채널별, 지점별 필터</li>
    <li>총매출, 결제수단별 분류, 인기제품 TOP 10</li>
    <li>PDF 다운로드 (jsPDF)</li>
    <li>역할별 접근 제한 (screen_permissions)</li>
  </ul>

  <h2>4.9 AI 에이전트</h2>
  <div class="info-box">
    <strong>실제 직원처럼 자연어로 업무 처리</strong> — MiniMax API Function Calling 기반
  </div>

  <h3>지원 도구 (Tools)</h3>
  <table>
    <thead><tr><th>도구</th><th>설명</th><th>구분</th></tr></thead>
    <tbody>
      <tr><td>get_inventory</td><td>지점별 재고 현황 조회</td><td>읽기</td></tr>
      <tr><td>get_customer</td><td>고객 정보 + 포인트 잔액 조회</td><td>읽기</td></tr>
      <tr><td>get_customer_grades</td><td>등급별 적립률 조회</td><td>읽기</td></tr>
      <tr><td>get_orders</td><td>매출/주문 내역 조회</td><td>읽기</td></tr>
      <tr><td>get_products</td><td>제품 목록 조회</td><td>읽기</td></tr>
      <tr><td>get_branches</td><td>지점 목록 조회</td><td>읽기</td></tr>
      <tr><td>transfer_inventory</td><td>지점 간 재고 이동</td><td>쓰기 (확인 필요)</td></tr>
      <tr><td>adjust_points</td><td>고객 포인트 수동 조정</td><td>쓰기 (확인 필요)</td></tr>
      <tr><td>update_customer_grade</td><td>고객 등급 변경</td><td>쓰기 (확인 필요)</td></tr>
      <tr><td>create_branch</td><td>새 지점 추가</td><td>쓰기 (확인 필요)</td></tr>
      <tr><td>create_customer</td><td>신규 고객 등록</td><td>쓰기 (확인 필요)</td></tr>
      <tr><td>update_customer</td><td>고객 정보 수정</td><td>쓰기 (확인 필요)</td></tr>
    </tbody>
  </table>

  <h3>처리 흐름</h3>
  <div class="flow">
    <div class="flow-step">자연어 입력</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">MiniMax Tool Call</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">읽기: 즉시 실행</div>
    <div class="flow-arrow">/</div>
    <div class="flow-step">쓰기: 확인 요청</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">자연어 응답</div>
  </div>
  <ul>
    <li>쓰기 작업은 사용자 확인 버튼 클릭 후 실행</li>
    <li>최근 10개 대화 히스토리 유지 (맥락 기반 다턴 대화)</li>
    <li>think 태그 자동 제거 (MiniMax 추론 과정 숨김)</li>
  </ul>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 5. 시스템 코드 관리 -->
<div class="page">
  <h1>5. 시스템 코드 관리</h1>
  <p>관리자가 앱 내에서 직접 마스터 데이터를 관리. 코드 변경이 즉시 전체 시스템에 반영.</p>
  <table>
    <thead><tr><th>탭</th><th>테이블</th><th>관리 항목</th></tr></thead>
    <tbody>
      <tr><td>지점 관리</td><td>branches</td><td>지점명, 채널, 주소, 전화, 활성화 (코드 자동생성)</td></tr>
      <tr><td>고객 등급</td><td>customer_grades</td><td>등급명, 적립률, 색상, 정렬</td></tr>
      <tr><td>고객 태그</td><td>customer_tags</td><td>태그명, 색상</td></tr>
      <tr><td>카테고리</td><td>categories</td><td>카테고리명, 상위카테고리, 정렬</td></tr>
      <tr><td>직원 관리</td><td>users</td><td>이름, 이메일, 역할, 담당 지점</td></tr>
    </tbody>
  </table>

  <h1>6. 외부 연동</h1>

  <h2>6.1 Cafe24 통합</h2>
  <table>
    <thead><tr><th>항목</th><th>내용</th><th>상태</th></tr></thead>
    <tbody>
      <tr><td>주문 웹훅</td><td>POST /api/webhooks/cafe24 → HMAC 검증 → 주문 자동 수집</td><td><span class="badge badge-done">완료</span></td></tr>
      <tr><td>주문 상태 업데이트</td><td>order.paid / order.shipped 등 이벤트 처리</td><td><span class="badge badge-done">완료</span></td></tr>
      <tr><td>고객 동기화</td><td>cafe24_member_id 매핑</td><td><span class="badge badge-partial">부분</span></td></tr>
      <tr><td>OAuth 인증</td><td>고객용 앱 로그인</td><td><span class="badge badge-todo">예정</span></td></tr>
    </tbody>
  </table>
  <div class="info-box yellow">
    <strong>Cafe24 API 연동을 위해 발주사에 요청할 사항:</strong>
    <ul style="margin-top: 8px;">
      <li>Mall ID 확인 및 API 키 발급</li>
      <li>OAuth 2.0 클라이언트 ID/Secret 발급</li>
      <li>고객용 앱 Redirect URI 등록</li>
      <li>웹훅 엔드포인트 등록 (https://도메인/api/webhooks/cafe24)</li>
    </ul>
  </div>

  <h2>6.2 Toss Place POS</h2>
  <p>오프라인 결제 데이터를 시스템과 연동. POS 판매 내역이 sales_orders에 자동 수집.</p>
  <div class="info-box yellow">
    <strong>Toss Place API 연동을 위해 요청할 사항:</strong>
    <ul style="margin-top: 8px;">
      <li>API 액세스 키 발급</li>
      <li>판매 내역 조회 API 엔드포인트 확인</li>
      <li>웹훅 연동 가능 여부 (실시간 동기화)</li>
    </ul>
  </div>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 7. 매입 관리 신규 -->
<div class="page">
  <h1>7. 매입(원재료 구매) 관리 — 신규 계획</h1>
  <div class="info-box red">
    <strong>⚠️ P0 — 미구현</strong>: 이카운트 완전 대체를 위해 반드시 필요한 모듈
  </div>

  <h2>7.1 요구사항</h2>
  <ul>
    <li>공급업체 마스터 관리 (이름, 연락처, 납품 품목)</li>
    <li>발주서 생성 및 승인 워크플로우</li>
    <li>입고 처리 → inventories 자동 증가 + IN 이력</li>
    <li>발주 대비 입고 수량 관리 (미입고 추적)</li>
  </ul>

  <h2>7.2 신규 DB 테이블 (예상)</h2>
  <table>
    <thead><tr><th>테이블</th><th>주요 컬럼</th></tr></thead>
    <tbody>
      <tr><td>suppliers (공급업체)</td><td>id, name, contact_name, phone, email, is_active</td></tr>
      <tr><td>purchase_orders (발주서)</td><td>id, supplier_id, branch_id, status, ordered_at, ordered_by</td></tr>
      <tr><td>purchase_order_items</td><td>id, purchase_order_id, product_id, quantity, unit_price, received_qty</td></tr>
    </tbody>
  </table>

  <h2>7.3 발주 흐름</h2>
  <div class="flow">
    <div class="flow-step">발주서 작성</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">승인</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">공급업체 발주</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">입고 확인</div>
    <div class="flow-arrow">→</div>
    <div class="flow-step">재고 자동 반영</div>
  </div>

  <h1>8. 고객용 앱 — 신규 계획</h1>
  <div class="info-box">
    <strong>목표:</strong> Cafe24 온라인 구매 + 오프라인 구매 내역을 한 곳에서 조회. 포인트 확인 및 내 정보 관리.
  </div>

  <h2>8.1 구현 방향</h2>
  <ul>
    <li>Next.js App Router의 <code>(customer)</code> route group 신규 추가 — 같은 앱 내 분리</li>
    <li>인증: Cafe24 OAuth 로그인 + 전화번호 인증 병행</li>
    <li>Cafe24 구매 내역: API로 직접 가져와 오프라인 내역과 합산 표시</li>
  </ul>

  <h2>8.2 주요 화면</h2>
  <table>
    <thead><tr><th>화면</th><th>내용</th></tr></thead>
    <tbody>
      <tr><td>구매 내역</td><td>온라인(Cafe24) + 오프라인(POS) 통합 이력</td></tr>
      <tr><td>포인트</td><td>잔액, 적립/사용 내역</td></tr>
      <tr><td>내 정보</td><td>이름, 연락처, 등급, 주소 확인/수정</td></tr>
    </tbody>
  </table>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

<!-- 9. 비기능 요구사항 -->
<div class="page">
  <h1>9. 비기능 요구사항</h1>
  <table>
    <thead><tr><th>구분</th><th>요구사항</th><th>현황</th></tr></thead>
    <tbody>
      <tr><td>성능</td><td>대시보드 로딩 2초 이내</td><td>API Route 집계 방식</td></tr>
      <tr><td>반응형</td><td>모바일/태블릿/데스크톱 완전 지원</td><td>Tailwind 반응형 구현</td></tr>
      <tr><td>보안</td><td>httpOnly 쿠키, 역할 기반 접근 제어</td><td>RBAC + screen_permissions</td></tr>
      <tr><td>가용성</td><td>Vercel 배포 — 99.9% SLA</td><td>Vercel + Supabase</td></tr>
      <tr><td>데이터 무결성</td><td>재고 이동 시 양방향 기록</td><td>inventory_movements</td></tr>
    </tbody>
  </table>

  <hr class="section-divider">
  <div style="margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 8px; text-align: center;">
    <p style="font-size: 11pt; font-weight: 700; color: #0f3460; margin-bottom: 8px;">경옥채 사내 통합시스템 PRD v2.0</p>
    <p style="font-size: 9pt; color: #64748b;">작성일: 2026년 4월 3일 | 검토: 경옥채 개발팀 | 분류: 내부용 (Confidential)</p>
    <p style="font-size: 9pt; color: #64748b; margin-top: 4px;">다음 버전(v2.1): 매입 관리 모듈 구현 완료 후 업데이트 예정</p>
  </div>
  <div class="footer">경옥채 사내통합시스템 PRD v2.0 — 내부용</div>
</div>

</body>
</html>`;

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: path.resolve(__dirname, '../doc/경옥채_사내통합시스템_PRD_v2.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
  });
  await browser.close();
  console.log('✅ PRD v2 PDF 생성 완료');
})();
