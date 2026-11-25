# MIDWIFE Clinical Portal backend

This is a dependency-free PHP 8 REST API for XAMPP/MariaDB.

Startup migrations are versioned in `api/startup-migrations.php`. The first
request for a new version runs the existing migrations under a database lock
and records completion in the existing `system_meta` table. Subsequent requests
check that marker and skip the schema checks and credential scans. Increment
`PORTAL_STARTUP_VERSION` whenever introducing another startup migration.
Deploy `startup-migrations.php` together with `bootstrap.php` and `index.php`.
Backup imports ignore the startup marker and migrate imported legacy credentials
before committing; administrator setup/recovery remains available separately.

Hostinger deployments require PHP 8.1 or later and `pdo_mysql`. Upload
`api/bootstrap.php`, `api/index.php`, and `assets/js/api-client.js` together when
applying the migration fixes. Student creation now includes the block assignment
in one transaction, so a failed enrollment cannot leave a partially saved account.

Open `/api/health` on the deployed site, then check student creation, verification,
and archive/restore while signed in. If initialization fails, the PHP error log
now records the underlying database error. Initial schema upgrades still need
CREATE/ALTER permissions; an upgraded schema no longer runs table creation,
enrollment ALTERs, or absent procedure removal on every request. Forward the
Authorization header to PHP; both normal and redirected FastCGI headers are accepted.

Do not reimport `database/schema.sql` over a live database to apply these fixes:
it is a full XAMPP dump with table replacement, a `thesis_portal` database name,
and local view definers. Existing records are preserved by the code fixes;
duplicate case submissions are rejected and repeated edit approvals do not
generate additional notifications. Existing duplicate records require review
before archiving; this update does not delete clinical history.

Regression checks: `node tests/api-client-migration.test.cjs`,
`node tests/workflow.test.cjs`, `node tests/portal-improvements.test.cjs`, and
`php tests/record-validation.test.php`. The additional
`tests/hostinger-workflows.test.cjs` creates records and must run against a
disposable localhost API/database with the schema, a `delivery-handled` procedure,
and an initial administrator. Set `PORTAL_TEST_URL` (ending in `/api/`) and
`PORTAL_TEST_ADMIN_PIN`. For hosting-permission coverage, initialize the schema
first, then run the API with a database user granted only SELECT/INSERT/UPDATE/DELETE.

1. Place the project in `C:\xampp\htdocs\THESIS6`.
2. Import `database/schema.sql` in phpMyAdmin.
3. Start Apache and MySQL in XAMPP.
4. Open `http://localhost/THESIS6/api/health`.

Database settings are in `api/config.php`. Environment variables named
`THESIS_DB_HOST`, `THESIS_DB_PORT`, `THESIS_DB_NAME`, `THESIS_DB_USER`, and
`THESIS_DB_PASSWORD` override the defaults.

For a brand-new database, set a 6–12 digit `THESIS_INITIAL_ADMIN_PIN` in the
Apache environment before the first request. The API creates the initial
administrator from that value; no browser-side default credential is used.

Very old installs with a truncated administrator hash can be recovered with a
temporary 6â€“12 digit `THESIS_ADMIN_RECOVERY_PIN`. Reload the API, sign in
with that recovery PIN, choose a new PIN when prompted, then remove the
variable. It affects only malformed, truncated bcrypt credentials.

Administrators can download an authenticated SQL database backup from System
Settings. The backup uses `INSERT IGNORE` statements, so importing it directly
into the selected MariaDB database preserves rows that already exist and adds
only records that are missing. The System Settings importer accepts these `.sql`
backups as well as older authenticated `.json` snapshots, and performs the same
conflict-safe merge inside a transaction. Existing administrator credentials
and active sessions are not replaced.

The API never accepts HTTP `DELETE`. Archive endpoints use
`PATCH /api/{resource}/{id}/archive`; retained records can be restored where
the workflow supports it. Permanent removal is available only through
role-protected `PATCH /api/{resource}/{id}/delete` actions, and only for
records that are already archived.

## Instructor email password recovery

Apply the instructor email columns and password-reset table from `database/add.sql`
once before using recovery or registering instructor emails. Do not re-import
existing columns/tables. The student edit-request migration is independent.

In GitHub repository Actions secrets, set:

- `THESIS_SMTP_USERNAME`: your full Gmail address, used to authenticate sending.
- `THESIS_SMTP_PASSWORD`: a Google App Password for that account, not its normal
  password. Enable Google Two-Step Verification, then create an App Password at
  https://myaccount.google.com/apppasswords. Never commit or share this password.
- `THESIS_MAIL_FROM`: the same Gmail address as `THESIS_SMTP_USERNAME` (if omitted,
  the sender defaults to the SMTP username).
- `THESIS_RECOVERY_LOGIN_URL`: the full HTTPS login page URL, for this deployment
  `https://midwife.dcsbisu.com/login` (no query string or fragment).

The existing deployment builds these values into the server-side PHP config.
For a manual deployment, set the equivalent environment variables or the
`instructor_recovery` values in `api/config.php`. Sending uses PHPMailer with
authenticated Gmail SMTP over verified TLS to smtp.gmail.com:465. There is no
PHP mail fallback. The deployment installs the locked Composer dependencies
into api/vendor; manual deployments must run `composer install --no-dev` and
upload that directory too. PHP 8.0+ with OpenSSL is required. The hosting server
must allow outbound connections to port 465. Confirm delivery to an actual
instructor mailbox, including spam, after deployment; SMTP acceptance does not
guarantee inbox delivery. Server logs report safe diagnostic categories for
connection, authentication, and delivery errors without message bodies or secrets.
Missing settings return a configuration error before any account lookup. Actual
delivery failure retains the generic public response to protect account privacy.

After setting the secrets, rerun the deployment so it rebuilds the configuration.
No SQL change is required for the SMTP switch. The instructor's Recovery Email
is the recipient; the Gmail account configured above is the sender. Google may
not offer App Passwords on some managed or restricted accounts. See
https://support.google.com/accounts/answer/185833 for eligibility and setup.

Admins register the recovery email when adding or editing an instructor. It is
only returned to admins, and changing it invalidates outstanding recovery codes.
`email_verified_at` stays NULL until the owner completes a password reset;
prior verification is not required for an admin-registered address. Existing
accounts continue to sign in without an email, but cannot recover by email until
an admin registers one. Duplicate recovery addresses are rejected.

Instructor login includes Forgot Password: enter email, enter the emailed
8-digit code, then choose a new password. Codes expire in 10 minutes. Verifying
a code consumes it and grants 10 minutes to finish resetting the password.
The existing token_hash column stores a hash of the code, then a hash of the
reset permission. No additional SQL migration is needed. Requests have an IP
limit, an account cooldown, and at most five code attempts per account in a
15-minute window across all IPs. Registered/unregistered addresses receive the
same public response. Completing a reset changes the hashed password, consumes
outstanding reset permissions, and revokes instructor sessions.

Deployment check: register a test instructor email, request a code, verify it,
reset the password, confirm old-password login fails and new-password login
works, then confirm that reusing the code is rejected. Also check expired
codes and changing the recovery email before using a previously issued code.
