# -*- coding: utf-8 -*-
"""경옥채 사내 통합시스템 개발 견적서 PDF 생성기."""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

# ── 폰트 등록 ─────────────────────────────────────────────────────────
FONT_REG = "C:/Windows/Fonts/malgun.ttf"
FONT_BOLD = "C:/Windows/Fonts/malgunbd.ttf"
pdfmetrics.registerFont(TTFont("Malgun", FONT_REG))
pdfmetrics.registerFont(TTFont("MalgunBold", FONT_BOLD))

# ── 색상 ──────────────────────────────────────────────────────────────
PRIMARY = colors.HexColor("#1e3a8a")      # 딥 네이비
ACCENT = colors.HexColor("#3b82f6")       # 블루
LIGHT = colors.HexColor("#eff6ff")        # 연한 파랑
GRAY_LINE = colors.HexColor("#cbd5e1")
GRAY_TEXT = colors.HexColor("#475569")
BG_HEADER = colors.HexColor("#1e3a8a")
BG_SUB = colors.HexColor("#dbeafe")
ZEBRA = colors.HexColor("#f8fafc")

# ── 스타일 ────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()
H1 = ParagraphStyle(
    "H1", parent=styles["Heading1"], fontName="MalgunBold",
    fontSize=22, leading=28, textColor=PRIMARY, spaceAfter=6, alignment=TA_LEFT,
)
H2 = ParagraphStyle(
    "H2", parent=styles["Heading2"], fontName="MalgunBold",
    fontSize=14, leading=18, textColor=PRIMARY, spaceBefore=12, spaceAfter=6,
    borderPadding=4, leftIndent=0,
)
H3 = ParagraphStyle(
    "H3", parent=styles["Heading3"], fontName="MalgunBold",
    fontSize=11, leading=15, textColor=ACCENT, spaceBefore=6, spaceAfter=3,
)
BODY = ParagraphStyle(
    "Body", parent=styles["BodyText"], fontName="Malgun",
    fontSize=9, leading=13, spaceAfter=3, alignment=TA_LEFT,
)
SMALL = ParagraphStyle(
    "Small", parent=BODY, fontSize=8, leading=11, textColor=GRAY_TEXT,
)
TITLE = ParagraphStyle(
    "Title", parent=H1, fontSize=26, leading=32, alignment=TA_CENTER,
    textColor=PRIMARY, spaceAfter=4,
)
SUBTITLE = ParagraphStyle(
    "Subtitle", parent=BODY, fontSize=13, alignment=TA_CENTER,
    textColor=GRAY_TEXT, spaceAfter=24,
)
TOTAL_BIG = ParagraphStyle(
    "TotalBig", parent=BODY, fontName="MalgunBold", fontSize=18,
    textColor=PRIMARY, alignment=TA_RIGHT, leading=24,
)
CELL = ParagraphStyle(
    "Cell", parent=BODY, fontSize=8, leading=11, alignment=TA_LEFT,
)
CELL_R = ParagraphStyle(
    "CellR", parent=CELL, alignment=TA_RIGHT,
)
CELL_C = ParagraphStyle(
    "CellC", parent=CELL, alignment=TA_CENTER,
)

# ── 테이블 공통 스타일 ────────────────────────────────────────────────

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
        # header
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

# ── 빌드 ─────────────────────────────────────────────────────────────
story = []

def p(text, style=BODY):
    story.append(Paragraph(text, style))

def sp(h=4):
    story.append(Spacer(1, h * mm))

# ══ 표지 ══════════════════════════════════════════════════════════════
sp(20)
p("개발 견적서", TITLE)
p("DEVELOPMENT QUOTATION", SUBTITLE)
sp(4)

# 표지 정보 박스
cover_data = [
    ["프로젝트명", "경옥채 사내 통합시스템 구축 사업"],
    ["버전", "PRD v2.0 기반 (ERP + CRM + POS + AI 에이전트)"],
    ["견적번호", "QT-2026-0408-001"],
    ["견적일자", "2026-04-08"],
    ["유효기간", "견적일로부터 30일 (~ 2026-05-08)"],
    ["발주처", "경옥채 주식회사 귀중"],
    ["공급자", "(수행사명)"],
    ["통화", "원화(KRW), 부가세 별도"],
]
t = Table(cover_data, colWidths=[35 * mm, 120 * mm])
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
sp(14)

# 총액 박스
total_data = [[
    Paragraph("<b>견적 총액 (VAT 포함)</b>", ParagraphStyle(
        "TotalLbl", fontName="MalgunBold", fontSize=12, textColor=colors.white, alignment=TA_LEFT, leading=16)),
    Paragraph("<b>₩ 143,721,050</b>", ParagraphStyle(
        "TotalVal", fontName="MalgunBold", fontSize=18, textColor=colors.white, alignment=TA_RIGHT, leading=22)),
]]
tt = Table(total_data, colWidths=[70 * mm, 85 * mm])
tt.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PRIMARY),
    ("TOPPADDING", (0, 0), (-1, -1), 14),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ("LEFTPADDING", (0, 0), (-1, -1), 18),
    ("RIGHTPADDING", (0, 0), (-1, -1), 18),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))
story.append(tt)
sp(3)
p("일금 일억사천삼백칠십이만일천오십원정", ParagraphStyle(
    "Hangul", parent=BODY, fontSize=10, alignment=TA_RIGHT, textColor=GRAY_TEXT))
sp(8)

# 간단 요약
p("■ 프로젝트 요약", H3)
summary = [
    ["총 공수", "332 MD", "개발 기간", "32주 (약 8개월)"],
    ["투입 인력", "24.5 MM", "화면 수", "20+ 화면"],
    ["외부 연동", "3종 (Cafe24/SweetTracker/Solapi)", "AI 도구", "49개 (Function Calling)"],
]
t = Table(summary, colWidths=[25 * mm, 50 * mm, 25 * mm, 55 * mm])
t.setStyle(TableStyle([
    ("FONTNAME", (0, 0), (-1, -1), "Malgun"),
    ("FONTSIZE", (0, 0), (-1, -1), 9),
    ("FONTNAME", (0, 0), (0, -1), "MalgunBold"),
    ("FONTNAME", (2, 0), (2, -1), "MalgunBold"),
    ("BACKGROUND", (0, 0), (0, -1), BG_SUB),
    ("BACKGROUND", (2, 0), (2, -1), BG_SUB),
    ("TEXTCOLOR", (0, 0), (0, -1), PRIMARY),
    ("TEXTCOLOR", (2, 0), (2, -1), PRIMARY),
    ("LINEBELOW", (0, 0), (-1, -1), 0.3, GRAY_LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))
story.append(t)

story.append(PageBreak())

# ══ 1. 프로젝트 개요 ═══════════════════════════════════════════════════
p("1. 프로젝트 개요", H2)

p("1-1. 목적", H3)
p(
    "경옥채의 다채널(한약국 매장 · 백화점 입점 · 자사몰 · 이벤트) 운영을 단일 시스템으로 통합하여 "
    "재고 · 판매 · 고객 · 생산 · 회계 · 배송을 일원화하고, AI 에이전트 기반 업무 자동화를 통해 "
    "인력 대비 처리량을 3~5배 향상시키는 것을 목표로 합니다.", BODY)
sp(3)

p("1-2. 개발 범위", H3)
p("• 웹 기반 ERP/CRM/POS 통합 시스템 (20개 이상 화면)", BODY)
p("• RBAC 기반 5개 역할 권한 분리 (SUPER_ADMIN, HQ_OPERATOR, EXECUTIVE, PHARMACY_STAFF, BRANCH_STAFF)", BODY)
p("• 외부 시스템 연동 3종 (Cafe24, SweetTracker, Solapi)", BODY)
p("• AI 에이전트 (Function Calling, 49개 도구)", BODY)
p("• 회계 자동 분개 + 배송 관리 + 재고 실사 등 확장 기능", BODY)
sp(3)

p("1-3. 기술 스택", H3)
stack = [
    ["계층", "기술"],
    ["프론트엔드", "Next.js 16 (App Router), React, TypeScript, Tailwind CSS v4"],
    ["백엔드", "Next.js Server Actions, API Routes"],
    ["데이터베이스", "Supabase (PostgreSQL), RLS 정책"],
    ["인증", "Custom Session (SHA-256, httpOnly cookies)"],
    ["AI", "Claude API (Anthropic) — Function Calling"],
    ["외부 연동", "Cafe24 OAuth/Webhook, SweetTracker, Solapi, 대한통운 엑셀"],
    ["배포", "Vercel, Supabase"],
]
t = Table(stack, colWidths=[30 * mm, 130 * mm])
t.setStyle(table_style_default(len(stack)))
story.append(t)

story.append(PageBreak())

# ══ 2. 공수 산정 ═══════════════════════════════════════════════════════
p("2. 개발 범위 및 공수 산정", H2)

p("2-1. 인력 단가 (MD 기준)", H3)
rate = [
    ["역할", "등급", "일당 단가", "주요 역할"],
    ["PM / 아키텍트", "시니어", "450,000원", "요구분석 · 설계 · 리뷰"],
    ["풀스택 개발자 A", "시니어", "400,000원", "주 개발 리드"],
    ["풀스택 개발자 B", "미들", "300,000원", "구현 지원"],
    ["UI/UX 디자이너", "미들", "300,000원", "화면 디자인 · 와이어"],
    ["QA 엔지니어", "미들", "250,000원", "테스트 계획 · 수행"],
    ["블렌디드 평균", "", "약 340,000원", ""],
]
t = Table(rate, colWidths=[38 * mm, 25 * mm, 32 * mm, 55 * mm])
t.setStyle(table_style_default(len(rate), total_row_idx=len(rate) - 1))
story.append(t)
sp(6)

# (가) 공통
p("2-2. 모듈별 상세 공수", H3)
p("(가) 공통 · 기반 작업", BODY)
common = [
    ["코드", "항목", "내용", "MD", "금액(원)"],
    ["CM-01", "요구사항 분석 · PRD 검토", "업무 인터뷰, 프로세스 맵", "15", "6,750,000"],
    ["CM-02", "화면 설계 · UX 와이어프레임", "20+ 화면 설계, 플로우", "20", "6,000,000"],
    ["CM-03", "시각 디자인", "컬러/타이포/컴포넌트", "15", "4,500,000"],
    ["CM-04", "DB 스키마 설계", "30+ 테이블, 24개 마이그레이션", "12", "4,800,000"],
    ["CM-05", "공통 레이아웃", "대시보드 레이아웃, 네비", "7", "2,800,000"],
    ["CM-06", "인증 · 세션 · RBAC", "로그인, SHA-256, 미들웨어", "10", "4,000,000"],
    ["CM-07", "공통 유틸리티 · 에러", "클라이언트, 헬퍼, 패턴", "5", "2,000,000"],
    ["소계", "", "", "84", "30,850,000"],
]
t = Table(common, colWidths=[16 * mm, 38 * mm, 58 * mm, 12 * mm, 30 * mm])
style = table_style_default(len(common), total_row_idx=len(common) - 1)
style.add("ALIGN", (3, 0), (4, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(4)

# (나) 비즈니스
p("(나) 비즈니스 모듈", BODY)
biz = [
    ["코드", "모듈", "주요 기능", "MD", "금액(원)"],
    ["BM-01", "대시보드", "카드 6종, 채널/지점 분포, 경고", "5", "2,000,000"],
    ["BM-02", "지점관리", "4채널 지점 CRUD", "3", "1,200,000"],
    ["BM-03", "제품관리", "마스터, 자동 재고 생성, BOM 연계", "6", "2,400,000"],
    ["BM-04", "재고관리", "IN/OUT/ADJUST/TRANSFER + audit", "7", "2,800,000"],
    ["BM-05", "재고실사", "실사시트, 차이계산, 확정 반영", "5", "2,000,000"],
    ["BM-06", "POS", "판매, 결제 5종, 영수증, 외상 수금", "15", "6,000,000"],
    ["BM-07", "POS 환불(확장)", "3경로 검색 + 부분환불 + 분개 역", "7", "2,800,000"],
    ["BM-08", "고객 CRM", "CRUD, 상담, 포인트, 등급 자동화", "8", "3,200,000"],
    ["BM-09", "고객 상세 · 분석", "RFM, 휴면 분석, 등급 분포", "6", "2,400,000"],
    ["BM-10", "매입 · 공급사", "발주 생성/확정/입고, 부분입고", "10", "4,000,000"],
    ["BM-11", "생산관리", "BOM, 지시, 원재료 차감, 완제품 입고", "8", "3,200,000"],
    ["BM-12", "배송관리", "카페24/대한통운/SweetTracker", "12", "4,800,000"],
    ["BM-13", "보고서", "기간/채널/지점/결제/과세, 엑셀", "7", "2,800,000"],
    ["BM-14", "회계", "분개장, 매출 자동, 외상, 역분개", "12", "4,800,000"],
    ["BM-15", "알림(카톡/SMS)", "템플릿, Solapi, 이력, 일괄", "8", "3,200,000"],
    ["BM-16", "시스템코드", "코드성 데이터 관리", "2", "600,000"],
    ["소계", "", "", "121", "48,200,000"],
]
t = Table(biz, colWidths=[16 * mm, 30 * mm, 66 * mm, 12 * mm, 30 * mm])
style = table_style_default(len(biz), total_row_idx=len(biz) - 1)
style.add("ALIGN", (3, 0), (4, -1), "RIGHT")
t.setStyle(style)
story.append(t)

story.append(PageBreak())

# (다) 외부연동
p("(다) 외부 시스템 연동", BODY)
ext = [
    ["코드", "항목", "내용", "MD", "금액(원)"],
    ["IN-01", "Cafe24 OAuth", "인증, 토큰 저장/갱신", "5", "2,000,000"],
    ["IN-02", "Cafe24 Webhook", "6개 이벤트, HMAC 검증", "6", "2,400,000"],
    ["IN-03", "Cafe24 주문/회원", "실시간+수동 배치, 매출 분개 연동", "8", "3,200,000"],
    ["IN-04", "SweetTracker", "배송 추적, 상태 매핑, 일괄", "3", "1,200,000"],
    ["IN-05", "Solapi SMS/카카오", "HMAC, 단건/일괄 발송", "4", "1,600,000"],
    ["IN-06", "대한통운 엑셀 I/O", "발송 엑셀, 송장 임포트", "3", "1,200,000"],
    ["소계", "", "", "29", "11,600,000"],
]
t = Table(ext, colWidths=[16 * mm, 35 * mm, 61 * mm, 12 * mm, 30 * mm])
style = table_style_default(len(ext), total_row_idx=len(ext) - 1)
style.add("ALIGN", (3, 0), (4, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(4)

# (라) AI
p("(라) AI 에이전트", BODY)
ai = [
    ["코드", "항목", "내용", "MD", "금액(원)"],
    ["AI-01", "에이전트 아키텍처", "tool-use 루프, confirm 단계", "5", "2,250,000"],
    ["AI-02", "도구 구현 (49개)", "조회/쓰기/분석 executor", "18", "7,200,000"],
    ["AI-03", "RBAC 통합", "ToolContext, 지점 강제, HQ 차단", "3", "1,200,000"],
    ["AI-04", "메모리 시스템", "장기 기억, 자동 추출, UI", "4", "1,600,000"],
    ["AI-05", "에이전트 채팅 UI", "스트림, 확인 모달, 에러", "5", "1,500,000"],
    ["소계", "", "", "35", "13,750,000"],
]
t = Table(ai, colWidths=[16 * mm, 35 * mm, 61 * mm, 12 * mm, 30 * mm])
style = table_style_default(len(ai), total_row_idx=len(ai) - 1)
style.add("ALIGN", (3, 0), (4, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(4)

# (마) 테스트
p("(마) 테스트 · 배포 · 운영", BODY)
test = [
    ["코드", "항목", "내용", "MD", "금액(원)"],
    ["TS-01", "단위 · 통합 테스트", "핵심 로직, 시나리오 검증", "10", "2,500,000"],
    ["TS-02", "QA 전수 검증", "20+ 화면 × 150+ 케이스", "12", "3,000,000"],
    ["TS-03", "보안 점검", "RLS, 권한 누수, RBAC 교차", "4", "1,600,000"],
    ["TS-04", "인프라 구축", "Vercel/Supabase, 환경변수", "3", "1,200,000"],
    ["TS-05", "데이터 마이그레이션", "기존 시스템 이관, 정합성", "5", "2,000,000"],
    ["TS-06", "교육 · 매뉴얼", "운영 매뉴얼, 교육 자료, 현장", "6", "1,800,000"],
    ["소계", "", "", "40", "12,100,000"],
]
t = Table(test, colWidths=[16 * mm, 35 * mm, 61 * mm, 12 * mm, 30 * mm])
style = table_style_default(len(test), total_row_idx=len(test) - 1)
style.add("ALIGN", (3, 0), (4, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(4)

# (바) PM
p("(바) 프로젝트 관리", BODY)
pm = [
    ["코드", "항목", "내용", "MD", "금액(원)"],
    ["PM-01", "프로젝트 관리", "일정/이슈/리포팅", "15", "6,750,000"],
    ["PM-02", "고객 미팅 · 변경", "주간 미팅, CR 관리", "8", "3,600,000"],
    ["소계", "", "", "23", "10,350,000"],
]
t = Table(pm, colWidths=[16 * mm, 35 * mm, 61 * mm, 12 * mm, 30 * mm])
style = table_style_default(len(pm), total_row_idx=len(pm) - 1)
style.add("ALIGN", (3, 0), (4, -1), "RIGHT")
t.setStyle(style)
story.append(t)

story.append(PageBreak())

# ══ 3. 총계 ═══════════════════════════════════════════════════════════
p("3. 공수 및 금액 총계", H2)
summary_total = [
    ["구분", "공수(MD)", "금액(원)", "비중"],
    ["(가) 공통 · 기반", "84", "30,850,000", "23.5%"],
    ["(나) 비즈니스 모듈", "121", "48,200,000", "36.8%"],
    ["(다) 외부 연동", "29", "11,600,000", "8.9%"],
    ["(라) AI 에이전트", "35", "13,750,000", "10.5%"],
    ["(마) 테스트 · 배포", "40", "12,100,000", "9.2%"],
    ["(바) 프로젝트 관리", "23", "10,350,000", "7.9%"],
    ["소계", "332", "126,850,000", "96.8%"],
    ["예비비 (3%)", "", "3,805,500", "2.9%"],
    ["개발 합계 (부가세 별도)", "332", "130,655,500", "100%"],
    ["부가세 (10%)", "", "13,065,550", ""],
    ["총액 (VAT 포함)", "332", "143,721,050", ""],
]
t = Table(summary_total, colWidths=[55 * mm, 25 * mm, 45 * mm, 25 * mm])
style = table_style_default(len(summary_total))
# 합계 행들 강조
for idx in [7, 9, 11]:
    style.add("BACKGROUND", (0, idx), (-1, idx), BG_SUB)
    style.add("FONTNAME", (0, idx), (-1, idx), "MalgunBold")
# 최종 총액 강조
style.add("BACKGROUND", (0, 11), (-1, 11), PRIMARY)
style.add("TEXTCOLOR", (0, 11), (-1, 11), colors.white)
style.add("FONTSIZE", (0, 11), (-1, 11), 10)
style.add("ALIGN", (1, 0), (-1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(6)

# 한글 총액 박스
p("<b>일금 일억사천삼백칠십이만일천오십원정 (₩143,721,050)</b>", ParagraphStyle(
    "Big", parent=BODY, fontName="MalgunBold", fontSize=14, textColor=PRIMARY,
    alignment=TA_RIGHT, leading=20))
sp(8)

# ══ 4. 일정 ═══════════════════════════════════════════════════════════
p("4. 일정 계획", H2)
schedule = [
    ["단계", "기간", "주요 산출물"],
    ["① 요구분석 · 설계", "4주", "PRD, 와이어프레임, DB 스키마"],
    ["② 기반 개발", "3주", "인증, 레이아웃, RBAC"],
    ["③ 모듈 개발 A", "6주", "지점/제품/재고/POS/CRM"],
    ["④ 모듈 개발 B", "5주", "매입/생산/보고서/회계"],
    ["⑤ 외부 연동", "3주", "Cafe24, SweetTracker, Solapi"],
    ["⑥ AI 에이전트", "4주", "도구, RBAC, 메모리, UI"],
    ["⑦ 배송 · 확장", "2주", "배송관리, 재고실사"],
    ["⑧ 통합 QA", "3주", "전수 테스트, 버그 수정"],
    ["⑨ 배포 · 교육", "2주", "프로덕션 배포, 교육, 이관"],
    ["총 개발 기간", "32주 (약 8개월)", ""],
]
t = Table(schedule, colWidths=[38 * mm, 32 * mm, 90 * mm])
style = table_style_default(len(schedule), total_row_idx=len(schedule) - 1)
t.setStyle(style)
story.append(t)

story.append(PageBreak())

# ══ 5. 월별 인력 투입 ══════════════════════════════════════════════════
p("5. 월별 인력 투입 계획 (Man-Month)", H2)
mm_plan = [
    ["역할", "1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "합계"],
    ["PM/아키텍트", "1.0", "0.5", "0.5", "0.5", "0.5", "0.5", "0.5", "1.0", "5.0"],
    ["시니어 개발자", "1.0", "1.0", "1.0", "1.0", "1.0", "1.0", "1.0", "1.0", "8.0"],
    ["미들 개발자", "—", "1.0", "1.0", "1.0", "1.0", "1.0", "1.0", "0.5", "6.5"],
    ["디자이너", "1.0", "1.0", "0.5", "—", "—", "—", "—", "—", "2.5"],
    ["QA", "—", "—", "—", "—", "—", "0.5", "1.0", "1.0", "2.5"],
    ["월 합계", "3.0", "3.5", "3.0", "2.5", "2.5", "3.0", "3.5", "3.5", "24.5"],
]
t = Table(mm_plan, colWidths=[30 * mm, 14 * mm, 14 * mm, 14 * mm, 14 * mm, 14 * mm, 14 * mm, 14 * mm, 14 * mm, 18 * mm])
style = table_style_default(len(mm_plan), total_row_idx=len(mm_plan) - 1)
style.add("ALIGN", (1, 0), (-1, -1), "CENTER")
t.setStyle(style)
story.append(t)
sp(6)

# ══ 6. 부대 비용 ══════════════════════════════════════════════════════
p("6. 부대 비용 (Optional)", H2)
p("외부 서비스 구독료 · API 사용료 등. 발주처 직접 구독 또는 공급자 대행 운영.", SMALL)
sp(2)
extra = [
    ["항목", "내용", "월 예상", "연 예상"],
    ["Vercel Pro", "호스팅 · CI/CD", "25,000", "300,000"],
    ["Supabase Pro", "DB · Auth · Storage", "35,000", "420,000"],
    ["Claude API", "AI 에이전트 호출 (월 1만 쿼리 기준)", "150,000~400,000", "1,800,000~4,800,000"],
    ["Solapi", "SMS/카카오 (건당 사용량)", "사용량", "사용량"],
    ["SweetTracker", "배송 추적", "무료~50,000", "0~600,000"],
    ["도메인 · SSL", "연간", "—", "30,000"],
    ["최소 합계", "", "210,000", "2,550,000"],
    ["최대 합계", "", "510,000", "6,150,000"],
]
t = Table(extra, colWidths=[30 * mm, 65 * mm, 32 * mm, 33 * mm])
style = table_style_default(len(extra))
for idx in [7, 8]:
    style.add("BACKGROUND", (0, idx), (-1, idx), BG_SUB)
    style.add("FONTNAME", (0, idx), (-1, idx), "MalgunBold")
style.add("ALIGN", (2, 0), (-1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(6)

# ══ 7. 유지보수 ═══════════════════════════════════════════════════════
p("7. 유지보수 및 운영지원", H2)
p("검수 완료 후 유지보수 계약(별도) 권장. 3개월 이상 계약 단위.", SMALL)
sp(2)
maint = [
    ["플랜", "내용", "월 비용"],
    ["기본", "장애 대응, 월 5시간 이내 수정, 버그 패치", "1,500,000원"],
    ["표준", "월 20시간 기능 개선, 신규 도구 추가, 긴급 대응", "3,500,000원"],
    ["전담", "개발자 1명 상주/원격 상주, 주 40시간", "6,500,000원"],
]
t = Table(maint, colWidths=[20 * mm, 110 * mm, 30 * mm])
style = table_style_default(len(maint))
style.add("ALIGN", (2, 0), (2, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(6)

# ══ 8. 지급 조건 ═══════════════════════════════════════════════════════
p("8. 지급 조건", H2)
pay = [
    ["차수", "지급 시점", "비율", "금액 (VAT 포함)"],
    ["1차", "계약 체결 시", "30%", "43,116,315원"],
    ["2차", "기본 모듈 검수 (④ 완료)", "30%", "43,116,315원"],
    ["3차", "AI · 외부 연동 검수 (⑥ 완료)", "20%", "28,744,210원"],
    ["4차", "최종 검수 · 배포 완료", "20%", "28,744,210원"],
    ["합계", "", "100%", "143,721,050원"],
]
t = Table(pay, colWidths=[20 * mm, 75 * mm, 25 * mm, 40 * mm])
style = table_style_default(len(pay), total_row_idx=len(pay) - 1)
style.add("ALIGN", (2, 0), (-1, -1), "RIGHT")
t.setStyle(style)
story.append(t)

story.append(PageBreak())

# ══ 9. 특기 사항 ═══════════════════════════════════════════════════════
p("9. 특기 사항 및 전제 조건", H2)

p("9-1. 포함 사항", H3)
for line in [
    "• 상세 요구분석 · 설계 문서 제공",
    "• 전체 소스코드 · DB 스키마 · 배포 스크립트 이관",
    "• 운영 매뉴얼 · API 문서 제공",
    "• 발주처 담당자 사용 교육 (2회, 총 8시간 이내)",
    "• 배포 후 <b>30일간 무상 하자 보수</b> (기능 결함에 한함)",
]:
    p(line, BODY)
sp(4)

p("9-2. 미포함 사항 (별도 견적)", H3)
for line in [
    "• Toss Place POS 연동 — API 계약 · 개발 별도 (약 10~15 MD)",
    "• 고객용 모바일 앱 (iOS/Android) — PRD v3 Phase (약 80~120 MD, 6~8천만원)",
    "• CJ 대한통운 Open API 통합 (송장 자동 발번) — 약 10 MD",
    "• 전자세금계산서 연동 (홈택스 등)",
    "• 기존 시스템(이카운트 등) 데이터 이관 — 별도 분석 후 견적",
    "• 하드웨어: POS 프린터, 바코드 스캐너, 카드 단말기 등",
]:
    p(line, BODY)
sp(4)

p("9-3. 전제 조건", H3)
for line in [
    "• 발주처는 요구사항 확정 후 변경 시 변경관리(CR) 절차 준수",
    "• 발주처 담당자(의사결정자) 주 1회 이상 리뷰 참여",
    "• Cafe24 플러스 플랜 이상 계약 및 OAuth 앱 등록 권한 보유",
    "• Solapi 발신프로필 등록 · 알림톡 채널 인증 완료",
    "• 테스트 환경 계정(역할별 5종) 제공",
]:
    p(line, BODY)
sp(4)

p("9-4. 산출물 목록", H3)
for line in [
    "① 요구사항정의서(PRD) ② 화면설계서(WBS · 와이어프레임) ③ 데이터베이스 설계서(ERD · 테이블 명세)",
    "④ API 명세서 ⑤ 테스트 시나리오 및 결과서(QA Test Plan) ⑥ 배포 가이드 · 운영 매뉴얼",
    "⑦ 소스 코드 일체 및 저장소 권한 이관 ⑧ 사용자 교육 자료",
]:
    p(line, BODY)
sp(4)

p("9-5. 지적재산권", H3)
p("• 본 프로젝트로 개발된 소스코드 및 산출물의 저작권은 <b>발주처에 귀속</b>", BODY)
p("• 범용 오픈소스 라이브러리(MIT/Apache 등)는 각 라이선스에 따름", BODY)
p("• 공급자는 본 프로젝트 수행 경험을 포트폴리오에 기재할 권리 보유", BODY)
sp(6)

# ══ 10. 비교 참고 ═════════════════════════════════════════════════════
p("10. 동급 시스템 견적 비교", H2)
compare = [
    ["구분", "일반 견적 범위", "본 견적"],
    ["국내 대형 SI", "2 ~ 3억원", ""],
    ["중견 SI / 전문 부티크", "1 ~ 1.5억원", "1.44억원 ✓"],
    ["프리랜서 팀 · 에이전시", "0.7 ~ 1억원", ""],
    ["사내 개발팀 자체 구축", "인건비 7천만 ~ 1.2억원", ""],
]
t = Table(compare, colWidths=[50 * mm, 60 * mm, 50 * mm])
style = table_style_default(len(compare))
style.add("BACKGROUND", (0, 2), (-1, 2), BG_SUB)
style.add("FONTNAME", (0, 2), (-1, 2), "MalgunBold")
style.add("ALIGN", (1, 0), (-1, -1), "CENTER")
t.setStyle(style)
story.append(t)
sp(4)
p(
    "본 견적은 <b>중견 SI 수준의 품질을 합리적 가격</b>으로 제공하는 구간에 위치합니다. "
    "AI 에이전트 · 회계 · 배송 등 확장 기능까지 포함한 것을 감안하면, "
    "동일 요건의 국내 대형 SI 견적 대비 <b>30~40% 저렴</b>한 수준입니다.", BODY)
sp(6)

# ══ 11. 할인 ══════════════════════════════════════════════════════════
p("11. 할인 조건", H2)
p("조건 충족 시 아래 할인 적용 가능 (중복 불가, 최대 2가지).", SMALL)
sp(2)
disc = [
    ["조건", "할인율"],
    ["초기 계약 시 50% 선지급", "-3%"],
    ["유지보수 표준 이상 12개월 동시 계약", "-5%"],
    ["발주처 브랜드 사례 공개 동의", "-2%"],
    ["요구사항 확정 후 변경 최소화 (CR 3건 이하)", "-3%"],
]
t = Table(disc, colWidths=[130 * mm, 30 * mm])
style = table_style_default(len(disc))
style.add("ALIGN", (1, 0), (1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(6)

# ══ 12. 투자 회수 ══════════════════════════════════════════════════════
p("12. 투자 회수 분석 (ROI)", H2)
p("본 시스템 도입 시 연간 절감 가치 추정:", BODY)
sp(2)
roi = [
    ["항목", "연간 절감 효과"],
    ["사무 인력 2~3명 업무 자동화 대체", "1억 ~ 1.5억원"],
    ["재고 오차 · POS 수작업 오류 감소", "1 ~ 2천만원"],
    ["카페24 · 회계 · 배송 수기 작업 제거", "1 ~ 3천만원"],
    ["총 연간 절감 가치", "1.2 ~ 2억원"],
    ["투자 회수 기간", "약 8 ~ 12개월"],
]
t = Table(roi, colWidths=[100 * mm, 60 * mm])
style = table_style_default(len(roi))
for idx in [4, 5]:
    style.add("BACKGROUND", (0, idx), (-1, idx), BG_SUB)
    style.add("FONTNAME", (0, idx), (-1, idx), "MalgunBold")
style.add("ALIGN", (1, 0), (1, -1), "RIGHT")
t.setStyle(style)
story.append(t)
sp(10)

# ══ 하단 서명 ═════════════════════════════════════════════════════════
p("본 견적서는 제시된 범위에 한하며, 요구사항 변경 및 범위 확장 시 재견적이 필요합니다.", SMALL)
sp(4)
p(
    "<b>견적 유효기간: 2026-04-08 ~ 2026-05-08</b><br/>"
    "본 견적은 협의 · 할인 여지가 있으며, 최종 금액은 계약서 기준으로 합니다.",
    ParagraphStyle("Notice", parent=SMALL, alignment=TA_CENTER, leading=12))
sp(10)

# 서명란
sig = [
    ["공급자", "발주처"],
    ["", ""],
    ["(수행사명)", "경옥채 주식회사"],
    ["대표이사 (인)", "대표이사 (인)"],
]
t = Table(sig, colWidths=[75 * mm, 75 * mm], rowHeights=[10 * mm, 20 * mm, 8 * mm, 10 * mm])
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

# ══ 페이지 번호 ══════════════════════════════════════════════════════════
def page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Malgun", 8)
    canvas.setFillColor(GRAY_TEXT)
    canvas.drawRightString(200 * mm, 10 * mm, f"- {doc.page} -")
    canvas.setFont("Malgun", 7)
    canvas.drawString(15 * mm, 10 * mm, "경옥채 사내 통합시스템 개발 견적서 (QT-2026-0408-001)")
    # 상단 라인
    if doc.page > 1:
        canvas.setStrokeColor(PRIMARY)
        canvas.setLineWidth(1.5)
        canvas.line(15 * mm, 285 * mm, 200 * mm, 285 * mm)
    canvas.restoreState()

# ── 빌드 ────────────────────────────────────────────────────────────────
out_path = "doc/경옥채_개발견적서_v1.pdf"
doc = SimpleDocTemplate(
    out_path, pagesize=A4,
    leftMargin=15 * mm, rightMargin=15 * mm,
    topMargin=18 * mm, bottomMargin=18 * mm,
    title="경옥채 사내 통합시스템 개발 견적서",
    author="(수행사명)",
)
doc.build(story, onFirstPage=page_number, onLaterPages=page_number)

size_kb = os.path.getsize(out_path) / 1024
print(f"[OK] {out_path} ({size_kb:.1f} KB)")
