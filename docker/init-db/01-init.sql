-- ==============================================================================
-- AIOS PostgreSQL Initialization Script
-- Kích hoạt các extension cần thiết cho AIOS:
-- 1. vector: Hỗ trợ lưu trữ và tìm kiếm vector embeddings (pgvector) cho RAG
-- 2. uuid-ossp: Hỗ trợ sinh UUID cho các thực thể quan hệ
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    RAISE NOTICE 'AIOS Database: Extensions vector and uuid-ossp successfully enabled.';
END $$;

