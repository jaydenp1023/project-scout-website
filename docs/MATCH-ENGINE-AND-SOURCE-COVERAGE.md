# Project Scout — Listing coverage and Match Engine (8 Nov 2026)

## Customer-facing 0–100 scale
- 100 is the theoretical maximum estimated **listing relevance**, not a guarantee of eligibility or contract award.
- Paying members use `scout_member_ranked_search` to rank **all** active, unique listings matching their selected state, source, trade, keyword and deadline **before** paginating the results. All member scores retain the full 0–100 scale.
- Free accounts get one real moderate-ranked state/trade result with an actual engine score no higher than 80. The server chooses a genuine lower-ranked result; **it does not edit a 94 to display 74**. Higher-ranked results are shown as locked, blurred teasers only if their true scores are higher.
- Labels: excellent 85–100, promising 65–84, broad/incomplete below 65. The 80 limit refers only to **freely visible samples**, not to members or the definition of perfection.

## Score inputs and known limitations
Calculated on the server from fields that exist in the issuing notice:
- Suggested trade compared with the selected trade / signed-in company profile; trade is generated from title keywords and can be wrong.
- Selected state versus record state, optional city match, posted and closing dates, title keyword, source URL, NAICS, agency and notice type.
- Lack of a worksite city, detailed description or NAICS lowers **evidence confidence**.
- Supply/chemical purchasing and design/consulting titles are penalized when the user seeks field work; titles indicating installation, on-call, construction, replacement or repair receive modest relevance credit.
- Scope category and information-quality chips are displayed on paid cards; incomplete records must not be described as verified jobsites.
- State is the state indexed by the source; if federal records have an obvious other-state title, they are excluded. Agency state is **not necessarily** actual project location.
- Distance from a ZIP is an approximation when calculated from the listing city; do not claim precise site distance.
- Scores do not validate company licenses, insurance, set-aside eligibility, bonding, capacity, bid competitiveness or supplier registration. **100 is not a probability of winning.**

## Source coverage status
- Georgia: `ga_gpr` official registry importer returned 516 open events on 8 Nov 2026; daily authenticated cron job `project-scout-georgia-gpr-daily`. Open-status data still needs individual source verification.
- Texas: `tx_esbd` historical seed had 389 records. Newly deployed `tx-esbd-incremental-sync` scans 14 official ESBD pages per invocation, storing a restartable page cursor in `scout_state_scan_cursors`. It is scheduled every five minutes as `project-scout-texas-incremental`; it has **not** completed its ~2,500-page first pass yet. It imports only notices with non-expired due dates and non-closed/cancelled/awarded statuses.
- SAM.gov and New York feeds continue through their preexisting sync jobs.
- Do **not** claim complete coverage of every state, every trade, or daily updates from any source that has only an old historical import.

## Access and security
- `public.scout_member_ranked_search` is `SECURITY INVOKER`; RLS on `opportunities` still restricts data to subscribers with active/trialing supported plans. `anon` has no execute grant.
- The public preview Edge Function uses the server's database access but returns only free listing details and sanitized locked teaser properties. It does not return the locked listing title, agency, ID or source URL.
- Supabase Vault stores scheduled connector tokens and cron jobs pass them server-side; **never put them in the GitHub Pages site**.

## Release regression checks
1. Georgia + Plumbing: valid state-only results, one lower-ranked free lead and locked higher matches, with no out-of-state Arizona title.
2. Texas + Plumbing: non-supply contract free sample; results may change as incremental crawl continues. No falsely inflated 90% labels.
3. Paid GA and NY searches: full-score results, total count and repeatable Load More pagination; verify all search filters and saved-only mode.
4. ZIP search: state mismatch rejected; distance marked approximate; no cross-state fallback.
5. Mobile Safari: card layout, buttons, signup, sign-in, business profile, confirmation and real Stripe plan recognition remain under manual QA.
