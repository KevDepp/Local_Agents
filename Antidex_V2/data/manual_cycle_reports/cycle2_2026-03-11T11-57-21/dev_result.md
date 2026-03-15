# T-006c_medium_baseline_fix - Result (Waiting Job)

Summary:
- Wrapper-based long job running to regenerate `medium_vs_medium_sanity.json` with required freshness.

Long Job:
- Request: data/jobs/requests/REQ-2026-03-11T09-46-02-1c11dc2f-a9d-T-006c_medium_baseline_fix.json
- Job folder: data/jobs/job-T-006c_medium_baseline_fix-2026-03-11T09-47-05
- Script: .\scripts\medium_sanity_job.cmd
- Expected output: ..\ai_lab\reports\medium_vs_medium_sanity.json
- Monitor path: data/jobs/job-T-006c_medium_baseline_fix-2026-03-11T09-47-05/stdout.log
- Monitor path: data/jobs/job-T-006c_medium_baseline_fix-2026-03-11T09-47-05/stderr.log
- Monitor path: data/jobs/job-T-006c_medium_baseline_fix-2026-03-11T09-47-05/monitor_reports/latest.md

Test Results:
- Pending (job still running).

Ecarts & rationale:
- Medium sanity run is long; using wrapper-based long job to avoid tool timeouts.

What this suggests next:
- Observed signal: The long job is still running; medium artifact not yet refreshed.
- Likely cause: MEDIUM 200-game run takes longer than interactive limits.
- Can current task still succeed as-is?: Yes, once the job completes and the new medium sanity JSON is written.
- Recommended next step: Wait for completion, then update dev_result with new summary and set developer_status=ready_for_review.
- Smallest confirming experiment: Watch `stdout.log` for completion and check `..\ai_lab\reports\medium_vs_medium_sanity.json` timestamp.

