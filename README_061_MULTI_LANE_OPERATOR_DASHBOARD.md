# Zihin Factory 0.6.1 — Multi-Lane + Türkçe Operatör Dashboard

Bu sürüm 0.6.0 production loop üzerine güvenli paralel çalışma ve operatör yönlendirmesi ekler.

- En fazla 4 bağımsız iş aynı anda çalışır.
- Hatlar: Araştırma/Keşif, İçerik/Tasarım, Kod, Bağımsız Kalite, Yayın/Release.
- Aynı Kod hattında yalnız 1 iş çalışır; bağımlılıklar korunur.
- `code_patch_json_parse_failed` için yerel JSON onarımı + ayrı JSON repair ajanı vardır.
- 0.6.0'dan kalan bu parser hatalı BLOCKED görevler Governor tarafından otomatik yeniden sıraya alınır.
- Dashboard tamamen Türkçe operatör görünümüne geçirilmiştir.
- Müdürlerin Türkçe görev açıklamaları gösterilir.
- QA puanı ile proje yüzdesi ayrımı açıkça gösterilir.
- Sorunlar / Çözümler ekranı: Ne oldu? Fabrika ne yapıyor? Kullanıcı ne yapmalı?
- NVIDIA geçici hatalarında kullanıcı müdahalesi istenmez; otomatik retry açıkça belirtilir.
- Telegram hata bildirimleri aynı operatör yönlendirmesini içerir.
- Retry yalnız dashboard güvenli şekilde önerdiğinde gösterilir.
- Üst komutların görevleri dashboard içinde açıklanır.
- Tarih formatlamadaki `Invalid Date` sorunu düzeltilmiştir.
