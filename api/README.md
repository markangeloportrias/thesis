# MIDWIFE Clinical Portal backend

This is a dependency-free PHP 8 REST API for XAMPP/MariaDB.

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
