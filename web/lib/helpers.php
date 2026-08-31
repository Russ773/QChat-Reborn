<?php
/** Small view + request helpers. */

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

function redirect(string $path): void
{
    header('Location: ' . $path);
    exit;
}

function post(string $key, string $default = ''): string
{
    return isset($_POST[$key]) ? trim((string) $_POST[$key]) : $default;
}

function is_post(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
}

/** CSRF: put csrf_field() in every form; check_csrf() at the top of POST handlers. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

function check_csrf(): void
{
    if (!hash_equals($_SESSION['csrf'] ?? '', $_POST['csrf'] ?? '')) {
        http_response_code(400);
        exit('Bad request (invalid CSRF token). Go back and try again.');
    }
}

/** One-shot flash messages across a redirect. */
function flash(string $msg, string $type = 'info'): void
{
    $_SESSION['flash'][] = ['msg' => $msg, 'type' => $type];
}

function take_flashes(): array
{
    $f = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $f;
}

// --- Session identity ------------------------------------------------------

function current_account(): ?string
{
    return $_SESSION['account'] ?? null;
}

function login_session(string $account): void
{
    session_regenerate_id(true);
    $_SESSION['account'] = $account;
}

function require_login(): string
{
    $a = current_account();
    if ($a === null) {
        redirect('/login.php?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/'));
    }
    return $a;
}
