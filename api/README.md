# MIDWIFE Clinical Portal backend

This is a dependency-free PHP 8 REST API for XAMPP/MariaDB.

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
