<?php
require __DIR__ . '/lib/boot.php';
if (current_account() !== null) {
    redirect('/profile.php');
}

$errors = [];
$account = '';
$email = '';

if (is_post()) {
    check_csrf();
    $account = post('account');
    $email = post('email');
    $pass = $_POST['password'] ?? '';
    $pass2 = $_POST['password2'] ?? '';

    if (!valid_account_name($account)) {
        $errors[] = 'Pick a nickname of 1 to 30 letters or digits, starting with a letter.';
    }
    if (!valid_email($email)) {
        $errors[] = 'Enter a valid email address (used for password resets).';
    }
    if (strlen($pass) < 6) {
        $errors[] = 'Password must be at least 6 characters.';
    }
    if ($pass !== $pass2) {
        $errors[] = 'The two passwords do not match.';
    }
    if (strcasecmp($pass, $account) === 0) {
        $errors[] = 'Password must not be the same as your nickname.';
    }
    if (!$errors && account_exists($account)) {
        $errors[] = 'That nickname is already registered. Try another, or log in.';
    }

    if (!$errors) {
        try {
            identity_register($account, $pass, $email);
            account_create($account, $email);
            save_profile($account, []); // create an empty profile row
            login_session($account);
            flash('Welcome to QChat, ' . $account . '! Your account is ready.', 'ok');
            redirect('/profile.php');
        } catch (Throwable $ex) {
            $errors[] = $ex->getMessage();
        }
    }
}

$pageTitle = 'Sign up';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Create your account</h2>
  <p class="sub">One signup gives you the website and IRC. Works in the chat straight away.</p>

  <?php foreach ($errors as $er): ?><div class="flash flash-error"><?= e($er) ?></div><?php endforeach; ?>

  <form class="stack" method="post" action="/register.php">
    <?= csrf_field() ?>
    <label>Nickname
      <input name="account" value="<?= e($account) ?>" maxlength="30" autocomplete="username" required autofocus>
    </label>
    <label>Email
      <input type="email" name="email" value="<?= e($email) ?>" autocomplete="email" required>
    </label>
    <label>Password
      <input type="password" name="password" autocomplete="new-password" required>
    </label>
    <label>Confirm password
      <input type="password" name="password2" autocomplete="new-password" required>
    </label>
    <button type="submit">Create account</button>
    <p class="form-foot">Already have an account? <a href="/login.php">Log in</a>.</p>
  </form>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
