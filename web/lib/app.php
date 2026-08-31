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
    // Always sanitise custom HTML here so it can never be stored raw, whatever
    // the caller passed. An empty/whitespace result clears the custom section.
    $html = sanitize_profile_html((string) ($f['profile_html'] ?? ''));
    $accent = qc_valid_accent($f['accent'] ?? null);

    $sql = 'INSERT INTO profiles
              (account_lower, account, display_name, pronouns, status, bio, links, accent, profile_html)
            VALUES (:al, :a, :dn, :pr, :st, :bio, :lnk, :acc, :html)
            ON DUPLICATE KEY UPDATE
              display_name = VALUES(display_name), pronouns = VALUES(pronouns),
              status = VALUES(status), bio = VALUES(bio), links = VALUES(links),
              accent = VALUES(accent), profile_html = VALUES(profile_html)';
    db()->prepare($sql)->execute([
        ':al' => mb_strtolower($account),
        ':a' => $account,
        ':dn' => mb_substr(trim((string) ($f['display_name'] ?? '')), 0, 64) ?: null,
        ':pr' => mb_substr(trim((string) ($f['pronouns'] ?? '')), 0, 32) ?: null,
        ':st' => mb_substr(trim((string) ($f['status'] ?? '')), 0, 120) ?: null,
        ':bio' => mb_substr(trim((string) ($f['bio'] ?? '')), 0, 300) ?: null,
        ':lnk' => $links !== '' ? $links : null,
        ':acc' => $accent,
        ':html' => $html !== '' ? $html : null,
    ]);
}

/** Validate an accent colour: a #rgb / #rrggbb hex string, else null. */
function qc_valid_accent($value): ?string
{
    $v = trim((string) $value);
    return preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $v) ? $v : null;
}

/**
 * Store an uploaded profile image and return its same-origin URL path.
 * Returns [url] on success or [null, error] on failure.
 */
function save_profile_image(string $account, array $file): array
{
    global $CONFIG;
    $allowed = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];

    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) {
        return [null, 'No file uploaded.'];
    }
    if ($file['size'] > ($CONFIG['profile_image_max_bytes'] ?? 3145728)) {
        return [null, 'Image is too large.'];
    }
    $mime = mime_content_type($file['tmp_name']);
    if (!isset($allowed[$mime])) {
        return [null, 'Image must be PNG, JPG, WebP or GIF.'];
    }

    $safeAcct = preg_replace('/[^a-z0-9_-]/', '_', mb_strtolower($account));
    $dir = rtrim($CONFIG['profile_media_dir'], '/') . '/' . $safeAcct;
    @mkdir($dir, 0755, true);
    $name = bin2hex(random_bytes(8)) . '.' . $allowed[$mime];
    if (!move_uploaded_file($file['tmp_name'], $dir . '/' . $name)) {
        return [null, 'Could not save the image.'];
    }
    return [rtrim($CONFIG['profile_media_url'], '/') . '/' . $safeAcct . '/' . $name, null];
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
