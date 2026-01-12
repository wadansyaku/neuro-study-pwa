CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_deck_external_unique
  ON questions (deck_id, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_question_options_question_key_unique
  ON question_options (question_id, option_key);

CREATE INDEX IF NOT EXISTS idx_questions_deck_external
  ON questions (deck_id, external_id);

CREATE INDEX IF NOT EXISTS idx_progress_user_deck_question
  ON progress_cards (user_id, deck_id, question_id);

CREATE INDEX IF NOT EXISTS idx_test_sessions_user_deck_started
  ON test_sessions (user_id, deck_id, started_at DESC);
