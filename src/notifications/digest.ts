import { sendTelegram } from "./telegram";

type Env={DB:D1Database;TELEGRAM_BOT_TOKEN:string;TELEGRAM_CHAT_ID:string};

export async function maybeSendFactoryDigest(env:Env):Promise<{sent:boolean;reason:string}>{
  const last=await env.DB.prepare(`SELECT value FROM PROJECT_STATE WHERE key='last_factory_digest_at'`).first<{value:string}>();
  const lastMs=last?.value ? Date.parse(last.value) : 0;
  if (lastMs && Date.now()-lastMs < 6*60*60*1000) return {sent:false,reason:"not_due"};

  const jobs=await env.DB.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN status='quarantine' THEN 1 ELSE 0 END) AS quarantine,
    SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked,
    SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
    FROM WORK_QUEUE WHERE datetime(created_at)>=datetime('now','-6 hours')`).first<{total:number|null;completed:number|null;quarantine:number|null;blocked:number|null;failed:number|null}>();
  const impact=await env.DB.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN pr_number IS NOT NULL THEN 1 ELSE 0 END) AS prs,
    SUM(CASE WHEN status='merged' THEN 1 ELSE 0 END) AS merged
    FROM PROJECT_IMPACT WHERE datetime(created_at)>=datetime('now','-6 hours')`).first<{total:number|null;prs:number|null;merged:number|null}>();
  const lesson=await env.DB.prepare(`SELECT COUNT(*) AS learned FROM FACTORY_LESSONS WHERE datetime(updated_at)>=datetime('now','-6 hours')`).first<{learned:number|null}>();
  const top=await env.DB.prepare(`SELECT defect_code,occurrences FROM FACTORY_LESSONS WHERE active=1 ORDER BY occurrences DESC,last_seen_at DESC LIMIT 1`).first<{defect_code:string;occurrences:number}>();

  const total=Number(jobs?.total??0), completed=Number(jobs?.completed??0), prs=Number(impact?.prs??0), merged=Number(impact?.merged??0);
  const status = prs>0 || merged>0 ? "🟢 Ürün çıktısı oluştu" : completed>0 ? "🔵 Fabrika ilerledi; ürün PR kapısı henüz açılmadı" : "🟡 Fabrika çalıştı ancak son 6 saatte tamamlanan iş az";
  const text=`📊 Zihin Factory — Son 6 Saat\n${status}\nİş: ${total} • Tamamlanan: ${completed} • Karantina: ${Number(jobs?.quarantine??0)} • Engelli: ${Number(jobs?.blocked??0)} • Teknik hata: ${Number(jobs?.failed??0)}\nÜrün PR: ${prs} • Merge: ${merged} • Ürün etkisi: ${Number(impact?.total??0)}\nÖğrenme hafızası güncellenen kayıt: ${Number(lesson?.learned??0)}${top?`\nEn sık bilinen kalite hatası: ${top.defect_code} (${top.occurrences})`:""}\nKural: Aynı bilinen hata tekrar ederse rol dersi ve model yönlendirmesi otomatik güncellenir.`;
  try { await sendTelegram(env,text); }
  catch { return {sent:false,reason:"telegram_failed"}; }
  await env.DB.prepare(`INSERT INTO PROJECT_STATE(key,value,updated_at) VALUES ('last_factory_digest_at',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(new Date().toISOString()).run();
  return {sent:true,reason:"sent"};
}
