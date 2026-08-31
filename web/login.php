<?php
require __DIR__ . '/lib/boot.php';

$next = $_GET['next'] ?? ($_POST['next'] ?? '/profile.php');
if (!is_string($next) || $next === '' || $next[0] !== '/') {
    $next = '/profile.php';
}
if (current_account() !== null) {
    redirect($next);
}

$errors = [];
$account = '';

if (is_post()) {
    check_csrf();
    $account = post('account');
    $pass = $_POST['password'] ?? '';
    $canonical = $account !== '' && $pass !== '' ? anope_verify($account, $pass) : null;
    if ($canonical !== null) {
        login_session($canonical);
        redirect($next);
    }
    $errors[] = 'Wrong nickname or password.';
}

$pageTitle = 'Log in';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Log in</h2>
  <p class="sub">Use your QChat nickname and password.</p>

  <?php foreach ($errors as $er): ?><div class="flash flash-error"><?= e($er) ?></div><?php endforeach; ?>

  <form class="stack" method="post" action="/login.php">
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <label>Nickname
      <input name="account" value="<?= e($account) ?>" autocomplete="username" required autofocus>
    </label>
    <label>Password
      <input type="password" name="password" autocomplete="current-password" required>
    </label>
    <button type="submit">Log in</button>
    <p class="form-foot">
      <a href="/forgot.php">Forgot your password?</a>
      &nbsp;&middot;&nbsp;
      New here? <a href="/register.php">Create an account</a>.
    </p>
  </form>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
