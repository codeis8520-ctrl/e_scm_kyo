-- ═════════════════════════════════════════════════════════════════════════
-- 113_branch_company_info → 지점별 공급자(사업자) 정보 (#99 거래명세서)
--
-- 배경: 거래명세서 공급자 정보를 로그인 사용자의 소속 지점 기준으로 채우려면
--   지점에 사업자등록번호·상호(법인명)·대표자명이 필요. 지점관리에서 편집.
--   주소·전화는 기존 branches.address·phone 재사용.
-- ═════════════════════════════════════════════════════════════════════════

SET search_path TO public;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS business_number varchar(20),   -- 사업자등록번호
  ADD COLUMN IF NOT EXISTS company_name    varchar(100),  -- 상호(법인명)
  ADD COLUMN IF NOT EXISTS ceo_name        varchar(50);   -- 대표자명
