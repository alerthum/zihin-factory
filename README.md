# zihin-factory

Serverless autonomous control plane for Kuzenler Yarışıyor / Zihin Arenası AE Engine V2.

Current phase: **Autonomous Governor**

Operational chain:

`Roadmap -> Governor -> D1 WORK_QUEUE -> Cloudflare Queue -> Durable Workflow -> Specialist Agent -> Independent QA -> PASS/RETRY/QUARANTINE/BLOCKED -> Artifact/Decision persistence -> Governor wake -> next task`

Runtime:
- Cloudflare Workers
- Cloudflare Workflows
- Cloudflare Queues
- Cloudflare D1
- NVIDIA NIM
- Telegram notifications

Admin endpoints require `FACTORY_ADMIN_TOKEN`; `/health` is public.

The first autonomous roadmap is bounded. The factory does **not** create infinite AI work when the seeded roadmap is exhausted.
