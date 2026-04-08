# -*- coding: utf-8 -*-
"""경옥채 파트너십 견적서(2천만원 초기 + 월정액 + 성과) PDF 생성기."""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

pdfmetrics.registerFont(TTFont("Malgun", "C:/Windows/Fonts/malgun.ttf"))
pdfmetrics.registerFont(TTFont("MalgunBold", "C:/Windows/Fonts/malgunbd.ttf"))

# ── 파트너십 전용 색상 (따뜻한 그린) ─────────────────────────────────
PRIMARY = colors.HexColor("#065f46")      # 딥 그린
ACCENT = colors.HexColor("#10b981")       # 민트 그린
LIGHT = colors.HexColor("#d1fae5")        # 연한 그린
GRAY_LINE = colors.HexColor("#cbd5e1")
GRAY_TEXT = colors.HexColor("#475569")
BG_HEADER = colors.HexColor("#065f46")
BG_SUB = colors.HexColor("#d1fae5")
ZEBRA = colors.HexColor("#f0fdf4")
WARNING = colors.HexColor("#fef3c7")

styles = getSampleStyleSheet()
TITLE = ParagraphStyle(
    "Title", parent=styles["Heading1"], fontName="MalgunBold",
    fontSize=26, leading=32, textColor=PRIMARY, alignment=TA_CENTER, spaceAfter=4,
)
SUBTITLE = ParagraphStyle(
    "Subtitle", fontName="Malgun", fontSize=13, alignment=TA_CENTER,
    textColor=GRAY_TEXT, spaceAfter=6,
)
BADGE = ParagraphStyle(
    "Badge", fontName="MalgunBold", fontSize=11, alignment=TA_CENTER,
    textColor=colors.white, leading=16,
)
H2 = ParagraphStyle(
    "H2", fontName="MalgunBold", fontSize=14, leading=18,
    textColor=PRIMARY, spaceBefore=10, spaceAfter=5,
)
H3 = ParagraphStyle(
    "H3", fontName="MalgunBold", fontSize=11, leading=15,
    textColor=ACCENT, spaceBefore=5, spaceAfter=3,
)
BODY = ParagraphStyle(
    "Body", fontName="Malgun", fontSize=9, leading=13, alignment=TA_LEFT, spaceAfter=2,
)
SMALL = ParagraphStyle(
    "Small", parent=BODY, fontSize=8, leading=11, textColor=GRAY_TEXT,
)
NOTICE = ParagraphStyle(
    "Notice", fontName="MalgunBold", fontSize=10, textColor=colors.HexColor("#92400e"),
    alignment=TA_LEFT, leading=14,
)


def table_style_default(n_rows, header_rows=1, total_row_idx=None, zebra=True):
    style = [
        ("FONTNAME", (0, 0), (-1, -1), "Malgun"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("LEADING", (0, 0), (-1, -1), 11),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, GRAY_LINE),
        ("LINEABOVE", (0, 0), (-1, 0), 1.2, PRIMARY),
        ("LINEBELOW", (0, -1), (-1, -1), 1.2, PRIMARY),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("BACKGROUND", (0, 0), (-1, header_rows - 1), BG_HEADER),
        ("TEXTCOLOR", (0, 0), (-1, header_rows - 1), colors.white),
        ("FONTNAME", (0, 0), (-1, header_rows - 1), "MalgunBold"),
        ("ALIGN", (0, 0), (-1, header_rows - 1), "CENTER"),
    ]
    if zebra:
        for r in range(header_rows, n_rows):
            if (r - header_rows) % 2 == 1:
                style.append(("BACKGROUND", (0, r), (-1, r), ZEBRA))
    if total_row_idx is not None:
        style.append(("BACKGROUND", (0, total_row_idx), (-1, total_row_idx), BG_SUB))
        style.append(("FONTNAME", (0, total_row_idx), (-1, total_row_idx), "MalgunBold"))
    return TableStyle(style)


story = []

def p(text, style=BODY):
    story.append(Paragraph(text, style))

def sp(h=4):
    story.append(Spacer(1, h * mm))


# ══ 표지 ══════════════════════════════════════════════════════════════
sp(18)
p("개발 견적서", TITLE)
p("Partnership Quotation — 장기 파트너십 버전", SUBTITLE)

# 파트너십 뱃지
badge = Table([[Paragraph("지인 · 장기 파트너십 할인 적용 (정식 견적 대비 약 85% 절감)", BADGE)]],
              colWidths=[170 * mm])
badge.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
]))
story.append(badge)
sp(10)

cover_data = [
    ["프로젝트명", "경옥채 사내 통합시스템 구축 및 장기 운영"],
    ["견적번호", "QT-2026-0408-002 (파트너십)"],
    ["견적일자", "2026-04-08"],
    ["유효기간", "견적일로부터 30일 (~ 2026-05-08)"],
    ["발주처", "경옥채 주식회사 귀중"],
    ["공급자", "(수행사명 / 담당자)"],
    ["문서 버전", "Draft v1.0"],
]
t = Table(cover_data, colWidths=[35 * mm, 135 * mm])
t.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, -1), "Malgun"),
    ("FONTSIZE", (0, 0), (-1, -1), 10),
    ("FONTNAME", (0, 0), (0, -1), "MalgunBold"),
    ("BACKGROUND", (0, 0), (0, -1), BG_SUB),
    ("TEXTCOLOR", (0, 0), (0, -1), PRIMARY),
    ("LINEBELOW", (0, 0), (-1, -1), 0.3, GRAY_LINE),
    ("LINEABOVE", (0, 0), (-1, 0), 1.5, PRIMARY),
    ("LINEBELOW", (0, -1), (-1, -1), 1.5, PRIMARY),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))
story.append(t)
sp(10)

# 가격 구조 표지 하이라이트 — 3층 박스
p("3층 가격 구조", H3)
sp(1)
pricing_row = [[
    Paragraph("<b>초기 구축비</b><br/><font size='18'>22,000,000원</font><br/><font size='8' color='#ffffff'>(VAT 포함, 1회)</font>", ParagraphStyle(
        "Col1", fontName="MalgunBold", fontSize=11, textColor=colors.white, alignment=TA_CENTER, leading=18)),
    Paragraph("<b>월 운영료</b><br/><font size='18'>440,000원</font><br/><font size='8' color='#ffffff'>(VAT 포함, 매월)</font>", ParagraphStyle(
        "Col2", fontName="MalgunBold", fontSize=11, textColor=colors.white, alignment=TA_CENTER, leading=18)),
    Paragraph("<b>성과 보너스</b><br/><font size='14'>매출 0.2%</font><br/><font size='8' color='#ffffff'>(월 cap 60만원)</font>", ParagraphStyle(
        "Col3", fontName="MalgunBold", fontSize=11, textColor=colors.white, alignment=TA_CENTER, leading=18)),
]]
pt = Table(pricing_row, colWidths=[56 * mm, 56 * mm, 58 * mm])
pt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#065f46")),
    ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#059669")),
    ("BACKGROUND", (2, 0), (2, 0), colors.HexColor("#10b981")),
    ("TOPPADDING", (0, 0), (-1, -1), 14),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))
story.append(pt)
sp(8)

# 5년 LTV 강조
p("5년 예상 총액 (LTV)", H3)
ltv_row = [
    ["시나리오", "초기 + 5년 운영료", "정식 견적 대비"],
    ["완만한 성장 (연 20%)", "약 48,000,000원", "-67%"],
    ["공격적 성장 (연 50%)", "약 62,000,000원", "-57%"],
]
t = Table(ltv_row, colWidths=[55 * mm, 60 * mm, 55 * mm])
style = table_style_default(len(ltv_row))
style.add("ALIGN", (1, 0), (-1, -1), "CENTER")
style.add("FONTSIZE", (1, 1), (1, -1), 10)
style.add("FONTNAME", (1, 1), (1, -1), "MalgunBold")
style.add("TEXTCOLOR", (1, 1), (1, -1), PRIMARY)
t.setStyle(style)
story.append(t)

story.append(PageBreak())

# ══ 1. 제안 배경 ══════════════════════════════════════════════════════
p("1. 제안 배경", H2)

p("1-1. 정식 견적 대비 할인 근거", H3)
p("정식 SI 견적 기준 본 시스템 구축비는 <b>약 1억 4,372만원(VAT 포함)</b>이나, 다음 사유로 특별 조건을 적용합니다.", BODY)
for line in [
    "• <b>AI 바이브 코딩 기반 개발</b> — Claude AI 도구를 활용한 개발 생산성 극대화로 실 투입 공수가 크게 절감",
    "• <b>지인 관계를 통한 신뢰 기반 파트너십</b> — 장기 협력을 전제로 초기 구축비 대폭 인하",
    "• <b>레퍼런스 가치</b> — 본 시스템이 공급자의 포트폴리오 및 타 고객 레퍼런스로 활용",
    "• <b>SaaS형 수익 구조</b> — 일시불이 아닌 월정액 분산 회수로 발주처 초기 부담 최소화",
]:
    p(line, BODY)
sp(4)

p("1-2. 핵심 철학", H3)
philo = Table([[Paragraph(
    '<b>"낮은 초기 진입 장벽 + 장기 동반 성장"</b><br/>'
    '발주처의 매출 규모에 비례하여 시스템 운영 비용도 성장하는 구조를 통해 상호 Win-Win을 추구합니다.',
    ParagraphStyle("Ph", fontName="Malgun", fontSize=10, alignment=TA_CENTER, leading=16, textColor=PRIMARY))]],
    colWidths=[170 * mm])
philo.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
    ("BOX", (0, 0), (-1, -1), 1, PRIMARY),
    ("TOPPADDING", (0, 0), (-1, -1), 12),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ("LEFTPADDING", (0, 0), (-1, -1), 16),
    ("RIGHTPADDING", (0, 0), (-1, -1), 16),
]))
story.append(philo)
sp(6)

# ══ 2. 가격 구조 상세 ══════════════════════════════════════════════════
p("2. 가격 구조 — 3층 구조 상세", H2)

p("2-1. 초기 구축비 (1회)", H3)
init_data = [
    ["항목", "금액"],
    ["시스템 구축 · 인수인계 · 교육", "20,000,000원"],
    ["부가세 (10%)", "2,000,000원"],
    ["총액 (VAT 포함)", "22,000,000원"],
]
t = Table(init_data, colWidths=[110 * mm, 60 * mm])
style = table_style_default(len(init_data), total_row_idx=len(init_data) - 1)
style.add("ALIGN", (1, 0), (1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(3)

p("포함 사항", BODY)
for line in [
    "• 현재까지 구축된 시스템 전체 (20+ 화면, 49개 AI 도구, 외부 연동 3종)",
    "• 초기 데이터 세팅 (제품 마스터, 지점 정보, 사용자 계정)",
    "• 운영 환경 구축 (Vercel, Supabase, Cafe24 · Solapi 인증)",
    "• 사용자 교육 2회 (역할별, 총 6시간 이내)",
    "• 운영 매뉴얼 1종",
    "• <b>배포 후 60일 무상 하자보수</b>",
]:
    p(line, BODY)
sp(3)

p("지급 조건", BODY)
p("• 계약 체결 시 50% (11,000,000원)", BODY)
p("• 검수 · 배포 완료 시 50% (11,000,000원)", BODY)
sp(5)

p("2-2. 월 기본 운영료 (월정액)", H3)
monthly_data = [
    ["항목", "금액"],
    ["월 운영료", "400,000원/월"],
    ["부가세 (10%)", "40,000원"],
    ["월 합계 (VAT 포함)", "440,000원"],
]
t = Table(monthly_data, colWidths=[110 * mm, 60 * mm])
style = table_style_default(len(monthly_data), total_row_idx=len(monthly_data) - 1)
style.add("ALIGN", (1, 0), (1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(3)

p("포함 사항", BODY)
for line in [
    "• 시스템 운영 모니터링 (24/7 자동 + 업무 시간 즉시 대응)",
    "• 버그 수정 및 장애 대응 (<b>월 5시간 이내</b>)",
    "• 정기 백업 및 복구 지원",
    "• 마이너 기능 개선 (텍스트 수정, 간단한 항목 추가 등 1시간 이내 작업)",
    "• 보안 패치 및 라이브러리 업데이트",
    "• 분기별 운영 리포트 제공",
]:
    p(line, BODY)
sp(3)

p("제외 사항 (별도 청구)", BODY)
for line in [
    "• 월 5시간 초과 작업: <b>시간당 50,000원</b> 또는 일 단위 300,000원/MD",
    "• 신규 화면 · 도구 · 외부 연동 개발",
    "• 대량 데이터 이관 · 마이그레이션",
    "• 하드웨어 관련 이슈 (프린터, 카드 단말기 등)",
]:
    p(line, BODY)

story.append(PageBreak())

# ══ 2-3. 성과 보너스 ══════════════════════════════════════════════════
p("2-3. 성과 연동 보너스 (변동)", H3)
p("발주처 성장에 연동되는 보너스 구조. 매출이 늘어날수록 공급자도 함께 성장하는 <b>상호 동반 성장 구조</b>.", BODY)
sp(2)

bonus_rule = [
    ["월 매출 구간", "보너스 계산", "월 보너스"],
    ["~ 1,000만원", "면제", "0원"],
    ["1,000만 초과분", "초과분 × 0.2%", "변동"],
    ["최대 한도 (cap)", "—", "월 600,000원"],
]
t = Table(bonus_rule, colWidths=[55 * mm, 65 * mm, 50 * mm])
style = table_style_default(len(bonus_rule))
style.add("ALIGN", (2, 0), (2, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(4)

p("예시 시뮬레이션", BODY)
sim = [
    ["월 매출", "초과분", "보너스 계산", "월 보너스"],
    ["1,000만원", "0", "면제", "0원"],
    ["2,000만원", "1,000만원", "× 0.2%", "20,000원"],
    ["3,000만원", "2,000만원", "× 0.2%", "40,000원"],
    ["5,000만원", "4,000만원", "× 0.2%", "80,000원"],
    ["1억원", "9,000만원", "× 0.2%", "180,000원"],
    ["2억원", "1억 9,000만원", "× 0.2% (cap 도달)", "600,000원"],
    ["3억원+", "—", "cap", "600,000원"],
]
t = Table(sim, colWidths=[35 * mm, 35 * mm, 55 * mm, 45 * mm])
style = table_style_default(len(sim))
style.add("ALIGN", (0, 0), (-1, -1), "RIGHT")
style.add("ALIGN", (2, 0), (2, -1), "CENTER")
t.setStyle(style)
story.append(t)
sp(3)
p("매출 산정 기준: sales_orders.status = 'COMPLETED' 상태 주문 합계 (자동 SQL 집계 → 투명성 확보)", SMALL)

story.append(PageBreak())

# ══ 3. 5년 LTV 시뮬레이션 ═════════════════════════════════════════════
p("3. 5년 LTV (Life Time Value) 시뮬레이션", H2)

p("3-1. 성장 시나리오 — 완만한 성장", H3)
ltv1 = [
    ["연도", "평균 월 매출", "월 기본료", "월 보너스", "월 합계", "연간 합계"],
    ["1년차", "1,500만원", "400,000", "10,000", "410,000", "4,920,000"],
    ["2년차", "2,500만원", "400,000", "30,000", "430,000", "5,160,000"],
    ["3년차", "4,000만원", "400,000", "60,000", "460,000", "5,520,000"],
    ["4년차", "6,000만원", "400,000", "100,000", "500,000", "6,000,000"],
    ["5년차", "8,000만원", "400,000", "140,000", "540,000", "6,480,000"],
    ["5년 누계 운영료", "", "", "", "", "28,080,000"],
    ["초기 구축비", "", "", "", "", "20,000,000"],
    ["5년 총 LTV", "", "", "", "", "48,080,000"],
]
t = Table(ltv1, colWidths=[25 * mm, 28 * mm, 25 * mm, 25 * mm, 25 * mm, 32 * mm])
style = table_style_default(len(ltv1))
for idx in [6, 7, 8]:
    style.add("BACKGROUND", (0, idx), (-1, idx), BG_SUB)
    style.add("FONTNAME", (0, idx), (-1, idx), "MalgunBold")
style.add("BACKGROUND", (0, 8), (-1, 8), PRIMARY)
style.add("TEXTCOLOR", (0, 8), (-1, 8), colors.white)
style.add("ALIGN", (1, 0), (-1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(5)

p("3-2. 성장 시나리오 — 공격적 성장", H3)
ltv2 = [
    ["연도", "평균 월 매출", "월 합계", "연간 합계"],
    ["1년차", "2,000만원", "420,000", "5,040,000"],
    ["2년차", "5,000만원", "480,000", "5,760,000"],
    ["3년차", "1억원", "580,000", "6,960,000"],
    ["4년차", "1.5억원", "1,000,000 (cap 근접)", "12,000,000"],
    ["5년차", "2.5억원", "1,000,000 (cap 도달)", "12,000,000"],
    ["5년 누계 운영료", "", "", "41,760,000"],
    ["초기 구축비", "", "", "20,000,000"],
    ["5년 총 LTV", "", "", "61,760,000"],
]
t = Table(ltv2, colWidths=[30 * mm, 35 * mm, 55 * mm, 40 * mm])
style = table_style_default(len(ltv2))
for idx in [6, 7, 8]:
    style.add("BACKGROUND", (0, idx), (-1, idx), BG_SUB)
    style.add("FONTNAME", (0, idx), (-1, idx), "MalgunBold")
style.add("BACKGROUND", (0, 8), (-1, 8), PRIMARY)
style.add("TEXTCOLOR", (0, 8), (-1, 8), colors.white)
style.add("ALIGN", (1, 0), (-1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(5)

p("3-3. 정식 견적 대비", H3)
cmp_ltv = [
    ["구분", "금액", "대비"],
    ["정식 SI 견적 (1회성)", "143,721,050원", "100%"],
    ["파트너십 5년 총액 (완만 성장)", "48,080,000원", "34%"],
    ["파트너십 5년 총액 (공격 성장)", "61,760,000원", "43%"],
]
t = Table(cmp_ltv, colWidths=[85 * mm, 50 * mm, 25 * mm])
style = table_style_default(len(cmp_ltv))
style.add("ALIGN", (1, 0), (-1, -1), "RIGHT")
style.add("BACKGROUND", (0, 2), (-1, 3), BG_SUB)
style.add("FONTNAME", (0, 2), (-1, 3), "MalgunBold")
t.setStyle(style)
story.append(t)
sp(3)
p("→ 발주처는 정식 견적 대비 <b>57~66% 비용 절감</b>", BODY)
p("→ 공급자는 5년간 <b>안정적 현금흐름 + 성장 업사이드</b> 확보", BODY)

story.append(PageBreak())

# ══ 4. 계약 주요 조건 ══════════════════════════════════════════════════
p("4. 계약 주요 조건", H2)

# 저작권 강조 박스
p("4-1. 저작권 및 사용권 (중요)", H3)
copyright_warn = Table([[Paragraph(
    "<b>⚠ 본 견적은 소스코드 매각이 아닌 이용권(라이선스) 제공을 전제로 합니다.</b>",
    NOTICE)]], colWidths=[170 * mm])
copyright_warn.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), WARNING),
    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#f59e0b")),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
]))
story.append(copyright_warn)
sp(3)

copyright_data = [
    ["항목", "내용"],
    ["소스코드 소유", "공급자 (수행사)"],
    ["시스템 사용권", "발주처, 월 운영료 납부 기간 동안 유효"],
    ["비즈니스 데이터 소유", "발주처 (언제든 export 가능)"],
    ["해지 시 처리", "공급자는 운영 시스템 접근 종료, 발주처는 데이터 export 권리"],
    ["소스코드 매입 옵션", "별도 협의 (예시: 50,000,000원 일시불)"],
]
t = Table(copyright_data, colWidths=[40 * mm, 130 * mm])
t.setStyle(table_style_default(len(copyright_data)))
story.append(t)
sp(5)

p("4-2. 월 운영료 지급 조건", H3)
p("• <b>지급일</b>: 매월 말일 기준 익월 10일까지 선납", BODY)
p("• <b>지급 방법</b>: 계좌 이체", BODY)
p("• <b>연체 시 3단계 대응</b>", BODY)
delay_data = [
    ["연체 기간", "조치"],
    ["30일 연체", "연 8% 지연 이자 발생"],
    ["60일 연체", "시스템 접근 일시 중단 (데이터는 보존)"],
    ["90일 연체", "자동 해지 간주"],
]
t = Table(delay_data, colWidths=[30 * mm, 140 * mm])
t.setStyle(table_style_default(len(delay_data)))
story.append(t)
sp(5)

p("4-3. 해지 조항", H3)
term_data = [
    ["주체", "조건", "절차"],
    ["발주처 해지", "3개월 전 서면 통보", "해지일까지 월 운영료 정상 납부"],
    ["공급자 해지", "3개월 전 서면 통보", "해지일 전까지 데이터 이관 지원"],
    ["즉시 해지", "계약 위반 · 부도 · 법적 분쟁", "상호 합의 또는 법적 절차"],
    ["최소 계약 기간", "12개월", "조기 해지 시 잔여분 일시 청구"],
]
t = Table(term_data, colWidths=[30 * mm, 50 * mm, 90 * mm])
t.setStyle(table_style_default(len(term_data)))
story.append(t)
sp(5)

p("4-4. 범위 관리 (Scope Management)", H3)
for line in [
    "• <b>월 5시간 운영 시간</b>은 이월되지 않음 (사용 or 소멸)",
    "• 신규 기능 요청은 <b>사전 견적서 발행 후 승인</b>을 원칙으로 함",
    "• “간단한 수정”의 기준: <b>1시간 이내</b> 작업. 그 이상은 모두 CR(변경 요청) 대상",
    "• CR 최소 단가: <b>300,000원/MD</b> (시니어), 200,000원/MD (미들)",
]:
    p(line, BODY)

story.append(PageBreak())

p("4-5. SLA (Service Level Agreement)", H3)
sla_data = [
    ["항목", "목표", "위반 시"],
    ["시스템 가용성", "월 99% 이상", "위반 월 운영료 10% 크레딧"],
    ["장애 1차 대응", "업무 시간 내 4시간 이내", "벌칙 없음 (성실 의무)"],
    ["장애 복구", "치명적 장애 24시간 이내", "벌칙 없음"],
    ["백업 주기", "일 1회 자동", "Supabase 기본 제공"],
    ["업무 시간", "평일 09:00 ~ 18:00", "이외 시간은 최선 노력"],
]
t = Table(sla_data, colWidths=[40 * mm, 60 * mm, 70 * mm])
t.setStyle(table_style_default(len(sla_data)))
story.append(t)
sp(5)

p("4-6. AI 도구 사용 고지", H3)
ai_notice = Table([[Paragraph(
    "본 시스템의 개발 및 운영은 <b>Anthropic Claude AI 도구를 적극 활용</b>하여 수행됨을 명시합니다. "
    "이를 통해 기존 SI 대비 낮은 비용 구조가 실현되며, AI 생성 결과는 공급자가 전량 검수 · 책임집니다.",
    ParagraphStyle("AI", fontName="Malgun", fontSize=9, alignment=TA_LEFT, leading=13))]],
    colWidths=[170 * mm])
ai_notice.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
    ("BOX", (0, 0), (-1, -1), 0.8, PRIMARY),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
]))
story.append(ai_notice)
sp(6)

# ══ 5. 외부 비용 ══════════════════════════════════════════════════════
p("5. 발주처 부담 외부 비용 (별도)", H2)
p("본 견적에 포함되지 않는 외부 서비스 비용. 발주처가 직접 구독하거나 공급자가 대행 결제 후 실비 청구 가능.", SMALL)
sp(2)
ext_cost = [
    ["항목", "월 예상", "비고"],
    ["Vercel Pro", "25,000원", "호스팅"],
    ["Supabase Pro", "35,000원", "DB · Auth · Storage"],
    ["Claude API", "150,000 ~ 400,000원", "AI 에이전트 사용량"],
    ["Solapi (알림톡/SMS)", "사용량", "건당 20~80원"],
    ["Cafe24 API", "무료", "기본 제공"],
    ["SweetTracker", "무료 ~ 50,000원", "사용량 초과 시"],
    ["도메인", "약 2,500원/월", "연간 계약"],
    ["최소 월 합계", "약 210,000원", ""],
    ["최대 월 합계", "약 510,000원", ""],
]
t = Table(ext_cost, colWidths=[40 * mm, 55 * mm, 75 * mm])
style = table_style_default(len(ext_cost))
for idx in [7, 8]:
    style.add("BACKGROUND", (0, idx), (-1, idx), BG_SUB)
    style.add("FONTNAME", (0, idx), (-1, idx), "MalgunBold")
style.add("ALIGN", (1, 0), (1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(6)

# ══ 6. 특별 혜택 ══════════════════════════════════════════════════════
p("6. 지인 · 장기 파트너십 특별 혜택", H2)
p("6-1. 추가 혜택", H3)
for line in [
    "• <b>초기 6개월 Claude API 사용료 공급자 부담</b> (월 한도 30만원 이내)",
    "• 분기별 대면 미팅 포함",
    "• 긴급 장애 시 야간 · 주말 대응 1회 무료 (이후 야간 할증 150%)",
]:
    p(line, BODY)
sp(3)

p("6-2. 기대 사항 (비강제)", H3)
for line in [
    "• 개선 아이디어 · 피드백의 적극적 공유",
    "• 공급자의 포트폴리오 및 사례 공개 동의",
    "• 시스템 안정화 6개월 후 동종 업계 지인 소개 (성사 시 5% 인센티브)",
]:
    p(line, BODY)

story.append(PageBreak())

# ══ 7. 요약 ═══════════════════════════════════════════════════════════
p("7. 요약 및 의사결정 포인트", H2)

p("7-1. 숫자 한눈에 보기", H3)
summary_box = [
    ["항목", "금액"],
    ["초기 구축비 (1회, VAT 포함)", "22,000,000원"],
    ["월 운영료 (고정, VAT 포함)", "440,000원"],
    ["월 성과 보너스", "매출 1천만 초과분 × 0.2%, cap 60만"],
    ["5년 예상 총액 (완만 성장)", "약 48,000,000원"],
    ["5년 예상 총액 (공격 성장)", "약 62,000,000원"],
]
t = Table(summary_box, colWidths=[100 * mm, 70 * mm])
style = table_style_default(len(summary_box))
style.add("ALIGN", (1, 0), (1, -1), "RIGHT")
style.add("BACKGROUND", (0, 1), (-1, 3), BG_SUB)
style.add("FONTNAME", (0, 1), (-1, 3), "MalgunBold")
t.setStyle(style)
story.append(t)
sp(5)

p("7-2. 발주처 체크리스트", H3)
checks = [
    "□ 초기 2천만원 일시금이 부담되는 수준인가?",
    "□ 월 44만원 고정비가 지속 가능한가?",
    "□ 소스코드 미소유에 동의하는가? (필요 시 5천만원에 매입 가능)",
    "□ 12개월 최소 약정에 동의하는가?",
    "□ 월 5시간 운영 시간 한도가 현재 운영 패턴에 맞는가?",
    "□ 매출 데이터 공유 (자동 집계)에 동의하는가?",
]
for c in checks:
    p(c, BODY)
sp(5)

# ══ 8. 다음 단계 ══════════════════════════════════════════════════════
p("8. 다음 단계", H2)
steps = [
    ["단계", "내용", "기간"],
    ["1", "본 견적 검토 · 피드백", "1주"],
    ["2", "조건 협의 · 수정", "1~2주"],
    ["3", "계약서 작성 · 검토", "1주"],
    ["4", "계약 체결 및 1차 대금 지급", "즉시"],
    ["5", "시스템 인수인계 및 운영 시작", "2주"],
]
t = Table(steps, colWidths=[15 * mm, 115 * mm, 40 * mm])
t.setStyle(table_style_default(len(steps)))
story.append(t)
sp(8)

# ══ 9. 공지 · 서명 ════════════════════════════════════════════════════
notice_text = Table([[Paragraph(
    "<b>본 견적서는 초안(Draft)이며, 상호 협의에 의해 조건 변경이 가능합니다.</b><br/>"
    "최종 금액 및 조건은 계약서 기준으로 합니다.<br/>"
    "견적 유효기간: 2026-04-08 ~ 2026-05-08",
    ParagraphStyle("Nt", fontName="Malgun", fontSize=9, alignment=TA_CENTER,
                   textColor=GRAY_TEXT, leading=13))]],
    colWidths=[170 * mm])
notice_text.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ZEBRA),
    ("BOX", (0, 0), (-1, -1), 0.5, GRAY_LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 10),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
]))
story.append(notice_text)
sp(10)

# 서명란
sig = [
    ["공급자", "발주처"],
    ["", ""],
    ["(수행사명)", "경옥채 주식회사"],
    ["대표자 (인)", "대표자 (인)"],
]
t = Table(sig, colWidths=[82 * mm, 82 * mm], rowHeights=[10 * mm, 20 * mm, 8 * mm, 10 * mm])
t.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, -1), "Malgun"),
    ("FONTSIZE", (0, 0), (-1, -1), 10),
    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("FONTNAME", (0, 0), (-1, 0), "MalgunBold"),
    ("BACKGROUND", (0, 0), (-1, 0), BG_SUB),
    ("LINEABOVE", (0, 0), (-1, 0), 1, PRIMARY),
    ("LINEBELOW", (0, 0), (-1, 0), 0.5, GRAY_LINE),
    ("LINEBELOW", (0, 1), (-1, 1), 0.5, GRAY_LINE),
    ("LINEBELOW", (0, -1), (-1, -1), 1, PRIMARY),
    ("BOX", (0, 0), (0, -1), 0.5, GRAY_LINE),
    ("BOX", (1, 0), (1, -1), 0.5, GRAY_LINE),
]))
story.append(t)


def page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Malgun", 8)
    canvas.setFillColor(GRAY_TEXT)
    canvas.drawRightString(200 * mm, 10 * mm, f"- {doc.page} -")
    canvas.setFont("Malgun", 7)
    canvas.drawString(15 * mm, 10 * mm, "경옥채 파트너십 견적서 (QT-2026-0408-002)")
    if doc.page > 1:
        canvas.setStrokeColor(PRIMARY)
        canvas.setLineWidth(1.5)
        canvas.line(15 * mm, 285 * mm, 200 * mm, 285 * mm)
    canvas.restoreState()


out_path = "doc/경옥채_파트너십견적서_v1.pdf"
doc = SimpleDocTemplate(
    out_path, pagesize=A4,
    leftMargin=15 * mm, rightMargin=15 * mm,
    topMargin=18 * mm, bottomMargin=18 * mm,
    title="경옥채 파트너십 견적서",
    author="(수행사명)",
)
doc.build(story, onFirstPage=page_number, onLaterPages=page_number)

size_kb = os.path.getsize(out_path) / 1024
print(f"[OK] {out_path} ({size_kb:.1f} KB)")
