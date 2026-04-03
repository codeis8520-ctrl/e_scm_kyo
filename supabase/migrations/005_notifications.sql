SET search_path TO public;

-- notifications 테이블에 Solapi 연동에 필요한 컬럼 추가
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS error_message        TEXT,
  ADD COLUMN IF NOT EXISTS sent_by              UUID REFERENCES public.users(id);
