# Zihin Factory 0.7.0 — Project Director Production Engine

Bu sürüm audit-loop davranışını project-completion loop'a çevirir.

- 15 dakikalık adaptif besleme aralığı kaldırıldı.
- Her çalışma hattı için düşük su seviyesi/backlog hedefi tutulur.
- Governor 4 paralel slotu uygun bağımsız işlerle sürekli doldurur.
- PASS repo keşfi otomatik olarak gerçek `product.code-patch` işine terfi ettirilir.
- Karantina/engel bir hattı bitirmez; Director alternatif faydalı işi hazır tutar.
- Code hattı Draft PR insan merge kapısı varken yeni PR yığmaz.
- Dashboard son 6 saatin tamamlanan/karantina/engel/PR verisini gösterir.
- Güvenlik değişmedi: main'e doğrudan push yok, yalnız QA PASS sonrası Draft PR.
