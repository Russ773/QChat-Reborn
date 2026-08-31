<?php
/**
 * Identity operations, delegated to the Node gateway's internal API (which
 * talks to NickServ). The website never touches Anope's database directly.
 */

function gateway_call(string $path, array $payload): array
{
    global $CONFIG;
    $g = $CONFIG['gateway'];
    $ch = curl_init($g['url'] . $path);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-Internal-Secret: ' . $g['secret'],
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        return ['ok' => false, 'error' => 'The chat service is unreachable. Please try again.', '_status' => 0];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        $data = ['ok' => false, 'error' => 'Unexpected response from the chat service.'];
    }
    $data['_status'] = $status;
    return $data;
}

/** Create the NickServ account. Throws with a friendly message on failure. */
function identity_register(string $nick, string $password, string $email): void
{
    $r = gateway_call('/internal/identity/register', ['nick' => $nick, 'password' => $password, 'email' => $email]);
    if (empty($r['ok'])) {
        throw new RuntimeException($r['error'] ?? 'Registration failed.');
    }
}

/** Return the canonical account name if the password is correct, else null. */
function identity_verify(string $nick, string $password): ?string
{
    $r = gateway_call('/internal/identity/verify', ['nick' => $nick, 'password' => $password]);
    return !empty($r['ok']) && !empty($r['account']) ? (string) $r['account'] : null;
}

/** Set a new password for an account (reset flow). Throws on failure. */
function identity_set_password(string $nick, string $newPassword): void
{
    $r = gateway_call('/internal/identity/reset', ['nick' => $nick, 'password' => $newPassword]);
    if (empty($r['ok'])) {
        throw new RuntimeException($r['error'] ?? 'Could not set the new password.');
    }
}
