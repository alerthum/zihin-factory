# Zihin Factory 0.6.2 — Adaptive Multi-Lane Supervisor

Bu sürüm 0.6.1 dashboard ekranında görülen `0/4` boş bekleme durumunu kapatır.

## Düzeltmeler
- Dashboard artık `ready` olan her işi "uygun" saymaz; dependency durumunu gerçek zamanlı hesaplar.
- `eligibleRoadmap` ve `blockedReadyRoadmap` ayrımı eklendi.
- Hazır ama önceki görev/merge sonucu bekleyen işler açıkça "bağımlılık bekliyor" olarak gösterilir.
- Queue'da Workflow başlangıcını bekleyen işler `startingJobs` olarak görünür ve aktif kapasite hesabına dahil edilir.
- Motor durumu `BAŞLATILIYOR`, `BAĞIMLILIK BEKLİYOR`, `SAĞLAYICI BEKLİYOR` gibi gerçek nedeni gösterir.
- NVIDIA cooldown varsa kullanıcıya "hiçbir şey yapmayın" mesajı dashboard üzerinde görünür.
- Adaptif proje besleyici eklendi: Araştırma/Keşif, İçerik/Tasarım, Kod, Bağımsız Kalite ve Yayın hatları için canlı repo tabanlı faydalı backlog üretir.
- Aynı hat anında sonsuz döngüye girmez; aynı stream için 15 dakikalık kontrollü üretim aralığı vardır.
- Kod hattında insan merge bekleyen bir Draft PR varken yeni otomatik code patch üretilmez.
- Maksimum paralellik 4 olarak korunur; lane başına kapasite 1'dir.
- Eski dependency zincirleri yeni bağımsız adaptive işleri durdurmaz.

Yeni secret gerekmez.
