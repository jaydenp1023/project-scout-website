# Project Scout — branded confirmation email setup

This change includes the email template and front-end success screen. The Supabase dashboard's mailer and redirect settings must **also** be configured; committing this file alone does not change the emails Supabase sends.

1. Open Supabase project **Project Scout** → **Authentication** → **URL Configuration**.
   - Site URL: `https://projectscouthq.com`
   - Confirm the production root URL is allowed for redirects. The site now uses its existing root URL for verification rather than requesting a new query-string callback. Keep only legitimate development preview origins as needed.
2. Open **Authentication** → **Email Templates** → **Confirm sign up**.
   - Subject: `Confirm your Project Scout account`
   - Replace the template body with `supabase/confirm-signup-email.html`. Preserve the Supabase placeholder `{{ .ConfirmationURL }}` exactly.
   - The template changes message contents; it does **not** change the From/Sender name.
3. Set up **Authentication** → **SMTP Settings** with a verified sender domain/address (for example a mailbox under projectscouthq.com). Set the verified sender name to **Project Scout**. Follow your email provider's SPF, DKIM and DMARC instructions. Do not put SMTP credentials in this repository.
   - Supabase's built-in sender is not suitable for signing up arbitrary public customers: on hosted projects it is restricted to pre-authorized recipients. Configure production SMTP before advertising registrations.
4. Keep **Confirm email** enabled. Do **not** disable confirmations as a workaround; that would make unverified addresses able to sign in.
5. Manual checks before merging:
   - Search a common trade and a state, plus nationwide/all; two real free results and a member-only teaser should appear when enough matching records exist.
   - Try a deliberately impossible keyword; the page should say there are no current matches, not show fake cards.
   - Sign up from a fresh email, check that the Project Scout template and sender appear.
   - Tap Confirm email address, verify the success notice and account/session behavior. If the email app opens a separate browser, confirm that a normal login using the existing password works without starting signup over.
   - Check same-phone browser and a different email-app browser; on a different browser the user may need Log In once with the password already created.
   - Try the Resend button and password reset; verify membership remains enforced by Supabase RLS.
   
No production email configuration is changed by this pull request.

6. Verify the business profile login loop fix:
   - Sign in on Safari/iPad. Without refreshing the page, open **My Account** and enter a business name, trade, city, and state.
   - Save business preferences and ensure the account remains signed in.
   - Refresh and return to My Account: the form should still show the saved details and must not switch back to Log In.
   - Sign out and confirm that the protected account form is hidden. Also check a separate browser where local storage is unavailable, since Supabase sessions are browser-specific.
7. Relevance percentages are estimates based on listing details/search criteria. They are not win rates, supplier eligibility scores, or verified buyer ratings. Locked percentages and titles are only visually obscured; membership authorization still depends on RLS and server-side controls.
