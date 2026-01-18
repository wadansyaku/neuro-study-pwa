CREATE TABLE IF NOT EXISTS user_migrations (
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_migrations_user ON user_migrations (user_id);
