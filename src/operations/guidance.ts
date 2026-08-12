export type OperatorGuidance = {
  code: string;
  severity: "info" | "warning" | "error";
  title: string;
  whatHappened: string;
  factoryAction: string;
  userAction: string;
  autoHandled: boolean;
  allowManualRetry: boolean;
};

export function guidanceForError(raw: string | null | undefined, status = ""): OperatorGuidance {
  const text = String(raw ?? "");
  const value = `${status} ${text}`;

  if (/NVIDIA|HTTP[_ ]?(?:429|5\d\d)|524|stream_(?:idle|total)|provider exhausted|initial_response_timeout|empty_stream_content/i.test(value)) {
    return {
      code: "provider-temporary",
      severity: "warning",
      title: "Yapay zekâ sağlayıcısında geçici bağlantı sorunu",
      whatHappened: "NVIDIA modeli zamanında veya kullanılabilir içerikle cevap veremedi. Bu, proje kodunun bozulduğu anlamına gelmez.",
      factoryAction: "Fabrika işi güvenli şekilde bırakır, sağlayıcı bekleme süresi uygular ve otomatik yeniden dener.",
      userAction: "Hiçbir şey yapmayın. Dashboard 'otomatik tekrar planlandı' diyorsa Retry veya Recover düğmesine basmayın.",
      autoHandled: true,
      allowManualRetry: false
    };
  }

  if (/code_patch_json_parse_failed|patch.*json.*parse/i.test(value)) {
    return {
      code: "patch-json-format",
      severity: "warning",
      title: "Kod değişikliği çıktısının formatı okunamadı",
      whatHappened: "Codex Engineer kod önerisini üretti ancak makinenin beklediği JSON sözleşmesine tam uymadı.",
      factoryAction: "0.7.0 ve sonrası önce yerel JSON onarımı, ardından gerektiğinde ayrı JSON düzeltme ajanı kullanır. Eski bu tip bloklar Governor tarafından bir kez otomatik yeniden sıraya alınır.",
      userAction: "Hiçbir şey yapmayın. Aynı hata yeni sürümde tekrar kalıcı BLOCKED olursa Dashboard size açıkça 'Güvenli yeniden dene' önerisi gösterecek.",
      autoHandled: true,
      allowManualRetry: false
    };
  }

  if (/stale_workflow|heartbeat|stalled/i.test(value)) {
    return {
      code: "stale-workflow",
      severity: "warning",
      title: "İş akışı heartbeat vermeyi bıraktı",
      whatHappened: "Bir Workflow uzun süre ilerleme sinyali üretmedi.",
      factoryAction: "Watchdog eski Workflow'u sonlandırıp görevi temiz bir Workflow ile yeniden sıraya alır.",
      userAction: "Normalde hiçbir şey yapmayın. Yalnız Dashboard 'STALLED' durumunu uzun süre korursa 'Takılan İşi Kurtar' düğmesini kullanın.",
      autoHandled: true,
      allowManualRetry: false
    };
  }

  if (/github.*(?:404|not found)|repo_alias_unavailable|permission|forbidden|401|403/i.test(value)) {
    return {
      code: "github-access",
      severity: "error",
      title: "GitHub repo erişimi veya repo ayarı sorunu",
      whatHappened: "Fabrika hedef repository'yi okuyamadı/yazamadı veya gerekli GitHub izni bulunamadı.",
      factoryAction: "İş BLOCKED tutulur; ana branch'e hiçbir şey yazılmaz.",
      userAction: "Dashboard GitHub bölümündeki repo adı ve erişim durumunu düzeltin. Durum OK olduktan sonra yalnız bu görevde 'Güvenli yeniden dene' düğmesine basın.",
      autoHandled: false,
      allowManualRetry: true
    };
  }

  if (/quarantine|revision_budget_exhausted|quality/i.test(value)) {
    return {
      code: "quality-quarantine",
      severity: "info",
      title: "Kalite kapısı çıktıyı karantinaya aldı",
      whatHappened: "Çıktı üretildi fakat bağımsız kalite kontrol yayınlanacak kadar güçlü bulmadı.",
      factoryAction: "Çıktı GitHub'a/ürüne uygulanmaz. Bağımsız diğer görevler çalışmaya devam eder.",
      userAction: "Retry düğmesine rastgele basmayın. Bu bir güvenlik davranışıdır; yeni üst seviye görev veya farklı yaklaşım gerektiğinde fabrika kendisi planlar.",
      autoHandled: true,
      allowManualRetry: false
    };
  }

  if (/blocked|execution failure|failed/i.test(value)) {
    return {
      code: "execution-blocked",
      severity: "error",
      title: "Görev güvenli şekilde durduruldu",
      whatHappened: text || "Görev çalışırken otomatik giderilemeyen bir hata oluştu.",
      factoryAction: "İş fail-closed olarak BLOCKED tutuldu; ürün repository'sine riskli değişiklik yazılmadı.",
      userAction: "Dashboard'daki 'Sorunlar / Çözümler' bölümünü izleyin. 'Güvenli yeniden dene' önerisi görünmüyorsa müdahale etmeyin.",
      autoHandled: false,
      allowManualRetry: false
    };
  }

  return {
    code: "status-info",
    severity: "info",
    title: "Bilgilendirme",
    whatHappened: text || status || "İş durumu güncellendi.",
    factoryAction: "Fabrika normal kontrol döngüsünü sürdürüyor.",
    userAction: "Müdahale gerekmiyor.",
    autoHandled: true,
    allowManualRetry: false
  };
}

export function guidanceTelegramText(g: OperatorGuidance, technical: string): string {
  return `${g.severity === "error" ? "🔴" : g.severity === "warning" ? "🟡" : "🔵"} ${g.title}\nNe oldu: ${g.whatHappened}\nFabrika ne yapıyor: ${g.factoryAction}\nSizin yapacağınız: ${g.userAction}\nTeknik: ${technical.slice(0,700)}`;
}
