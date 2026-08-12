# Zihin Factory 0.4.4 — QA Contract Recovery

Bu patch 0.4.3 logunda görülen iki gerçek sorunu kapatır:

1. Reviewer doğru kalite kararı üretse bile JSON sözleşmesine tam uymadığında `qa_json_parse_failed` ile puanın 0'a düşmesi.
2. Uzun/başarısız reviewer model denemelerinin aynı roadmap işini gereksiz yere uzun süre aktif tutması.

Değişiklikler:
- strict JSON + balanced-object extraction + safe JSON repair + labeled-field fallback
- `<think>` / markdown fence temizleme
- QA raw response artifact olarak saklama (`qa-raw`)
- parse mode kaydı: strict-json / repaired-json / field-fallback / unreadable
- reviewer model önceliğinde daha önce parseable JSON üreten Llama 3.1 70B
- reviewer provider attempt bütçesi 2
- QA Workflow step retry limiti açık ve sınırlı
- Factory Designer acceptance-to-evidence odaklı; repo dili bilinmiyorsa sahte Java/TypeScript kodu üretmiyor
- producer artifact token bütçesi biraz artırıldı
- güvenli `POST /admin/restart-roadmap-job` eklendi; sadece dispatched işi temiz restart eder, DONE işi açmaz
- factory version 0.4.4; schema version değişmedi (4)

- Workflow `runId` artık `step.do` içinde üretilip durable state olarak saklanır; hibernation/restart sonrası orphan RUN_EVENT oluşmaz.
