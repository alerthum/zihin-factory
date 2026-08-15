# Zihin Factory Observer

The observer is a read-only evidence collector. It cannot start, pause, retry,
certify, deploy, merge, or modify factory work.

## Rollout

1. Pause the previous three-hour ChatGPT task. Preserve its run history.
2. Add the existing Worker `FACTORY_ADMIN_TOKEN` value as a GitHub Actions
   repository secret with the same name. Never put the value in a prompt,
   issue, workflow file, artifact, or commit.
3. Run `Zihin Factory Observer` manually with `workflow_dispatch`.
4. Review `report.md`, `report.json`, and the GitHub Actions step summary.
5. Correct false alarms and repeat the manual run.
6. After successful manual verification, enable the three-hour schedule.
7. GitHub Actions refreshes one durable watch issue with its scoped
   `GITHUB_TOKEN`. This issue is the single operator-facing control center:
   it shows the latest verified report and links to deeper diagnostics.
   Historical evidence stays in workflow runs and 14-day artifacts rather
   than accumulating as issue comments.
8. Configure Codex Web to read that evidence and report a diagnosis in
   Scheduled. Codex must not modify GitHub or code during observer runs.

## Evidence contract

The observer separates three questions:

- Is the service operational?
- Did the factory finish useful work?
- Is there enough evidence to claim item quality?

The current required item-quality evidence is:

- evaluated sample size;
- semantic duplicate rate;
- correct-answer length-position signal;
- unique-answer rate;
- explanation-to-source evidence rate.

If these values are absent, the observer reports `QUALITY_EVIDENCE_MISSING`.
It does not treat a completed workflow, an AI reviewer score, or an internally
set approval flag as proof of question quality.

## Codex Web observer prompt

The GitHub Observer runs every three hours even when the local computer is
off. Codex Web is an optional reasoning layer on top of the durable control
center; it is not responsible for triggering the Observer.

Use a standalone scheduled task only after the manual workflow is proven:

```text
Every three hours, inspect the latest completed `Zihin Factory Observer`
workflow run and the open issue titled `[WATCH] Zihin Factory evidence log`
in alerthum/zihin-factory.

Read the latest issue entry and compare it with the previous observed run.
Return the diagnosis to this Scheduled task only.

Rules:
- Read-only observer mode: do not edit code, create branches, open PRs, deploy,
  start jobs, pause jobs, retry jobs, merge, certify questions, or write to
  GitHub.
- Report only evidence present in the observer output or GitHub Actions state.
- Never infer human approval, student learning, psychometrics, or quality from
  an AI score or a completed workflow.
- If there is no new observer run, report `Yeni kanıt yok` and stop.
- If severity is INFO, return a one-line timestamped health summary.
- If severity is WARNING or CRITICAL, include the finding code, direct evidence,
  change from the previous run, and exactly one bounded next task.
- Never include or request FACTORY_ADMIN_TOKEN or any other secret.
```

The first scheduled version remains an observer. A later repair task must be a
separate, explicitly approved workflow with its own branch, tests, and draft PR.
