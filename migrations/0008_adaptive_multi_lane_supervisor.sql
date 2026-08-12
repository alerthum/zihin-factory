-- 0.6.2 adaptive multi-lane supervisor
CREATE INDEX IF NOT EXISTS IX_FACTORY_ROADMAP_ROLE_STATUS ON FACTORY_ROADMAP(agent_role,status,updated_at);
