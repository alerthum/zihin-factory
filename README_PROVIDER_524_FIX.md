# Zihin Factory 0.4.2 — NVIDIA 524 Resilience

Bu sürüm JOB-004..007 zincirindeki NVIDIA hosted API 524 hatasını kontrol-plane seviyesinde ele alır.

- Chat completions artık SSE streaming kullanır.
- İlk cevap için 35 saniyelik client timeout vardır; 125 saniyelik upstream 524 beklenmez.
- Stream idle ve toplam süre koruması vardır.
- En fazla 3 farklı uygun model denenir.
- Control-plane görevlerinde daha hızlı instruction modelleri önce tercih edilir.
- Producer token bütçesi 900, QA bütçesi 450 seviyesine düşürüldü.
- NVIDIA 429/5xx/524/timeout hataları transient kabul edilir.
- Transient hata roadmap'i BLOCKED yapmaz; 90 saniye cooldown sonrası otomatik retry eder.
- Governor, `dispatched` kalmış ama bağlı işi failed/abandoned olmuş roadmap kayıtlarını otomatik reconcile eder.
- Başarılı/blocked/quarantine terminal durumları da roadmap ile uzlaştırılır.
- Factory version 0.4.2, schema version 4.
