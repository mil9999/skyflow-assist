/** Summarize only sanitized worker results. Never ingest provider responses. */
export function summarizeEvaluation(results, live) {
  const totals = { passed: 0, failed: 0, inconclusive: 0 };
  const scenarios = {};
  const fingerprints = new Set();
  for (const result of results) {
    const outcome = ["passed", "failed"].includes(result.outcome) ? result.outcome : "inconclusive";
    totals[outcome]++;
    const summary = scenarios[result.scenario] ??= { runs: 0, passed: 0, failed: 0, inconclusive: 0, failedChecks: [] };
    summary.runs++; summary[outcome]++;
    for (const step of result.steps ?? []) {
      for (const check of step.checks ?? []) {
        if (!check.passed && !summary.failedChecks.includes(check.name)) summary.failedChecks.push(check.name);
      }
    }
    if (result.configuration?.fingerprint) fingerprints.add(result.configuration.fingerprint);
  }
  const configurationConsistent = live ? results.length > 0 && fingerprints.size === 1 && results.every((result) => result.configuration?.fingerprint) : null;
  return { total: results.length, counts: totals, scenarios, configurationConsistent,
    passed: results.length > 0 && totals.passed === results.length && (!live || configurationConsistent) };
}
