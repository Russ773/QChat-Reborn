<?php
/** Shared page top. Set $pageTitle before including. */
global $CONFIG;
$acct = current_account();
$title = isset($pageTitle) ? ($pageTitle . ' | ' . $CONFIG['site_name']) : $CONFIG['site_name'];
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= e($title) ?></title>
  <link rel="icon" href="/assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">
    <img src="/assets/logo.svg" width="34" height="34" alt="">
    <span class="wordmark">QChat <span class="reborn">Reborn</span></span>
  </a>
  <nav class="topnav">
    <a href="/chat">Chat</a>
    <?php if ($acct !== null): ?>
      <a href="/profile.php">Profile</a>
      <a href="/preferences.php">Preferences</a>
      <?php if (is_admin($acct)): ?><a href="/admin.php">Admin</a><?php endif; ?>
      <a href="/u.php?a=<?= rawurlencode($acct) ?>"><?= e($acct) ?></a>
      <a class="btn-sm" href="/logout.php">Log out</a>
    <?php else: ?>
      <a href="/login.php">Log in</a>
      <a class="btn-sm" href="/register.php">Sign up</a>
    <?php endif; ?>
  </nav>
</header>
<main class="wrap">
<?php foreach (take_flashes() as $f): ?>
  <div class="flash flash-<?= e($f['type']) ?>"><?= e($f['msg']) ?></div>
<?php endforeach; ?>
