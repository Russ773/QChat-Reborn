<?php
require __DIR__ . '/lib/boot.php';

$token = $_GET['token'] ?? ($_POST['token'] ?? '');
$errors = [];

function reset_lookup(string $token): ?array
{
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
        return null;
    }
    $stmt = db()->prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1');
    $stmt->execute([$token]);
    return $stmt->fetch() ?: null;
}

$row = reset_lookup($token);

if (is_post() && $row) {
    check_csrf();
    $pass = $_POST['password'] ?? '';
    $pass2 = $_POST['password2'] ?? '';
    if (strlen($pass) < 6) {
        $errors[] = 'Password must be at least 6 characters.';
    }
    if ($pass !== $pass2) {
        $errors[] = 'The two passwords do not match.';
    }
    if (!$errors) {
        try {
            identity_set_password($row['account_lower'], $pass);
            db()->prepare('UPDATE password_resets SET used = 1 WHERE token = ?')->execute([$token]);
            flash('Your password has been reset. You can log in now.', 'ok');
            redirect('/login.php');
        } catch (Throwable $ex) {
            $errors[] = $ex->getMessage();
        }
    }
}

$pageTitle = 'Reset password';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Choose a new password</h2>
  <?php if (!$row): ?>
    <div class="flash flash-error">
      This reset link is invalid or has expired. <a href="/forgot.php">Request a new one</a>.
    </div>
  <?php else: ?>
    <p class="sub">Setting a new password for <strong><?= e($row['account_lower']) ?></strong>.</p>
    <?php foreach ($errors as $er): ?><div class="flash flash-error"><?= e($er) ?></div><?php endforeach; ?>
    <form class="stack" method="post" action="/reset.php">
      <?= csrf_field() ?>
      <input type="hidden" name="token" value="<?= e($token) ?>">
      <label>New password
        <input type="password" name="password" autocomplete="new-password" required autofocus>
      </label>
      <label>Confirm new password
        <input type="password" name="password2" autocomplete="new-password" required>
      </label>
      <button type="submit">Reset password</button>
    </form>
  <?php endif; ?>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
