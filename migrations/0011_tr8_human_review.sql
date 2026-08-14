CREATE TABLE IF NOT EXISTS TR8_HUMAN_REVIEWS (
  review_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  reviewer_anon_id TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REVISE','REJECT')),
  correctness INTEGER NOT NULL CHECK(correctness BETWEEN 1 AND 5),
  option_or_rubric_quality INTEGER NOT NULL CHECK(option_or_rubric_quality BETWEEN 1 AND 5),
  age_language_fit INTEGER NOT NULL CHECK(age_language_fit BETWEEN 1 AND 5),
  hint_non_leakage INTEGER NOT NULL CHECK(hint_non_leakage BETWEEN 1 AND 5),
  feedback_teaching_value INTEGER NOT NULL CHECK(feedback_teaching_value BETWEEN 1 AND 5),
  naturalness INTEGER NOT NULL CHECK(naturalness BETWEEN 1 AND 5),
  critical_blockers_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id,question_id,reviewer_anon_id)
);

CREATE INDEX IF NOT EXISTS IX_TR8_HUMAN_REVIEWS_JOB_QUESTION
ON TR8_HUMAN_REVIEWS(job_id,question_id,created_at);

INSERT INTO FACTORY_META(key,value) VALUES ('schema_version','11')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
