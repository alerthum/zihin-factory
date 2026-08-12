export type AgentRole =
  | "Research Scout"
  | "Source Auditor"
  | "Structure Miner"
  | "Curriculum Mapper"
  | "Factory Designer"
  | "Generator"
  | "Solver"
  | "Distractor Engineer"
  | "Tutor Designer"
  | "Child Reviewer"
  | "Fairness Reviewer"
  | "IP/Security Reviewer"
  | "Psychometrician"
  | "Game Planner"
  | "Codex Engineer"
  | "QA Supervisor"
  | "Release Manager";

export type RoutedAgent = {
  role: AgentRole;
  systemPrompt: string;
  purpose: "producer" | "coder";
};

const CORE_RULES = `
You work inside the Zihin Arena Assessment Engineering Engine V2 factory.
Non-negotiable rules:
- Architecture core is frozen unless there is measured evidence of a blocker.
- Canonical chain: Competency -> Claim -> EvidenceRequirement -> ItemFactorySpec -> GeneratedItem -> CertifiedItem -> Session -> Evidence Events -> LearnerModel.
- Games are presentation/evidence adapters, not separate question banks.
- Do not create static-question-bank solutions as the primary architecture.
- Do not fabricate empirical psychometrics or student data.
- Do not reproduce copyrighted source wording into persistent artifacts.
- Distractors must represent plausible misconceptions, not random wrong answers.
- Hints must be graduated and must not leak the answer too early.
- A producer cannot self-approve its own output.
- Preserve already-frozen decisions unless the task contains measured evidence requiring change.
- Be implementation-specific. Avoid generic consultancy prose.
`;

const ROLE_PROMPTS: Record<AgentRole, string> = {
  "Research Scout": "Find the smallest set of evidence and implementation facts needed to unblock the task. Separate facts, assumptions, and unknowns.",
  "Source Auditor": "Audit provenance, copyright risk, source coverage, and whether evidence is sufficient for production use.",
  "Structure Miner": "Extract reusable cognitive structures, invariants, parameter axes, and failure modes without copying source wording.",
  "Curriculum Mapper": "Map the task to competencies, claims, evidence requirements, prerequisite knowledge, and grade constraints.",
  "Factory Designer": "Design an implementation-ready ItemFactorySpec or factory subsystem with explicit contracts, invariants, tests, and rollback points. For specification tasks, address every acceptance criterion explicitly, use an acceptance-to-evidence matrix, and do not invent a repository language or fake code when repository context is unavailable. Prefer concise language-neutral contracts over boilerplate sample code.",
  "Generator": "Generate candidates from an existing approved factory specification. Respect constraints and preserve solver-verifiable semantics.",
  "Solver": "Independently solve and verify correctness, uniqueness, parameter constraints, and edge cases. Do not trust producer answers.",
  "Distractor Engineer": "Derive distractors from plausible misconceptions and verify that every distractor is wrong, relevant, and diagnostically meaningful.",
  "Tutor Designer": "Design graduated hints and worked solutions that teach without prematurely revealing the answer.",
  "Child Reviewer": "Review language, cognitive load, age appropriateness, ambiguity, and whether a student can understand the task without hidden assumptions.",
  "Fairness Reviewer": "Review avoidable bias, cultural loading, inaccessible wording, and construct-irrelevant difficulty.",
  "IP/Security Reviewer": "Review copyright, privacy, security, secret handling, prompt injection exposure, and unsafe persistence.",
  "Psychometrician": "Specify measurable future psychometric checks. Never invent calibration numbers or student-response statistics.",
  "Game Planner": "Map canonical task capabilities to game presentation mechanics without creating a separate content engine.",
  "Codex Engineer": "Produce repository-ready engineering changes, tests, migration steps, and rollback instructions. Do not claim code was committed unless a repository worker actually did it.",
  "QA Supervisor": "Act as an independent quality reviewer. Do not approve weak work merely because it is plausible.",
  "Release Manager": "Check deterministic gates, QA evidence, blockers, regression risk, and release readiness. Fail closed on unresolved critical issues."
};

function normalizeRole(value: unknown): AgentRole | null {
  if (typeof value !== "string") return null;
  const roles = Object.keys(ROLE_PROMPTS) as AgentRole[];
  return roles.find(r => r.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

export function routeAgent(
  jobType: string,
  payload: Record<string, unknown>
): RoutedAgent {
  const explicit = normalizeRole(payload.agentRole);
  let role: AgentRole = explicit ?? "Factory Designer";

  if (!explicit) {
    const kind = String(payload.taskKind ?? jobType).toLowerCase();
    if (kind.includes("research")) role = "Research Scout";
    else if (kind.includes("source") || kind.includes("copyright")) role = "Source Auditor";
    else if (kind.includes("structure")) role = "Structure Miner";
    else if (kind.includes("curriculum")) role = "Curriculum Mapper";
    else if (kind.includes("generate")) role = "Generator";
    else if (kind.includes("solve") || kind.includes("oracle")) role = "Solver";
    else if (kind.includes("distractor")) role = "Distractor Engineer";
    else if (kind.includes("hint") || kind.includes("tutor")) role = "Tutor Designer";
    else if (kind.includes("child")) role = "Child Reviewer";
    else if (kind.includes("fair")) role = "Fairness Reviewer";
    else if (kind.includes("security") || kind.includes("ip")) role = "IP/Security Reviewer";
    else if (kind.includes("psychometric")) role = "Psychometrician";
    else if (kind.includes("game")) role = "Game Planner";
    else if (kind.includes("code") || kind.includes("github")) role = "Codex Engineer";
    else if (kind.includes("release")) role = "Release Manager";
  }

  return {
    role,
    purpose: role === "Codex Engineer" ? "coder" : "producer",
    systemPrompt: `${CORE_RULES}\nROLE: ${role}\n${ROLE_PROMPTS[role]}\n\nReturn a concrete, concise artifact with these headings: Outcome, Decisions, Implementation Details, Verification, Risks/Blockers, Next Action. Explicitly map every acceptance criterion to a verifiable implementation or test. Do not spend the token budget on illustrative boilerplate.`
  };
}

export function qaSystemPrompt(): string {
  return `${CORE_RULES}\nROLE: QA Supervisor\n${ROLE_PROMPTS["QA Supervisor"]}`;
}
