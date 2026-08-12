# Zihin Factory 0.5.0 — JOB-008 Project Writer

Bu sürüm JOB-004..007 kalite zincirinde kanıtlanan davranışı korur ve JOB-008 GitHub Project Writer katmanını ekler.

## Kapanan konular

- QA sonucu RETRY olduğunda iki normal revizyondan sonra, 75+ puanlı yakın çıktılar için bir adet senior producer escalation çalışır.
- Revizyonlarda ilk güçlü producer modeli mümkün olduğunca pinlenir; daha zayıf modele gereksiz düşüş azaltılır.
- QUARANTINE kalite kararı gevşetilmez. İçerik lane'i karantinaya düşse bile bağımsız infrastructure lane çalışmaya devam eder.
- `GITHUB-WRITER-CONTRACT-003` artık karantinadaki G8TR spec zincirine bağımlı değildir.
- GitHub Project Writer yalnız `factory/*` branch oluşturur ve yalnız draft PR açar. Main'e doğrudan push/merge kodu yoktur.
- GitHub token yalnız Worker secret olarak okunur; D1, artifact, event ve loglara yazılmaz.
- Varsayılan repo aliasları: `factory=alerthum/zihin-factory`, `product=alerthum/Kuzenler_Yarisiyor`.
- `github.project-pr` job tipi gerçek branch + dosya commitleri + draft PR üretir.
- Workflow retry durumunda branch/PR işlemleri job-id tabanlı ve idempotent olacak şekilde tekrar kullanılabilir.
- `.env`, `secrets/` ve `.github/workflows/` yolları writer tarafından korunur.
- İçerikte bilinen token/secret kalıpları görülürse yazma reddedilir.

## Yeni API

- `GET /github/status` — secret/config/readiness ve repo izinlerini gösterir.
- `POST /admin/github/configure` — repo aliaslarını değiştirir.
- `POST /admin/github-smoke` — zihin-factory reposunda güvenli bir smoke dosyası ile draft PR açar.
- `POST /jobs` + `jobType=github.project-pr` — Project Feeder tarafından kullanılacak gerçek PR writer job tipi.

## Secret

Worker'da bir kere `GITHUB_TOKEN` secret'ı tanımlanır.
Fine-grained token yalnız seçili iki repository için en az:
- Contents: Read and write
- Pull requests: Read and write
- Metadata: Read

Factory token değerini hiçbir zaman chat, repo, D1 veya artifact içine koymaz.
