# T-006c_medium_baseline_fix - Result (Waiting Job)

Summary:
- Easy sanity regenerated successfully; medium sanity regeneration still pending due to long runtime.
- Started a new wrapper-based long job to regenerate `medium_vs_medium_sanity.json` with the required freshness.

Long Job:
- Request: data/jobs/requests/REQ-2026-03-11T09-46-02-1c11dc2f-a9d-T-006c_medium_baseline_fix.json
- Script: .\scripts\medium_sanity_job.cmd
- Job folder: pending (watch `data/jobs/job-T-006c_medium_baseline_fix-*`)
- Expected output: ..\ai_lab\reports\medium_vs_medium_sanity.json
- Monitor path: data/jobs/<job_id>/stdout.log
- Monitor path: data/jobs/<job_id>/stderr.log
- Monitor path: data/jobs/<job_id>/monitor_reports/latest.md

Test Results:
- Pending (background job running).

Ecarts & rationale:
- Foreground medium run exceeded tool timeouts; switched back to the protocol-aware wrapper for a durable run.

What this suggests next:
- Observed signal: Medium sanity artifact is still stale for this attempt; job running to refresh it.
- Likely cause: The 200-game MEDIUM run exceeds interactive timeout limits.
- Can current task still succeed as-is?: Yes, once the job completes and the updated medium sanity JSON is written.
- Recommended next step: Wait for job completion, then update dev_result with the new summary and set developer_status=ready_for_review.
- Smallest confirming experiment: Check for an updated timestamp on `..\ai_lab\reports\medium_vs_medium_sanity.json` after the job completes.

