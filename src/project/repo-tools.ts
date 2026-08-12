import type { RepoTreeEntry } from "../providers/github";

export type AppliedPatch = {
  summary: string;
  verification: string[];
  changes: Array<{ path:string; content:string; editCount:number; edits:Array<{search:string;replace:string}> }>;
};

const EXCLUDED_PREFIXES = [
  "node_modules/","dist/","build/","coverage/",".next/",".vercel/",".cloudflare/",
  "ARCHIVE/","BACKUP/","backup/","archive/","public/assets/"
];

const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json)$/i;

function normalize(s: string): string {
  return s.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[\u0300-\u036f]/g,"");
}

export function candidateRepoPaths(tree: RepoTreeEntry[], focus: string, limit = 120): string[] {
  const focusTokens = normalize(focus).split(/[^a-z0-9]+/).filter(x => x.length >= 3);
  const domainTokens = [
    "turk","turkish","grade8","8th","quiz","question","assessment","item","factory","engine",
    "solver","oracle","distractor","hint","semantic","mutation","game","adapter","curriculum","content","test","e2e"
  ];

  const protectedRoots = new Set(["package.json","package-lock.json","pnpm-lock.yaml","yarn.lock","PROJECT_STATE.json"]);
  return tree
    .filter(x => x.type === "blob" && CODE_EXT.test(x.path) && !protectedRoots.has(x.path) && !EXCLUDED_PREFIXES.some(p => x.path.startsWith(p)))
    .filter(x => typeof x.size !== "number" || x.size <= 24_000)
    .map(x => {
      const path = normalize(x.path);
      let score = 0;
      for (const t of focusTokens) if (path.includes(t)) score += 7;
      for (const t of domainTokens) if (path.includes(t)) score += 3;
      if (/^(src|app|scripts|tests?|e2e)\//i.test(x.path)) score += 2;
      if (/test|spec|engine|factory|quiz|question/i.test(x.path)) score += 2;
      return {path:x.path,score};
    })
    .sort((a,b) => b.score-a.score || a.path.localeCompare(b.path))
    .slice(0,Math.max(20,Math.min(300,limit)))
    .map(x => x.path);
}

function stripFences(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi,"").replace(/```(?:json)?/gi,"").replace(/```/g,"").trim();
}

function balancedObject(text: string): string | null {
  const clean = stripFences(text);
  let start = -1, depth = 0;
  let quoted = false, escaped = false;
  for (let i=0;i<clean.length;i++) {
    const ch = clean[i];
    if (quoted) {
      if (escaped) { escaped=false; continue; }
      if (ch === "\\") { escaped=true; continue; }
      if (ch === '"') quoted=false;
      continue;
    }
    if (ch === '"') { quoted=true; continue; }
    if (ch === "{") { if (depth===0) start=i; depth++; }
    else if (ch === "}" && depth>0) { depth--; if (depth===0 && start>=0) return clean.slice(start,i+1); }
  }
  return null;
}

function repairJsonLike(text: string): string {
  const src = text.replace(/[“”]/g,'"').replace(/[‘’]/g,"'");
  let out = "";
  let quoted = false;
  let escaped = false;
  for (let i=0;i<src.length;i++) {
    const ch = src[i];
    if (quoted) {
      if (escaped) {
        const valid = /["\\/bfnrtu]/.test(ch);
        if (!valid) out += "\\";
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; quoted = false; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { quoted = true; out += ch; continue; }
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g,"$1");
}

function parseObject(text: string): Record<string,unknown> | null {
  const raw = [stripFences(text),balancedObject(text)].filter(Boolean) as string[];
  const candidates = [...raw,...raw.map(repairJsonLike)];
  for (const c of candidates) {
    try {
      const value = JSON.parse(c);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string,unknown>;
    } catch { /* try next */ }
  }
  return null;
}

export function parsePathSelection(text: string, allowed: Set<string>, maxFiles = 8): string[] {
  const parsed = parseObject(text);
  const raw = parsed && Array.isArray(parsed.paths) ? parsed.paths.map(String) : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of raw) {
    if (!allowed.has(path) || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
    if (result.length >= maxFiles) break;
  }
  return result;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count=0,pos=0;
  while ((pos=haystack.indexOf(needle,pos))>=0) { count++; pos+=needle.length; }
  return count;
}

export function parseAndApplyPatchProposal(text: string, sources: Map<string,string>, maxFiles = 2): AppliedPatch {
  const parsed = parseObject(text);
  if (!parsed) throw new Error("code_patch_json_parse_failed");
  const summary = String(parsed.summary ?? "").trim();
  const verification = Array.isArray(parsed.verification) ? parsed.verification.map(String).filter(Boolean).slice(0,8) : [];
  const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];
  const changes: Array<{path:string;content:string;editCount:number;edits:Array<{search:string;replace:string}>}> = [];
  const seen = new Set<string>();

  for (const item of rawChanges) {
    const obj = item && typeof item === "object" ? item as Record<string,unknown> : {};
    const path = String(obj.path ?? "").trim();
    if (!sources.has(path)) throw new Error(`code_patch_unread_path:${path}`);
    if (seen.has(path)) throw new Error(`code_patch_duplicate_path:${path}`);
    const edits = Array.isArray(obj.edits) ? obj.edits : [];
    if (edits.length < 1 || edits.length > 4) throw new Error(`code_patch_invalid_edit_count:${path}`);
    let content = String(sources.get(path) ?? "");
    const normalizedEdits: Array<{search:string;replace:string}> = [];
    for (const rawEdit of edits) {
      const edit = rawEdit && typeof rawEdit === "object" ? rawEdit as Record<string,unknown> : {};
      const search = String(edit.search ?? "");
      const replace = String(edit.replace ?? "");
      if (search.length < 8) throw new Error(`code_patch_search_too_short:${path}`);
      const occurrences = countOccurrences(content,search);
      if (occurrences !== 1) throw new Error(`code_patch_search_not_unique:${path}:${occurrences}`);
      if (/\.\.\.|TODO:\s*(?:implement|fill)|PLACEHOLDER|lorem ipsum/i.test(replace)) throw new Error(`code_patch_placeholder:${path}`);
      if (/(?:ghp_|github_pat_|Bearer\s+[A-Za-z0-9._-]{20,})/i.test(replace)) throw new Error(`code_patch_secret_pattern:${path}`);
      content = content.replace(search,replace);
      normalizedEdits.push({search,replace});
    }
    if (content === sources.get(path)) throw new Error(`code_patch_noop:${path}`);
    seen.add(path);
    changes.push({path,content,editCount:edits.length,edits:normalizedEdits});
    if (changes.length > maxFiles) throw new Error("code_patch_too_many_files");
  }

  if (!summary || changes.length === 0 || verification.length === 0) throw new Error("code_patch_contract_incomplete");
  return {summary,verification,changes};
}

export function patchReviewArtifact(proposal: AppliedPatch): string {
  return `Outcome\n${proposal.summary}\n\nDecisions\nOnly previously-read existing repository files are changed with exact, uniquely-matched edits. Main is never written directly; Draft PR only after independent QA.\n\nImplementation Details\n${proposal.changes.map(c=>`FILE ${c.path} (${c.editCount} exact edit(s))\n${c.edits.map((e,i)=>`EDIT ${i+1} SEARCH:\n${e.search}\nEDIT ${i+1} REPLACE:\n${e.replace}`).join("\n")}`).join("\n\n")}\n\nVerification\n${proposal.verification.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nRisks/Blockers\nThe factory does not merge. CI and human merge remain the release gate.\n\nNext Action\nIf independent QA passes, create factory/* Draft PR and wait for merge.`;
}
