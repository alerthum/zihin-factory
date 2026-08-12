import { getPullRequest } from "../providers/github";

export type ProjectFeederEnv = {
  DB: D1Database;
  GITHUB_TOKEN?: string;
};

export type ProjectFeederResult = {
  enabled: boolean;
  seeded: number;
  merged: number;
  closedUnmerged: number;
  waitingHuman: number;
  action: string;
  promoted?: number;
};

type SeedItem = {
  id: string;
  sequence: number;
  title: string;
  jobType: string;
  role: string;
  objective: string;
  acceptance: string[];
  deps: string[];
  payload: Record<string, unknown>;
};

async function stateValue(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM PROJECT_STATE WHERE key=?`).bind(key).first<{value:string}>();
  return row?.value ?? null;
}

async function setState(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO PROJECT_STATE(key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`
  ).bind(key,value).run();
}

const BASELINE: SeedItem[] = [
  {
    id:"ZA-PRODUCT-RECON-001",
    sequence:1000,
    title:"Zihin Arenası canlı repo keşfi ve 8. sınıf Türkçe native integration hedef haritası",
    jobType:"product.repo-recon",
    role:"Structure Miner",
    objective:"Canlı alerthum/KuzenlerYarisiyor reposunu yalnız gerçek GitHub dosya ağacı ve okunan dosyalar üzerinden keşfet. Mevcut PROJECT_STATE ve gerçek kaynak yollarını kullanarak 8. sınıf Türkçe verified integration 7/10 durumundan kalan production-native boşlukların hangi gerçek dosya/kontrat/test alanlarında bulunduğunu implementation-ready repo map olarak çıkar. Dosya veya dil uydurma.",
    acceptance:[
      "Canlı repo default branch, PROJECT_STATE.json ve package.json kanıtı kullanılmalı.",
      "Gerçek dosya yollarından en az 5 ilgili aday yol listelenmeli; olmayan dosya uydurulmamalı.",
      "8. sınıf Türkçe kalan integration işi mevcut mimariyi bozmadan somut kod/test hedeflerine ayrılmalı.",
      "Static question bank yaklaşımına dönülmemeli; ECD + AIG factory sözleşmesi korunmalı.",
      "İlk güvenli code-patch için gerçek dosya hedefleri ve doğrulama komutları önerilmeli."
    ],
    deps:[],
    payload:{ repoAlias:"product",focus:"g8-turkish-native-integration",impactArea:"8. Sınıf Türkçe" }
  },
  {
    id:"ZA-G8TR-NATIVE-PATCH-002",
    sequence:1010,
    title:"8. sınıf Türkçe native integration ilk production code patch",
    jobType:"product.code-patch",
    role:"Codex Engineer",
    objective:"Canlı Zihin Arenası reposunda 8. sınıf Türkçe native integration 7/10 -> 10/10 hedefi için en küçük, gerçek ve doğrulanabilir production kod/test iyileştirmesini hazırla. Yalnız GitHub'dan okunmuş mevcut dosyaları değiştir. Mevcut mimariyi ve dili koru. Sonuç yalnız QA PASS sonrasında factory/* branch üzerinde Draft PR olmalı.",
    acceptance:[
      "Yalnız gerçekten okunmuş mevcut repo dosyaları değiştirilmeli; hayali dosya veya dil kullanılmamalı.",
      "En fazla 2 dosyalık küçük ve geri alınabilir değişiklik yapılmalı.",
      "Değişiklik 8. sınıf Türkçe native integration veya onu doğrulayan test kapısına doğrudan katkı sağlamalı.",
      "Static bank veya game-specific ayrı soru motoru oluşturulmamalı.",
      "Değişikliğin doğrulama/test komutları açıkça belirtilmeli ve bağımsız QA PASS olmadan GitHub'a yazılmamalı.",
      "Main branch'e doğrudan push/merge yapılmamalı; yalnız Draft PR oluşturulmalı."
    ],
    deps:[],
    payload:{ repoAlias:"product",focus:"8th grade Turkish native integration, assessment/item factories, quiz runtime and targeted tests",impactArea:"8. Sınıf Türkçe",maxFiles:2 }
  },
  {
    id:"ZA-G8TR-TEST-GATES-003",
    sequence:1020,
    title:"8. sınıf Türkçe native integration regression ve mutation gate patch",
    jobType:"product.code-patch",
    role:"Codex Engineer",
    objective:"Önceki production PR merge edildikten sonra canlı main üzerinden 8. sınıf Türkçe native integration için en eksik regression/mutation doğrulama kapısını gerçek repo test altyapısına ekle veya güçlendir. Var olan test dilini ve runner'ı koru.",
    acceptance:[
      "Önceki product PR merge edilmiş olmalı; canlı main yeniden okunmalı.",
      "Yalnız gerçek mevcut dosyalar değiştirilmeli ve en fazla 2 dosya olmalı.",
      "En az bir regression veya mutation-style failure mode doğrulanmalı.",
      "Test, semantic-repeat/answer-leak/solver-oracle/native-adapter gibi gerçek integration risklerinden en az birini yakalamalı.",
      "QA PASS sonrası yalnız Draft PR oluşturulmalı."
    ],
    deps:["ZA-G8TR-NATIVE-PATCH-002"],
    payload:{ repoAlias:"product",focus:"8th grade Turkish native integration regression mutation tests semantic repeat answer leak solver oracle game adapter",impactArea:"8. Sınıf Türkçe / Kalite",maxFiles:2 }
  },
  {
    id:"ZA-CONTENT-QUALITY-RECON-004",
    sequence:1030,
    title:"Zihin Arenası soru motoru kalite borcu repo keşfi",
    jobType:"product.repo-recon",
    role:"QA Supervisor",
    objective:"Canlı main üzerinde soru motoru kalite borcunu gerçek kaynak yollarına bağla. Özellikle seçenek/çeldirici kalitesi, semantic repeat, answer leak, solver/oracle ve oyun adapter ayrımını mevcut kod/test kanıtlarıyla denetle. Sonraki bağımsız patch adaylarını önceliklendir.",
    acceptance:[
      "Yalnız canlı repo kanıtı kullanılmalı.",
      "En az 3 gerçek dosya/test yolu kalite riskiyle eşleştirilmeli.",
      "Öncelikler ölçülebilir test veya kod değişikliği olarak ifade edilmeli.",
      "ECD/AIG ve canonical item model korunmalı."
    ],
    deps:[],
    payload:{ repoAlias:"product",focus:"question engine option distractor semantic repeat answer leak solver oracle game adapters",impactArea:"Soru Motoru Kalitesi" }
  }
];


function dailyAuditItems(now = new Date()): SeedItem[] {
  const day = now.toISOString().slice(0,10).replace(/-/g,"");
  const seqBase = 20_000_000 + Number(day) * 10;
  return [
    {
      id:`ZA-DAILY-G8TR-AUDIT-${day}`,
      sequence:seqBase+1,
      title:`Günlük 8. sınıf Türkçe native integration canlı repo audit ${day}`,
      jobType:"product.repo-recon",
      role:"Release Manager",
      objective:"Canlı main branch'i yeniden okuyarak 8. sınıf Türkçe native integration hedefindeki güncel risk, açık gap, test kanıtı ve merge bekleyen etkileri denetle. Önceki raporu varsayma; yalnız canlı repo ve factory state kanıtını kullan. Yeni bir code patch gerekiyorsa en küçük gerçek dosya hedeflerini belirt, fakat repo değişikliği yapılmış gibi davranma.",
      acceptance:[
        "Canlı repo yolları ve PROJECT_STATE kanıtı kullanılmalı.",
        "Mevcut native integration riskleri gerçek dosya/test yollarına bağlanmalı.",
        "Merge bekleyen PR varsa bağımlı işi yanlışlıkla tamamlanmış saymamalı.",
        "Yeni patch adayı varsa küçük, test edilebilir ve mevcut mimariyle uyumlu olmalı."
      ],
      deps:[],
      payload:{repoAlias:"product",focus:"daily 8th grade Turkish native integration runtime tests item factory quiz",impactArea:"8. Sınıf Türkçe / Günlük Audit"}
    },
    {
      id:`ZA-DAILY-QUALITY-AUDIT-${day}`,
      sequence:seqBase+2,
      title:`Günlük soru motoru kalite ve regresyon audit ${day}`,
      jobType:"product.repo-recon",
      role:"QA Supervisor",
      objective:"Canlı Zihin Arenası main üzerinde soru motoru kalite ve regresyon borcunu gerçek kod/test kanıtlarıyla denetle. Semantic repeat, answer leak, distractor, solver/oracle, hint ladder ve game adapter ayrımı için yalnız mevcut repo yollarına dayalı öncelik üret.",
      acceptance:[
        "En az 3 gerçek repo yolu kalite sinyaliyle eşleşmeli.",
        "Rastgele veya statik soru bankası çözümü önerilmemeli.",
        "Önerilen her sonraki adım ölçülebilir bir test/gate ile doğrulanabilir olmalı."
      ],
      deps:[],
      payload:{repoAlias:"product",focus:"daily question engine semantic repeat answer leak distractor solver oracle hint game adapter regression",impactArea:"Soru Motoru / Günlük Audit"}
    }
  ];
}


type DirectorStream = "research" | "content" | "qa" | "release" | "code";

type DirectorProgram = {
  key: string;
  stream: DirectorStream;
  role: string;
  jobType: "product.repo-recon" | "product.code-patch";
  title: string;
  focus: string;
  impactArea: string;
  objective: string;
  acceptance: string[];
};

// The director keeps a real executable backlog instead of creating one audit every 15 minutes.
// Lane capacity remains one active job per lane, while ready work is kept behind it so the
// Governor can immediately hand off the next useful task when a job finishes/quarantines.
const DIRECTOR_TARGETS: Record<DirectorStream,number> = {
  research: 2,
  content: 2,
  qa: 2,
  release: 1,
  code: 1
};

const DIRECTOR_STREAM_ROLES: Record<DirectorStream,string[]> = {
  research:["Structure Miner","Research Scout","Source Auditor","Curriculum Mapper"],
  content:["Factory Designer","Distractor Engineer","Tutor Designer","Game Planner"],
  qa:["QA Supervisor","Child Reviewer","Fairness Reviewer","IP/Security Reviewer"],
  release:["Release Manager"],
  code:["Codex Engineer"]
};

const DIRECTOR_PROGRAMS: DirectorProgram[] = [
  {
    key:"g8tr-native-runtime",stream:"research",role:"Structure Miner",jobType:"product.repo-recon",
    title:"8. sınıf Türkçe native runtime gerçek dosya açıkları",
    focus:"8th grade Turkish native integration runtime item factory quiz adapter tests",
    impactArea:"8. Sınıf Türkçe / Native Runtime",
    objective:"Canlı main üzerinde 8. sınıf Türkçe native integration 7/10 -> 10/10 hedefindeki bir sonraki uygulanabilir açığı yalnız gerçek dosya ve test kanıtıyla bul. Önceki raporu tekrar etme. Bir sonraki küçük production değişikliği için mevcut dosya yollarını, exact contract/risk alanını ve doğrulama komutunu açıkça belirt.",
    acceptance:["En az 4 gerçek repo yolu kullanılmalı.","Tekrarlanan genel tavsiye yerine uygulanabilir tek bir sonraki adım seçilmeli.","Native adapter/item-factory/test ilişkisi kanıtlanmalı.","Static soru bankası önerilmemeli."]
  },
  {
    key:"g8tr-tests",stream:"research",role:"Source Auditor",jobType:"product.repo-recon",
    title:"8. sınıf Türkçe regression mutation test açığı",
    focus:"grade 8 Turkish regression mutation semantic repeat answer leak solver oracle tests",
    impactArea:"8. Sınıf Türkçe / Test Kapıları",
    objective:"Canlı main üzerinde 8. sınıf Türkçe native integration için en değerli eksik regression veya mutation-style failure mode'u gerçek test kaynaklarıyla belirle. Sonraki patch'in en fazla iki gerçek dosyada uygulanabilecek biçimini tarif et.",
    acceptance:["Gerçek test dosyaları ve runner kanıtı kullanılmalı.","En az bir somut failure mode seçilmeli.","Doğrulama komutu belirtilmeli.","Öneri en fazla iki dosyalık patch'e indirgenmeli."]
  },
  {
    key:"factory-contract",stream:"content",role:"Factory Designer",jobType:"product.repo-recon",
    title:"Soru fabrikası canonical contract üretim borcu",
    focus:"assessment ECD AIG item factory generator distractor hint solution game adapter contracts",
    impactArea:"Soru Fabrikası / Contract",
    objective:"Canlı repo üzerinde canonical item factory sözleşmesinde gerçekten uygulanmamış veya zayıf kalan tek yüksek etkili production borcunu seç. Generator, distractor, hint, solution ve game adapter katmanlarını gerçek dosyalarla eşleştir ve küçük uygulanabilir patch hedefi üret.",
    acceptance:["Gerçek repo yolları kullanılmalı.","Tek bir yüksek etkili contract borcu önceliklendirilmeli.","Her öneri test/gate ile doğrulanabilir olmalı.","Game-specific ayrı bankaya dönülmemeli."]
  },
  {
    key:"distractor-hint",stream:"content",role:"Distractor Engineer",jobType:"product.repo-recon",
    title:"Çeldirici ipucu çözüm kalitesi production borcu",
    focus:"distractor misconception hint ladder solution model option quality Turkish engines",
    impactArea:"İçerik Motoru / Çeldirici ve İpucu",
    objective:"Canlı main üzerinde seçenek/çeldirici, misconception, hint ladder veya solution model kalitesini düşüren gerçek bir contract/test boşluğunu bul ve en küçük production iyileştirmesini gerçek dosya hedefleriyle tarif et.",
    acceptance:["Gerçek öğrenci yanılgısı/çeldirici sözleşmesiyle bağlantı kurulmalı.","En az 3 gerçek dosya/test yolu kullanılmalı.","Sonraki patch ölçülebilir kalite kapısı içermeli.","Rastgele seçenek üretimi önerilmemeli."]
  },
  {
    key:"semantic-quality",stream:"qa",role:"QA Supervisor",jobType:"product.repo-recon",
    title:"Semantic repeat answer leak bağımsız kalite açığı",
    focus:"semantic repeat answer leak option quality ambiguity solver oracle quality gates",
    impactArea:"Soru Motoru / Bağımsız Kalite",
    objective:"Canlı main üzerinde semantic repeat, answer leak, ambiguity veya option-quality risklerinden en yüksek etkili olanı gerçek test/kod kanıtıyla bağımsız QA olarak seç. Riskin yakalanacağı deterministic gate veya mutation-style kontrolü uygulanabilir biçimde tarif et.",
    acceptance:["En az 3 gerçek dosya/test yolu kullanılmalı.","Birincil failure mode açıkça seçilmeli.","Önerilen gate ölçülebilir olmalı.","Sahte psikometri üretilmemeli."]
  },
  {
    key:"oracle-adapter",stream:"qa",role:"Child Reviewer",jobType:"product.repo-recon",
    title:"Solver oracle ve oyun adapter bağımsız kalite açığı",
    focus:"solver oracle canonical item game adapter validation mutation tests",
    impactArea:"Soru Motoru / Solver-Oracle",
    objective:"Canlı main üzerinde solver/oracle doğruluğu ile game adapter sunum ayrımındaki en değerli doğrulama açığını gerçek kaynaklarla bul. Bir sonraki küçük test veya code patch hedefini somutlaştır.",
    acceptance:["Canonical item ile adapter ayrımı korunmalı.","Gerçek kaynak yolları kullanılmalı.","Yanlış cevap/oracle sapmasını yakalayan failure mode belirtilmeli.","Sonraki iş en fazla iki dosyaya indirgenmeli."]
  },
  {
    key:"release-ci",stream:"release",role:"Release Manager",jobType:"product.repo-recon",
    title:"PR CI fail-closed yayın kapısı kontrolü",
    focus:"github workflows CI quality gates pull request tests release deployment",
    impactArea:"Yayın / CI",
    objective:"Canlı Zihin Arenası reposunda CI, regression ve quality-gate zincirinin mevcut durumu üzerinden bir sonraki fail-closed yayın iyileştirmesini seç. Açık PR/merge bilgisini uydurma; yalnız canlı repo ve factory state kanıtını kullan.",
    acceptance:["Gerçek workflow/test yolları kullanılmalı.","CI başarısızken release önerilmemeli.","En az iki yayın riski değerlendirilmeli ve biri önceliklendirilmeli.","İnsan merge kapısı korunmalı."]
  },
  {
    key:"safe-code",stream:"code",role:"Codex Engineer",jobType:"product.code-patch",
    title:"Zihin Arenası en küçük güvenli production iyileştirmesi",
    focus:"8th grade Turkish native integration item factory quality gate regression mutation tests",
    impactArea:"Zihin Arenası / Production Patch",
    objective:"Canlı main üzerindeki gerçek dosyalardan en fazla ikisinde, 8. sınıf Türkçe native integration veya soru motoru kalite kapısına doğrudan katkı veren küçük ve geri alınabilir bir production code/test iyileştirmesi hazırla. Repo dilini ve mevcut mimariyi koru. QA PASS olmadan yazma ve yalnız Draft PR oluştur.",
    acceptance:["Yalnız gerçekten okunmuş mevcut dosyalar değiştirilmeli.","En fazla 2 dosya değişmeli.","Doğrulama/test komutu bulunmalı.","Main'e doğrudan push/merge yapılmamalı.","Static soru bankası oluşturulmamalı."]
  }
];

async function dependencyStatus(db: D1Database, depsJson: string): Promise<boolean> {
  let deps: string[] = [];
  try { const parsed=JSON.parse(depsJson||"[]"); if (Array.isArray(parsed)) deps=parsed.map(String); } catch { deps=[]; }
  for (const dep of deps) {
    const found=await db.prepare(`SELECT status FROM FACTORY_ROADMAP WHERE id=?`).bind(dep).first<{status:string}>();
    if (found?.status !== "done") return false;
  }
  return true;
}

async function executableBacklogForRoles(db: D1Database, roles: string[]): Promise<number> {
  if (!roles.length) return 0;
  const placeholders=roles.map(()=>"?").join(",");
  const rows=await db.prepare(
    `SELECT status,depends_on_json FROM FACTORY_ROADMAP
     WHERE agent_role IN (${placeholders}) AND status IN ('ready','dispatched','waiting-human')
     ORDER BY updated_at DESC LIMIT 120`
  ).bind(...roles).all<{status:string;depends_on_json:string}>();
  let count=0;
  for (const row of rows.results) {
    if (row.status === "dispatched" || row.status === "waiting-human") { count++; continue; }
    if (await dependencyStatus(db,row.depends_on_json)) count++;
  }
  return count;
}

async function executableBacklogForStream(db: D1Database, stream: DirectorStream): Promise<number> {
  return executableBacklogForRoles(db,DIRECTOR_STREAM_ROLES[stream]);
}

async function nextDirectorCursor(db: D1Database, stream: DirectorStream): Promise<number> {
  const key=`director_cursor_${stream}`;
  const current=Number((await stateValue(db,key)) ?? "0");
  const next=Number.isFinite(current) ? current+1 : 1;
  await setState(db,key,String(next));
  return next;
}

async function seedDirectorBacklog(db: D1Database): Promise<number> {
  const waitingHuman=await db.prepare(`SELECT COUNT(*) AS count FROM PROJECT_IMPACT WHERE status='waiting-human'`).first<{count:number}>();
  let inserted=0;
  const streams: DirectorStream[]=["research","content","qa","release","code"];
  for (const stream of streams) {
    const programs=DIRECTOR_PROGRAMS.filter(x=>x.stream===stream);
    if (!programs.length) continue;
    let target=DIRECTOR_TARGETS[stream];
    if (stream === "code" && Number(waitingHuman?.count ?? 0) > 0) target=0;
    let backlog=await executableBacklogForStream(db,stream);
    while (backlog < target) {
      const cursor=await nextDirectorCursor(db,stream);
      const program=programs[(cursor-1)%programs.length];
      const id=`ZA-DIRECTOR-${stream.toUpperCase()}-${String(cursor).padStart(6,"0")}`;
      const sequence=50_000_000 + cursor*100 + streams.indexOf(stream);
      const result=await db.prepare(
        `INSERT OR IGNORE INTO FACTORY_ROADMAP
         (id,sequence_no,title,job_type,agent_role,objective,acceptance_json,depends_on_json,payload_json,status)
         VALUES (?,?,?,?,?,?,?,'[]',?,'ready')`
      ).bind(
        id,sequence,`${program.title} [Director ${cursor}]`,program.jobType,program.role,program.objective,
        JSON.stringify(program.acceptance),
        JSON.stringify({repoAlias:"product",focus:program.focus,impactArea:program.impactArea,maxFiles:2,directorStream:stream,directorProgram:program.key,directorCursor:cursor})
      ).run();
      if ((result.meta?.changes ?? 0) > 0) {
        inserted++; backlog++;
        await db.prepare(`INSERT INTO PROJECT_FEED_LOG(action,roadmap_id,detail_json) VALUES ('DIRECTOR_SEED',?,?)`)
          .bind(id,JSON.stringify({stream,program:program.key,role:program.role,target})).run();
      } else {
        break;
      }
    }
  }
  await setState(db,"director_backlog_last_fill",new Date().toISOString());
  return inserted;
}

async function promotePassedReconToCode(db: D1Database): Promise<number> {
  const waitingHuman=await db.prepare(`SELECT COUNT(*) AS count FROM PROJECT_IMPACT WHERE status='waiting-human'`).first<{count:number}>();
  if (Number(waitingHuman?.count ?? 0) > 0) return 0;
  if ((await executableBacklogForStream(db,"code")) >= 1) return 0;

  const rows=await db.prepare(
    `SELECT r.id,r.title,r.result_summary,r.payload_json,w.result_json
     FROM FACTORY_ROADMAP r JOIN WORK_QUEUE w ON w.id=r.work_queue_id
     WHERE r.job_type='product.repo-recon' AND r.status='done'
       AND NOT EXISTS (SELECT 1 FROM PROJECT_FEED_LOG l WHERE l.action='PROMOTE_RECON_TO_CODE' AND l.roadmap_id=r.id)
     ORDER BY r.updated_at DESC LIMIT 12`
  ).all<{id:string;title:string;result_summary:string|null;payload_json:string;result_json:string|null}>();
  if (!rows.results.length) return 0;

  const source=rows.results[0];
  let output=source.result_summary ?? "";
  try {
    const parsed=JSON.parse(source.result_json ?? "{}") as {output?:unknown};
    if (typeof parsed.output === "string" && parsed.output.trim()) output=parsed.output;
  } catch { /* summary fallback */ }
  let payload: Record<string,unknown>={};
  try { payload=JSON.parse(source.payload_json||"{}"); } catch { payload={}; }
  const cursor=await nextDirectorCursor(db,"code");
  const id=`ZA-DIRECTOR-CODE-FROM-RECON-${String(cursor).padStart(6,"0")}`;
  const evidence=output.slice(0,5000);
  const objective=`Bağımsız QA'dan PASS almış repo keşfini gerçek production değişikliğine çevir. Kaynak keşif: ${source.title}. Aşağıdaki kanıtı yalnız başlangıç ipucu olarak kullan; canlı main dosyalarını yeniden oku ve en fazla iki mevcut dosyada küçük, geri alınabilir code/test patch hazırla. QA PASS olmadan GitHub'a yazma.\n\nPASS RECON EVIDENCE:\n${evidence}`;
  const acceptance=[
    "Canlı main yeniden okunmalı; keşif çıktısı tek başına gerçek kabul edilmemeli.",
    "Yalnız gerçekten mevcut ve okunmuş en fazla 2 dosya değiştirilmeli.",
    "Patch, kaynak keşifteki doğrulanmış riske doğrudan katkı sağlamalı.",
    "Test/doğrulama komutu belirtilmeli.",
    "Main'e doğrudan push/merge yapılmamalı; yalnız QA PASS sonrası Draft PR oluşturulmalı."
  ];
  const result=await db.prepare(
    `INSERT OR IGNORE INTO FACTORY_ROADMAP
     (id,sequence_no,title,job_type,agent_role,objective,acceptance_json,depends_on_json,payload_json,status)
     VALUES (?,? ,?,'product.code-patch','Codex Engineer',?,?,'[]',?,'ready')`
  ).bind(
    id,55_000_000+cursor,
    `PASS repo keşfinden production patch: ${source.title}`.slice(0,240),objective,JSON.stringify(acceptance),
    JSON.stringify({repoAlias:"product",focus:`${String(payload.focus??"")} ${evidence.slice(0,1400)}`,impactArea:String(payload.impactArea??"Zihin Arenası / Production Patch"),maxFiles:2,directorStream:"code",sourceReconRoadmapId:source.id})
  ).run();
  await db.prepare(`INSERT INTO PROJECT_FEED_LOG(action,roadmap_id,detail_json) VALUES ('PROMOTE_RECON_TO_CODE',?,?)`)
    .bind(source.id,JSON.stringify({createdRoadmapId:id,changes:Number(result.meta?.changes??0)})).run();
  return (result.meta?.changes ?? 0) > 0 ? 1 : 0;
}

export async function seedProjectRoadmap(db: D1Database): Promise<number> {
  let inserted = 0;
  const items = [...BASELINE,...dailyAuditItems()];
  for (const item of items) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO FACTORY_ROADMAP
       (id,sequence_no,title,job_type,agent_role,objective,acceptance_json,depends_on_json,payload_json,status)
       VALUES (?,?,?,?,?,?,?,?,?,'ready')`
    ).bind(
      item.id,item.sequence,item.title,item.jobType,item.role,item.objective,
      JSON.stringify(item.acceptance),JSON.stringify(item.deps),JSON.stringify(item.payload)
    ).run();
    if ((result.meta?.changes ?? 0) > 0) {
      inserted++;
      await db.prepare(`INSERT INTO PROJECT_FEED_LOG(action,roadmap_id,detail_json) VALUES ('SEED',?,?)`)
        .bind(item.id,JSON.stringify({title:item.title,jobType:item.jobType,impactArea:item.payload.impactArea ?? null})).run();
    }
  }
  return inserted;
}

export async function reconcileProductPullRequests(env: ProjectFeederEnv): Promise<{merged:number;closedUnmerged:number;waitingHuman:number}> {
  const rows = await env.DB.prepare(
    `SELECT id,roadmap_id,job_id,repo_full_name,pr_number,pr_url,status
     FROM PROJECT_IMPACT
     WHERE status='waiting-human' AND pr_number IS NOT NULL AND repo_full_name IS NOT NULL
     ORDER BY created_at ASC LIMIT 20`
  ).all<{id:string;roadmap_id:string|null;job_id:string|null;repo_full_name:string;pr_number:number;pr_url:string|null;status:string}>();

  let merged = 0;
  let closedUnmerged = 0;
  let waitingHuman = 0;
  for (const row of rows.results) {
    try {
      const pr = await getPullRequest(env,row.repo_full_name,Number(row.pr_number));
      if (pr.merged || pr.merged_at) {
        await env.DB.batch([
          env.DB.prepare(`UPDATE PROJECT_IMPACT SET status='merged',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id),
          env.DB.prepare(`UPDATE GITHUB_OPERATIONS SET status='merged',updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND pr_number=?`).bind(row.job_id,row.pr_number),
          env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='done',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='waiting-human'`).bind(`Draft PR #${row.pr_number} merged; production lane released`,row.roadmap_id),
          env.DB.prepare(`INSERT INTO PROJECT_FEED_LOG(action,roadmap_id,detail_json) VALUES ('PR_MERGED',?,?)`).bind(row.roadmap_id,JSON.stringify({prNumber:row.pr_number,prUrl:row.pr_url}))
        ]);
        merged++;
      } else if (pr.state === "closed") {
        await env.DB.batch([
          env.DB.prepare(`UPDATE PROJECT_IMPACT SET status='closed-unmerged',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(row.id),
          env.DB.prepare(`UPDATE GITHUB_OPERATIONS SET status='closed-unmerged',updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND pr_number=?`).bind(row.job_id,row.pr_number),
          env.DB.prepare(`UPDATE FACTORY_ROADMAP SET status='quarantine',result_summary=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='waiting-human'`).bind(`Draft PR #${row.pr_number} closed without merge`,row.roadmap_id),
          env.DB.prepare(`INSERT INTO PROJECT_FEED_LOG(action,roadmap_id,detail_json) VALUES ('PR_CLOSED_UNMERGED',?,?)`).bind(row.roadmap_id,JSON.stringify({prNumber:row.pr_number,prUrl:row.pr_url}))
        ]);
        closedUnmerged++;
      } else {
        waitingHuman++;
      }
    } catch (error) {
      waitingHuman++;
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(`INSERT INTO PROJECT_FEED_LOG(action,roadmap_id,detail_json) VALUES ('PR_RECONCILE_ERROR',?,?)`)
        .bind(row.roadmap_id,JSON.stringify({prNumber:row.pr_number,error:message.slice(0,600)})).run();
    }
  }
  return {merged,closedUnmerged,waitingHuman};
}

export async function projectFeederCycle(env: ProjectFeederEnv): Promise<ProjectFeederResult> {
  const enabled = (await stateValue(env.DB,"project_feeder_enabled")) !== "0";
  if (!enabled) return {enabled:false,seeded:0,merged:0,closedUnmerged:0,waitingHuman:0,action:"paused"};

  const baselineSeeded = await seedProjectRoadmap(env.DB);
  const promoted = await promotePassedReconToCode(env.DB);
  const directorSeeded = await seedDirectorBacklog(env.DB);
  const seeded = baselineSeeded + promoted + directorSeeded;
  const reconciled = String(env.GITHUB_TOKEN ?? "").trim()
    ? await reconcileProductPullRequests(env)
    : {merged:0,closedUnmerged:0,waitingHuman:0};
  const action = seeded > 0 ? "seeded" : reconciled.merged > 0 ? "pr-merged" : reconciled.closedUnmerged > 0 ? "pr-closed" : reconciled.waitingHuman > 0 ? "waiting-human" : "steady";
  await setState(env.DB,"last_project_feeder_action",action);
  await setState(env.DB,"last_project_feeder_at",new Date().toISOString());
  return {enabled:true,seeded,promoted,...reconciled,action};
}
