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

/**
 * The optional "detail" fields shown on a profile, with the metadata used to
 * render their edit inputs. Keeping them in one place keeps the edit page, the
 * public page and the preferences page in sync.
 */
function profile_detail_fields(): array
{
    return [
        'age'          => ['label' => 'Age', 'type' => 'number', 'min' => 13, 'max' => 120],
        'gender'       => ['label' => 'Gender', 'type' => 'text', 'maxlen' => 32],
        'location'     => ['label' => 'Location', 'type' => 'text', 'maxlen' => 80, 'ph' => 'City, Country'],
        'timezone'     => ['label' => 'Timezone', 'type' => 'text', 'maxlen' => 48, 'ph' => 'e.g. GMT, PST'],
        'relationship' => ['label' => 'Relationship', 'type' => 'select',
                           'options' => ['Single', 'In a relationship', 'Married', "It's complicated", 'Prefer not to say']],
        'looking_for'  => ['label' => 'Looking for', 'type' => 'text', 'maxlen' => 120, 'ph' => 'e.g. friends & good chat'],
        'occupation'   => ['label' => 'Occupation', 'type' => 'text', 'maxlen' => 80],
        'interests'    => ['label' => 'Interests', 'type' => 'text', 'maxlen' => 255, 'ph' => 'music, gaming, coding…'],
        'favourites'   => ['label' => 'Favourites', 'type' => 'textarea', 'maxlen' => 255, 'ph' => 'Favourite music, films, games…'],
    ];
}

/** Everything a user can choose to show/hide on their public profile. */
function profile_visibility_fields(): array
{
    return [
        'pronouns' => 'Pronouns', 'age' => 'Age', 'gender' => 'Gender',
        'location' => 'Location', 'timezone' => 'Timezone', 'relationship' => 'Relationship',
        'looking_for' => 'Looking for', 'occupation' => 'Occupation', 'status' => 'Status',
        'interests' => 'Interests', 'favourites' => 'Favourites', 'bio' => 'About', 'links' => 'Links',
    ];
}

function save_profile(string $account, array $f): void
{
    $nz = static fn(string $s): ?string => $s !== '' ? $s : null;
    $vals = [
        'display_name' => $nz(mb_substr(trim((string) ($f['display_name'] ?? '')), 0, 64)),
        'pronouns'     => $nz(mb_substr(trim((string) ($f['pronouns'] ?? '')), 0, 32)),
        'status'       => $nz(mb_substr(trim((string) ($f['status'] ?? '')), 0, 120)),
        'bio'          => $nz(mb_substr(trim((string) ($f['bio'] ?? '')), 0, 600)),
        'links'        => $nz(trim((string) ($f['links'] ?? ''))),
        'accent'       => qc_valid_accent($f['accent'] ?? null),
        'age'          => qc_valid_age($f['age'] ?? null),
        'gender'       => $nz(mb_substr(trim((string) ($f['gender'] ?? '')), 0, 32)),
        'location'     => $nz(mb_substr(trim((string) ($f['location'] ?? '')), 0, 80)),
        'timezone'     => $nz(mb_substr(trim((string) ($f['timezone'] ?? '')), 0, 48)),
        'relationship' => qc_valid_relationship($f['relationship'] ?? null),
        'looking_for'  => $nz(mb_substr(trim((string) ($f['looking_for'] ?? '')), 0, 120)),
        'occupation'   => $nz(mb_substr(trim((string) ($f['occupation'] ?? '')), 0, 80)),
        'interests'    => $nz(mb_substr(trim((string) ($f['interests'] ?? '')), 0, 255)),
        'favourites'   => $nz(mb_substr(trim((string) ($f['favourites'] ?? '')), 0, 255)),
        // profile_html is always sanitised so it can never be stored raw.
        'profile_html' => $nz(sanitize_profile_html((string) ($f['profile_html'] ?? ''))),
    ];

    $cols = array_keys($vals);
    $colList = 'account_lower, account, ' . implode(', ', $cols);
    $ph = ':al, :a, ' . implode(', ', array_map(static fn($c) => ":$c", $cols));
    $upd = implode(', ', array_map(static fn($c) => "$c = VALUES($c)", $cols));
    $params = [':al' => mb_strtolower($account), ':a' => $account];
    foreach ($vals as $c => $v) {
        $params[":$c"] = $v;
    }
    db()->prepare("INSERT INTO profiles ($colList) VALUES ($ph) ON DUPLICATE KEY UPDATE $upd")
        ->execute($params);
}

/** Validate an accent colour: a #rgb / #rrggbb hex string, else null. */
function qc_valid_accent($value): ?string
{
    $v = trim((string) $value);
    return preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $v) ? $v : null;
}

/** Validate age: an integer 13..120, else null. */
function qc_valid_age($value): ?int
{
    $v = trim((string) $value);
    if ($v === '' || !ctype_digit($v)) {
        return null;
    }
    $n = (int) $v;
    return ($n >= 13 && $n <= 120) ? $n : null;
}

/** Validate relationship against the allowed options, else null. */
function qc_valid_relationship($value): ?string
{
    $v = trim((string) $value);
    $allowed = profile_detail_fields()['relationship']['options'];
    return in_array($v, $allowed, true) ? $v : null;
}

// --- Profile display preferences (per-field visibility + PM toggle) ---------

/** Decode a profile's prefs into ['visible' => [...], 'allow_pm' => bool]. */
function profile_prefs(array $p): array
{
    $data = isset($p['prefs']) ? json_decode((string) $p['prefs'], true) : null;
    if (!is_array($data)) {
        $data = [];
    }
    return [
        'visible' => is_array($data['visible'] ?? null) ? $data['visible'] : [],
        'allow_pm' => (bool) ($data['allow_pm'] ?? true),
    ];
}

/** A field shows by default; it is hidden only if explicitly set to false. */
function profile_field_visible(array $prefs, string $field): bool
{
    return ($prefs['visible'][$field] ?? true) !== false;
}

function save_prefs(string $account, array $visible, bool $allowPm): void
{
    $json = json_encode(['visible' => $visible, 'allow_pm' => $allowPm]);
    db()->prepare('INSERT INTO profiles (account_lower, account, prefs) VALUES (?, ?, ?)
                   ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)')
        ->execute([mb_strtolower($account), $account, $json]);
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
