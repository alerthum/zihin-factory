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

  const seeded = await seedProjectRoadmap(env.DB);
  const reconciled = String(env.GITHUB_TOKEN ?? "").trim()
    ? await reconcileProductPullRequests(env)
    : {merged:0,closedUnmerged:0,waitingHuman:0};
  const action = seeded > 0 ? "seeded" : reconciled.merged > 0 ? "pr-merged" : reconciled.closedUnmerged > 0 ? "pr-closed" : reconciled.waitingHuman > 0 ? "waiting-human" : "steady";
  await setState(env.DB,"last_project_feeder_action",action);
  await setState(env.DB,"last_project_feeder_at",new Date().toISOString());
  return {enabled:true,seeded,...reconciled,action};
}
