import type { QualityReview } from "../quality/gate";
import type { NvidiaPurpose, ProviderAttemptEvent } from "../providers/nvidia";

export type LearningEnv = { DB: D1Database };

const LESSON_TEXT: Record<string,string> = {
  github_ci_failed: "AI QA sonucunu final başarı sayma. Draft PR sonrasında gerçek GitHub CI sonucunu bekle; failure ise hatayı düzeltme turuna geri taşı.",
  missing_npm_script: "Verification komutundaki her npm run scriptini PR öncesinde package.json scripts ile doğrula; olmayan scripti uydurma.",
  missing_dependency: "Test veya kodun kullandığı bağımlılığın package manifest/lock içinde gerçekten bulunduğunu doğrula; yerel node_modules varlığına güvenme.",
  test_only_production_patch: "Gerçek ürün davranışı isteyen görevde yalnız test dosyalarını değiştirerek problemi çözülmüş sayma; production implementasyonuna dokunan gerçek patch üret veya blocker bildir.",
  workflow_manifest_drift: "CI workflow komutları ile package.json scriptleri arasında drift olup olmadığını deterministic olarak kontrol et.",
  throughput_stall_review_backlog: "İnsan merge kapısını koru ama tek bir waiting-human Draft PR nedeniyle üretim kod hattını sıfırlama. Sınırlı açık PR bütçesi içinde yeni doğrulanmış production patch üretmeye devam et; uzun sessizliği throughput stall olarak kaydet ve kendi kendine teşhis et.",
  acceptance_coverage: "Her kabul kriterini ayrı ayrı somut kanıt, uygulanabilir değişiklik veya test ile karşıla; genel ifadelerle geçme.",
  verification_not_executable: "Verification bölümünde gerçek repo komutu, deterministic kontrol veya ölçülebilir PASS koşulu ver; 'kontrol edilmeli' gibi soyut cümle kullanma.",
  implementation_not_concrete: "Implementation Details bölümünde gerçek sözleşme, dosya/alan, veri akışı, invariant veya test hedefi ver; danışmanlık dili kullanma.",
  test_scope_weak: "Regression/mutation/test planında kapsamı, girişleri, beklenen sonucu ve fail koşulunu açıkça tanımla.",
  invented_context: "Canlı repo kanıtı yoksa dil, dosya, framework, API veya tip uydurma; yalnız verilen kanıta dayan.",
  unclear_contract: "Üretilen kontratı alanlar, giriş/çıkışlar, invariantlar ve hata davranışıyla makinece doğrulanabilir hale getir.",
  generic_output: "Genel tavsiye yerine objective'e doğrudan uygulanabilir, küçük, doğrulanabilir artifact üret.",
  qa_format: "Makine sözleşmesi isteniyorsa yalnız istenen şemayı üret; markdown/fence/ek prose ekleme.",
  short_output: "Çıktıyı acceptance kriterlerini kanıtlayacak kadar tam üret; eksik/yarım artifact bırakma.",
  unknown_quality: "Önceki kalite hatasını tekrar etme; acceptance kriterleriyle satır satır çapraz kontrol yap ve eksik kalan noktayı somutlaştır."
};

const GLOBAL_DEFECT_CODES = new Set(["acceptance_coverage","verification_not_executable","invented_context","generic_output","qa_format","short_output","unclear_contract"]);

export function defectCode(detail: string): string {
  const s=String(detail||"").toLowerCase();
  if (/github_ci_failed|ci failure|github ci fail/.test(s)) return "github_ci_failed";
  if (/missing_npm_script/.test(s)) return "missing_npm_script";
  if (/missing_dependency/.test(s)) return "missing_dependency";
  if (/test_only_production_patch/.test(s)) return "test_only_production_patch";
  if (/workflow_manifest_drift/.test(s)) return "workflow_manifest_drift";
  if (/throughput_stall|review backlog|waiting-human.*freeze|production lane.*freeze/.test(s)) return "throughput_stall_review_backlog";
  if (/acceptance|kabul kriter|criterion|criteria/.test(s) && /(missing|weak|not.*met|yeter|karşılan|coverage|explicit)/.test(s)) return "acceptance_coverage";
  if (/verification|doğrulama/.test(s) && /(missing|vague|weak|command|executable|belirsiz|somut)/.test(s)) return "verification_not_executable";
  if (/implementation|uygulama|implementation-ready|detail/.test(s) && /(missing|weak|vague|not.*clear|belirsiz|insufficient|yetersiz)/.test(s)) return "implementation_not_concrete";
  if (/regression|mutation|test/.test(s) && /(scope|coverage|weak|missing|kapsam|yetersiz|belirsiz)/.test(s)) return "test_scope_weak";
  if (/invent|fabricat|uydur|repo context|language|framework|file path/.test(s)) return "invented_context";
  if (/contract|sözleşme|invariant|schema/.test(s) && /(unclear|weak|missing|belirsiz|yetersiz)/.test(s)) return "unclear_contract";
  if (/generic|consultancy|boilerplate|genel|soyut/.test(s)) return "generic_output";
  if (/json|parse|machine-readable|format/.test(s)) return "qa_format";
  if (/too_short|too short|short output|yarım|eksik çıktı/.test(s)) return "short_output";
  return "unknown_quality";
}

function lessonFor(code:string): string { return LESSON_TEXT[code] ?? LESSON_TEXT.unknown_quality; }

export async function recordQualityLearning(db:D1Database,input:{jobId:string;runId:string;producerRole:string;attemptNo:number;review:QualityReview}):Promise<void>{
  if (input.review.decision === "PASS") {
    await db.prepare(`UPDATE FACTORY_LESSONS SET resolved_successes=resolved_successes+1,last_resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE scope_type='role' AND scope_key=? AND active=1`).bind(input.producerRole).run();
    return;
  }
  const details=[...input.review.reasons,...input.review.deterministicIssues];
  const seen=new Set<string>();
  for (const detail of details) {
    const code=defectCode(detail);
    if (seen.has(code)) continue;
    seen.add(code);
    const lesson=lessonFor(code);
    const statements = [
      db.prepare(`INSERT INTO QUALITY_DEFECTS(id,job_id,run_id,producer_role,defect_code,detail,attempt_no) VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),input.jobId,input.runId,input.producerRole,code,String(detail).slice(0,1600),input.attemptNo),
      db.prepare(`INSERT INTO FACTORY_LESSONS(id,scope_type,scope_key,defect_code,lesson_text,severity,occurrences,active,first_seen_at,last_seen_at,updated_at)
        VALUES (?,'role',?,?,?,'medium',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(scope_type,scope_key,defect_code) DO UPDATE SET occurrences=occurrences+1,last_seen_at=CURRENT_TIMESTAMP,lesson_text=excluded.lesson_text,active=1,updated_at=CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(),input.producerRole,code,lesson)
    ];
    if (GLOBAL_DEFECT_CODES.has(code)) {
      statements.push(db.prepare(`INSERT INTO FACTORY_LESSONS(id,scope_type,scope_key,defect_code,lesson_text,severity,occurrences,active,first_seen_at,last_seen_at,updated_at)
        VALUES (?,'global','all',?,?,'medium',1,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(scope_type,scope_key,defect_code) DO UPDATE SET occurrences=occurrences+1,last_seen_at=CURRENT_TIMESTAMP,lesson_text=excluded.lesson_text,active=1,updated_at=CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(),code,lesson));
    }
    await db.batch(statements);
  }
}

export async function learnedPromptForRole(db:D1Database,role:string):Promise<string>{
  const rows=await db.prepare(`SELECT defect_code,lesson_text,occurrences,resolved_successes,scope_type FROM FACTORY_LESSONS WHERE active=1 AND ((scope_type='role' AND scope_key=?) OR (scope_type='global' AND scope_key='all')) ORDER BY occurrences DESC,last_seen_at DESC LIMIT 10`).bind(role).all<{defect_code:string;lesson_text:string;occurrences:number;resolved_successes:number;scope_type:string}>();
  if (!rows.results.length) return "";
  const lines=rows.results.map((x,i)=>`${i+1}. [${x.scope_type === "global" ? "tüm müdürler" : role}; ${x.defect_code}; tekrar=${x.occurrences}] ${x.lesson_text}`);
  return `\n\nFABRİKANIN ÖNCEKİ KALİTE DERSLERİ — bunlar önceki görevlerden öğrenildi ve tekrar edilmemelidir:\n${lines.join("\n")}\nÇıktıyı teslim etmeden önce bu dersleri acceptance kriterleriyle birlikte self-check yap.`;
}

export async function recordProviderAttempt(db:D1Database,event:ProviderAttemptEvent):Promise<void>{
  const now=Date.now();
  if (event.outcome === "success") {
    await db.prepare(`INSERT INTO PROVIDER_MODEL_STATS(purpose,model,successes,total_latency_ms,consecutive_failures,last_success_at,cooldown_until,updated_at)
      VALUES (?,?,1,?,0,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
      ON CONFLICT(purpose,model) DO UPDATE SET successes=successes+1,total_latency_ms=total_latency_ms+excluded.total_latency_ms,consecutive_failures=0,last_success_at=CURRENT_TIMESTAMP,last_error=NULL,cooldown_until=NULL,updated_at=CURRENT_TIMESTAMP`)
      .bind(event.purpose,event.model,Math.max(0,Math.round(event.latencyMs??0))).run();
    return;
  }
  if (event.outcome !== "failure") return;
  const err=String(event.error??"");
  const timeout=/timeout|524|HTTP_5\d\d|HTTP_429/i.test(err) ? 1 : 0;
  const empty=/empty_stream_content/i.test(err) ? 1 : 0;
  const prior=await db.prepare(`SELECT consecutive_failures FROM PROVIDER_MODEL_STATS WHERE purpose=? AND model=?`).bind(event.purpose,event.model).first<{consecutive_failures:number}>();
  const consecutive=Math.max(1,Number(prior?.consecutive_failures??0)+1);
  const cooldownMinutes=Math.min(60,Math.max(3,Math.pow(2,Math.min(5,consecutive-1))*3));
  const cooldownIso=new Date(now+cooldownMinutes*60_000).toISOString();
  await db.prepare(`INSERT INTO PROVIDER_MODEL_STATS(purpose,model,failures,timeout_failures,empty_failures,consecutive_failures,total_latency_ms,last_failure_at,last_error,cooldown_until,updated_at)
    VALUES (?,?,1,?,?,1,?,CURRENT_TIMESTAMP,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(purpose,model) DO UPDATE SET failures=failures+1,timeout_failures=timeout_failures+excluded.timeout_failures,empty_failures=empty_failures+excluded.empty_failures,consecutive_failures=?,total_latency_ms=total_latency_ms+excluded.total_latency_ms,last_failure_at=CURRENT_TIMESTAMP,last_error=excluded.last_error,cooldown_until=excluded.cooldown_until,updated_at=CURRENT_TIMESTAMP`)
    .bind(event.purpose,event.model,timeout,empty,Math.max(0,Math.round(event.latencyMs??0)),err.slice(0,1400),cooldownIso,consecutive).run();
}

export async function providerRoutingHints(db:D1Database,purpose:NvidiaPurpose):Promise<{preferredModels:string[];avoidModels:string[]}>{
  const rows=await db.prepare(`SELECT model,successes,failures,total_latency_ms,cooldown_until,consecutive_failures FROM PROVIDER_MODEL_STATS WHERE purpose=? ORDER BY updated_at DESC LIMIT 50`).bind(purpose).all<{model:string;successes:number;failures:number;total_latency_ms:number;cooldown_until:string|null;consecutive_failures:number}>();
  const now=Date.now();
  const avoid:string[]=[];
  const candidates: Array<{model:string;score:number}>=[];
  for (const r of rows.results) {
    if (r.cooldown_until && Date.parse(r.cooldown_until)>now) { avoid.push(r.model); continue; }
    const attempts=Math.max(1,r.successes+r.failures);
    const successRate=r.successes/attempts;
    const avgLatency=r.successes>0 ? r.total_latency_ms/Math.max(1,r.successes) : 120000;
    const score=successRate*100 - Math.min(40,avgLatency/3000) - r.consecutive_failures*10 + Math.min(10,r.successes);
    candidates.push({model:r.model,score});
  }
  candidates.sort((a,b)=>b.score-a.score);
  return {preferredModels:candidates.map(x=>x.model),avoidModels:avoid};
}

export async function recordOperationalLearning(db:D1Database,input:{jobId?:string|null;runId?:string|null;producerRole:string;defectCode:string;detail:string;attemptNo?:number}):Promise<void>{
  const code=input.defectCode || defectCode(input.detail);
  const lesson=lessonFor(code);
  await db.batch([
    db.prepare(`INSERT INTO QUALITY_DEFECTS(id,job_id,run_id,producer_role,defect_code,detail,attempt_no) VALUES (?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),input.jobId??null,input.runId??null,input.producerRole,code,input.detail.slice(0,3000),input.attemptNo??null),
    db.prepare(`INSERT INTO FACTORY_LESSONS(id,scope_type,scope_key,defect_code,lesson_text,severity,occurrences,resolved_successes,active,first_seen_at,last_seen_at,updated_at)
      VALUES (?,'role',?,?,?,'high',1,0,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT(scope_type,scope_key,defect_code) DO UPDATE SET occurrences=occurrences+1,lesson_text=excluded.lesson_text,severity='high',active=1,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(),input.producerRole,code,lesson)
  ]);
}

export async function learningSummary(db:D1Database){
  const lessons=await db.prepare(`SELECT defect_code,SUM(occurrences) AS occurrences,SUM(resolved_successes) AS resolved FROM FACTORY_LESSONS WHERE active=1 GROUP BY defect_code ORDER BY occurrences DESC LIMIT 12`).all<{defect_code:string;occurrences:number;resolved:number}>();
  const providers=await db.prepare(`SELECT purpose,model,successes,failures,consecutive_failures,cooldown_until,last_error FROM PROVIDER_MODEL_STATS ORDER BY purpose,successes DESC,failures ASC`).all();
  const repeated=await db.prepare(`SELECT COUNT(*) AS count FROM FACTORY_LESSONS WHERE scope_type='role' AND occurrences>=2 AND active=1`).first<{count:number}>();
  const firstPass=await db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN decision='PASS' THEN 1 ELSE 0 END) AS passed FROM QUALITY_REVIEWS WHERE attempt_no=1 AND datetime(created_at)>=datetime('now','-6 hours')`).first<{total:number|null;passed:number|null}>();
  const defects6h=await db.prepare(`SELECT COUNT(*) AS total,COUNT(DISTINCT defect_code) AS unique_count FROM QUALITY_DEFECTS WHERE datetime(created_at)>=datetime('now','-6 hours')`).first<{total:number|null;unique_count:number|null}>();
  const total=Number(firstPass?.total??0), passed=Number(firstPass?.passed??0);
  return {lessons:lessons.results,providers:providers.results,repeatedKnownDefects:Number(repeated?.count??0),firstPass:{total,passed,rate:total?Math.round(passed*1000/total)/10:0},defects6h:{total:Number(defects6h?.total??0),unique:Number(defects6h?.unique_count??0)}};
}
