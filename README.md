# zihin-factory

24/7 serverless control plane for Kuzenler Yarışıyor / Zihin Arenası AE Engine V2.

Current bootstrap:
- Worker: `zihin-factory-governor`
- D1: `zihin-factory-db`
- Durable Workflow: `zihin-factory-core`
- Persistent WORK_QUEUE / PROJECT_STATE / RUNS / EVENTS / AGENTS / ARTIFACTS / BLOCKERS / METRICS

Endpoints:
- `GET /health`
- `GET /status`
- `GET /jobs`
- `POST /jobs`

Next: Queue → NVIDIA NIM → Telegram → GitHub project worker → quality/eval gates.
