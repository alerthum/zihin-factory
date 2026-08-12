# Zihin Factory 0.4.3 — QA heartbeat + score normalization

Observed 0.4.2 behavior proved streaming/failover works, but also exposed a watchdog race: a legitimate long QA model call could stay inside one Workflow step longer than the stale window, so the Governor could abandon it and restart the same roadmap item.

0.4.3 fixes that without changing the architecture:
- Provider streaming emits best-effort D1 heartbeats while a model is active.
- Stale watchdog therefore measures real inactivity, not merely long inference duration.
- Dynamic model discovery now recognizes version-suffixed instruct/reasoning model IDs, increasing the chance of a smaller independent reviewer model.
- Provider time budgets are tightened to fail over sooner.
- QA contract explicitly requires 0..100 scoring. Fractional 0..1 scores are normalized defensively (0.8 => 80).
- QA completion events are persisted, making progress visible in `/factory`.
- Cron stale threshold is 5 minutes, while heartbeats refresh healthy active jobs.

No new secret and no D1 schema migration is required. Schema remains v4; factory version is 0.4.3.
