# DiscoverAgent Product Brief

## Summary
DiscoverAgent is a cross-platform app (web + iOS via Expo) that helps users quickly compare viewpoints from trusted sources and monitor the latest source highlights. The product combines direct Q&A categorization, source-homepage summarization, clustering, and voice-to-text input.

## Problem
Users who need credible, cross-source perspective synthesis spend too much time jumping between outlets, filtering noise, and reconciling disagreements.

## Target Users
- Individual users who want a quick multi-source perspective on a question.
- Users tracking headline-level changes across major media and tech/community sources.
- Builders/operators who want lightweight API observability from inside the app.

## Product Goals
- Provide fast, source-aware perspective summaries from a single prompt.
- Surface high-signal, cross-source clusters from trusted source homepages.
- Keep source highlights reasonably fresh without requiring a page visit.
- Expose basic reliability and performance visibility through a dashboard.

## Current Use Cases
1. Perspective analysis from a question
- User enters a question and taps `Analyze Perspectives`.
- The app requests `/api/categorize` and returns clustered source-aligned views.

2. Latest highlight discovery
- User taps `Discover Latest Highlights` for a forced refresh.
- The app calls `/api/source-workflow` and shows per-source summaries plus ranked clusters.
- On initial load, the app also triggers source workflow fetch automatically.

3. Voice-assisted input
- On supported browsers, user speaks into the mic.
- Speech recognition is used when available; otherwise audio is recorded and sent to `/api/transcribe`.
- Transcript is appended into the question input.

4. Operational monitoring
- User opens Dashboard to view API totals, endpoint stats, cache hit/miss stats, and recent requests from `/api/metrics`.

## Key Product Behavior (Current Implementation)
- Backend periodic source refresh job runs in the local Node server process:
  - startup refresh enabled by default
  - recurring refresh every 30 minutes by default
  - forced refresh by default (bypasses cache)
- Frontend source workflow also auto-runs on page load and every 6 hours while page is open.
- Trusted source prioritization is applied in categorization prompts.
- Rate limiting is enforced at 10 requests/minute/IP.

## Scope
### In Scope
- Multi-endpoint API for ask/categorize/source workflow/transcribe/metrics.
- In-memory + optional Redis-backed source workflow cache.
- Web/iOS app navigation and core workflows.

### Out of Scope (Current)
- User accounts and personalized history.
- Persistent long-term analytics storage.
- Guaranteed global periodic scheduling in serverless runtime without external cron.

## Success Metrics (Recommended)
- Time to first useful result (categorize/source workflow).
- Percentage of source workflow responses served fresh vs cache.
- Source workflow usable-source ratio.
- API success rate and p95 latency per endpoint.
- User engagement with `Analyze Perspectives` and `Discover Latest Highlights`.

## Risks and Constraints
- Homepage snapshots can miss paywalled or deep-link content.
- Source extraction quality depends on HTML readability and anti-bot friction.
- In serverless-only deployments, periodic background refresh needs external scheduling.
- No persisted datastore for metrics/history by default.
