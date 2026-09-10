<?php
declare(strict_types=1);

const PORTAL_STARTUP_KEY = 'portal_startup_version';
// Bump this when adding a schema or credential migration.
const PORTAL_STARTUP_VERSION = '2026-09-10-1';

function runPortalStartup(PDO $pdo, callable $migrate): void
{
    $read = $pdo->prepare('SELECT meta_value FROM system_meta WHERE meta_key=?');
    $ready = static function () use ($read): bool {
        $read->execute([PORTAL_STARTUP_KEY]);
        return json_decode((string)$read->fetchColumn(), true) === PORTAL_STARTUP_VERSION;
    };
    if ($ready()) return;

    // Serialize first requests while MySQL DDL commits implicitly.
    $lock = $pdo->prepare('SELECT GET_LOCK(?, 30)');
    $lockName = 'portal-startup-' . substr(hash('sha256', (string)$pdo->query('SELECT DATABASE()')->fetchColumn()), 0, 40);
    $lock->execute([$lockName]);
    if ((int)$lock->fetchColumn() !== 1) throw new RuntimeException('Database upgrade is still running. Please retry.');
    try {
        if ($ready()) return;
        $migrate();
        // Only a fully successful migration may skip work on future requests.
        $save = $pdo->prepare('INSERT INTO system_meta (meta_key,meta_value) VALUES (?,?) ON DUPLICATE KEY UPDATE meta_value=VALUES(meta_value)');
        $save->execute([PORTAL_STARTUP_KEY, json_encode(PORTAL_STARTUP_VERSION)]);
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}
