<?php
declare(strict_types=1);
require __DIR__ . '/../api/startup-migrations.php';

// Exercise the migration control flow with an isolated in-memory database.
// Adapt only MySQL lock/upsert syntax; production still uses MySQL locks.
class StartupTestDatabase extends PDO {
    public int $locks = 0;
    public int $releases = 0;
    public function __construct() {
        parent::__construct('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
        $this->exec('CREATE TABLE system_meta (meta_key TEXT PRIMARY KEY, meta_value TEXT)');
    }
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false {
        return parent::query($query === 'SELECT DATABASE()' ? "SELECT 'test'" : $query);
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        if (str_contains($query, 'GET_LOCK')) { $this->locks++; $query = 'SELECT 1 WHERE ? IS NOT NULL'; }
        if (str_contains($query, 'RELEASE_LOCK')) { $this->releases++; $query = 'SELECT 1 WHERE ? IS NOT NULL'; }
        $query = str_replace('ON DUPLICATE KEY UPDATE meta_value=VALUES(meta_value)', 'ON CONFLICT(meta_key) DO UPDATE SET meta_value=excluded.meta_value', $query);
        return parent::prepare($query, $options);
    }
}
function verifyStartup(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
$db = new StartupTestDatabase();
$runs = 0;
$migrate = function () use (&$runs): void { $runs++; };
runPortalStartup($db, $migrate);
runPortalStartup($db, $migrate);
verifyStartup($runs === 1 && $db->locks === 1, 'Warm requests must skip migration and locking');
$db->exec("UPDATE system_meta SET meta_value='\"old-version\"'");
try {
    runPortalStartup($db, function (): void { throw new RuntimeException('Simulated migration failure'); });
    throw new LogicException('Expected failure');
} catch (RuntimeException $error) {
    verifyStartup($error->getMessage() === 'Simulated migration failure', 'Unexpected error');
}
verifyStartup($db->releases === 2, 'Failed migration must release its lock');
verifyStartup(json_decode($db->query('SELECT meta_value FROM system_meta')->fetchColumn(), true) === 'old-version', 'Failed migration must not mark completion');
runPortalStartup($db, $migrate);
verifyStartup($runs === 2, 'Failed migration must be retried');
echo "PASS: first startup, fast warm path, version upgrades, failure cleanup and retry\n";
