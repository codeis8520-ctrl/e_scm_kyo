import type { MiniMaxTool } from './client';
import { processRefund, getSalesOrderForRefund } from '@/lib/return-actions';
import { refreshCafe24Token, syncCafe24PaidOrders } from '@/lib/cafe24-actions';

// ─── Tool Definitions ──────────────────────────────────────────────────────

export const AGENT_TOOLS: MiniMaxTool[] = [
  // ── 조회 ──────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_inventory',
      description: '지점별 재고 현황 조회. "재고 얼마야?", "경옥고 재고 확인해줘", "강남점 재고" 등에 사용. 안전재고 미달 여부 포함.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '지점명 키워드. 예: "강남", "본점". 생략 시 전체 지점.' },
          product_name: { type: 'string', description: '제품명 키워드. 예: "경옥고", "홍삼". 생략 시 전체 제품.' },
          include_zero: { type: 'boolean', description: '재고 0인 품절 항목 포함 여부. 기본 false.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_low_stock',
      description: '안전재고 미달(재고 부족) 품목 조회. "부족한 거 뭐야?", "보충 필요한 거", "재고 경고" 등에 사용.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '지점명 키워드. 생략 시 전체 지점 통합 조회.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: '제품 목록과 단가, 원가, 바코드를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '제품명 키워드' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_branches',
      description: '지점 목록(이름, 채널, 주소, 전화, 운영상태)을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '지점명 키워드 (선택)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer',
      description: '고객 검색. 포인트 잔액, 등급, 최근 구매 이력 포함. 고객 이름이나 전화번호 중 하나만 있어도 검색 가능. 포인트 조정·등급 변경 전 반드시 먼저 호출해서 고객 확인.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '고객 이름 (부분 일치). 예: "김", "홍길동"' },
          phone: { type: 'string', description: '전화번호. 예: "010-1234-5678" 또는 "01012345678"' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_grades',
      description: '고객 등급별 적립률과 혜택을 조회합니다.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_point_history',
      description: '특정 고객의 포인트 적립/사용/조정 이력을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '고객 이름' },
          phone: { type: 'string', description: '고객 전화번호' },
          limit: { type: 'number', description: '최대 조회 건수 (기본 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_orders',
      description: '판매 주문(매출) 내역을 조회합니다. 기간, 지점, 고객으로 필터링 가능.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '지점명 필터' },
          customer_name: { type: 'string', description: '고객명 필터' },
          date_from: { type: 'string', description: '시작일 (YYYY-MM-DD)' },
          date_to: { type: 'string', description: '종료일 (YYYY-MM-DD)' },
          limit: { type: 'number', description: '최대 조회 건수 (기본 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_summary',
      description: '기간별 매출 합계·건수·채널별 분석. "이번달 매출", "오늘 얼마 팔렸어?", "강남점 이번주 매출" 등에 사용. date_from/date_to는 오늘 날짜 기준으로 계산해서 전달.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: '시작일 YYYY-MM-DD. 이번달 1일, 오늘, 이번주 월요일 등 계산해서 입력.' },
          date_to: { type: 'string', description: '종료일 YYYY-MM-DD. 보통 오늘 날짜.' },
          branch_name: { type: 'string', description: '지점명 키워드. 생략 시 전체 합산.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_suppliers',
      description: '공급업체(매입처) 목록을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '공급업체명 키워드 (선택)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_purchase_orders',
      description: '매입 발주서 목록과 상태를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
            description: '상태 필터 (생략 시 전체)',
          },
          branch_name: { type: 'string', description: '지점명 필터 (선택)' },
          limit: { type: 'number', description: '최대 조회 건수 (기본 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_production_orders',
      description: '생산 지시서 목록과 진행 상태를 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
            description: '상태 필터 (생략 시 전체)',
          },
          branch_name: { type: 'string', description: '지점명 필터 (선택)' },
          limit: { type: 'number', description: '최대 조회 건수 (기본 20)' },
        },
      },
    },
  },

  // ── 재고 관련 쓰기 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'bulk_adjust_inventory',
      description: '여러 지점/제품을 한 번에 재고 조정합니다. "모든 점포", "전체 제품" 같은 대량 작업에 사용. branch_name 또는 product_name을 생략하면 전체 대상으로 처리됩니다.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '지점명. 생략하면 전체 지점 대상.' },
          product_name: { type: 'string', description: '제품명. 생략하면 전체 제품 대상.' },
          movement_type: {
            type: 'string',
            enum: ['IN', 'OUT', 'ADJUST'],
            description: 'IN=입고(현재+수량), OUT=출고(현재-수량), ADJUST=실사(현재=수량으로 덮어씀)',
          },
          quantity: { type: 'number', description: '수량 (각 항목에 동일하게 적용)' },
          memo: { type: 'string', description: '사유 (선택)' },
        },
        required: ['movement_type', 'quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'adjust_inventory',
      description: '특정 지점의 특정 제품 1건 재고를 입고(+), 출고(-), 실사(=) 방식으로 조정합니다. 단일 건에만 사용하고, 여러 지점/제품이면 bulk_adjust_inventory를 사용하세요.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '지점명' },
          product_name: { type: 'string', description: '제품명' },
          movement_type: {
            type: 'string',
            enum: ['IN', 'OUT', 'ADJUST'],
            description: 'IN=입고(현재+수량), OUT=출고(현재-수량), ADJUST=실사(현재=수량)',
          },
          quantity: { type: 'number', description: '수량' },
          memo: { type: 'string', description: '사유 (선택)' },
        },
        required: ['branch_name', 'product_name', 'movement_type', 'quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transfer_inventory',
      description: '지점 간 재고를 이동합니다. 출발 지점 재고가 차감되고 도착 지점에 추가됩니다.',
      parameters: {
        type: 'object',
        properties: {
          from_branch_name: { type: 'string', description: '출발 지점명' },
          to_branch_name: { type: 'string', description: '도착 지점명' },
          product_name: { type: 'string', description: '제품명' },
          quantity: { type: 'number', description: '이동 수량' },
        },
        required: ['from_branch_name', 'to_branch_name', 'product_name', 'quantity'],
      },
    },
  },

  // ── 고객 관련 쓰기 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_customer',
      description: '새 고객을 등록합니다.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '고객 이름' },
          phone: { type: 'string', description: '전화번호 (010-XXXX-XXXX)' },
          grade: { type: 'string', enum: ['NORMAL', 'VIP', 'VVIP'], description: '등급 (기본 NORMAL)' },
          email: { type: 'string', description: '이메일 (선택)' },
          address: { type: 'string', description: '주소 (선택)' },
          health_note: { type: 'string', description: '건강 메모 (선택)' },
        },
        required: ['name', 'phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer',
      description: '고객 정보(전화번호, 이메일, 주소, 건강메모, 등급)를 수정합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '찾을 고객 이름' },
          phone: { type: 'string', description: '찾을 고객 전화번호' },
          new_phone: { type: 'string', description: '새 전화번호' },
          email: { type: 'string', description: '새 이메일' },
          address: { type: 'string', description: '새 주소' },
          health_note: { type: 'string', description: '건강 메모 업데이트' },
          grade: { type: 'string', enum: ['NORMAL', 'VIP', 'VVIP'], description: '변경할 등급' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_consultations',
      description: '고객 상담 기록 목록 조회. 상담 내용, 유형, 날짜, ID 포함. 상담 기록 삭제 전 반드시 먼저 호출해서 ID 확인.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '고객 이름' },
          phone: { type: 'string', description: '고객 전화번호' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_customer_consultation',
      description: '고객 상담 기록을 추가합니다. 방문 예정, 전화 상담, 구매 상담, 민원 처리 등을 기록할 때 사용합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '고객 이름' },
          phone: { type: 'string', description: '고객 전화번호' },
          consultation_type: {
            type: 'string',
            enum: ['전화 상담', '방문 상담', '구매 상담', '민원 처리', '기타'],
            description: '상담 유형. 방문 관련은 "방문 상담" 사용.',
          },
          content: { type: 'string', description: '상담 내용 (자유 텍스트)' },
        },
        required: ['content', 'consultation_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer_grade',
      description: '특정 고객의 등급을 변경합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '고객 이름' },
          phone: { type: 'string', description: '고객 전화번호' },
          new_grade: { type: 'string', enum: ['NORMAL', 'VIP', 'VVIP'], description: '변경할 등급' },
        },
        required: ['new_grade'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upgrade_customer_grades',
      description: '누적 구매액 기준으로 전체 고객 등급을 자동 업그레이드합니다. (100만원↑→VIP, 300만원↑→VVIP)',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'adjust_points',
      description: '고객 포인트를 수동으로 추가하거나 차감합니다.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '고객 이름' },
          phone: { type: 'string', description: '고객 전화번호' },
          points: { type: 'number', description: '조정 포인트 (양수=적립, 음수=차감)' },
          reason: { type: 'string', description: '조정 사유' },
        },
        required: ['points', 'reason'],
      },
    },
  },

  // ── 지점/제품 관련 쓰기 ─────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_branch',
      description: '새 지점/매장을 추가합니다. 추가 시 모든 제품에 대해 재고 레코드(0개)가 자동 생성됩니다.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '지점명 (예: 송파점)' },
          channel: { type: 'string', enum: ['STORE', 'DEPT_STORE', 'ONLINE', 'EVENT'], description: '채널 유형' },
          address: { type: 'string', description: '주소 (선택)' },
          phone: { type: 'string', description: '전화번호 (선택)' },
        },
        required: ['name', 'channel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_branch',
      description: '지점 정보(이름, 주소, 전화, 활성화여부)를 수정합니다.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '수정할 지점명' },
          new_name: { type: 'string', description: '새 지점명' },
          address: { type: 'string', description: '새 주소' },
          phone: { type: 'string', description: '새 전화번호' },
          is_active: { type: 'boolean', description: '활성화 여부' },
        },
        required: ['branch_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_product',
      description: '새 제품을 등록합니다. 등록 시 모든 지점에 재고 레코드(0개)가 자동 생성됩니다.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '제품명' },
          price: { type: 'number', description: '판매가 (원)' },
          cost: { type: 'number', description: '원가 (원, 선택)' },
          unit: { type: 'string', description: '단위 (기본 "개")' },
          barcode: { type: 'string', description: '바코드 (선택)' },
        },
        required: ['name', 'price'],
      },
    },
  },

  // ── 매입(발주) 관련 쓰기 ───────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_purchase_order',
      description: '공급업체에 제품 발주서를 작성합니다. DRAFT 상태로 생성되며 확정 전 수정 가능.',
      parameters: {
        type: 'object',
        properties: {
          supplier_name: { type: 'string', description: '공급업체명' },
          branch_name: { type: 'string', description: '입고 지점명' },
          product_name: { type: 'string', description: '발주할 제품명' },
          quantity: { type: 'number', description: '발주 수량' },
          unit_price: { type: 'number', description: '매입 단가 (원)' },
          memo: { type: 'string', description: '발주 메모 (선택)' },
        },
        required: ['supplier_name', 'branch_name', 'product_name', 'quantity', 'unit_price'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_purchase_order',
      description: '발주서를 DRAFT에서 CONFIRMED(확정) 상태로 변경합니다. 확정 후 수정 불가.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '발주서 번호 (PO-...)' },
        },
        required: ['order_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'receive_purchase_order',
      description: '발주서에 대한 실제 입고를 처리합니다. 재고가 자동으로 증가하고 회계 분개가 생성됩니다.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '발주서 번호 (PO-...)' },
          memo: { type: 'string', description: '입고 메모 (선택)' },
        },
        required: ['order_number'],
      },
    },
  },

  // ── 생산 관련 쓰기 ──────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_production_order',
      description: '제품 생산 지시서를 생성합니다. BOM이 등록된 제품만 가능. PENDING 상태로 생성.',
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: '생산할 완제품명' },
          branch_name: { type: 'string', description: '생산 지점명' },
          quantity: { type: 'number', description: '생산 수량' },
          memo: { type: 'string', description: '생산 메모 (선택)' },
        },
        required: ['product_name', 'branch_name', 'quantity'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_production_order',
      description: '생산 지시서를 착수(PENDING→IN_PROGRESS) 상태로 변경합니다.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '생산 지시서 번호 (WO-...)' },
        },
        required: ['order_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_production_order',
      description: '생산을 완료 처리합니다. BOM 원재료가 재고에서 차감되고 완제품 재고가 증가합니다.',
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '생산 지시서 번호 (WO-...)' },
        },
        required: ['order_number'],
      },
    },
  },

  // ── 알림 ────────────────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'send_sms',
      description: 'SMS를 발송합니다. 고객 이름/전화번호로 특정 고객에게, 또는 전화번호를 직접 지정하여 발송.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: '발송할 고객 이름 (phone 대신 사용 가능)' },
          phone: { type: 'string', description: '수신자 전화번호 (직접 지정)' },
          message: { type: 'string', description: '발송할 SMS 내용' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_product',
      description: '제품의 판매가, 원가, 이름, 단위를 수정합니다.',
      parameters: {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: '수정할 제품명 키워드' },
          new_price: { type: 'number', description: '새 판매가 (원). 변경 불필요시 생략.' },
          new_cost: { type: 'number', description: '새 원가 (원). 변경 불필요시 생략.' },
          new_name: { type: 'string', description: '새 제품명. 변경 불필요시 생략.' },
          new_unit: { type: 'string', description: '새 단위. 변경 불필요시 생략.' },
        },
        required: ['product_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_update_product_costs',
      description: '전체 또는 특정 제품의 원가를 판매가 대비 비율로 일괄 업데이트합니다. "원가를 판매가의 50%로 설정해줘" 같은 요청에 사용.',
      parameters: {
        type: 'object',
        properties: {
          cost_ratio: { type: 'number', description: '판매가 대비 원가 비율 (0~1). 예: 0.5 = 50%' },
          product_name: { type: 'string', description: '특정 제품만 적용 시 제품명 키워드. 생략 시 전체 제품.' },
        },
        required: ['cost_ratio'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_send_sms',
      description: '특정 등급 또는 전체 고객에게 동일한 SMS를 일괄 발송합니다. 프로모션, 공지사항 등에 사용.',
      parameters: {
        type: 'object',
        properties: {
          grade: { type: 'string', enum: ['NORMAL', 'VIP', 'VVIP', 'ALL'], description: '발송 대상 등급. ALL이면 전체 고객.' },
          message: { type: 'string', description: '발송할 SMS 내용' },
          branch_name: { type: 'string', description: '특정 지점 담당 고객만 발송 시 지점명' },
        },
        required: ['grade', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_and_confirm_purchase_order',
      description: '발주서를 작성하고 즉시 확정합니다. "발주하고 확정까지 해줘" 요청에 사용.',
      parameters: {
        type: 'object',
        properties: {
          supplier_name: { type: 'string', description: '공급업체 이름 키워드' },
          branch_name: { type: 'string', description: '입고 지점명' },
          product_name: { type: 'string', description: '발주 제품명 키워드' },
          quantity: { type: 'number', description: '발주 수량' },
          unit_price: { type: 'number', description: '단가 (원)' },
          memo: { type: 'string', description: '메모' },
        },
        required: ['supplier_name', 'branch_name', 'product_name', 'quantity', 'unit_price'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replenish_low_stock',
      description: '안전재고 미달 품목을 자동으로 보충합니다. 안전재고 수준까지 채우거나 지정 수량만큼 입고 처리.',
      parameters: {
        type: 'object',
        properties: {
          branch_name: { type: 'string', description: '지점명 (생략 시 전체 지점)' },
          fill_to_safety: { type: 'boolean', description: '안전재고 수준까지 채우기 (기본 true). false면 fixed_quantity 사용.' },
          fixed_quantity: { type: 'number', description: 'fill_to_safety가 false일 때 각 품목에 입고할 고정 수량' },
          memo: { type: 'string', description: '메모' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_products',
      description: '기간별 판매량/매출액 상위 제품을 조회합니다.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: '조회 시작일 YYYY-MM-DD (기본: 이번 달 1일)' },
          end_date: { type: 'string', description: '조회 종료일 YYYY-MM-DD (기본: 오늘)' },
          limit: { type: 'number', description: '상위 N개 (기본 10)' },
          branch_name: { type: 'string', description: '지점 필터 (생략 시 전체)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_sales',
      description: '두 기간의 매출을 비교합니다. "이번달 vs 지난달", "이번주 vs 지난주" 등의 요청에 사용.',
      parameters: {
        type: 'object',
        properties: {
          period1_start: { type: 'string', description: '비교 기간1 시작일 YYYY-MM-DD' },
          period1_end: { type: 'string', description: '비교 기간1 종료일 YYYY-MM-DD' },
          period2_start: { type: 'string', description: '비교 기간2 시작일 YYYY-MM-DD' },
          period2_end: { type: 'string', description: '비교 기간2 종료일 YYYY-MM-DD' },
          branch_name: { type: 'string', description: '지점 필터 (생략 시 전체)' },
        },
        required: ['period1_start', 'period1_end', 'period2_start', 'period2_end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_record',
      description: `레코드 삭제. 잘못 입력된 상담 기록, 메모, 알림 등 허용된 테이블의 항목을 ID로 삭제.
허용 테이블: customer_consultations(상담기록), notifications(발송이력).
삭제 전 반드시 get_customer_consultations 등으로 ID를 확인한 후 사용.
sales_orders·inventories 등 핵심 거래 테이블은 삭제 불가.`,
      parameters: {
        type: 'object',
        properties: {
          table: {
            type: 'string',
            enum: ['customer_consultations', 'notifications'],
            description: '삭제할 테이블명',
          },
          record_id: { type: 'string', description: '삭제할 레코드의 UUID' },
          reason: { type: 'string', description: '삭제 사유 (예: "잘못 입력된 상담 기록")' },
        },
        required: ['table', 'record_id'],
      },
    },
  },
  // ── Phase B: 환불 ─────────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'refund_sales_order',
      description: `POS 판매 주문 환불 처리. 전액 또는 부분 환불 지원. 환불 시 재고 자동 복원, 적립 포인트 비율만큼 차감, 환불 전표 생성.
사용 예: "SA-GN-20260408-ABCD 환불해줘", "어제 김철수 주문 환불".
주의: 원본 주문이 COMPLETED 또는 PARTIALLY_REFUNDED 상태여야 함.`,
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '원본 주문의 order_number (예: SA-GN-20260408-ABCD)' },
          reason: {
            type: 'string',
            enum: ['DEFECTIVE', 'WRONG_ITEM', 'CHANGE_OF_MIND', 'DUPLICATE', 'OTHER'],
            description: '환불 사유 (DEFECTIVE:불량, WRONG_ITEM:오배송, CHANGE_OF_MIND:단순변심, DUPLICATE:중복, OTHER:기타)',
          },
          reason_detail: { type: 'string', description: '상세 사유 (선택)' },
          refund_method: {
            type: 'string',
            enum: ['cash', 'card', 'point'],
            description: '환불 방법 (cash:현금, card:카드취소, point:포인트전환). 기본 원 결제수단과 동일.',
          },
          full_refund: { type: 'boolean', description: 'true면 전체 환불, false이면 items 파라미터로 부분 환불. 기본 true.' },
          items: {
            type: 'array',
            description: '부분 환불 시 환불할 항목 목록. 각 항목은 {product_name, quantity}',
            items: {
              type: 'object',
              properties: {
                product_name: { type: 'string' },
                quantity: { type: 'number' },
              },
            },
          },
        },
        required: ['order_number', 'reason'],
      },
    },
  },
  // ── Phase B: 부분 입고 ────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'receive_purchase_order_partial',
      description: `발주의 일부 수량만 입고 처리. 100개 발주 중 50개만 받은 경우 사용.
발주 상태는 전체 입고 시 RECEIVED, 부분 입고 시 PARTIALLY_RECEIVED로 전환.
잔여 수량은 후속 receive_purchase_order(_partial) 호출로 이어서 입고 가능.`,
      parameters: {
        type: 'object',
        properties: {
          order_number: { type: 'string', description: '발주번호 (예: PO-20260408-ABC)' },
          items: {
            type: 'array',
            description: '입고할 품목 목록. 각 항목: {product_name, quantity}',
            items: {
              type: 'object',
              properties: {
                product_name: { type: 'string' },
                quantity: { type: 'number' },
              },
              required: ['product_name', 'quantity'],
            },
          },
          memo: { type: 'string', description: '입고 메모 (선택)' },
        },
        required: ['order_number', 'items'],
      },
    },
  },
  // ── Phase B: 배송 관리 ────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_shipments',
      description: `배송 목록 조회. 상태/수령자명/송장번호로 필터링. "오늘 미발송 건", "배송중인 거", "홍길동 배송 어디쯤"에 사용.`,
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'PRINTED', 'SHIPPED', 'DELIVERED'], description: '배송 상태 필터' },
          recipient_name: { type: 'string', description: '수령자명 키워드' },
          tracking_number: { type: 'string', description: '송장번호' },
          limit: { type: 'number', description: '최대 건수 (기본 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_shipment_tracking',
      description: `배송 건에 송장번호를 등록하거나 수정. 등록 시 상태가 자동으로 SHIPPED로 전환.
수령자명과 송장번호로 식별. 같은 수령자가 여러 건이면 가장 최근 PENDING 건에 반영.`,
      parameters: {
        type: 'object',
        properties: {
          recipient_name: { type: 'string', description: '수령자명' },
          tracking_number: { type: 'string', description: '송장번호 (필수)' },
          cafe24_order_id: { type: 'string', description: '카페24 주문 ID로 식별하는 경우' },
        },
        required: ['tracking_number'],
      },
    },
  },
  // ── Phase B: 카페24 동기화 ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'refresh_cafe24_token',
      description: `카페24 API 토큰(access_token / refresh_token) 수동 갱신. 카페24 연동 오류 발생 시 또는 수시 갱신용.`,
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_cafe24_paid_orders',
      description: `카페24에서 결제완료 주문을 끌어와 sales_orders에 매출로 동기화. Webhook 누락 보완용.
각 주문에 대해 신규 생성 + COMPLETED 상태 + 매출 분개까지 일괄 처리.`,
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: '시작일 YYYY-MM-DD' },
          end_date: { type: 'string', description: '종료일 YYYY-MM-DD' },
        },
        required: ['start_date', 'end_date'],
      },
    },
  },
  // ── Phase B: 고객 세분화 ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'customer_segment_analysis',
      description: `고객 세분화 분석. 기간별 매출 상위 고객, 휴면 고객(최근 N일 미구매), 구매 빈도 상위 등.
"VIP 중 매출 TOP 5", "최근 90일 미구매 고객", "경옥고 자주 사는 고객" 등에 사용.`,
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['top_spenders', 'dormant', 'frequent_buyers', 'grade_breakdown'],
            description: 'top_spenders=매출상위, dormant=휴면, frequent_buyers=자주구매, grade_breakdown=등급별분포',
          },
          days: { type: 'number', description: '분석 기간 (일수). 기본 90' },
          grade: { type: 'string', enum: ['NORMAL', 'VIP', 'VVIP'], description: '등급 필터' },
          limit: { type: 'number', description: '반환 건수 (기본 10)' },
        },
        required: ['mode'],
      },
    },
  },
];

export const WRITE_TOOLS = new Set([
  'bulk_adjust_inventory',
  'adjust_inventory',
  'transfer_inventory',
  'create_customer',
  'update_customer',
  'add_customer_consultation',
  'update_customer_grade',
  'upgrade_customer_grades',
  'adjust_points',
  'create_branch',
  'update_branch',
  'create_product',
  'create_purchase_order',
  'confirm_purchase_order',
  'receive_purchase_order',
  'create_production_order',
  'start_production_order',
  'complete_production_order',
  'send_sms',
  'bulk_send_sms',
  'create_and_confirm_purchase_order',
  'replenish_low_stock',
  'update_product',
  'bulk_update_product_costs',
  'delete_record',
  // Phase B
  'refund_sales_order',
  'receive_purchase_order_partial',
  'update_shipment_tracking',
  'refresh_cafe24_token',
  'sync_cafe24_paid_orders',
]);

// ─── Shared Helpers ──────────────────────────────────────────────────────────

async function findBranch(sb: any, name: string) {
  const { data } = await sb.from('branches').select('id, name').ilike('name', `%${name}%`).limit(1).single();
  return data as { id: string; name: string } | null;
}

async function findProduct(sb: any, name: string) {
  const { data } = await sb.from('products').select('id, name, code, price, cost, unit').eq('is_active', true).ilike('name', `%${name}%`).limit(1).single();
  return data as { id: string; name: string; code: string; price: number; cost: number; unit: string } | null;
}

async function findCustomer(sb: any, args: { customer_name?: string; phone?: string; name?: string }) {
  const name = args.customer_name || args.name;
  let q = sb.from('customers').select('id, name, phone, grade, email').eq('is_active', true);
  if (args.phone) q = q.eq('phone', args.phone);
  else if (name) q = q.ilike('name', `%${name}%`);
  const { data } = await q.limit(1).single();
  return data as { id: string; name: string; phone: string; grade: string; email: string } | null;
}

async function getPoints(sb: any, customerId: string): Promise<number> {
  const { data } = await sb.from('point_history').select('balance').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(1).single();
  return data?.balance ?? 0;
}

// ─── RBAC ────────────────────────────────────────────────────────────────────

export interface ToolContext {
  userId?: string;
  userRole?: string;
  branchId?: string;
}

const STAFF_ROLES = new Set(['BRANCH_STAFF', 'PHARMACY_STAFF']);
const HQ_ROLES = new Set(['SUPER_ADMIN', 'HQ_OPERATOR', 'EXECUTIVE']);

function isStaffRole(role?: string): boolean {
  return !!role && STAFF_ROLES.has(role);
}
function isHqRole(role?: string): boolean {
  return !!role && HQ_ROLES.has(role);
}

/** 본사 전용 작업 가드 — staff 역할이면 에러 JSON 반환 */
function requireHq(ctx: ToolContext, actionLabel: string): string | null {
  // role 미지정(로컬/테스트)은 허용
  if (!ctx.userRole) return null;
  if (isHqRole(ctx.userRole)) return null;
  return JSON.stringify({ error: `${actionLabel}은(는) 본사 권한이 필요합니다.` });
}

/**
 * 쓰기 대상 지점을 해결한다.
 * - Staff: 본인 지점 강제 (branch_name 인자가 있어도 본인 지점과 일치해야 함)
 * - HQ / role 미지정: branch_name 인자로 탐색
 */
async function resolveBranchForWrite(
  sb: any,
  ctx: ToolContext,
  branchNameArg?: string
): Promise<{ ok: true; branch: { id: string; name: string } } | { ok: false; error: string }> {
  if (isStaffRole(ctx.userRole)) {
    if (!ctx.branchId) return { ok: false, error: '담당 지점이 지정되지 않았습니다.' };
    const { data: b } = await sb.from('branches').select('id, name').eq('id', ctx.branchId).maybeSingle();
    if (!b) return { ok: false, error: '담당 지점을 찾을 수 없습니다.' };
    // 사용자가 다른 지점명을 지정한 경우 차단
    if (branchNameArg) {
      const nameMatch =
        String(b.name).toLowerCase().includes(String(branchNameArg).toLowerCase()) ||
        String(branchNameArg).toLowerCase().includes(String(b.name).toLowerCase());
      if (!nameMatch) {
        return { ok: false, error: `담당 지점(${b.name})만 작업할 수 있습니다.` };
      }
    }
    return { ok: true, branch: b as any };
  }
  // HQ/미지정
  if (!branchNameArg) return { ok: false, error: '지점명을 지정해주세요.' };
  const branch = await findBranch(sb, branchNameArg);
  if (!branch) return { ok: false, error: `지점 "${branchNameArg}" 없음` };
  return { ok: true, branch };
}

/** 이미 찾은 지점 ID가 staff의 담당 지점과 일치하는지 검증 */
function assertBranchAccess(ctx: ToolContext, targetBranchId: string, branchLabel: string): string | null {
  if (!isStaffRole(ctx.userRole)) return null;
  if (!ctx.branchId) return JSON.stringify({ error: '담당 지점이 지정되지 않았습니다.' });
  if (ctx.branchId !== targetBranchId) {
    return JSON.stringify({ error: `담당 지점만 작업할 수 있습니다. (요청: ${branchLabel})` });
  }
  return null;
}

// ─── Tool Executors ──────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  sb: any,
  ctx: ToolContext = {}
): Promise<string> {
  try {
    switch (toolName) {
      case 'get_inventory':            return execGetInventory(sb, args);
      case 'get_low_stock':            return execGetLowStock(sb, args);
      case 'get_products':             return execGetProducts(sb, args);
      case 'get_branches':             return execGetBranches(sb, args);
      case 'get_customer':             return execGetCustomer(sb, args);
      case 'get_customer_grades':      return execGetCustomerGrades(sb);
      case 'get_point_history':        return execGetPointHistory(sb, args);
      case 'get_orders':               return execGetOrders(sb, args);
      case 'get_sales_summary':        return execGetSalesSummary(sb, args);
      case 'get_suppliers':            return execGetSuppliers(sb, args);
      case 'get_purchase_orders':      return execGetPurchaseOrders(sb, args);
      case 'get_production_orders':    return execGetProductionOrders(sb, args);
      case 'bulk_adjust_inventory':    return execBulkAdjustInventory(sb, args as any, ctx);
      case 'adjust_inventory':         return execAdjustInventory(sb, args as any, ctx);
      case 'transfer_inventory':       return execTransferInventory(sb, args as any, ctx);
      case 'create_customer':          return execCreateCustomer(sb, args as any);
      case 'update_customer':          return execUpdateCustomer(sb, args as any);
      case 'add_customer_consultation':return execAddCustomerConsultation(sb, args as any);
      case 'update_customer_grade':    return execUpdateCustomerGrade(sb, args as any);
      case 'upgrade_customer_grades':  return execUpgradeCustomerGrades(sb, ctx);
      case 'adjust_points':            return execAdjustPoints(sb, args as any);
      case 'create_branch':            return execCreateBranch(sb, args as any, ctx);
      case 'update_branch':            return execUpdateBranch(sb, args as any, ctx);
      case 'create_product':           return execCreateProduct(sb, args as any, ctx);
      case 'create_purchase_order':    return execCreatePurchaseOrder(sb, args as any, ctx);
      case 'confirm_purchase_order':   return execConfirmPurchaseOrder(sb, args as any, ctx);
      case 'receive_purchase_order':   return execReceivePurchaseOrder(sb, args as any, ctx);
      case 'create_production_order':  return execCreateProductionOrder(sb, args as any, ctx);
      case 'start_production_order':   return execStartProductionOrder(sb, args as any, ctx);
      case 'complete_production_order':return execCompleteProductionOrder(sb, args as any, ctx);
      case 'send_sms':                 return execSendSms(sb, args as any);
      case 'bulk_send_sms':            return execBulkSendSms(sb, args as any, ctx);
      case 'create_and_confirm_purchase_order': return execCreateAndConfirmPurchaseOrder(sb, args as any, ctx);
      case 'replenish_low_stock':      return execReplenishLowStock(sb, args as any, ctx);
      case 'get_top_products':         return execGetTopProducts(sb, args as any);
      case 'compare_sales':            return execCompareSales(sb, args as any);
      case 'update_product':           return execUpdateProduct(sb, args as any, ctx);
      case 'bulk_update_product_costs':return execBulkUpdateProductCosts(sb, args as any, ctx);
      case 'get_customer_consultations':return execGetCustomerConsultations(sb, args as any);
      case 'delete_record':            return execDeleteRecord(sb, args as any, ctx);
      // Phase B
      case 'refund_sales_order':       return execRefundSalesOrder(sb, args as any, ctx);
      case 'receive_purchase_order_partial': return execReceivePurchaseOrderPartial(sb, args as any, ctx);
      case 'get_shipments':            return execGetShipments(sb, args as any, ctx);
      case 'update_shipment_tracking': return execUpdateShipmentTracking(sb, args as any, ctx);
      case 'refresh_cafe24_token':     return execRefreshCafe24Token(ctx);
      case 'sync_cafe24_paid_orders':  return execSyncCafe24PaidOrders(sb, args as any, ctx);
      case 'customer_segment_analysis':return execCustomerSegmentAnalysis(sb, args as any);
      default: return JSON.stringify({ error: `알 수 없는 도구: ${toolName}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

// ── 재고 조회 ────────────────────────────────────────────────────────────────

async function execGetInventory(sb: any, args: { branch_name?: string; product_name?: string; include_zero?: boolean }): Promise<string> {
  let branchId: string | null = null;
  let productId: string | null = null;

  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }
  if (args.product_name) {
    const p = await findProduct(sb, args.product_name);
    if (!p) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });
    productId = p.id;
  }

  let q = sb.from('inventories').select('quantity, safety_stock, products(name, code), branches(name)');
  if (branchId) q = q.eq('branch_id', branchId);
  if (productId) q = q.eq('product_id', productId);
  if (!args.include_zero) q = q.gt('quantity', 0);
  q = q.limit(50);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '재고 데이터 없음' });

  return JSON.stringify((data as any[]).map(inv => ({
    지점: inv.branches?.name,
    제품: inv.products?.name,
    코드: inv.products?.code,
    수량: inv.quantity,
    안전재고: inv.safety_stock,
    상태: inv.quantity < (inv.safety_stock || 0) ? '⚠️부족' : '정상',
  })));
}

async function execGetLowStock(sb: any, args: { branch_name?: string }): Promise<string> {
  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  let q = sb.from('inventories').select('quantity, safety_stock, products(name, code), branches(name)');
  if (branchId) q = q.eq('branch_id', branchId);
  const { data } = await q;

  const low = ((data || []) as any[]).filter(i => i.quantity < (i.safety_stock || 0));
  if (!low.length) return JSON.stringify({ 결과: '재고 부족 품목 없음 ✅' });

  return JSON.stringify({
    부족건수: low.length,
    목록: low.map(i => ({
      지점: i.branches?.name,
      제품: i.products?.name,
      현재: i.quantity,
      안전재고: i.safety_stock,
      부족량: i.safety_stock - i.quantity,
    })),
  });
}

// ── 제품/지점 조회 ───────────────────────────────────────────────────────────

async function execGetProducts(sb: any, args: { name?: string }): Promise<string> {
  let q = sb.from('products').select('name, code, price, cost, unit, barcode').eq('is_active', true).order('name');
  if (args.name) q = q.ilike('name', `%${args.name}%`);
  const { data, error } = await q.limit(30);
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify((data || []) as any[]);
}

async function execGetBranches(sb: any, args: { name?: string }): Promise<string> {
  const channelMap: Record<string, string> = { STORE: '한약국', DEPT_STORE: '백화점', ONLINE: '자사몰', EVENT: '이벤트' };
  let q = sb.from('branches').select('name, code, channel, address, phone, is_active').order('name');
  if (args.name) q = q.ilike('name', `%${args.name}%`);
  const { data, error } = await q.limit(30);
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify(((data || []) as any[]).map(b => ({
    지점명: b.name, 코드: b.code,
    채널: channelMap[b.channel] || b.channel,
    주소: b.address || '-', 전화: b.phone || '-',
    상태: b.is_active ? '운영중' : '비활성',
  })));
}

// ── 고객 조회 ────────────────────────────────────────────────────────────────

async function execGetCustomer(sb: any, args: { name?: string; phone?: string }): Promise<string> {
  let q = sb.from('customers').select('id, name, phone, email, grade, address, health_note, is_active, created_at').eq('is_active', true);
  if (args.phone) q = q.eq('phone', args.phone);
  else if (args.name) q = q.ilike('name', `%${args.name}%`);
  q = q.limit(5);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '고객 없음' });

  const gradeLabels: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
  const results = await Promise.all((data as any[]).map(async c => {
    const points = await getPoints(sb, c.id);
    // 최근 주문 합산
    const { data: orders } = await sb.from('sales_orders')
      .select('total_amount').eq('customer_id', c.id).eq('status', 'COMPLETED');
    const totalPurchase = ((orders || []) as any[]).reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
    return {
      이름: c.name, 전화: c.phone, 이메일: c.email || '-',
      등급: gradeLabels[c.grade] || c.grade,
      포인트잔액: `${points.toLocaleString()}P`,
      누적구매액: `${totalPurchase.toLocaleString()}원`,
      주소: c.address || '-',
      건강메모: c.health_note || '-',
      등록일: c.created_at?.slice(0, 10),
    };
  }));

  return JSON.stringify(results);
}

async function execGetCustomerGrades(sb: any): Promise<string> {
  const { data, error } = await sb.from('customer_grades').select('code, name, point_rate').eq('is_active', true).order('sort_order');
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify(((data || []) as any[]).map(g => ({
    코드: g.code, 등급명: g.name, 적립률: `${g.point_rate}%`,
  })));
}

async function execGetPointHistory(sb: any, args: { customer_name?: string; phone?: string; limit?: number }): Promise<string> {
  const customer = await findCustomer(sb, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const typeLabels: Record<string, string> = { earn: '적립', use: '사용', adjust: '조정', expire: '만료' };
  const { data, error } = await sb.from('point_history')
    .select('type, points, balance, description, created_at')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(args.limit || 20);

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    고객: customer.name,
    현재잔액: `${(await getPoints(sb, customer.id)).toLocaleString()}P`,
    이력: ((data || []) as any[]).map(h => ({
      구분: typeLabels[h.type] || h.type,
      포인트: `${h.points > 0 ? '+' : ''}${h.points}P`,
      잔액: `${h.balance}P`,
      설명: h.description,
      일시: h.created_at?.slice(0, 16),
    })),
  });
}

// ── 판매 조회 ────────────────────────────────────────────────────────────────

async function execGetOrders(sb: any, args: { branch_name?: string; customer_name?: string; date_from?: string; date_to?: string; limit?: number }): Promise<string> {
  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  const paymentLabels: Record<string, string> = { cash: '현금', card: '카드', kakao: '카카오페이' };
  const statusLabels: Record<string, string> = { COMPLETED: '완료', CANCELLED: '취소', REFUNDED: '환불', PARTIALLY_REFUNDED: '부분환불' };

  let q = sb.from('sales_orders')
    .select('order_number, total_amount, discount_amount, points_used, payment_method, status, ordered_at, channel, customers(name)')
    .order('ordered_at', { ascending: false });

  if (branchId) q = q.eq('branch_id', branchId);
  if (args.date_from) q = q.gte('ordered_at', `${args.date_from}T00:00:00`);
  if (args.date_to) q = q.lte('ordered_at', `${args.date_to}T23:59:59`);
  q = q.limit(args.limit || 20);

  // customer name filter
  if (args.customer_name) {
    const cust = await findCustomer(sb, { name: args.customer_name });
    if (!cust) return JSON.stringify({ 결과: '해당 고객 주문 없음' });
    q = q.eq('customer_id', cust.id);
  }

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '주문 없음' });

  const list = data as any[];
  const total = list.reduce((s, o) => s + (o.total_amount || 0), 0);
  return JSON.stringify({
    조회건수: list.length, 합계금액: `${total.toLocaleString()}원`,
    목록: list.map(o => ({
      주문번호: o.order_number, 고객: o.customers?.name || '비회원',
      금액: `${(o.total_amount || 0).toLocaleString()}원`,
      할인: o.discount_amount ? `${o.discount_amount.toLocaleString()}원` : '-',
      결제: paymentLabels[o.payment_method] || o.payment_method,
      상태: statusLabels[o.status] || o.status,
      일시: o.ordered_at?.slice(0, 16),
    })),
  });
}

async function execGetSalesSummary(sb: any, args: { date_from?: string; date_to?: string; branch_name?: string }): Promise<string> {
  const now = new Date();
  const from = args.date_from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = args.date_to || now.toISOString().slice(0, 10);

  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  let q = sb.from('sales_orders')
    .select('total_amount, discount_amount, channel, branch_id, branches(name)')
    .eq('status', 'COMPLETED')
    .gte('ordered_at', `${from}T00:00:00`)
    .lte('ordered_at', `${to}T23:59:59`);
  if (branchId) q = q.eq('branch_id', branchId);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });

  const orders = (data || []) as any[];
  const totalRevenue = orders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const totalDiscount = orders.reduce((s, o) => s + (o.discount_amount || 0), 0);

  // 채널별
  const channelLabels: Record<string, string> = { STORE: '한약국', DEPT_STORE: '백화점', ONLINE: '자사몰', EVENT: '이벤트' };
  const byChannel: Record<string, { amount: number; count: number }> = {};
  const byBranch: Record<string, { name: string; amount: number; count: number }> = {};
  for (const o of orders) {
    const ch = o.channel || 'STORE';
    if (!byChannel[ch]) byChannel[ch] = { amount: 0, count: 0 };
    byChannel[ch].amount += o.total_amount || 0;
    byChannel[ch].count++;

    const bn = o.branches?.name || o.branch_id;
    if (!byBranch[bn]) byBranch[bn] = { name: bn, amount: 0, count: 0 };
    byBranch[bn].amount += o.total_amount || 0;
    byBranch[bn].count++;
  }

  return JSON.stringify({
    기간: `${from} ~ ${to}`,
    총매출: `${totalRevenue.toLocaleString()}원`,
    총할인: `${totalDiscount.toLocaleString()}원`,
    순매출: `${(totalRevenue - totalDiscount).toLocaleString()}원`,
    주문건수: orders.length,
    채널별: Object.entries(byChannel).map(([k, v]) => ({
      채널: channelLabels[k] || k, 매출: `${v.amount.toLocaleString()}원`, 건수: v.count,
    })),
    지점별: Object.values(byBranch).sort((a, b) => b.amount - a.amount).map(v => ({
      지점: v.name, 매출: `${v.amount.toLocaleString()}원`, 건수: v.count,
    })),
  });
}

// ── 매입 조회 ────────────────────────────────────────────────────────────────

async function execGetSuppliers(sb: any, args: { name?: string }): Promise<string> {
  let q = sb.from('suppliers').select('name, code, contact_name, phone, email, is_active').eq('is_active', true).order('name');
  if (args.name) q = q.ilike('name', `%${args.name}%`);
  const { data, error } = await q.limit(30);
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '공급업체 없음' });
  return JSON.stringify(((data || []) as any[]).map(s => ({
    업체명: s.name, 코드: s.code,
    담당자: s.contact_name || '-', 전화: s.phone || '-', 이메일: s.email || '-',
  })));
}

async function execGetPurchaseOrders(sb: any, args: { status?: string; branch_name?: string; limit?: number }): Promise<string> {
  const statusLabels: Record<string, string> = {
    DRAFT: '초안', CONFIRMED: '확정', PARTIALLY_RECEIVED: '부분입고', RECEIVED: '입고완료', CANCELLED: '취소',
  };

  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  let q = sb.from('purchase_orders')
    .select('order_number, status, total_amount, ordered_at, memo, suppliers(name), branches(name)')
    .order('ordered_at', { ascending: false });
  if (args.status) q = q.eq('status', args.status);
  if (branchId) q = q.eq('branch_id', branchId);
  q = q.limit(args.limit || 20);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '발주서 없음' });

  return JSON.stringify(((data || []) as any[]).map(o => ({
    발주번호: o.order_number,
    공급업체: o.suppliers?.name || '-',
    지점: o.branches?.name || '-',
    금액: `${(o.total_amount || 0).toLocaleString()}원`,
    상태: statusLabels[o.status] || o.status,
    일자: o.ordered_at?.slice(0, 10),
    메모: o.memo || '-',
  })));
}

// ── 생산 조회 ────────────────────────────────────────────────────────────────

async function execGetProductionOrders(sb: any, args: { status?: string; branch_name?: string; limit?: number }): Promise<string> {
  const statusLabels: Record<string, string> = {
    PENDING: '대기', IN_PROGRESS: '진행중', COMPLETED: '완료', CANCELLED: '취소',
  };

  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  let q = (sb as any).from('production_orders')
    .select('order_number, status, quantity, memo, started_at, created_at, products(name), branches(name)')
    .order('created_at', { ascending: false });
  if (args.status) q = q.eq('status', args.status);
  if (branchId) q = q.eq('branch_id', branchId);
  q = q.limit(args.limit || 20);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '생산 지시서 없음' });

  return JSON.stringify(((data || []) as any[]).map(o => ({
    지시번호: o.order_number,
    제품: o.products?.name || '-',
    지점: o.branches?.name || '-',
    수량: o.quantity,
    상태: statusLabels[o.status] || o.status,
    착수일: o.started_at?.slice(0, 10) || '-',
    생성일: o.created_at?.slice(0, 10),
    메모: o.memo || '-',
  })));
}

// ── 재고 쓰기 ────────────────────────────────────────────────────────────────

async function execBulkAdjustInventory(sb: any, args: {
  branch_name?: string;
  product_name?: string;
  movement_type: string;
  quantity: number;
  memo?: string;
}, ctx: ToolContext): Promise<string> {
  // 대상 지점 목록 — staff는 자기 지점만
  let branchesQ = sb.from('branches').select('id, name').eq('is_active', true);
  if (isStaffRole(ctx.userRole)) {
    if (!ctx.branchId) return JSON.stringify({ error: '담당 지점이 지정되지 않았습니다.' });
    branchesQ = branchesQ.eq('id', ctx.branchId);
  } else if (args.branch_name) {
    branchesQ = branchesQ.ilike('name', `%${args.branch_name}%`);
  }
  const { data: branches } = await branchesQ;
  if (!branches?.length) return JSON.stringify({ error: '대상 지점이 없습니다.' });

  // 대상 제품 목록
  let productsQ = sb.from('products').select('id, name').eq('is_active', true);
  if (args.product_name) productsQ = productsQ.ilike('name', `%${args.product_name}%`);
  const { data: products } = await productsQ;
  if (!products?.length) return JSON.stringify({ error: '대상 제품이 없습니다.' });

  const typeLabel: Record<string, string> = { IN: '입고', OUT: '출고', ADJUST: '실사' };
  const memo = args.memo || `AI 대량 ${typeLabel[args.movement_type] || args.movement_type}`;

  let successCount = 0;
  let failCount = 0;
  const errors: string[] = [];

  for (const branch of branches as any[]) {
    for (const product of products as any[]) {
      try {
        const { data: inv } = await sb.from('inventories')
          .select('id, quantity')
          .eq('branch_id', branch.id)
          .eq('product_id', product.id)
          .single();

        const current = (inv as any)?.quantity ?? 0;
        let newQty: number;

        if (args.movement_type === 'IN') {
          newQty = current + args.quantity;
        } else if (args.movement_type === 'OUT') {
          if (current < args.quantity) {
            errors.push(`${branch.name}/${product.name}: 재고 부족 (현재 ${current}개)`);
            failCount++;
            continue;
          }
          newQty = current - args.quantity;
        } else {
          newQty = args.quantity; // ADJUST
        }

        if (inv) {
          await sb.from('inventories').update({ quantity: newQty }).eq('id', (inv as any).id);
        } else {
          await sb.from('inventories').insert({
            branch_id: branch.id, product_id: product.id, quantity: newQty, safety_stock: 0,
          });
        }

        await sb.from('inventory_movements').insert({
          branch_id: branch.id, product_id: product.id,
          movement_type: args.movement_type,
          quantity: args.movement_type === 'OUT' ? -args.quantity : args.quantity,
          memo,
        });

        successCount++;
      } catch (e: any) {
        errors.push(`${branch.name}/${product.name}: ${e.message}`);
        failCount++;
      }
    }
  }

  return JSON.stringify({
    성공: true,
    메시지: `대량 재고 ${typeLabel[args.movement_type] || args.movement_type} 완료`,
    대상지점수: branches.length,
    대상제품수: products.length,
    처리성공: `${successCount}건`,
    처리실패: failCount > 0 ? `${failCount}건` : '없음',
    오류상세: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
}

async function execAdjustInventory(sb: any, args: { branch_name: string; product_name: string; movement_type: string; quantity: number; memo?: string }, ctx: ToolContext): Promise<string> {
  const r = await resolveBranchForWrite(sb, ctx, args.branch_name);
  if (!r.ok) return JSON.stringify({ error: r.error });
  const branch = r.branch;

  const product = await findProduct(sb, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  const { data: inv } = await sb.from('inventories').select('id, quantity').eq('branch_id', branch.id).eq('product_id', product.id).single();

  let newQty: number;
  const current = (inv as any)?.quantity || 0;

  if (args.movement_type === 'IN') newQty = current + args.quantity;
  else if (args.movement_type === 'OUT') {
    if (current < args.quantity) return JSON.stringify({ error: `재고 부족. 현재: ${current}개, 요청: ${args.quantity}개` });
    newQty = current - args.quantity;
  } else {
    newQty = args.quantity; // ADJUST
  }

  if (inv) {
    await sb.from('inventories').update({ quantity: newQty }).eq('id', (inv as any).id);
  } else {
    await sb.from('inventories').insert({ branch_id: branch.id, product_id: product.id, quantity: newQty, safety_stock: 0 });
  }

  const typeLabel: Record<string, string> = { IN: '입고', OUT: '출고', ADJUST: '재고실사' };
  await sb.from('inventory_movements').insert({
    branch_id: branch.id, product_id: product.id,
    movement_type: args.movement_type,
    quantity: args.movement_type === 'OUT' ? -args.quantity : args.quantity,
    memo: (args.memo || `AI 에이전트 ${typeLabel[args.movement_type] || args.movement_type}`),
  });

  return JSON.stringify({
    성공: true,
    메시지: `${branch.name} · ${product.name} ${typeLabel[args.movement_type] || args.movement_type} ${args.quantity}개 처리 완료`,
    이전재고: current, 변경후재고: newQty,
  });
}

async function execTransferInventory(sb: any, args: { from_branch_name: string; to_branch_name: string; product_name: string; quantity: number }, ctx: ToolContext): Promise<string> {
  const from = await findBranch(sb, args.from_branch_name);
  if (!from) return JSON.stringify({ error: `출발 지점 "${args.from_branch_name}" 없음` });
  const to = await findBranch(sb, args.to_branch_name);
  if (!to) return JSON.stringify({ error: `도착 지점 "${args.to_branch_name}" 없음` });
  // Staff: 출발 지점이 본인 지점이어야 함
  if (isStaffRole(ctx.userRole)) {
    const denied = assertBranchAccess(ctx, from.id, from.name);
    if (denied) return denied;
  }
  const product = await findProduct(sb, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  const { data: srcInv } = await sb.from('inventories').select('id, quantity').eq('branch_id', from.id).eq('product_id', product.id).single();
  if (!(srcInv as any) || (srcInv as any).quantity < args.quantity) {
    return JSON.stringify({ error: `${from.name} 재고 부족. 현재: ${(srcInv as any)?.quantity ?? 0}개, 요청: ${args.quantity}개` });
  }

  await sb.from('inventories').update({ quantity: (srcInv as any).quantity - args.quantity }).eq('id', (srcInv as any).id);

  const { data: dstInv } = await sb.from('inventories').select('id, quantity').eq('branch_id', to.id).eq('product_id', product.id).single();
  if (dstInv) {
    await sb.from('inventories').update({ quantity: (dstInv as any).quantity + args.quantity }).eq('id', (dstInv as any).id);
  } else {
    await sb.from('inventories').insert({ branch_id: to.id, product_id: product.id, quantity: args.quantity, safety_stock: 0 });
  }

  const now = new Date().toISOString();
  await sb.from('inventory_movements').insert([
    { branch_id: from.id, product_id: product.id, movement_type: 'TRANSFER', quantity: -args.quantity, memo: `이동출고 → ${to.name} (AI)`, created_at: now },
    { branch_id: to.id, product_id: product.id, movement_type: 'TRANSFER', quantity: args.quantity, memo: `이동입고 ← ${from.name} (AI)`, created_at: now },
  ]);

  return JSON.stringify({
    성공: true,
    메시지: `${product.name} ${args.quantity}개 이동 완료 (${from.name} → ${to.name})`,
    출발지잔여: (srcInv as any).quantity - args.quantity,
  });
}

// ── 고객 쓰기 ────────────────────────────────────────────────────────────────

async function execCreateCustomer(sb: any, args: any): Promise<string> {
  const { error } = await sb.from('customers').insert({
    name: args.name, phone: args.phone,
    grade: args.grade || 'NORMAL',
    email: args.email || null, address: args.address || null,
    health_note: args.health_note || null, is_active: true,
  });
  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate'))
      return JSON.stringify({ error: `${args.phone}은 이미 등록된 번호입니다.` });
    return JSON.stringify({ error: error.message });
  }
  return JSON.stringify({ 성공: true, 메시지: `${args.name} 고객 등록 완료` });
}

async function execUpdateCustomer(sb: any, args: any): Promise<string> {
  const customer = await findCustomer(sb, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const updates: Record<string, any> = {};
  if (args.new_phone !== undefined) updates.phone = args.new_phone;
  if (args.email !== undefined) updates.email = args.email;
  if (args.address !== undefined) updates.address = args.address;
  if (args.health_note !== undefined) updates.health_note = args.health_note;
  if (args.grade !== undefined) updates.grade = args.grade;

  const { error } = await sb.from('customers').update(updates).eq('id', customer.id);
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ 성공: true, 메시지: `${customer.name} 고객 정보 수정 완료` });
}

async function execAddCustomerConsultation(sb: any, args: any): Promise<string> {
  const customer = await findCustomer(sb, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const { error } = await sb.from('customer_consultations').insert({
    customer_id: customer.id,
    consultation_type: args.consultation_type,
    content: { text: args.content },
    consulted_by: null,
  });
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    성공: true,
    메시지: `${customer.name} 고객 상담 기록 추가 완료`,
    상담유형: args.consultation_type,
    내용: args.content,
  });
}

async function execUpdateCustomerGrade(sb: any, args: any): Promise<string> {
  const customer = await findCustomer(sb, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const gradeLabels: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
  await sb.from('customers').update({ grade: args.new_grade }).eq('id', customer.id);
  return JSON.stringify({
    성공: true,
    메시지: `${customer.name} 등급 변경 완료: ${gradeLabels[customer.grade] || customer.grade} → ${gradeLabels[args.new_grade] || args.new_grade}`,
  });
}

async function execUpgradeCustomerGrades(sb: any, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '전체 고객 등급 자동 업그레이드');
  if (denied) return denied;
  const { data: customers } = await sb.from('customers').select('id, name, grade').eq('is_active', true);
  if (!customers?.length) return JSON.stringify({ 결과: '활성 고객 없음' });

  let upgraded = 0;
  const details: string[] = [];
  const gradeLabels: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };

  for (const c of customers as any[]) {
    const { data: orders } = await sb.from('sales_orders')
      .select('total_amount').eq('customer_id', c.id).eq('status', 'COMPLETED');
    const total = ((orders || []) as any[]).reduce((s: number, o: any) => s + (o.total_amount || 0), 0);

    let newGrade = c.grade;
    if (total >= 3_000_000 && c.grade !== 'VVIP') newGrade = 'VVIP';
    else if (total >= 1_000_000 && c.grade === 'NORMAL') newGrade = 'VIP';

    if (newGrade !== c.grade) {
      await sb.from('customers').update({ grade: newGrade }).eq('id', c.id);
      upgraded++;
      details.push(`${c.name}: ${gradeLabels[c.grade]} → ${gradeLabels[newGrade]} (누적 ${total.toLocaleString()}원)`);
    }
  }

  return JSON.stringify({
    성공: true,
    업그레이드건수: upgraded,
    메시지: upgraded > 0 ? `${upgraded}명 등급 업그레이드 완료` : '업그레이드 대상 없음',
    상세: details,
  });
}

async function execAdjustPoints(sb: any, args: any): Promise<string> {
  const customer = await findCustomer(sb, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const current = await getPoints(sb, customer.id);
  const newBalance = current + args.points;
  if (newBalance < 0) return JSON.stringify({ error: `포인트 부족. 현재: ${current}P, 차감: ${Math.abs(args.points)}P` });

  await sb.from('point_history').insert({
    customer_id: customer.id, type: 'adjust',
    points: args.points, balance: newBalance,
    description: `${args.reason} (AI 에이전트)`,
  });

  return JSON.stringify({
    성공: true,
    메시지: `${customer.name} 포인트 ${args.points > 0 ? '+' : ''}${args.points}P 조정 완료`,
    이전잔액: `${current}P`, 변경후잔액: `${newBalance}P`,
  });
}

// ── 지점/제품 쓰기 ───────────────────────────────────────────────────────────

async function execCreateBranch(sb: any, args: any, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '지점 생성');
  if (denied) return denied;
  const code = 'BR-' + Date.now().toString(36).toUpperCase();
  const { error } = await sb.from('branches').insert({
    name: args.name, code, channel: args.channel,
    address: args.address || null, phone: args.phone || null, is_active: true,
  });
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ 성공: true, 메시지: `${args.name} 지점 추가 완료`, 지점코드: code });
}

async function execUpdateBranch(sb: any, args: any, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '지점 정보 수정');
  if (denied) return denied;
  const branch = await findBranch(sb, args.branch_name);
  if (!branch) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });

  const updates: Record<string, any> = {};
  if (args.new_name !== undefined) updates.name = args.new_name;
  if (args.address !== undefined) updates.address = args.address;
  if (args.phone !== undefined) updates.phone = args.phone;
  if (args.is_active !== undefined) updates.is_active = args.is_active;

  const { error } = await sb.from('branches').update(updates).eq('id', branch.id);
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ 성공: true, 메시지: `${branch.name} 지점 수정 완료` });
}

async function execCreateProduct(sb: any, args: any, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '제품 등록');
  if (denied) return denied;
  const code = `KYO-${Date.now().toString(36).toUpperCase()}`;
  const { data: product, error } = await sb.from('products').insert({
    name: args.name, code, price: args.price,
    cost: args.cost || null, unit: args.unit || '개',
    barcode: args.barcode || null, is_active: true,
  }).select('id').single();

  if (error) return JSON.stringify({ error: error.message });

  // 모든 활성 지점에 재고 레코드 생성
  const { data: branches } = await sb.from('branches').select('id').eq('is_active', true);
  if (branches?.length && (product as any)?.id) {
    const invRecords = (branches as any[]).map(b => ({
      branch_id: b.id, product_id: (product as any).id, quantity: 0, safety_stock: 0,
    }));
    await sb.from('inventories').insert(invRecords);
  }

  return JSON.stringify({ 성공: true, 메시지: `${args.name} 제품 등록 완료`, 제품코드: code });
}

// ── 매입(발주) 쓰기 ──────────────────────────────────────────────────────────

async function execCreatePurchaseOrder(sb: any, args: any, ctx: ToolContext): Promise<string> {
  // 공급업체 찾기
  const { data: supplier } = await sb.from('suppliers').select('id, name').ilike('name', `%${args.supplier_name}%`).eq('is_active', true).limit(1).single();
  if (!supplier) return JSON.stringify({ error: `공급업체 "${args.supplier_name}" 없음. get_suppliers로 목록 확인 후 정확한 이름 사용.` });

  const br = await resolveBranchForWrite(sb, ctx, args.branch_name);
  if (!br.ok) return JSON.stringify({ error: br.error });
  const branch = br.branch;

  const product = await findProduct(sb, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  const orderNumber = `PO-${today}-${suffix}`;
  const totalAmount = args.quantity * args.unit_price;

  const { data: po, error } = await (sb as any).from('purchase_orders').insert({
    order_number: orderNumber,
    supplier_id: (supplier as any).id,
    branch_id: branch.id,
    status: 'DRAFT',
    total_amount: totalAmount,
    ordered_at: new Date().toISOString(),
    memo: args.memo || null,
  }).select('id').single();

  if (error) return JSON.stringify({ error: error.message });

  await (sb as any).from('purchase_order_items').insert({
    purchase_order_id: (po as any).id,
    product_id: product.id,
    ordered_quantity: args.quantity,
    received_quantity: 0,
    unit_price: args.unit_price,
  });

  return JSON.stringify({
    성공: true,
    메시지: `발주서 작성 완료 (초안 상태)`,
    발주번호: orderNumber,
    공급업체: (supplier as any).name,
    제품: product.name,
    수량: args.quantity,
    단가: `${args.unit_price.toLocaleString()}원`,
    합계: `${totalAmount.toLocaleString()}원`,
    안내: '확정하려면 confirm_purchase_order를 사용하세요.',
  });
}

async function execConfirmPurchaseOrder(sb: any, args: { order_number: string }, ctx: ToolContext): Promise<string> {
  const { data: po } = await (sb as any).from('purchase_orders').select('id, status, order_number, branch_id, branches(name)').eq('order_number', args.order_number).single();
  if (!po) return JSON.stringify({ error: `발주서 "${args.order_number}" 없음` });
  const denied1 = assertBranchAccess(ctx, (po as any).branch_id, (po as any).branches?.name || '지점');
  if (denied1) return denied1;
  if ((po as any).status !== 'DRAFT') return JSON.stringify({ error: `이미 "${(po as any).status}" 상태. DRAFT 상태만 확정 가능.` });

  const { error } = await (sb as any).from('purchase_orders').update({ status: 'CONFIRMED' }).eq('id', (po as any).id);
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({ 성공: true, 메시지: `발주서 ${args.order_number} 확정 완료. 이제 입고 처리 가능.` });
}

async function execReceivePurchaseOrder(sb: any, args: { order_number: string; memo?: string }, ctx: ToolContext): Promise<string> {
  const { data: po } = await (sb as any).from('purchase_orders')
    .select('id, status, branch_id, order_number, branches(name)')
    .eq('order_number', args.order_number).single();
  if (!po) return JSON.stringify({ error: `발주서 "${args.order_number}" 없음` });
  const denied2 = assertBranchAccess(ctx, (po as any).branch_id, (po as any).branches?.name || '지점');
  if (denied2) return denied2;
  if (!['CONFIRMED', 'PARTIALLY_RECEIVED'].includes((po as any).status))
    return JSON.stringify({ error: `입고 불가 상태: ${(po as any).status}. CONFIRMED 또는 PARTIALLY_RECEIVED 상태만 가능.` });

  // 발주 항목 가져오기
  const { data: items } = await (sb as any).from('purchase_order_items')
    .select('id, product_id, ordered_quantity, received_quantity, unit_price, products(name)')
    .eq('purchase_order_id', (po as any).id);

  if (!items?.length) return JSON.stringify({ error: '발주 항목이 없습니다.' });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  const receiptNumber = `GR-${today}-${suffix}`;

  // 입고 전표 생성
  const totalAmount = (items as any[]).reduce((s, i) => s + i.unit_price * i.ordered_quantity, 0);
  const { data: receipt, error: receiptErr } = await (sb as any).from('purchase_receipts').insert({
    purchase_order_id: (po as any).id,
    receipt_number: receiptNumber,
    branch_id: (po as any).branch_id,
    total_amount: totalAmount,
    received_at: new Date().toISOString(),
    memo: args.memo || `AI 에이전트 입고 처리`,
  }).select('id').single();
  if (receiptErr) return JSON.stringify({ error: receiptErr.message });

  // 각 항목 입고 처리
  const receivedDetails: string[] = [];
  for (const item of items as any[]) {
    const qty = item.ordered_quantity - item.received_quantity;
    if (qty <= 0) continue;

    // 입고 항목 생성
    await (sb as any).from('purchase_receipt_items').insert({
      purchase_receipt_id: (receipt as any).id,
      product_id: item.product_id,
      quantity: qty, unit_price: item.unit_price,
    });

    // 재고 증가
    const { data: inv } = await sb.from('inventories').select('id, quantity').eq('branch_id', (po as any).branch_id).eq('product_id', item.product_id).single();
    if (inv) {
      await sb.from('inventories').update({ quantity: (inv as any).quantity + qty }).eq('id', (inv as any).id);
    } else {
      await sb.from('inventories').insert({ branch_id: (po as any).branch_id, product_id: item.product_id, quantity: qty, safety_stock: 0 });
    }

    // 재고 이동 기록
    await sb.from('inventory_movements').insert({
      branch_id: (po as any).branch_id, product_id: item.product_id,
      movement_type: 'IN', quantity: qty,
      reference_id: (po as any).id, reference_type: 'PURCHASE_RECEIPT',
      memo: `입고 ${receiptNumber} (AI)`,
    });

    // 발주 항목 수량 업데이트
    await (sb as any).from('purchase_order_items').update({ received_quantity: item.ordered_quantity }).eq('id', item.id);
    receivedDetails.push(`${item.products?.name} ${qty}개`);
  }

  // 발주서 상태 완료로 변경
  await (sb as any).from('purchase_orders').update({ status: 'RECEIVED' }).eq('id', (po as any).id);

  return JSON.stringify({
    성공: true,
    메시지: `${args.order_number} 입고 처리 완료`,
    입고전표: receiptNumber,
    입고항목: receivedDetails,
    지점: (po as any).branches?.name,
  });
}

// ── 생산 쓰기 ────────────────────────────────────────────────────────────────

async function execCreateProductionOrder(sb: any, args: any, ctx: ToolContext): Promise<string> {
  const product = await findProduct(sb, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  const br3 = await resolveBranchForWrite(sb, ctx, args.branch_name);
  if (!br3.ok) return JSON.stringify({ error: br3.error });
  const branch = br3.branch;

  // BOM 확인
  const { data: bom } = await (sb as any).from('bom')
    .select('quantity_required, products!bom_material_id_fkey(name)')
    .eq('product_id', product.id);
  if (!bom?.length) return JSON.stringify({ error: `${product.name}의 BOM(원재료 목록)이 없습니다. 생산 메뉴에서 BOM을 먼저 등록하세요.` });

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  const orderNumber = `WO-${today}-${suffix}`;

  const { error } = await (sb as any).from('production_orders').insert({
    order_number: orderNumber,
    product_id: product.id,
    branch_id: branch.id,
    quantity: args.quantity,
    status: 'PENDING',
    memo: args.memo || null,
  });
  if (error) return JSON.stringify({ error: error.message });

  const bomSummary = (bom as any[]).map(b => `${b.products?.name} × ${b.quantity_required * args.quantity}`).join(', ');
  return JSON.stringify({
    성공: true,
    메시지: `생산 지시서 생성 완료`,
    지시번호: orderNumber,
    제품: product.name, 수량: args.quantity, 지점: branch.name,
    소요재료: bomSummary,
    안내: '착수하려면 start_production_order를 사용하세요.',
  });
}

async function execStartProductionOrder(sb: any, args: { order_number: string }, ctx: ToolContext): Promise<string> {
  const { data: po } = await (sb as any).from('production_orders').select('id, status, branch_id, branches(name)').eq('order_number', args.order_number).single();
  if (!po) return JSON.stringify({ error: `생산 지시서 "${args.order_number}" 없음` });
  const d = assertBranchAccess(ctx, (po as any).branch_id, (po as any).branches?.name || '지점');
  if (d) return d;
  if ((po as any).status !== 'PENDING') return JSON.stringify({ error: `현재 상태: ${(po as any).status}. PENDING 상태만 착수 가능.` });

  await (sb as any).from('production_orders').update({ status: 'IN_PROGRESS', started_at: new Date().toISOString() }).eq('id', (po as any).id);
  return JSON.stringify({ 성공: true, 메시지: `${args.order_number} 생산 착수 완료 (PENDING → 진행중)` });
}

async function execCompleteProductionOrder(sb: any, args: { order_number: string }, ctx: ToolContext): Promise<string> {
  const { data: po } = await (sb as any).from('production_orders')
    .select('id, status, product_id, branch_id, quantity, products(name), branches(name)')
    .eq('order_number', args.order_number).single();

  if (!po) return JSON.stringify({ error: `생산 지시서 "${args.order_number}" 없음` });
  const dd = assertBranchAccess(ctx, (po as any).branch_id, (po as any).branches?.name || '지점');
  if (dd) return dd;
  if ((po as any).status !== 'IN_PROGRESS') return JSON.stringify({ error: `현재 상태: ${(po as any).status}. IN_PROGRESS 상태만 완료 가능.` });

  // BOM 조회
  const { data: bom } = await (sb as any).from('bom')
    .select('material_id, quantity_required, products!bom_material_id_fkey(name)')
    .eq('product_id', (po as any).product_id);

  if (!bom?.length) return JSON.stringify({ error: 'BOM이 없어 완료 처리 불가' });

  // 원재료 재고 확인
  for (const item of bom as any[]) {
    const needed = item.quantity_required * (po as any).quantity;
    const { data: inv } = await sb.from('inventories').select('quantity').eq('branch_id', (po as any).branch_id).eq('product_id', item.material_id).single();
    if (!(inv as any) || (inv as any).quantity < needed) {
      return JSON.stringify({ error: `재료 부족: ${item.products?.name} 필요 ${needed}개, 현재 ${(inv as any)?.quantity ?? 0}개` });
    }
  }

  // 원재료 차감
  for (const item of bom as any[]) {
    const needed = item.quantity_required * (po as any).quantity;
    const { data: inv } = await sb.from('inventories').select('id, quantity').eq('branch_id', (po as any).branch_id).eq('product_id', item.material_id).single();
    await sb.from('inventories').update({ quantity: (inv as any).quantity - needed }).eq('id', (inv as any).id);
    await sb.from('inventory_movements').insert({
      branch_id: (po as any).branch_id, product_id: item.material_id,
      movement_type: 'PRODUCTION', quantity: -needed,
      reference_id: (po as any).id, reference_type: 'PRODUCTION',
      memo: `생산 원재료 사용 ${args.order_number} (AI)`,
    });
  }

  // 완제품 재고 증가
  const { data: finInv } = await sb.from('inventories').select('id, quantity').eq('branch_id', (po as any).branch_id).eq('product_id', (po as any).product_id).single();
  if (finInv) {
    await sb.from('inventories').update({ quantity: (finInv as any).quantity + (po as any).quantity }).eq('id', (finInv as any).id);
  } else {
    await sb.from('inventories').insert({ branch_id: (po as any).branch_id, product_id: (po as any).product_id, quantity: (po as any).quantity, safety_stock: 0 });
  }
  await sb.from('inventory_movements').insert({
    branch_id: (po as any).branch_id, product_id: (po as any).product_id,
    movement_type: 'PRODUCTION', quantity: (po as any).quantity,
    reference_id: (po as any).id, reference_type: 'PRODUCTION',
    memo: `생산 완제품 입고 ${args.order_number} (AI)`,
  });

  // 상태 완료
  await (sb as any).from('production_orders').update({ status: 'COMPLETED', completed_at: new Date().toISOString() }).eq('id', (po as any).id);

  return JSON.stringify({
    성공: true,
    메시지: `${args.order_number} 생산 완료 처리`,
    완제품: (po as any).products?.name, 생산량: (po as any).quantity,
    지점: (po as any).branches?.name,
    처리내용: '원재료 재고 차감 + 완제품 재고 증가 완료',
  });
}

// ── SMS 발송 ─────────────────────────────────────────────────────────────────

async function execSendSms(sb: any, args: { customer_name?: string; phone?: string; message: string }): Promise<string> {
  const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
  const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
  const SOLAPI_SENDER = process.env.SOLAPI_SENDER_PHONE;

  let recipientPhone = args.phone;
  let recipientName = '';

  if (!recipientPhone && args.customer_name) {
    const customer = await findCustomer(sb, { name: args.customer_name });
    if (!customer) return JSON.stringify({ error: `고객 "${args.customer_name}"을 찾을 수 없습니다.` });
    recipientPhone = customer.phone;
    recipientName = customer.name;
  }

  if (!recipientPhone) return JSON.stringify({ error: '수신자 전화번호 또는 고객 이름이 필요합니다.' });

  // Solapi 미설정 시 즉시 에러 (DB에 잘못된 'sent' 기록 방지)
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
    return JSON.stringify({
      error: 'SMS 발송 미설정 — 관리자에게 Solapi 환경변수(SOLAPI_API_KEY/SECRET/SENDER_PHONE) 설정을 요청하세요.',
    });
  }

  // DB 기록 (pending)
  if (recipientName) {
    const { data: cust } = await sb.from('customers').select('id').eq('phone', recipientPhone).single();
    if (cust) {
      await sb.from('notifications').insert({
        customer_id: (cust as any).id,
        type: 'SMS',
        message: args.message,
        status: 'pending',
        sent_at: new Date().toISOString(),
      });
    }
  }

  // Solapi 발송
  try {
    const date = new Date().toISOString();
    const salt = Math.random().toString(36).substring(2, 12);
    const hmacData = date + salt;
    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', SOLAPI_API_SECRET).update(hmacData).digest('hex');

    const msgType = Buffer.byteLength(args.message, 'utf8') > 90 ? 'LMS' : 'SMS';

    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({
        message: { to: recipientPhone, from: SOLAPI_SENDER, text: args.message, type: msgType },
      }),
    });

    const result = await res.json() as any;

    if (result.errorCode || !res.ok) {
      return JSON.stringify({ error: `Solapi 발송 오류: ${result.errorMessage || result.errorCode || '알 수 없는 오류'}` });
    }

    return JSON.stringify({
      성공: true,
      메시지: `SMS 발송 완료`,
      수신자: recipientPhone, 내용미리보기: args.message.slice(0, 30) + (args.message.length > 30 ? '...' : ''),
    });
  } catch (e: any) {
    return JSON.stringify({ error: `발송 오류: ${e.message}` });
  }
}

// ── 일괄 SMS ─────────────────────────────────────────────────────────────────

async function execBulkSendSms(sb: any, args: { grade: string; message: string; branch_name?: string }, ctx: ToolContext): Promise<string> {
  let q = sb.from('customers').select('id, name, phone, grade').eq('is_active', true);
  if (args.grade !== 'ALL') q = q.eq('grade', args.grade);
  // Staff는 본인 지점으로 강제
  if (isStaffRole(ctx.userRole)) {
    if (!ctx.branchId) return JSON.stringify({ error: '담당 지점이 지정되지 않았습니다.' });
    q = q.eq('primary_branch_id', ctx.branchId);
  } else if (args.branch_name) {
    const branch = await findBranch(sb, args.branch_name);
    if (!branch) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    q = q.eq('primary_branch_id', branch.id);
  }
  const { data: customers, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!customers?.length) return JSON.stringify({ error: '발송 대상 고객이 없습니다.' });

  const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
  const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
  const SOLAPI_SENDER = process.env.SOLAPI_SENDER_PHONE;

  const gradeLabel: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP', ALL: '전체' };

  // Solapi 미설정 시 즉시 에러 — 가짜 성공 표시 방지
  if (!SOLAPI_API_KEY || !SOLAPI_API_SECRET || !SOLAPI_SENDER) {
    return JSON.stringify({
      error: 'SMS 발송 미설정 — 관리자에게 Solapi 환경변수(SOLAPI_API_KEY/SECRET/SENDER_PHONE) 설정을 요청하세요.',
    });
  }

  const now = new Date().toISOString();
  const notifications = (customers as any[]).map(c => ({
    customer_id: c.id,
    type: 'SMS',
    message: args.message,
    status: 'pending',
    sent_at: now,
  }));

  // DB 기록 (배치 삽입)
  await sb.from('notifications').insert(notifications);

  // Solapi 일괄 발송
  try {
    const date = new Date().toISOString();
    const salt = Math.random().toString(36).substring(2, 12);
    const { createHmac } = await import('crypto');
    const signature = createHmac('sha256', SOLAPI_API_SECRET).update(date + salt).digest('hex');
    const msgType = Buffer.byteLength(args.message, 'utf8') > 90 ? 'LMS' : 'SMS';

    const messages = (customers as any[]).map(c => ({ to: c.phone, from: SOLAPI_SENDER, text: args.message, type: msgType }));

    const res = await fetch('https://api.solapi.com/messages/v4/send-many', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
      },
      body: JSON.stringify({ messages }),
    });

    const result = await res.json() as any;
    if (result.errorCode) return JSON.stringify({ error: `Solapi 오류: ${result.errorMessage}` });

    return JSON.stringify({
      성공: true,
      메시지: `일괄 SMS 발송 완료`,
      대상등급: gradeLabel[args.grade] || args.grade,
      발송대상: `${customers.length}명`,
    });
  } catch (e: any) {
    return JSON.stringify({ error: `발송 오류: ${e.message}` });
  }
}

// ── 발주 생성+확정 ────────────────────────────────────────────────────────────

async function execCreateAndConfirmPurchaseOrder(sb: any, args: {
  supplier_name: string; branch_name: string; product_name: string;
  quantity: number; unit_price: number; memo?: string;
}, ctx: ToolContext): Promise<string> {
  // 공급업체 조회
  const { data: supplier } = await sb.from('suppliers').select('id, name').ilike('name', `%${args.supplier_name}%`).eq('is_active', true).limit(1).single();
  if (!supplier) return JSON.stringify({ error: `공급업체 "${args.supplier_name}" 없음` });

  const br2 = await resolveBranchForWrite(sb, ctx, args.branch_name);
  if (!br2.ok) return JSON.stringify({ error: br2.error });
  const branch = br2.branch;

  const product = await findProduct(sb, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  const total = args.quantity * args.unit_price;
  const { data: dateRow } = await sb.from('purchase_orders').select('order_number').ilike('order_number', 'PO-%').order('created_at', { ascending: false }).limit(1).single();
  const nextNum = dateRow ? String(parseInt((dateRow as any).order_number.replace('PO-', '')) + 1).padStart(6, '0') : '000001';
  const orderNumber = `PO-${nextNum}`;

  const { error: poErr } = await sb.from('purchase_orders').insert({
    order_number: orderNumber,
    supplier_id: (supplier as any).id,
    branch_id: branch.id,
    status: 'CONFIRMED',
    total_amount: total,
    memo: args.memo || null,
  });
  if (poErr) return JSON.stringify({ error: poErr.message });

  const { data: po } = await sb.from('purchase_orders').select('id').eq('order_number', orderNumber).single();
  await sb.from('purchase_order_items').insert({
    purchase_order_id: (po as any).id,
    product_id: product.id,
    ordered_quantity: args.quantity,
    received_quantity: 0,
    unit_price: args.unit_price,
  });

  return JSON.stringify({
    성공: true,
    메시지: '발주서 작성 및 확정 완료',
    발주번호: orderNumber,
    공급업체: (supplier as any).name,
    지점: branch.name,
    제품: product.name,
    수량: args.quantity,
    단가: args.unit_price.toLocaleString(),
    합계: `${total.toLocaleString()}원`,
    상태: 'CONFIRMED',
    안내: '입고 처리는 receive_purchase_order를 사용하세요.',
  });
}

// ── 자동 재고 보충 ────────────────────────────────────────────────────────────

async function execReplenishLowStock(sb: any, args: {
  branch_name?: string; fill_to_safety?: boolean; fixed_quantity?: number; memo?: string;
}, ctx: ToolContext): Promise<string> {
  let branchIds: string[] | null = null;

  if (isStaffRole(ctx.userRole)) {
    if (!ctx.branchId) return JSON.stringify({ error: '담당 지점이 지정되지 않았습니다.' });
    branchIds = [ctx.branchId];
  } else if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchIds = [b.id];
  }

  let q = sb.from('inventories').select('id, quantity, safety_stock, branch_id, product_id, branches(name), products(name)');
  if (branchIds) q = q.in('branch_id', branchIds);
  const { data: allInv } = await q;

  const lowItems = ((allInv || []) as any[]).filter(i => i.quantity < i.safety_stock);
  if (!lowItems.length) return JSON.stringify({ 결과: '안전재고 미달 품목 없음 — 모든 재고가 정상입니다.' });

  const fillToSafety = args.fill_to_safety !== false;
  const memo = args.memo || 'AI 자동 재고 보충';
  let successCount = 0;

  for (const item of lowItems) {
    const addQty = fillToSafety
      ? item.safety_stock - item.quantity
      : (args.fixed_quantity || item.safety_stock - item.quantity);

    if (addQty <= 0) continue;

    await sb.from('inventories').update({ quantity: item.quantity + addQty }).eq('id', item.id);
    await sb.from('inventory_movements').insert({
      branch_id: item.branch_id, product_id: item.product_id,
      movement_type: 'IN', quantity: addQty, memo,
    });
    successCount++;
  }

  return JSON.stringify({
    성공: true,
    메시지: `부족 품목 ${successCount}개 자동 보충 완료`,
    처리건수: successCount,
    기준: fillToSafety ? '안전재고 수준까지' : `고정 ${args.fixed_quantity}개`,
    상세: lowItems.slice(0, 8).map(i => {
      const addQty = fillToSafety ? i.safety_stock - i.quantity : (args.fixed_quantity || i.safety_stock - i.quantity);
      return `${i.branches?.name}/${i.products?.name}: +${addQty}개`;
    }),
  });
}

// ── 상위 제품 조회 ────────────────────────────────────────────────────────────

async function execGetTopProducts(sb: any, args: { start_date?: string; end_date?: string; limit?: number; branch_name?: string }): Promise<string> {
  const now = new Date();
  const startDate = args.start_date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endDate = args.end_date || now.toISOString().slice(0, 10);
  const limit = args.limit || 10;

  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  let q = sb.from('sales_order_items')
    .select('quantity, total_price, product_id, products(name, code), sales_orders!inner(ordered_at, branch_id, status)')
    .gte('sales_orders.ordered_at', `${startDate}T00:00:00`)
    .lte('sales_orders.ordered_at', `${endDate}T23:59:59`)
    .eq('sales_orders.status', 'COMPLETED');

  if (branchId) q = q.eq('sales_orders.branch_id', branchId);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '해당 기간 판매 데이터 없음' });

  // 제품별 집계
  const map = new Map<string, { name: string; code: string; qty: number; revenue: number }>();
  for (const item of data as any[]) {
    const pid = item.product_id;
    if (!map.has(pid)) map.set(pid, { name: item.products?.name || pid, code: item.products?.code || '', qty: 0, revenue: 0 });
    const entry = map.get(pid)!;
    entry.qty += item.quantity;
    entry.revenue += item.total_price;
  }

  const sorted = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  return JSON.stringify({
    기간: `${startDate} ~ ${endDate}`,
    상위제품: sorted.map((p, i) => ({
      순위: i + 1, 제품명: p.name, 코드: p.code,
      판매량: `${p.qty}개`,
      매출: `${p.revenue.toLocaleString()}원`,
    })),
  });
}

// ── 매출 비교 ─────────────────────────────────────────────────────────────────

async function execCompareSales(sb: any, args: {
  period1_start: string; period1_end: string;
  period2_start: string; period2_end: string;
  branch_name?: string;
}): Promise<string> {
  let branchId: string | null = null;
  if (args.branch_name) {
    const b = await findBranch(sb, args.branch_name);
    if (!b) return JSON.stringify({ error: `지점 "${args.branch_name}" 없음` });
    branchId = b.id;
  }

  async function periodSummary(start: string, end: string) {
    let q = sb.from('sales_orders')
      .select('total_amount, discount_amount, points_used')
      .eq('status', 'COMPLETED')
      .gte('ordered_at', `${start}T00:00:00`)
      .lte('ordered_at', `${end}T23:59:59`);
    if (branchId) q = q.eq('branch_id', branchId);
    const { data } = await q;
    const orders = (data || []) as any[];
    const revenue = orders.reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
    const discount = orders.reduce((s: number, o: any) => s + (o.discount_amount || 0), 0);
    return { 건수: orders.length, 매출: revenue, 할인: discount };
  }

  const [p1, p2] = await Promise.all([
    periodSummary(args.period1_start, args.period1_end),
    periodSummary(args.period2_start, args.period2_end),
  ]);

  const diff = p1.매출 - p2.매출;
  const diffPct = p2.매출 > 0 ? ((diff / p2.매출) * 100).toFixed(1) : 'N/A';

  return JSON.stringify({
    비교결과: {
      기간1: { 날짜: `${args.period1_start} ~ ${args.period1_end}`, ...p1, 매출표시: `${p1.매출.toLocaleString()}원` },
      기간2: { 날짜: `${args.period2_start} ~ ${args.period2_end}`, ...p2, 매출표시: `${p2.매출.toLocaleString()}원` },
    },
    증감: `${diff >= 0 ? '+' : ''}${diff.toLocaleString()}원 (${diff >= 0 ? '+' : ''}${diffPct}%)`,
    분석: diff > 0 ? '기간1이 기간2보다 매출이 높습니다.' : diff < 0 ? '기간1이 기간2보다 매출이 낮습니다.' : '두 기간 매출이 동일합니다.',
  });
}

// ── 제품 수정 ─────────────────────────────────────────────────────────────────

async function execUpdateProduct(sb: any, args: {
  product_name: string; new_price?: number; new_cost?: number; new_name?: string; new_unit?: string;
}, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '제품 정보 수정');
  if (denied) return denied;
  const product = await findProduct(sb, args.product_name);
  if (!product) return JSON.stringify({ error: `제품 "${args.product_name}" 없음` });

  const updates: Record<string, any> = {};
  if (args.new_price !== undefined) updates.price = args.new_price;
  if (args.new_cost !== undefined) updates.cost = args.new_cost;
  if (args.new_name !== undefined) updates.name = args.new_name;
  if (args.new_unit !== undefined) updates.unit = args.new_unit;

  if (Object.keys(updates).length === 0) return JSON.stringify({ error: '변경할 내용이 없습니다.' });

  const { error } = await sb.from('products').update(updates).eq('id', product.id);
  if (error) return JSON.stringify({ error: error.message });

  const changeLines = Object.entries(updates).map(([k, v]) => {
    const labels: Record<string, string> = { price: '판매가', cost: '원가', name: '제품명', unit: '단위' };
    return `${labels[k] || k}: ${typeof v === 'number' ? v.toLocaleString() + '원' : v}`;
  }).join(', ');

  return JSON.stringify({ 성공: true, 메시지: `${product.name} 수정 완료`, 변경내용: changeLines });
}

async function execBulkUpdateProductCosts(sb: any, args: { cost_ratio: number; product_name?: string }, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '제품 원가 일괄 수정');
  if (denied) return denied;
  let q = sb.from('products').select('id, name, price').eq('is_active', true);
  if (args.product_name) q = q.ilike('name', `%${args.product_name}%`);
  const { data: products, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!products?.length) return JSON.stringify({ error: '대상 제품이 없습니다.' });

  let successCount = 0;
  const details: string[] = [];

  for (const p of products as any[]) {
    const newCost = Math.round(p.price * args.cost_ratio);
    const { error: upErr } = await sb.from('products').update({ cost: newCost }).eq('id', p.id);
    if (!upErr) {
      successCount++;
      details.push(`${p.name}: ${newCost.toLocaleString()}원`);
    }
  }

  return JSON.stringify({
    성공: true,
    메시지: `${successCount}개 제품 원가 일괄 업데이트 완료`,
    기준: `판매가의 ${Math.round(args.cost_ratio * 100)}%`,
    처리건수: successCount,
    상세: details.slice(0, 10),
    안내: details.length > 10 ? `외 ${details.length - 10}개` : undefined,
  });
}

// ── 상담 기록 조회 ────────────────────────────────────────────────────────────

async function execGetCustomerConsultations(sb: any, args: { customer_name?: string; phone?: string }): Promise<string> {
  const customer = await findCustomer(sb, args);
  if (!customer) return JSON.stringify({ error: '고객을 찾을 수 없습니다.' });

  const { data, error } = await sb.from('customer_consultations')
    .select('id, consultation_type, content, created_at')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: `${customer.name} 고객의 상담 기록이 없습니다.` });

  return JSON.stringify({
    고객: customer.name,
    상담기록: (data as any[]).map(r => ({
      id: r.id,
      유형: r.consultation_type,
      내용: r.content?.text || JSON.stringify(r.content),
      일시: r.created_at?.slice(0, 16).replace('T', ' '),
    })),
    안내: '삭제 시 id 값을 delete_record에 전달하세요.',
  });
}

// ── 범용 레코드 삭제 ──────────────────────────────────────────────────────────

const DELETABLE_TABLES: Record<string, string> = {
  customer_consultations: '상담 기록',
  notifications: '발송 이력',
};

async function execDeleteRecord(sb: any, args: { table: string; record_id: string; reason?: string }, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '레코드 삭제');
  if (denied) return denied;
  if (!DELETABLE_TABLES[args.table]) {
    return JSON.stringify({ error: `"${args.table}" 테이블은 삭제가 허용되지 않습니다. 허용: ${Object.keys(DELETABLE_TABLES).join(', ')}` });
  }

  // 삭제 전 존재 확인
  const { data: existing } = await sb.from(args.table).select('id').eq('id', args.record_id).single();
  if (!existing) return JSON.stringify({ error: `해당 ID의 ${DELETABLE_TABLES[args.table]}을 찾을 수 없습니다.` });

  const { error } = await sb.from(args.table).delete().eq('id', args.record_id);
  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    성공: true,
    메시지: `${DELETABLE_TABLES[args.table]} 삭제 완료`,
    테이블: args.table,
    삭제ID: args.record_id,
    사유: args.reason || '미지정',
  });
}

// ═══ Phase B ═══════════════════════════════════════════════════════════════

// ── 환불 처리 ────────────────────────────────────────────────────────────────
async function execRefundSalesOrder(sb: any, args: {
  order_number: string;
  reason: string;
  reason_detail?: string;
  refund_method?: string;
  full_refund?: boolean;
  items?: Array<{ product_name: string; quantity: number }>;
}, ctx: ToolContext): Promise<string> {
  // 1) 원본 주문 조회
  const lookup = await getSalesOrderForRefund(args.order_number);
  if (lookup.error || !lookup.data) {
    return JSON.stringify({ error: lookup.error || `주문 "${args.order_number}"을(를) 찾을 수 없습니다.` });
  }
  const order: any = lookup.data;

  if (order.status === 'CANCELLED') return JSON.stringify({ error: '취소된 주문은 환불할 수 없습니다.' });
  if (order.status === 'REFUNDED') return JSON.stringify({ error: '이미 전액 환불된 주문입니다.' });

  // 2) 지점 권한 검증
  const denied = assertBranchAccess(ctx, order.branch?.id, order.branch?.name || '지점');
  if (denied) return denied;

  // 3) 환불 항목 구성
  const fullRefund = args.full_refund !== false && (!args.items || args.items.length === 0);
  let refundItems: Array<{ sales_order_item_id: string; product_id: string; quantity: number; unit_price: number }> = [];

  if (fullRefund) {
    refundItems = (order.items || []).map((i: any) => ({
      sales_order_item_id: i.id,
      product_id: i.product.id,
      quantity: i.quantity,
      unit_price: i.unit_price,
    }));
  } else {
    // 부분 환불 — product_name 매핑
    for (const req of args.items || []) {
      const match = (order.items || []).find((i: any) =>
        String(i.product?.name || '').toLowerCase().includes(String(req.product_name).toLowerCase())
      );
      if (!match) {
        return JSON.stringify({ error: `주문에 "${req.product_name}" 항목이 없습니다.` });
      }
      if (req.quantity <= 0 || req.quantity > match.quantity) {
        return JSON.stringify({ error: `${match.product.name}의 환불 수량은 1~${match.quantity} 범위여야 합니다.` });
      }
      refundItems.push({
        sales_order_item_id: match.id,
        product_id: match.product.id,
        quantity: req.quantity,
        unit_price: match.unit_price,
      });
    }
  }

  if (refundItems.length === 0) {
    return JSON.stringify({ error: '환불할 항목이 없습니다.' });
  }

  // 4) processRefund 호출 (재고 복원 + 포인트 차감 + 분개까지 포함)
  const result = await processRefund({
    originalOrderId: order.id,
    branchId: order.branch.id,
    reason: args.reason,
    reasonDetail: args.reason_detail,
    refundMethod: args.refund_method || order.payment_method || 'cash',
    items: refundItems,
  });

  if (result.error) return JSON.stringify({ error: result.error });

  const refundAmount = refundItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  return JSON.stringify({
    성공: true,
    메시지: `환불 처리 완료`,
    환불번호: result.returnNumber,
    원주문: args.order_number,
    환불금액: `${refundAmount.toLocaleString()}원`,
    환불수단: args.refund_method || order.payment_method || 'cash',
    유형: fullRefund ? '전액 환불' : '부분 환불',
  });
}

// ── 부분 입고 ────────────────────────────────────────────────────────────────
async function execReceivePurchaseOrderPartial(sb: any, args: {
  order_number: string;
  items: Array<{ product_name: string; quantity: number }>;
  memo?: string;
}, ctx: ToolContext): Promise<string> {
  const { data: po } = await sb.from('purchase_orders')
    .select('id, status, branch_id, order_number, branches(name)')
    .eq('order_number', args.order_number).single();
  if (!po) return JSON.stringify({ error: `발주서 "${args.order_number}" 없음` });
  const denied = assertBranchAccess(ctx, (po as any).branch_id, (po as any).branches?.name || '지점');
  if (denied) return denied;
  if (!['CONFIRMED', 'PARTIALLY_RECEIVED'].includes((po as any).status)) {
    return JSON.stringify({ error: `입고 불가 상태: ${(po as any).status}` });
  }

  const { data: orderItems } = await sb.from('purchase_order_items')
    .select('id, product_id, ordered_quantity, received_quantity, unit_price, products(name)')
    .eq('purchase_order_id', (po as any).id);

  if (!orderItems?.length) return JSON.stringify({ error: '발주 항목이 없습니다.' });

  // product_name 매핑 + 잔여수량 검증
  const toReceive: Array<{ item: any; qty: number }> = [];
  for (const req of args.items) {
    const match = (orderItems as any[]).find(oi =>
      String(oi.products?.name || '').toLowerCase().includes(String(req.product_name).toLowerCase())
    );
    if (!match) return JSON.stringify({ error: `발주에 "${req.product_name}" 항목이 없습니다.` });
    const remaining = match.ordered_quantity - match.received_quantity;
    if (req.quantity <= 0) return JSON.stringify({ error: `${match.products.name}: 수량은 1 이상이어야 합니다.` });
    if (req.quantity > remaining) {
      return JSON.stringify({ error: `${match.products.name}: 잔여 입고 가능 ${remaining}개, 요청 ${req.quantity}개` });
    }
    toReceive.push({ item: match, qty: req.quantity });
  }

  // 입고 전표 생성
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  const receiptNumber = `GR-${today}-${suffix}`;
  const totalAmount = toReceive.reduce((s, r) => s + r.item.unit_price * r.qty, 0);

  const { data: receipt, error: receiptErr } = await sb.from('purchase_receipts').insert({
    purchase_order_id: (po as any).id,
    receipt_number: receiptNumber,
    branch_id: (po as any).branch_id,
    total_amount: totalAmount,
    received_at: new Date().toISOString(),
    memo: args.memo || 'AI 부분 입고',
  }).select('id').single();
  if (receiptErr) return JSON.stringify({ error: receiptErr.message });

  const detail: string[] = [];
  for (const { item, qty } of toReceive) {
    // 입고 항목
    await sb.from('purchase_receipt_items').insert({
      purchase_receipt_id: (receipt as any).id,
      product_id: item.product_id,
      quantity: qty,
      unit_price: item.unit_price,
    });
    // 재고 증가
    const { data: inv } = await sb.from('inventories')
      .select('id, quantity')
      .eq('branch_id', (po as any).branch_id)
      .eq('product_id', item.product_id).single();
    if (inv) {
      await sb.from('inventories').update({ quantity: (inv as any).quantity + qty }).eq('id', (inv as any).id);
    } else {
      await sb.from('inventories').insert({ branch_id: (po as any).branch_id, product_id: item.product_id, quantity: qty, safety_stock: 0 });
    }
    await sb.from('inventory_movements').insert({
      branch_id: (po as any).branch_id,
      product_id: item.product_id,
      movement_type: 'IN',
      quantity: qty,
      reference_id: (po as any).id,
      reference_type: 'PURCHASE_RECEIPT',
      memo: `부분 입고 ${receiptNumber} (AI)`,
    });
    // 발주 항목 received_quantity 누적
    await sb.from('purchase_order_items')
      .update({ received_quantity: item.received_quantity + qty })
      .eq('id', item.id);
    detail.push(`${item.products.name} ${qty}개`);
  }

  // 전체 입고 여부 판단 → PO 상태 업데이트
  const { data: refreshed } = await sb.from('purchase_order_items')
    .select('ordered_quantity, received_quantity')
    .eq('purchase_order_id', (po as any).id);
  const allReceived = (refreshed as any[] || []).every(r => r.received_quantity >= r.ordered_quantity);
  const newStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  await sb.from('purchase_orders').update({ status: newStatus }).eq('id', (po as any).id);

  return JSON.stringify({
    성공: true,
    메시지: `부분 입고 처리 완료 (${newStatus === 'RECEIVED' ? '전량 입고됨' : '잔여 있음'})`,
    입고전표: receiptNumber,
    입고항목: detail,
    발주상태: newStatus,
  });
}

// ── 배송 조회 ────────────────────────────────────────────────────────────────
async function execGetShipments(sb: any, args: {
  status?: string;
  recipient_name?: string;
  tracking_number?: string;
  limit?: number;
}, ctx: ToolContext): Promise<string> {
  let q = sb.from('shipments').select('*').order('created_at', { ascending: false });
  if (args.status) q = q.eq('status', args.status);
  if (args.tracking_number) q = q.eq('tracking_number', args.tracking_number);
  if (args.recipient_name) q = q.ilike('recipient_name', `%${args.recipient_name}%`);
  // Staff 지점 필터
  if (isStaffRole(ctx.userRole) && ctx.branchId) q = q.eq('branch_id', ctx.branchId);
  q = q.limit(args.limit || 20);

  const { data, error } = await q;
  if (error) return JSON.stringify({ error: error.message });
  if (!data?.length) return JSON.stringify({ 결과: '조건에 맞는 배송 건이 없습니다.' });

  const statusLabel: Record<string, string> = { PENDING: '대기', PRINTED: '송장출력', SHIPPED: '발송완료', DELIVERED: '배송완료' };
  return JSON.stringify({
    총건수: data.length,
    배송목록: (data as any[]).map((s: any) => ({
      수령자: s.recipient_name,
      전화: s.recipient_phone,
      주소: [s.recipient_address, s.recipient_address_detail].filter(Boolean).join(' '),
      품목: s.items_summary || '-',
      송장번호: s.tracking_number || '미등록',
      상태: statusLabel[s.status] || s.status,
      출처: s.source === 'CAFE24' ? '카페24' : '매장',
      등록일: s.created_at?.slice(0, 10),
    })),
  });
}

// ── 배송 송장 업데이트 ───────────────────────────────────────────────────────
async function execUpdateShipmentTracking(sb: any, args: {
  recipient_name?: string;
  tracking_number: string;
  cafe24_order_id?: string;
}, ctx: ToolContext): Promise<string> {
  if (!args.tracking_number) return JSON.stringify({ error: '송장번호가 필요합니다.' });

  let q = sb.from('shipments').select('id, recipient_name, status, branch_id');
  if (args.cafe24_order_id) {
    q = q.eq('cafe24_order_id', args.cafe24_order_id);
  } else if (args.recipient_name) {
    q = q.ilike('recipient_name', `%${args.recipient_name}%`).in('status', ['PENDING', 'PRINTED']);
  } else {
    return JSON.stringify({ error: '수령자명 또는 cafe24_order_id 중 하나가 필요합니다.' });
  }
  if (isStaffRole(ctx.userRole) && ctx.branchId) q = q.eq('branch_id', ctx.branchId);
  q = q.order('created_at', { ascending: false }).limit(1);

  const { data: rows } = await q;
  const target = (rows as any[])?.[0];
  if (!target) return JSON.stringify({ error: '대상 배송 건을 찾을 수 없습니다.' });

  const { error } = await sb.from('shipments').update({
    tracking_number: args.tracking_number,
    status: 'SHIPPED',
    updated_at: new Date().toISOString(),
  }).eq('id', target.id);
  if (error) return JSON.stringify({ error: error.message });

  return JSON.stringify({
    성공: true,
    메시지: `송장번호 등록 완료 (${target.recipient_name})`,
    송장번호: args.tracking_number,
    수령자: target.recipient_name,
    상태: '발송완료',
  });
}

// ── 카페24 토큰 갱신 ─────────────────────────────────────────────────────────
async function execRefreshCafe24Token(ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '카페24 토큰 갱신');
  if (denied) return denied;
  const r = await refreshCafe24Token();
  if (!r.success) return JSON.stringify({ error: r.message });
  return JSON.stringify({ 성공: true, 메시지: r.message });
}

// ── 카페24 결제완료 매출 동기화 ─────────────────────────────────────────────
async function execSyncCafe24PaidOrders(sb: any, args: { start_date: string; end_date: string }, ctx: ToolContext): Promise<string> {
  const denied = requireHq(ctx, '카페24 매출 동기화');
  if (denied) return denied;
  const r = await syncCafe24PaidOrders({ startDate: args.start_date, endDate: args.end_date });
  if (!r.success) return JSON.stringify({ error: r.message });
  return JSON.stringify({ 성공: true, 메시지: r.message, 처리건수: r.processed });
}

// ── 고객 세분화 분석 ─────────────────────────────────────────────────────────
async function execCustomerSegmentAnalysis(sb: any, args: {
  mode: 'top_spenders' | 'dormant' | 'frequent_buyers' | 'grade_breakdown';
  days?: number;
  grade?: string;
  limit?: number;
}): Promise<string> {
  const days = args.days || 90;
  const limit = args.limit || 10;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  if (args.mode === 'grade_breakdown') {
    const { data: customers } = await sb.from('customers').select('grade').eq('is_active', true);
    const bucket: Record<string, number> = { NORMAL: 0, VIP: 0, VVIP: 0 };
    (customers || []).forEach((c: any) => { bucket[c.grade] = (bucket[c.grade] || 0) + 1; });
    return JSON.stringify({
      모드: '등급별 분포',
      총고객: (customers || []).length,
      분포: { 일반: bucket.NORMAL, VIP: bucket.VIP, VVIP: bucket.VVIP },
    });
  }

  if (args.mode === 'dormant') {
    // 최근 days일 내 구매가 없는 활성 고객
    const { data: recent } = await sb.from('sales_orders')
      .select('customer_id')
      .gte('ordered_at', sinceIso)
      .eq('status', 'COMPLETED')
      .not('customer_id', 'is', null);
    const activeIds = new Set(((recent || []) as any[]).map(r => r.customer_id));

    let custQ = sb.from('customers').select('id, name, phone, grade').eq('is_active', true);
    if (args.grade) custQ = custQ.eq('grade', args.grade);
    const { data: allCust } = await custQ;
    const dormant = (allCust || []).filter((c: any) => !activeIds.has(c.id)).slice(0, limit);

    return JSON.stringify({
      모드: `${days}일 미구매 휴면 고객`,
      총건수: dormant.length,
      고객목록: dormant.map((c: any) => ({
        이름: c.name,
        전화: c.phone,
        등급: ({ NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' } as any)[c.grade] || c.grade,
      })),
    });
  }

  // top_spenders / frequent_buyers
  let soQ = sb.from('sales_orders')
    .select('customer_id, total_amount, customers(name, phone, grade)')
    .eq('status', 'COMPLETED')
    .gte('ordered_at', sinceIso)
    .not('customer_id', 'is', null);
  const { data: orders } = await soQ;

  const agg = new Map<string, { name: string; phone: string; grade: string; spent: number; count: number }>();
  for (const o of (orders || []) as any[]) {
    const id = o.customer_id;
    const cur = agg.get(id) || {
      name: o.customers?.name || '',
      phone: o.customers?.phone || '',
      grade: o.customers?.grade || 'NORMAL',
      spent: 0, count: 0,
    };
    cur.spent += Number(o.total_amount) || 0;
    cur.count += 1;
    agg.set(id, cur);
  }

  let rows = Array.from(agg.values());
  if (args.grade) rows = rows.filter(r => r.grade === args.grade);

  if (args.mode === 'top_spenders') {
    rows.sort((a, b) => b.spent - a.spent);
  } else {
    rows.sort((a, b) => b.count - a.count);
  }
  rows = rows.slice(0, limit);

  return JSON.stringify({
    모드: args.mode === 'top_spenders' ? `최근 ${days}일 매출 상위` : `최근 ${days}일 구매 빈도 상위`,
    총건수: rows.length,
    결과: rows.map((r, i) => ({
      순위: i + 1,
      이름: r.name,
      전화: r.phone,
      등급: ({ NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' } as any)[r.grade] || r.grade,
      누적매출: `${r.spent.toLocaleString()}원`,
      구매건수: `${r.count}건`,
    })),
  });
}
