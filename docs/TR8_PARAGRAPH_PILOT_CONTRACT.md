# 8. Sınıf Türkçe Paragraf Pilotu — Kalite Sözleşmesi

Bu pilotta fabrika yeni bir soru biçimi icat etmez. `KuzenlerYarisiyor` içindeki kanonik soru sözleşmesi 3.0, iki depo arasındaki ürün sınırıdır. Fabrika üretir ve kanıtlar; ana proje yalnızca onaylanmış kanonik soruları oyuna uyarlar.

## Yayın kapısı

Bir aday soru şu kanıtlar olmadan pilot paketine giremez:

- 8. sınıf Türkçe kazanımı ve kaynak kimliği,
- dört benzersiz ve konuya bağlı seçenek,
- üç farklı öğrenci yanılgısına bağlı üç çeldirici,
- her yanlış seçenek için kanıt ve öğretici geri bildirim,
- cevabı söylemeyen üç aşamalı ipucu,
- en az üç görünür çözüm adımı,
- birbirinden farklı çözücü ve bağımsız doğrulayıcı,
- cevap uzunluğu sızıntısı ve tekrar kontrolleri,
- üreticinin değiştiremediği 20 ayrı `diversityPlanId`; beş söylem yapısı, dört akıl yürütme yolu ve beş tür arasında dengeli dağılım,
- benchmark kaynaklarından beş kelimeyi aşan ifade kopyasına karşı telif kapısı,
- altı boyutun her birinde en az 4/5 alan anonim insan onayı.

İlk kalibrasyon partisi tam 20 sorudur. Doğru cevap konumları dengeli olmalı, semantik tekrar bulunmamalı, doğru seçeneğin tek başına en uzun olduğu soru oranı yüzde 35'i geçmemeli ve insan kabul oranı en az yüzde 80 olmalıdır. Reddedilen veya düzeltme istenen sorular oyuna aktarılmaz.

Konu, kişi ve nesne adlarını değiştirmek yeni soru kalıbı sayılmaz. Her soru kendisine önceden atanmış benzersiz söylem-yapısı/akıl-yürütme kombinasyonunu taşır; aynı yapısal parmak izi ikinci kez kullanılırsa bütün parti kapanır. Üretici cevap konumunu veya yapısal planı değiştiremez.

## Sorumluluk sınırı

Bu çekirdek üretim Worker'ını veya dashboard'u değiştirmez. Sonraki adım, mevcut 0.10.1 taslağındaki yararlı üretici/bağımsız inceleyici parçalarını bu sözleşmeye bağlamak ve Observer'a yalnızca bu kapının ölçümlerini eklemektir.
