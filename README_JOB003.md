# JOB-003 — Cloudflare Queue + Recovery Scheduler

Bu paket JOB-002'de doğrulanan NVIDIA + Telegram + D1 + Workflow katmanını korur.

Eklenenler:
- `zihin-factory-jobs` Queue producer binding
- Aynı Worker üzerinde Queue consumer
- Deterministik Workflow instance ID: `job-<jobId>`
- `createBatch()` ile tekrar teslimlerde idempotent Workflow başlatma
- Queue retry + exponential delay
- Dead-letter queue: `zihin-factory-jobs-dlq`
- Her dakika recovery cron
- `POST /admin/recover` ile aynı recovery fonksiyonunun anlık testi
- API `POST /jobs` artık doğrudan Workflow başlatmaz; Queue'ya iş bırakır
- Queue gönderimi geçici hata verirse iş D1'de `queued` kalır ve recovery cron tekrar yollar

Ön koşul:
Cloudflare'da ana queue bir kez oluşturulmalı:
`zihin-factory-jobs`

DLQ consumer konfigürasyonunda tanımlıdır:
`zihin-factory-jobs-dlq`

Secret değerleri GitHub'a yazılmaz.
