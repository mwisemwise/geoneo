# Product Rules

## Data Integrity — No Guessing

**Every number, score, and claim in a report must come from actual verified data.**

- Do NOT estimate website quality without actually crawling the site
- Do NOT guess AI visibility without actually querying AI tools
- Do NOT fabricate national averages or benchmarks without a real data source
- If data is unavailable, say "not yet audited" — never fill in a guess
- Market reports must be backed by real website audits of the businesses that show up in search
- Admin-side data files store real audit results and update over time as businesses are re-audited
- Any estimate or projection must be explicitly labeled as such and approved before shipping

**If we haven't looked at it, we don't score it.**

## Intake Fields

Audit intake supports:
- `contactName`
- `businessName`
- `businessEmail`
- `phone`
- `industry`
- `streetAddress`
- `city`
- `state`
- `market` (main markets)
- `competitors` (1-3, free text/textarea)
- `bestContactTime` (optional)
- `followupConsent` (checkbox)
- `url` (website)
- `package`

## Package Visibility Rules

### Free (Basic)
Show:
- Real World Search visibility summary (outcome)
- Limited technical summary (underlying causes)

Hide:
- Full rankings table
- Deep issue breakdown and strategy plan

### Silver
Show:
- Everything in Basic
- Rankings + competitor visibility detail
- Full issue list
- Categorized issue output (SEO, technical, trust, etc.)
- Recommendation

Hide:
- Gold-only implementation roadmap and strategy plan

### Gold
Show everything in Silver, plus:
- Screenshots in the real-world rankings section
- Full diagnosis
- Issue-by-issue solutions
- Step-by-step implementation roadmap
- Prioritized action plan

### Admin/Internal
Always keep full data available for internal use.

## Upgrade Credit Rules

- Silver payment amount can be credited toward Gold.
- Gold payment amount can be credited toward Platinum.
- Persist in record as:
  - `purchasedPackage`
  - `amountPaid`
  - `upgradeCreditAvailable`

## Lead Persistence Rules

Each saved record should include:
- Lead intake fields
- `auditId`, `createdAt`
- `scores`
- `recommendation`
- `reportLink`
- `fullAuditResult` (internal)
- Follow-up fields (`followupConsent`, `followupStatus`)
