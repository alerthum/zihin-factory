# Zihin Factory 0.6.0 — JOB-009 Dashboard + Project Feeder + Production Loop

Bu sürüm fabrikanın kurulum aşamasını kapatan production control-plane paketidir.

## Dashboard

Public shell: `/dashboard`

Dashboard veri API'si korumalıdır. Tarayıcı FACTORY_ADMIN_TOKEN değerini yalnız `sessionStorage` içinde tutar ve `/dashboard/api` isteklerinde Bearer header olarak gönderir. Token HTML içine gömülmez, D1/artifact/log içine yazılmaz.

Dashboard bölümleri:
- Fabrika durumu, Governor, queue, active job
- Müdürler / ajanlar ve canlı görevleri
- Roadmap: ready / dispatched / done / quarantine / blocked / waiting-human
- Zihin Arenası etkisi ve “bugün ne yaptı?”
- GitHub branch / Draft PR / merge bekleyen işler
- QA puanları ve kararları
- Canlı event stream
- Blocker merkezi
- Güvenli Resume / Pause / Governor Now / Project Feed / Recover / Roadmap Retry kontrolleri

## Project Feeder

Feeder canlı `alerthum/KuzenlerYarisiyor` reposunu hedefler. İlk üretim hattı:
1. Canlı repo keşfi / gerçek yol haritası
2. 8. sınıf Türkçe native integration için bounded code patch
3. Independent QA
4. QA PASS ise yalnız `factory/*` branch + Draft PR
5. Roadmap `waiting-human` olur
6. PR merge edilince cron bunu otomatik algılar ve bağımlı regression/mutation patch'ini serbest bırakır

Ayrıca iki günlük read-only audit görevi otomatik seed edilir. Böylece merge beklerken fabrika kalite/repo keşfi üretmeye devam eder; doğrudan main yazmaz.

## Code patch güvenlik sözleşmesi

- Model repo yolu uyduramaz; yalnız GitHub tree'den gelen mevcut yollar seçilebilir.
- Model tam dosya yazmaz. Yalnız exact `search -> replace` edit JSON üretir.
- `search` canlı dosyada tam bir kez eşleşmek zorundadır.
- En fazla 2 dosya, dosya başına en fazla 4 edit.
- Placeholder ve secret-pattern fail-closed.
- Worker değişiklikleri canlı kaynak içeriğine deterministik olarak uygular.
- Independent QA PASS olmadan GitHub write yapılmaz.
- Main branch'e doğrudan push/merge yoktur.
- Draft PR merge edilmeden bağımlı patch `done` sayılmaz.

## D1

Yeni tablolar:
- `PROJECT_IMPACT`
- `PROJECT_FEED_LOG`

`ensureSchema()` ilk Worker isteğinde tabloları güvenli `CREATE TABLE IF NOT EXISTS` ile oluşturur. Ayrı manuel D1 migration komutu gerektirmez.

## Sürüm
- factory_version: `0.6.0`
- schema_version: `6`
- phase: `production-loop-dashboard`
