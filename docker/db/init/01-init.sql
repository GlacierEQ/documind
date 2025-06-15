-- Documind Database Initialization

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create user table if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = 'users') THEN
        CREATE TABLE users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE,
            full_name VARCHAR(255),
            role VARCHAR(50) DEFAULT 'user',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP WITH TIME ZONE
        );

        -- Create default admin user (password: admin)
        INSERT INTO users (username, password, email, full_name, role)
        VALUES ('admin', crypt('admin', gen_salt('bf')), 'admin@example.com', 'Admin User', 'admin');
    END IF;
END $$;

-- Create other essential tables if they don't exist yet
-- These will typically be created by the application on startup,
-- but we ensure basic structure exists for initial deployment
