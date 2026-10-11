# Cogumi Kanban — Codex and progress capture addendum

Version 2.2 | October 10, 2026 | User-authorized local plugin update

Extends Cogumi_Claude_Kanban_PRD.md v2.1. Historical source is preserved. Product display name is Cogumi Kanban; rename the package identity to cogumi-kanban and preserve the existing database through a compatible data-home alias.

## Host and UI

Support Codex with a read-only loopback browser board that reads the existing SQLite database. This explicitly supersedes the original exclusion of network listeners only for a private 127.0.0.1 board transport with random URL, Host/Origin checks and no cloud synchronization. Retain Claude Artifact and snapshot modes. Poll live observations every 15 seconds and display tracking warnings separately from lifecycle status.

## Reliable progress

Registered execution must save its start before launching, heartbeat its existing claim during the run, journal the actual result before delivery, enqueue stable-ID events, and replay interrupted delivery only after worker-state verification. Existing workflow test/resume implements these obligations. Never infer a pass from exit status alone, chat text, missing outcomes or direct untracked tests. Uncommitted results cannot qualify clean-candidate proof.

At session start, story switches, blockers and before progress reports, run the update reconciliation. Observe repository binding, exact commit, dirty state, pending/rejected queue counts and existence of explicit proof scripts. Persist a private report and reconciliation. Queue parse failures must stop the update, not become zero pending. Do not recover claims, replay a running worker or alter scope automatically.

Detect expired claims, absent candidate, missing current-attempt checks, started runs without results, dirty/outdated proof, missing releases and delivery problems. Display an expired claim as interruption, not silently renewed activity. Surface implementation, proof and release independently. Existing lifecycle gates remain authoritative.

## On-demand command

/cogumi-kanban:update invokes cli update from the bound product repository. Resolve exact binding; ambiguous/mismatched binding requires selection. Save observations and show truthful status/gaps. Hosts without slash dispatch may invoke the skill with “Update Cogumi Kanban.” The plugin must not claim host command registration that was not observed.

## Bounds and source coverage

No plugin can intercept every arbitrary terminal command or guarantee survival of total device loss. Commands outside the tracked runner remain unverified. These changes do not dispatch a worker or grant deployment authority. PRD imports retain original source and IDs; human review distinguishes metadata from requirements and maps cross-cutting requirements. Do not silently delete or waive existing scope during reconciliation.

## Acceptance

Tests must verify unknown results and older attempts remain unverified, expiry/dirty/source drift are detected without mutation, local browser warnings render, update observes a real bound checkout and persists a private report, queue corruption is visible, and existing reporting/recovery/gating regressions pass.

## Delivery modes and source classification (v2.3)

An explicit project decision selects Auto or Approval; existing projects default to Approval. Auto prepares approved, unchanged scope across epics on import, scope approval, reconciliation and story closure. Draft becomes Backlog; Ready still requires reviewed criteria/proof plans and qualified dependencies. Proposed/excluded/source-review and unapproved phases are not promoted. Auto does not launch an independent worker; the active agent continues next_story → claim → implement → tracked checks → release/deployed checks → before-close → Shipped across epics until real blockers or approved scope exhaustion. Approval retains manual queue preparation. Both modes preserve all completion gates, source authority and claim protection.

Source inventory distinguishes reference metadata from actual requirements. Cross-cutting requirements explicitly map across epics and phases; they do not require a synthetic story for a document heading. Classification repair retains source text, IDs, revision and mapping history without changing acceptance criteria or active attempts. Uncertain requirements remain unmapped. An unchanged legacy reimport preserves audited classification repairs; changed source still requires review. Abovely v1.7 mapping repair is stored in reconciliations/Abovely_PRD_v1.7.json with source-text fingerprints. Three title/version rows are reference material; the remaining 44 global paragraphs retain delivery obligations and story links.
