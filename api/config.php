<?php
declare(strict_types=1);

return [
    'database' => [
        'host' => getenv('THESIS_DB_HOST') ?: 'localhost',
        'port' => getenv('THESIS_DB_PORT') ?: '3306',
        'name' => getenv('THESIS_DB_NAME') ?: 'u948876618_midwife',
        'user' => getenv('THESIS_DB_USER') ?: 'u948876618_midwife',
        // Database password; keep this server configuration private.
        'password' => getenv('THESIS_DB_PASSWORD') ?: 'Mid_wife125',
    ],
    'session_hours' => 12,
    // Leave empty for same-origin XAMPP use. Set this when the browser app is
    // hosted on a different trusted origin.
    'allowed_origin' => getenv('THESIS_ALLOWED_ORIGIN') ?: '',
    // Required only when creating a brand-new database with no administrator.
    // Keep this in the server environment, never in client-side JavaScript.
    'initial_admin_pin' => getenv('THESIS_INITIAL_ADMIN_PIN') ?: '',
    // Emergency, one-time recovery for installs that previously truncated an
    // administrator bcrypt hash. Remove this environment variable immediately
    // after the affected administrator signs in and selects a new PIN.
    'admin_recovery_pin' => getenv('THESIS_ADMIN_RECOVERY_PIN') ?: '',
];
