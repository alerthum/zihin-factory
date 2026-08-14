# 8. Sınıf Türkçe Benchmark İşi

Cloudflare Worker production'a alınmadan hiçbir iş başlamaz. Bu değişiklik yalnız taslak PR'dır.

Birleştirme ve kontrollü deployment sonrasında mevcut yetkili `POST /jobs` yolu şu sınırlı işi kabul eder:

```json
{
  "jobType": "assessment.tr8-paragraph-benchmark",
  "priority": 20,
  "payload": {
    "batchId": "tr8-smoke-001",
    "sampleSize": 2,
    "maxAttempts": 2,
    "themes": ["kültür ve gündelik yaşam", "çevre gözlemi"],
    "morphologyNotes": ["Cevap en az üç kanıt biriminin sentezini gerektirir."]
  }
}
```

Varsayılan smoke partisi iki sorudur. Her soru en fazla iki kez üretilir. Üretici, cevabı görmeden çözen kör reviewer ve tam paketi denetleyen kalite reviewer'ı üç farklı model olmak zorundadır. Deterministik kapılardan veya bağımsız cevap çözümünden geçmeyen aday insan incelemesine ulaşamaz.

İş sonucu `PENDING_HUMAN_REVIEW` olsa bile `pilotReady` değeri `false` kalır. Gerçek öğretmen/uzman kararları tamamlanmadan 20 soruluk paket KuzenlerYarisiyor'a aktarılamaz.
