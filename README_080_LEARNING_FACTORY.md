# Zihin Factory 0.8.0 — Learning Memory + Adaptive Model Router

Bu sürümün amacı yeni müdür eklemek değil, fabrikanın **aynı bilinen hatayı tekrar tekrar yapmasını azaltmak** ve NVIDIA model seçimini kalıcı sağlık verisine göre yönetmektir.

## Temel değişiklikler

- QA nedenleri `QUALITY_DEFECTS` tablosunda normalize edilir.
- Her hata rol bazlı `FACTORY_LESSONS` hafızasına yazılır.
- Genel nitelikteki hatalar (`acceptance coverage`, doğrulama eksikliği, repo uydurma, generic çıktı, JSON formatı vb.) bütün müdürlerin ortak dersine de yazılır.
- Bir müdür yeni göreve başlamadan önce kendi ve ortak fabrika derslerini promptuna yükler.
- Aynı hata tekrarlandıkça occurrence sayısı artar; dashboard bunun düşüp düşmediğini gösterir.
- İlk denemede QA geçiş oranı ayrı KPI olarak izlenir.

## NVIDIA / model yönlendirme

- Model sırası artık yalnız sabit array değildir.
- Her producer/reviewer/coder model denemesi başarı/hata/gecikme olarak `PROVIDER_MODEL_STATS` tablosuna yazılır.
- Timeout, 524, boş stream veya benzeri hata alan model exponential cooldown'a alınır.
- Sonraki işte cooldown'daki model ilk sırada tekrar denenmez.
- Başarılı ve daha hızlı modeller aynı amaç için öne çıkarılır.
- Tüm sağlıklı modeller tükenirse iş fail-closed olur ve otomatik retry planlanır.

## Telegram sinyal politikası

- Aynı kalite karantinası türü 60 dakika içinde tekrar tekrar Telegram'a yağdırılmaz.
- Aynı geçici provider problemi 60 dakika içinde tek uyarıya düşürülür.
- Ürün Draft PR ve gerçek görev tamamlanması olumlu bildirim olarak kalır.
- Her 6 saatte tek fabrika özeti gönderilir: iş, tamamlanan, karantina, blocker, ürün PR, merge ve öğrenme hafızası.

## Dashboard

Yeni **Fabrika Öğrenmesi** sekmesi:
- İlk denemede kalite geçiş oranı
- Tekrarlanan bilinen hata sayısı
- Son 6 saat kalite hata sayısı
- Kalıcı kalite dersleri
- NVIDIA model sağlık tablosu / cooldown durumu

## Gerçekçi kalite hedefi

Amaç bütün LLM üretimlerinin hata oranını matematiksel olarak %0.1 yapmak değildir. Açık uçlu üretimde yeni hata sınıfları her zaman oluşabilir. Hedef:
- **bilinen/tekrarlayan aynı hata sınıfını sıfıra yaklaştırmak**,
- machine-readable contract ve deterministic gate hatalarını çok düşük seviyeye indirmek,
- provider transient hatalarını kullanıcı müdahalesi olmadan yönetmek,
- gerçek ürün PR throughput'unu yükseltmektir.

Bu sürüm, 0.7.0 Project Director üretim döngüsünü değiştirmez; onun önüne kalıcı deneyim hafızası ve adaptif model router koyar.
