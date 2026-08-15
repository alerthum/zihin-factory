-- 0.10.1 is the first bounded 8th-grade Turkish paragraph pilot release.
-- This migration changes release metadata only; it does not start a job or deploy a Worker.
INSERT INTO FACTORY_META(key,value,updated_at) VALUES ('factory_version','0.10.1',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;

INSERT INTO FACTORY_META(key,value,updated_at) VALUES ('schema_version','12',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;
