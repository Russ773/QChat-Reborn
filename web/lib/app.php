<?php
/** QChat app data: profiles, roles, announcements (our own tables). */

function valid_account_name(string $name): bool
{
    // IRC-style nick: letters/digits and a few symbols, 1..30 chars.
    return (bool) preg_match('/^[A-Za-z][A-Za-z0-9_\-\[\]\\\\`^{}|]{0,29}$/', $name);
}

function valid_email(string $email): bool
{
    return (bool) filter_var($email, FILTER_VALIDATE_EMAIL);
}

function get_profile(string $account): ?array
{
    $stmt = db()->prepare('SELECT * FROM profiles WHERE account_lower = ?');
    $stmt->execute([mb_strtolower($account)]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function save_profile(string $account, array $f): void
{
    $links = trim((string) ($f['links'] ?? ''));
    $sql = 'INSERT INTO profiles (account_lower, account, display_name, pronouns, status, bio, links)
            VALUES (:al, :a, :dn, :pr, :st, :bio, :lnk)
            ON DUPLICATE KEY UPDATE
              display_name = VALUES(display_name), pronouns = VALUES(pronouns),
              status = VALUES(status), bio = VALUES(bio), links = VALUES(links)';
    db()->prepare($sql)->execute([
        ':al' => mb_strtolower($account),
        ':a' => $account,
        ':dn' => mb_substr(trim((string) ($f['display_name'] ?? '')), 0, 64) ?: null,
        ':pr' => mb_substr(trim((string) ($f['pronouns'] ?? '')), 0, 32) ?: null,
        ':st' => mb_substr(trim((string) ($f['status'] ?? '')), 0, 120) ?: null,
        ':bio' => mb_substr(trim((string) ($f['bio'] ?? '')), 0, 300) ?: null,
        ':lnk' => $links !== '' ? $links : null,
    ]);
}

function set_avatar(string $account, string $urlPath): void
{
    $sql = 'INSERT INTO profiles (account_lower, account, avatar) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE avatar = VALUES(avatar)';
    db()->prepare($sql)->execute([mb_strtolower($account), $account, $urlPath]);
}

function get_roles(string $account): array
{
    $stmt = db()->prepare('SELECT role FROM roles WHERE account_lower = ?');
    $stmt->execute([mb_strtolower($account)]);
    return array_column($stmt->fetchAll(), 'role');
}

function is_admin(?string $account): bool
{
    return $account !== null && in_array('admin', get_roles($account), true);
}

function add_announcement(string $body, string $by): void
{
    db()->prepare('INSERT INTO announcements (body, by_account) VALUES (?, ?)')
        ->execute([mb_substr($body, 0, 500), $by]);
}

function list_announcements(int $limit = 20): array
{
    $stmt = db()->prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT ?');
    $stmt->bindValue(1, $limit, PDO::PARAM_INT);
    $stmt->execute();
    return $stmt->fetchAll();
}

// --- Account directory (our record of who signed up + their email) ---------

function account_create(string $account, string $email): void
{
    db()->prepare('INSERT INTO accounts (account_lower, account, email) VALUES (?, ?, ?)
                   ON DUPLICATE KEY UPDATE email = VALUES(email)')
        ->execute([mb_strtolower($account), $account, $email]);
}

function account_exists(string $account): bool
{
    $stmt = db()->prepare('SELECT 1 FROM accounts WHERE account_lower = ? LIMIT 1');
    $stmt->execute([mb_strtolower($account)]);
    return (bool) $stmt->fetchColumn();
}

function account_email(string $account): ?string
{
    $stmt = db()->prepare('SELECT email FROM accounts WHERE account_lower = ? LIMIT 1');
    $stmt->execute([mb_strtolower($account)]);
    $email = $stmt->fetchColumn();
    return $email !== false ? (string) $email : null;
}
