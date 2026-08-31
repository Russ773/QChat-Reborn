<?php
require __DIR__ . '/lib/boot.php';
global $CONFIG;

$done = false;
if (is_post()) {
    check_csrf();
    $account = post('account');
    // Always respond the same way to avoid revealing which accounts exist.
    $done = true;
    if (valid_account_name($account) && account_exists($account)) {
        $email = account_email($account);
        if ($email) {
            $token = bin2hex(random_bytes(32));
            $expires = date('Y-m-d H:i:s', time() + $CONFIG['reset_ttl_minutes'] * 60);
            db()->prepare('INSERT INTO password_resets (token, account_lower, email, expires_at) VALUES (?, ?, ?, ?)')
                ->execute([$token, mb_strtolower($account), $email, $expires]);
            $link = $CONFIG['site_url'] . '/reset.php?token=' . $token;
            $body = "Hi $account,\n\n"
                . "Someone asked to reset your QChat password. To set a new one, open:\n\n"
                . "$link\n\n"
                . "This link expires in {$CONFIG['reset_ttl_minutes']} minutes. "
                . "If you did not request this, you can ignore this email.\n\n"
                . "QChat Reborn";
            send_mail($email, 'Reset your QChat password', $body);
        }
    }
}

$pageTitle = 'Forgot password';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Forgot your password?</h2>
  <?php if ($done): ?>
    <div class="flash flash-ok">
      If that account exists and has an email on file, we have sent a reset link.
      Check your inbox (and spam folder).
    </div>
    <p class="form-foot"><a href="/login.php">Back to log in</a></p>
  <?php else: ?>
    <p class="sub">Enter your nickname and we will email you a reset link.</p>
    <form class="stack" method="post" action="/forgot.php">
      <?= csrf_field() ?>
      <label>Nickname
        <input name="account" autocomplete="username" required autofocus>
      </label>
      <button type="submit">Email me a reset link</button>
      <p class="form-foot"><a href="/login.php">Back to log in</a></p>
    </form>
  <?php endif; ?>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
