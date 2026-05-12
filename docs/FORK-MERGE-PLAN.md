# GeoNeo Fork Merge Plan

## Source: a1davida1/geoneo branch feature/optimized-fork
## Target: /home/matt/geoneo-ai (current working copy on main)

## Services to pull from fork:
1. services/visibilityScoring.js - 8-pillar weighted scoring engine
2. services/weeklyScoreScheduler.js - cron-based auto-scoring for paid members
3. services/scoreHistory.js - stores/retrieves historical scores per domain
4. services/competitorIntelligence.js - live competitor comparison + gap analysis
5. services/competitorTracking.js - persists tracked competitors, records movement
6. services/memberBrief.js - weekly actionable recommendations (3 items)
7. services/weeklyEmailReport.js - auto-sends score reports
8. services/adminSummary.js - aggregated admin dashboard data
9. services/fixTracker.js - tracks implemented fixes per domain
10. services/emailOutbox.js - email queue with state tracking
11. services/auditLookup.js - loads audit records helper
12. services/apiAccess.js - API access control

## Pages to pull:
- admin/index.html - full admin dashboard (1276 lines, sidebar nav, panels)
- member-dashboard.html
- competitor-intelligence.html
- pricing.html

## Dependencies to add:
- node-cron ^3.0.3

## Important notes:
- Fork is 18 commits BEHIND current main (our report.html changes, market overview, SWOT, etc are NOT in fork)
- Fork removed audits.json from repo (uses .gitkeep in data/)
- Admin page hits /api/admin/* endpoints that need wiring into server.js
- Weekly scheduler won't work on Vercel serverless (needs persistent process)
- The fork's server.js is different from ours - DON'T replace, just wire new endpoints

## Current state of our codebase:
- report.html has new market overview (SWOT, GBP/SEO/GEO bars, difficulty badges, etc)
- data/market-audits/branson-towing.json has real audit data for 7 tow companies
- scripts/audit-branson-towing.js crawls and scores tow truck websites
- docs/PRODUCT_RULES.md has "no guessing" rule
- Target industries: electricians, garage-door, hvac, pest-control, plumbers, restoration, roofers, tree-service, towing (9 total)
- Need to audit all Branson businesses in all 9 industries with email/phone extraction
- Need admin page to view all this data

## Approach:
1. Pull services from fork (curl raw files from GitHub)
2. Pull admin/index.html and other pages
3. Add node-cron dependency
4. Wire /api/admin/* endpoints into our server.js
5. Then run multi-industry audits for all 9 Branson industries
6. Store results in data/market-audits/ per industry (branson-{industry}.json)
7. Each file has: business name, website, phone, email, address, audit score, analysis details

## Fetch URLs pattern:
https://raw.githubusercontent.com/a1davida1/geoneo/feature/optimized-fork/geoneo-ai/{path}
