<?php
/**
 * Anope (NickServ) account bridge, over the shared MySQL database.
 *
 * IMPORTANT: the exact column layout of Anope's SQL tables is version specific.
 * Login (read `pass`) and password reset (update `pass`) are low risk. The
 * register INSERT touches two tables and their relationship, so confirm it
 * against your real schema after the MySQL migration:
 *
 *     SHOW CREATE TABLE anope_db_NickCore;
 *     SHOW CREATE TABLE anope_db_NickAlias;
 *
 * and adjust anope_register() if needed.
 */

function anope_table(string $name): string
{
    global $CONFIG;
    return $CONFIG['anope']['table_prefix'] . $name;
}

/** Build the stored password value Anope's enc_bcrypt understands. */
function anope_make_pass(string $password): string
{
    global $CONFIG;
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => $CONFIG['bcrypt_cost']]);
    // PHP emits the $2y$ variant; normalize to $2b$ so Anope's bcrypt reads it.
    $hash = preg_replace('/^\$2y\$/', '\$2b\$', $hash);
    return $CONFIG['anope']['pass_prefix'] . $hash;
}

/** True if an account (by its display / nick) already exists. */
function anope_account_exists(string $account): bool
{
    $core = anope_table('NickCore');
    $stmt = db()->prepare("SELECT 1 FROM `$core` WHERE LOWER(display) = LOWER(?) LIMIT 1");
    $stmt->execute([$account]);
    return (bool) $stmt->fetchColumn();
}

/** Verify a password against NickServ. Returns the canonical account or null. */
function anope_verify(string $account, string $password): ?string
{
    global $CONFIG;
    $core = anope_table('NickCore');
    $stmt = db()->prepare("SELECT display, pass FROM `$core` WHERE LOWER(display) = LOWER(?) LIMIT 1");
    $stmt->execute([$account]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $stored = (string) $row['pass'];
    $prefix = $CONFIG['anope']['pass_prefix'];
    if (strncmp($stored, $prefix, strlen($prefix)) === 0) {
        $stored = substr($stored, strlen($prefix));
    }
    return password_verify($password, $stored) ? (string) $row['display'] : null;
}

/** Set a new password for an existing account (used by the reset flow). */
function anope_set_password(string $account, string $newPassword): bool
{
    $core = anope_table('NickCore');
    $stmt = db()->prepare("UPDATE `$core` SET pass = ? WHERE LOWER(display) = LOWER(?)");
    $stmt->execute([anope_make_pass($newPassword), $account]);
    return $stmt->rowCount() >= 0;
}

/** Look up the email on file for an account (for the reset flow). */
function anope_email(string $account): ?string
{
    $core = anope_table('NickCore');
    $stmt = db()->prepare("SELECT email FROM `$core` WHERE LOWER(display) = LOWER(?) LIMIT 1");
    $stmt->execute([$account]);
    $email = $stmt->fetchColumn();
    return $email !== false && $email !== null && $email !== '' ? (string) $email : null;
}

/**
 * Register a new NickServ account + nick in one go.
 *
 * VERIFY against your schema (see the note at the top of this file). This uses
 * the common Anope layout: insert the account into NickCore, then a matching
 * nick into NickAlias referencing the new NickCore row's id.
 */
function anope_register(string $account, string $password, string $email): void
{
    $core = anope_table('NickCore');
    $alias = anope_table('NickAlias');
    $now = time();
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO `$core` (display, pass, email) VALUES (?, ?, ?)")
            ->execute([$account, anope_make_pass($password), $email]);
        $nc = (int) $pdo->lastInsertId();
        $pdo->prepare("INSERT INTO `$alias` (nick, nc, time_registered, last_seen) VALUES (?, ?, ?, ?)")
            ->execute([$account, $nc, $now, $now]);
        $pdo->commit();
    } catch (Throwable $ex) {
        $pdo->rollBack();
        throw $ex;
    }
}
