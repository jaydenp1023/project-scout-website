# Project Scout custom-domain cutover checklist

Proposed domain: **projectscouthq.com**. This is **not an availability check** and is **not proof of registration**.

## Before merging this branch
- Confirm that the domain is available and the Project Scout owner has **purchased and controls** it.
- Set DNS at the chosen registrar according to current GitHub Pages documentation.
  - Apex domain `projectscouthq.com`: A records pointing to GitHub Pages IP addresses, as documented in GitHub Pages settings.
  - Optionally configure `www.projectscouthq.com` as a CNAME pointing to `jaydenp1023.github.io`. Configure HTTPS and redirects in GitHub Pages.
  - Add GitHub Pages' DNS domain verification TXT record if GitHub requests it.
- Verify that DNS resolves and HTTPS is available **before switching live account emails or Stripe callbacks**.

## After domain ownership is verified
- Merge the CNAME branch and check GitHub Pages Settings > Pages > Custom domain.
- Update Supabase Auth **Site URL** and **Redirect URLs** to include `https://projectscouthq.com` while retaining old URL as fallback during transition.
- Update the Supabase Edge Functions that currently restrict origin to `https://jaydenp1023.github.io`, including:
  - `create-stripe-checkout` (also Stripe checkout success/cancel URLs)
  - `stripe-customer-portal` (also billing portal return URL)
  - `project-scout-public-preview`
  - `import-legacy-state-scan`, `ny-contract-sync`, `sam-opportunities-sync`, `project-scout-engine-admin`
- Ensure both new domain and old Pages URL function temporarily, and that dynamic CORS policy allows only explicitly approved origins.
- Test account signup, email verification, password reset, user profile, saved bids, Sandbox checkout, return URLs, billing portal and cancellation webhooks.
- Do not enter Stripe Live Mode until migration tests pass.

## Rollback
- Unmerge/remove the CNAME if the custom domain fails.
- Restore Supabase Auth Site URL and permit old GitHub Pages origin.
- Confirm previous site remains accessible at `https://jaydenp1023.github.io/project-scout-website/`.

No DNS changes or purchases are made by this staging branch.
