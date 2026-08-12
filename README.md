# zihin-factory

Durable autonomous control plane for **Kuzenler Yarışıyor / Zihin Arenası AE Engine V2**.

Current phase: **Production Loop + Dashboard (0.6.0)**

Operational chain:

`Project Feeder -> Governor -> D1 WORK_QUEUE -> Cloudflare Queue -> Durable Workflow -> Specialist Agent -> Independent QA -> PASS/RETRY/QUARANTINE/BLOCKED -> GitHub factory/* Draft PR -> waiting-human -> merge reconciliation -> next dependent task`

Runtime:
- Cloudflare Workers
- Cloudflare Workflows
- Cloudflare Queues
- Cloudflare D1
- NVIDIA NIM
- GitHub PR-only Project Writer
- Telegram notifications

Dashboard:
- `/dashboard` — public HTML shell; factory data remains Bearer-token protected.
- `/dashboard/api` — protected live control-plane data.

Safety:
- Main branch is never directly written or automatically merged by the factory.
- Product code patching uses only live GitHub files and exact unique `search -> replace` edits.
- Independent QA must PASS before a product Draft PR is created.
- Dependent product work waits until the Draft PR is actually merged.
- Secrets are Worker secrets and are not persisted to D1/artifacts/log output.

The Project Feeder seeds a bounded pilot backlog plus two read-only daily repo audits. This keeps the factory useful while human/CI merge gates are pending without creating uncontrolled write activity.
