<?php
require __DIR__ . '/lib/boot.php';
$acct = current_account();
$anns = list_announcements(5);
require __DIR__ . '/templates/header.php';
?>
<section class="hero">
  <img src="/assets/logo.svg" width="96" height="96" alt="QChat Reborn">
  <h1>QChat <span class="reborn">Reborn</span></h1>
  <p>Media webchat, reborn.</p>
  <div class="cta">
    <a class="btn" href="/chat">Open the chat</a>
    <?php if ($acct === null): ?>
      <a class="btn secondary" href="/register.php">Create an account</a>
    <?php else: ?>
      <a class="btn secondary" href="/profile.php">Edit your profile</a>
    <?php endif; ?>
  </div>
</section>

<?php if ($anns): ?>
<div class="card">
  <h2>Announcements</h2>
  <p class="sub">Latest news from the QChat team.</p>
  <?php foreach ($anns as $a): ?>
    <div class="prof-row">
      <span><?= e(date('j M', strtotime($a['created_at']))) ?></span>
      <div><?= e($a['body']) ?> <em class="muted">&mdash; <?= e($a['by_account']) ?></em></div>
    </div>
  <?php endforeach; ?>
</div>
<?php endif; ?>

<div class="card">
  <h2>One account, everywhere</h2>
  <p class="sub">
    Sign up once and your account works on the web and on IRC. Set an avatar and
    a profile, then jump into the chat.
  </p>
  <div class="cta" style="justify-content:flex-start">
    <?php if ($acct === null): ?>
      <a class="btn" href="/register.php">Sign up</a>
      <a class="btn secondary" href="/login.php">Log in</a>
    <?php else: ?>
      <a class="btn" href="/u.php?a=<?= rawurlencode($acct) ?>">View your profile page</a>
    <?php endif; ?>
  </div>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
