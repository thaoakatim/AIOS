-- ==============================================================================
-- AIOS Keycloak Database Initialization Script
-- Tạo database riêng cho Keycloak để cô lập dữ liệu xác thực với aios_db
-- ==============================================================================

SELECT 'CREATE DATABASE aios_keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'aios_keycloak')\gexec

GRANT ALL PRIVILEGES ON DATABASE aios_keycloak TO aios_user;

DO $$
BEGIN
    RAISE NOTICE 'Keycloak Database: aios_keycloak database initialized and permissions granted to aios_user.';
END $$;
