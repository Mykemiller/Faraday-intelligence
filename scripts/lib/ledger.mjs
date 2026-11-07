// ledger.mjs — FDY-97 migration-ledger integrity, pure logic.
//
// Faraday's equivalent of Boundstone's test/ledger-integrity.test.mjs (FDY-60),
// with two deliberate differences:
//
//  1. Match by NAME, not version. The Supabase MCP apply_migration tool stamps
//     its own timestamp version, so the same migration can be filed as
//     20261009210000_poller_fair_scheduling.sql and applied as
//     20261012xxxxxx poller_fair_scheduling. A version match would call every
//     such migration unfiled; a name match does not.
//  2. A shrink-only BASELINE. On 2026-11-06 2,260 of 2,302 applied names had no
//     repo file. Failing on all of them would make the test permanently red and
//     therefore ignored. Instead the baseline freezes today's debt: a NEW
//     unfiled name fails, and a baseline entry that has since been filed also
//     fails (so the list can only shrink).

/** "20261009210000_poller_fair_scheduling.sql" -> "poller_fair_scheduling";
 *  "0034_cc_state_incentive_source_registry.sql" -> "cc_state_incentive_source_registry". */
export function migrationNameFromFile(filename) {
  return String(filename).replace(/\.sql$/i, "").replace(/^\d+_/, "");
}

/**
 * @param {{applied: {version:string,name:string}[]}} snapshot
 * @param {string[]} repoFiles  filenames in supabase/migrations/
 * @param {{unfiled: string[]}} baseline
 */
export function checkLedger(snapshot, repoFiles, baseline) {
  const filed = new Set(repoFiles.filter((f) => f.endsWith(".sql")).map(migrationNameFromFile));
  const appliedNames = new Set(snapshot.applied.map((r) => r.name));
  const base = new Set(baseline.unfiled);
  const unfiled = [...appliedNames].filter((n) => !filed.has(n)).sort();
  return {
    appliedCount: appliedNames.size,
    unfiledCount: unfiled.length,
    /** applied, not filed, not grandfathered — the drift this guard exists to stop */
    newUnfiled: unfiled.filter((n) => !base.has(n)),
    /** grandfathered but now filed — must be deleted from the baseline */
    staleBaseline: [...base].filter((n) => filed.has(n)).sort(),
    /** grandfathered names that are no longer applied at all (rolled back / renamed) */
    vanishedBaseline: [...base].filter((n) => !appliedNames.has(n)).sort(),
    /** filed but not applied: normal here (migrations ship un-applied for Myke) — informational */
    filedNotApplied: [...filed].filter((n) => !appliedNames.has(n)).sort(),
  };
}
