# Zihin Factory 0.4.1 — Autonomous Stall Recovery

Bu paket JOB-004..007 otonom Governor katmanını sağlamlaştırır.

Düzeltmeler:
- NVIDIA isteklerine kesin timeout.
- Aynı amaç için ikinci uygun modele otomatik failover.
- Uzun süren `running` Workflow için watchdog.
- Watchdog Cloudflare Workflow instance'ını binding üzerinden terminate eder.
- Stale iş `abandoned` olur; bağlı roadmap işi tekrar `ready` durumuna alınır.
- Governor her cron döngüsünde stale işleri otomatik tarar.
- `/admin/recover-stale` ile aynı recovery işlemi anında çalıştırılabilir.
- Producer / QA aşamalarında heartbeat ve RUN_EVENTS tanılama kayıtları.
- `/factory` artık aktif işleri ve son çalışma olaylarını gösterir.
- Provider tamamen başarısız olursa roadmap sessizce `dispatched` durumunda takılı kalmaz; `blocked` + BLOCKER kaydı oluşur.
- QA kayıtları Workflow step içinde kalıcılaştırılır.
- Factory version: 0.4.1 / schema version: 3.
