# Project Scout — preliminary bid-readiness cards

## What changed
Visible opportunity cards now include a plain-language, source-grounded explanation and an expandable **“Can I actually bid?”** checklist covering:
- Suggested trade fit (based on categorized listing, **not** the full work scope)
- Listed state versus actual worksite
- Recorded deadline versus any later amendments, times and time zones
- Vendor registration, set-asides, licensing, insurance, bonding, capacity and past performance (always marked unverified)

## Safety/accuracy boundaries
- **No eligibility verdict.** A matching trade or state only earns "possible fit"; requirements remain unverified until a user reads the official solicitation.
- **No new AI claims, fabricated scope, or invented details.** The explanation uses only fields already in the visible result.
- **No subscriber data leakage.** This component is added in makeCard(), which renders only visible records. Locked teaser rendering stays unchanged.
- **No scoring, database or API changes.** Existing server relevance scores and RLS boundaries remain untouched.
- The summary uses textContent through the established elt() helper, not innerHTML, so source titles and agencies aren't interpreted as HTML.

## QA checklist
1. Open Contracts and search as a free visitor. Expand "Can I actually bid?" on the one visible opportunity.
2. Confirm blurred premium teaser cards have no new opportunity details.
3. Search with trade + state, then without any trade. Confirm copy stays cautious.
4. Confirm unknown worksite, missing deadline and old deadline are marked for review.
5. Test mobile view (iPhone Safari), keyboard Tab/Enter on details, and both light and limited-detail listings.
6. Repeat with an active paid account and verify save, load more, checkout, search and membership access.

This first release deliberately avoids auto-approving a bidder. A later phase can parse official solicitation documents and compare them with verified company qualifications, with source citations.
