-- Migration 032: take the previous vendor's name off the account type.
--
-- `user_type` is fixed by a CHECK constraint written into 030, and 001 through
-- 030 are already recorded in `_sqlx_migrations` with their checksums, so the
-- constraint cannot be corrected at source. SQLite has no ALTER for a CHECK,
-- which leaves rebuilding the table as the only way to change it.
--
-- Every user-scoped table references `users(id)`, so this runs with foreign
-- keys off and verifies the rows survived the copy — the same shape 030 used
-- when it created this table.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
    id                 TEXT PRIMARY KEY NOT NULL,
    user_type          TEXT NOT NULL DEFAULT 'local'
                           CHECK(user_type IN ('local', 'pro')),
    external_user_id   TEXT,
    username           TEXT,
    email              TEXT,
    password_hash      TEXT,
    avatar_path        TEXT,
    jwt_secret         TEXT,
    status             TEXT NOT NULL DEFAULT 'active'
                           CHECK(status IN ('active', 'disabled')),
    session_generation INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    last_login         INTEGER,
    CHECK (
        (user_type = 'local' AND password_hash IS NOT NULL)
        OR
        (user_type = 'pro')
    ),
    CHECK (
        (external_user_id IS NULL)
        OR
        (length(external_user_id) > 0)
    )
);

INSERT INTO users_new (
    id,
    user_type,
    external_user_id,
    username,
    email,
    password_hash,
    avatar_path,
    jwt_secret,
    status,
    session_generation,
    created_at,
    updated_at,
    last_login
)
SELECT
    id,
    CASE WHEN user_type = 'aionpro' THEN 'pro' ELSE user_type END,
    external_user_id,
    username,
    email,
    password_hash,
    avatar_path,
    jwt_secret,
    status,
    session_generation,
    created_at,
    updated_at,
    last_login
FROM users;

CREATE TEMP TABLE account_type_rebrand_checks (
    ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO account_type_rebrand_checks (ok)
SELECT CASE
    WHEN (SELECT COUNT(*) FROM users_new) = (SELECT COUNT(*) FROM users)
    THEN 1
    ELSE 0
END;

INSERT INTO account_type_rebrand_checks (ok)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM users_new WHERE user_type NOT IN ('local', 'pro'))
    THEN 1
    ELSE 0
END;

DROP TABLE account_type_rebrand_checks;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX idx_users_local_username
    ON users(username)
    WHERE user_type = 'local' AND username IS NOT NULL;
CREATE UNIQUE INDEX idx_users_email
    ON users(email)
    WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_users_external_user
    ON users(user_type, external_user_id)
    WHERE external_user_id IS NOT NULL;
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);

PRAGMA foreign_keys = ON;
