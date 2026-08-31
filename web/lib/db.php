<?php
/**
 * Shared bootstrap: loads config, opens the PDO connection, starts the session.
 * Every page does:  require __DIR__ . '/lib/db.php';
 */

$configFile = __DIR__ . '/../config.php';
if (!file_exists($configFile)) {
    http_response_code(500);
    exit('Missing config.php (copy config.example.php to config.php and fill it in).');
}
$CONFIG = require $configFile;

function db(): PDO
{
    static $pdo = null;
    global $CONFIG;
    if ($pdo === null) {
        $c = $CONFIG['db'];
        $dsn = "mysql:host={$c['host']};port={$c['port']};dbname={$c['name']};charset=utf8mb4";
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    return $pdo;
}

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
    ]);
    session_start();
}
