import { runGovOpportunityIngest } from "./api/_shared/govOpportunities.js";

export async function onScheduled({ env, scheduledTime }) {
  try {
    const summary = await runGovOpportunityIngest({ env, now: scheduledTime ? new Date(scheduledTime) : new Date() });
    console.info("gov opportunity scheduled ingest complete", {
      run_id: summary.run_id,
      usaspending_fetched: summary.usaspending.fetched,
      sam_fetched: summary.sam.fetched,
      sam_skipped: summary.sam.skipped,
      inserted: summary.inserted,
      updated: summary.updated,
      failed: summary.failed,
    });
  } catch (error) {
    console.error("gov opportunity scheduled ingest failed", { error: error?.name || "unknown" });
  }
}
