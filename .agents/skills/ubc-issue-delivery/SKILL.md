---
name: ubc-issue-delivery
description: Implement approved issues in the UBC Assignment Manager repository one at a time, with a separate branch, relevant tests, PR review, and authorized merge. Use for issue-by-issue project delivery; do not use for planning-only requests.
---

# UBC issue delivery

Use this workflow only when the user has authorized implementation of the issue or issue set. Read the current issue, linked milestone, repository instructions, and working tree before editing. Treat the latest user correction as authoritative if an issue still contains older wording.

For each issue:

1. Start from the latest `main` with a clean working tree and create a dedicated `codex/<issue-number>-<short-topic>` branch. Keep unrelated changes out of that branch.
2. Implement the issue's observable acceptance criteria. Preserve Windows behavior while adding macOS support. If a requirement depends on a real Mac, separate automated evidence from unverified device behavior and label any unverified package as a preview.
3. Run tests relevant to the change, including the repository's existing tests. Inspect the built artifact when packaging changes. Check the staged diff for credentials, browser profiles, `.local-data`, personal course data, and unexpected binaries.
4. Commit and push the branch, open a PR linked to the issue, inspect the diff and CI, and fix actionable findings. Merge only when the user has authorized merging in this session and required checks pass. Otherwise leave the PR for review.
5. Confirm the issue and PR state, update local `main`, then start the next issue. Report completed and unverified acceptance criteria precisely; do not close an issue merely because code exists.

For this repository's macOS milestone, the deliverable is a desktop `.app` installed by an unsigned, unnotarized `.pkg`. Its main UI must open in the App's own window. A separate browser may be used for course login and synchronization. System reminders must come from the Mac App and remain available while its main window is closed. Do not substitute browser notifications or an external browser tab for these requirements.
