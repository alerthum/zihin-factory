-- 0.7.0 project director / continuous backlog compiler
CREATE INDEX IF NOT EXISTS IX_PROJECT_FEED_LOG_ACTION_ROADMAP ON PROJECT_FEED_LOG(action,roadmap_id,created_at);
CREATE INDEX IF NOT EXISTS IX_FACTORY_ROADMAP_JOBTYPE_STATUS ON FACTORY_ROADMAP(job_type,status,updated_at);
