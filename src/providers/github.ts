export type GitHubEnv = { GITHUB_TOKEN?: string };

export type RepoInfo = {
  full_name: string;
  default_branch: string;
  private: boolean;
  permissions?: { pull?: boolean; push?: boolean; admin?: boolean; maintain?: boolean; triage?: boolean };
};

type FileInfo = { sha: string; content?: string; encoding?: string };

type PullRequestInfo = { number: number; html_url: string; state: string; draft?: boolean; head?: { ref?: string }; base?: { ref?: string } };
export type RepoTreeEntry = { path: string; type: "blob" | "tree"; sha: string; size?: number };

export type PullRequestState = {
  number: number;
  state: string;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  html_url: string;
  head?: { ref?: string };
  base?: { ref?: string };
};

function base64ToUtf8(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}


const API = "https://api.github.com";
const UA = "zihin-factory-governor/0.6.0";

function assertToken(env: GitHubEnv): string {
  const token = String(env.GITHUB_TOKEN ?? "").trim();
  if (!token) throw new Error("github_token_not_configured");
  return token;
}

function validRepo(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function gh<T>(env: GitHubEnv, path: string, init: RequestInit = {}): Promise<T> {
  const token = assertToken(env);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", UA);
  if (init.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1800);
    throw new Error(`github_http_${response.status}:${body}`);
  }
  return await response.json() as T;
}

export async function getRepo(env: GitHubEnv, repo: string): Promise<RepoInfo> {
  if (!validRepo(repo)) throw new Error("invalid_repo_name");
  return gh<RepoInfo>(env, `/repos/${repo}`);
}

export async function getBranchSha(env: GitHubEnv, repo: string, branch: string): Promise<string> {
  const data = await gh<{ object?: { sha?: string } }>(env, `/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const sha = data.object?.sha;
  if (!sha) throw new Error("github_branch_sha_missing");
  return sha;
}

export async function createBranch(env: GitHubEnv, repo: string, branch: string, fromSha: string): Promise<void> {
  if (!branch.startsWith("factory/")) throw new Error("branch_policy_violation");
  try {
    await gh(env, `/repos/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Workflow retries must be idempotent. A branch created by a partial prior
    // attempt is safe to reuse because branch names are job-specific.
    if (!/github_http_422:/.test(message)) throw error;
    await getBranchSha(env, repo, branch);
  }
}

export async function getFile(env: GitHubEnv, repo: string, path: string, ref: string): Promise<FileInfo | null> {
  try {
    return await gh<FileInfo>(env, `/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/github_http_404:/.test(message)) return null;
    throw error;
  }
}

export async function putTextFile(
  env: GitHubEnv,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
  existingSha?: string
): Promise<{ commit?: { sha?: string }; content?: { sha?: string } }> {
  if (!branch.startsWith("factory/")) throw new Error("branch_policy_violation");
  const normalized = path.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) throw new Error("invalid_file_path");
  if (/^(?:\.env|secrets?\/|\.github\/workflows\/)/i.test(normalized)) throw new Error(`protected_path:${normalized}`);
  if (content.length > 220_000) throw new Error(`file_too_large:${normalized}`);
  if (/(?:ghp_|github_pat_|sk-[A-Za-z0-9]|Bearer\s+[A-Za-z0-9._-]{20,})/i.test(content)) throw new Error(`secret_pattern_detected:${normalized}`);

  return gh(env, `/repos/${repo}/contents/${encodePath(normalized)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: message.slice(0, 240),
      content: utf8ToBase64(content),
      branch,
      ...(existingSha ? { sha: existingSha } : {})
    })
  });
}

export async function createDraftPullRequest(
  env: GitHubEnv,
  repo: string,
  input: { title: string; body: string; head: string; base: string }
): Promise<PullRequestInfo> {
  if (!input.head.startsWith("factory/")) throw new Error("branch_policy_violation");
  try {
    return await gh<PullRequestInfo>(env, `/repos/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: input.title.slice(0, 240), body: input.body.slice(0, 20_000), head: input.head, base: input.base, draft: true })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/github_http_422:/.test(message)) throw error;
    const owner = repo.split("/")[0];
    const existing = await gh<PullRequestInfo[]>(env, `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.head}`)}&base=${encodeURIComponent(input.base)}`);
    if (existing[0]) return existing[0];
    throw error;
  }
}

export function safeBranchName(jobId: string, title: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "change";
  return `factory/${jobId.slice(0, 8)}-${slug}`;
}

export async function createProjectDraftPr(
  env: GitHubEnv,
  input: {
    repo: string;
    jobId: string;
    title: string;
    summary: string;
    baseBranch?: string;
    changes: Array<{ path: string; content: string }>;
  }
): Promise<{ repo: string; branch: string; base: string; prNumber: number; prUrl: string; commitShas: string[] }> {
  if (!validRepo(input.repo)) throw new Error("invalid_repo_name");
  if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > 20) throw new Error("invalid_change_count");

  const repoInfo = await getRepo(env, input.repo);
  if (repoInfo.permissions && repoInfo.permissions.push === false && !repoInfo.permissions.admin && !repoInfo.permissions.maintain) {
    throw new Error("github_repo_write_permission_missing");
  }

  const base = input.baseBranch || repoInfo.default_branch;
  const baseSha = await getBranchSha(env, input.repo, base);
  const branch = safeBranchName(input.jobId, input.title);
  await createBranch(env, input.repo, branch, baseSha);

  const commitShas: string[] = [];
  for (const change of input.changes) {
    const existing = await getFile(env, input.repo, change.path, branch);
    const written = await putTextFile(
      env,
      input.repo,
      branch,
      change.path,
      change.content,
      `factory: ${input.title}`,
      existing?.sha
    );
    if (written.commit?.sha) commitShas.push(written.commit.sha);
  }

  const pr = await createDraftPullRequest(env, input.repo, {
    title: `[Factory] ${input.title}`,
    body: `${input.summary}\n\n---\nCreated by Zihin Factory. Draft PR only; no automatic merge.\nJob: ${input.jobId}`,
    head: branch,
    base
  });

  return { repo: input.repo, branch, base, prNumber: pr.number, prUrl: pr.html_url, commitShas };
}


export async function getRepoTree(env: GitHubEnv, repo: string, ref: string): Promise<RepoTreeEntry[]> {
  if (!validRepo(repo)) throw new Error("invalid_repo_name");
  const data = await gh<{ tree?: Array<{ path?:string; type?:string; sha?:string; size?:number }>; truncated?:boolean }>(
    env, `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );
  const entries = (data.tree ?? [])
    .filter(x => x.path && x.sha && (x.type === "blob" || x.type === "tree"))
    .map(x => ({ path:String(x.path), type:x.type as "blob"|"tree", sha:String(x.sha), ...(typeof x.size === "number" ? {size:x.size} : {}) }));
  if (data.truncated && entries.length === 0) throw new Error("github_repo_tree_empty_truncated");
  return entries;
}

export async function getTextFile(env: GitHubEnv, repo: string, path: string, ref: string, maxChars = 80_000): Promise<{ path:string; sha:string; content:string } | null> {
  const file = await getFile(env,repo,path,ref);
  if (!file || !file.content) return null;
  const content = file.encoding === "base64" ? base64ToUtf8(file.content) : String(file.content);
  if (content.length > maxChars) throw new Error(`github_text_file_too_large:${path}`);
  return { path,sha:file.sha,content };
}

export async function getPullRequest(env: GitHubEnv, repo: string, prNumber: number): Promise<PullRequestState> {
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error("invalid_pr_number");
  return gh<PullRequestState>(env,`/repos/${repo}/pulls/${prNumber}`);
}
