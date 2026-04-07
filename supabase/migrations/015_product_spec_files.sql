-- =====================================================
-- 015_product_spec_files.sql
-- 제품 규격 필드 + 다중 파일/이미지 테이블
-- =====================================================

-- 1. products 테이블에 규격 및 설명 컬럼 추가
--    spec: JSONB 자유 키-값 (용량, 성분, 유통기한 등 제품마다 다른 항목)
--    description: 제품 상세 설명 (긴 텍스트)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS spec JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. 제품 다중 파일/이미지 테이블
--    기존 products.image_url(단일)은 유지하되, 추가 파일은 이 테이블에 저장
CREATE TABLE IF NOT EXISTS product_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_type   VARCHAR(20) NOT NULL DEFAULT 'image', -- 'image' | 'document'
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_files_product ON product_files(product_id);

-- RLS
ALTER TABLE product_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_files_select ON product_files
  FOR SELECT TO authenticated USING (true);

CREATE POLICY product_files_all ON product_files
  FOR ALL TO authenticated USING (true);
