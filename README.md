# MIDWIFE Clinical Portal

Role-specific web entry points remain at the project root:

- `login.html`
- `student.html`
- `instructor.html`
- `admin-dashboard.html`

Start Apache and MySQL in XAMPP, import `database/schema.sql`, configure a
6–12 digit `THESIS_INITIAL_ADMIN_PIN` in the Apache environment for a new
database, then open `http://localhost/THESIS6/login.html`. Existing portal
credentials are upgraded to secure password hashes automatically on the next
API request.

If this version reports an administrator PIN recovery requirement after an
older upgrade, set a temporary 6â€“12 digit `THESIS_ADMIN_RECOVERY_PIN` in the
Apache environment and reload the API once. Sign in with that PIN, change it
when prompted, then remove the environment variable. This is only for the
historic truncated-hash migration; it does not create a default PIN.

See `docs/ARCHITECTURE.md` for the application structure and maintenance rules.
