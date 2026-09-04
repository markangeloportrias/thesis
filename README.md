# MIDWIFE Clinical Portal

Role-specific pages are available through clean browser routes (Apache rewrites
these internally to the existing HTML files, so scripts and assets continue to
work unchanged):

- `/THESIS6/login`
- `/THESIS6/student`
- `/THESIS6/instructor`
- `/THESIS6/admin-dashboard` (also `/THESIS6/admin`)

The `.html` URLs remain backward-compatible and redirect to these clean routes.

Start Apache and MySQL in XAMPP, import `database/schema.sql`, configure a
6–12 digit `THESIS_INITIAL_ADMIN_PIN` in the Apache environment for a new
database, then open `http://localhost/THESIS6/login`. Existing portal
credentials are upgraded to secure password hashes automatically on the next
API request.

If this version reports an administrator PIN recovery requirement after an
older upgrade, set a temporary 6â€“12 digit `THESIS_ADMIN_RECOVERY_PIN` in the
Apache environment and reload the API once. Sign in with that PIN, change it
when prompted, then remove the environment variable. This is only for the
historic truncated-hash migration; it does not create a default PIN.

See `docs/ARCHITECTURE.md` for the application structure and maintenance rules.
