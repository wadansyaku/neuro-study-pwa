CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_user (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decks (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id bigserial PRIMARY KEY,
  deck_id text NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  external_id text,
  type text NOT NULL,
  type_raw text,
  stem text NOT NULL,
  explanation text,
  topic text,
  tag text,
  answer_keys text[] NOT NULL DEFAULT '{}',
  answer_texts text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_options (
  id bigserial PRIMARY KEY,
  question_id bigint NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_key text NOT NULL,
  option_text text NOT NULL,
  option_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS progress_cards (
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  deck_id text NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  seen int NOT NULL DEFAULT 0,
  correct int NOT NULL DEFAULT 0,
  wrong int NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  last_answered_at timestamptz,
  last_imported_at timestamptz,
  sr_due_at timestamptz NOT NULL DEFAULT now(),
  sr_interval_days int NOT NULL DEFAULT 0,
  sr_ease float NOT NULL DEFAULT 2.5,
  sr_reps int NOT NULL DEFAULT 0,
  sr_lapses int NOT NULL DEFAULT 0,
  sr_last_grade text,
  mistake_last_reason text,
  mistake_reason_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  mistake_last_note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  deck_id text NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  session_id uuid,
  is_correct boolean NOT NULL,
  grade text,
  chosen_answers text[] NOT NULL DEFAULT '{}',
  elapsed_ms int,
  reason text,
  note text,
  answered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_sessions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  deck_id text NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  mode text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_sec int,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS test_session_items (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  question_id bigint NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  order_index int NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_deck_tag ON questions (deck_id, tag);
CREATE INDEX IF NOT EXISTS idx_questions_deck_topic ON questions (deck_id, topic);
CREATE INDEX IF NOT EXISTS idx_progress_due ON progress_cards (user_id, deck_id, sr_due_at);
CREATE INDEX IF NOT EXISTS idx_progress_seen ON progress_cards (user_id, deck_id, seen);
CREATE INDEX IF NOT EXISTS idx_attempts_user_answered ON attempts (user_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_session_items_order ON test_session_items (session_id, order_index);
