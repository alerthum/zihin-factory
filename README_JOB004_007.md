# JOB-004..007 — Autonomous Governor + Agent Router + Independent QA + Continuous Loop

This package upgrades the already-PASS JOB-003 infrastructure without changing platform architecture.

## Added
- Governor with persistent roadmap and lock
- Specialist agent router
- Independent QA Supervisor model call
- PASS / RETRY / QUARANTINE / BLOCKED gates
- Up to two bounded autonomous revisions
- Producer/reviewer model separation when NVIDIA has an alternative model
- Persistent QUALITY_REVIEWS and JOB_DECISIONS
- Sequential roadmap dependencies
- Immediate governor wake after a job ends
- 1-minute cron as durable fallback
- Start/pause/cycle admin endpoints
- Initial bounded roadmap for Grade-8 Turkish native integration and GitHub writer contract

## Important
`continuous_enabled` is intentionally OFF on first deployment. The supplied PowerShell test validates the system and then turns it ON through `POST /admin/start`.

After PASS, browser/PowerShell may be closed. Cloudflare Queue + Workflow + Cron continue the seeded roadmap.
