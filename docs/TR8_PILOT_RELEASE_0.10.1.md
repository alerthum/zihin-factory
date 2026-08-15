# Zihin Factory 0.10.1 — 8. Sınıf Türkçe Paragraf Pilot Adayı

Bu sürüm, mevcut fabrikanın sınırsız ve ölçülemeyen görev üretimini ürün başarısı saymaz. Tek hedefi, `T.8.3.17` ana düşünce ailesi için kanıtlanabilir bir pilot hattı kurmaktır.

## Sürümde bulunan kapılar

- KuzenlerYarisiyor kanonik soru sözleşmesi `3.0`
- üretici, kör çözücü ve son kalite reviewer'ı arasında üç-model ayrımı
- dört yakın şık ve üç ayrı kavram yanılgısı
- cevap uzunluğu, cevap konumu, ipucu sızıntısı ve anlamsal tekrar denetimi
- üç aşamalı ipucu, kanıtlı çözüm grafiği ve seçeneğe özel öğretici geri bildirim
- iki soruluk smoke; 20 soruluk calibration'ı kendiliğinden başlatmaz
- altı boyutlu anonim insan incelemesi
- tam 20 soru incelemesi ve en az `%80` kabul olmadan export yok
- KuzenlerYarisiyor tarafında ikinci kez fail-closed import denetimi

## Yayın sınırı

`0.10.1` metadata değişikliği tek başına Worker deploy etmez, smoke başlatmaz, `main` dalına merge yapmaz veya oyunun canlı whitelist'ini açmaz. Gerçek sıra şöyledir:

1. Taslak PR zinciri insan tarafından incelenir ve sırayla birleştirilir.
2. Ayrı production deploy onayı verilir.
3. Observer canlı sürümün tam `0.10.1` olduğunu kanıtlar.
4. GitHub Actions'tan yalnız iki soruluk smoke açık onayla çalıştırılır.
5. Smoke soruları insan tarafından incelenmeden 20 soruluk calibration başlamaz.
