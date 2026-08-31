<?php
require __DIR__ . '/lib/boot.php';

$acct = trim((string) ($_GET['a'] ?? ''));
if (!valid_account_name($acct)) {
    http_response_code(404);
    $acct = '';
}

$p = $acct !== '' ? get_profile($acct) : null;
$exists = $acct !== '' && ($p !== null || account_exists($acct));

if (!$exists) {
    $pageTitle = 'Not found';
    require __DIR__ . '/templates/header.php';
    echo '<div class="card"><h2>No such user</h2><p class="sub">That profile does not exist.</p></div>';
    require __DIR__ . '/templates/footer.php';
    exit;
}

$display = !empty($p['display_name']) ? $p['display_name'] : $acct;
$links = !empty($p['links']) ? preg_split('/\r\n|\r|\n/', $p['links']) : [];
$pageTitle = $display;
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <div class="prof-head">
    <?php if (!empty($p['avatar'])): ?>
      <img class="avatar" src="<?= e($p['avatar']) ?>" alt="">
    <?php else: ?>
      <span class="avatar" style="background:linear-gradient(135deg,#7c8cff,#b06bff)"><?= e(strtoupper(substr($acct, 0, 1))) ?></span>
    <?php endif; ?>
    <div>
      <h1 class="prof-name"><?= e($display) ?></h1>
      <div class="prof-sub">
        <?= e($acct) ?><?php if (!empty($p['pronouns'])): ?> &middot; <?= e($p['pronouns']) ?><?php endif; ?>
      </div>
    </div>
  </div>

  <?php if (!empty($p['status'])): ?>
    <div class="prof-row"><span>Status</span><div>&#128172; <?= e($p['status']) ?></div></div>
  <?php endif; ?>
  <?php if (!empty($p['bio'])): ?>
    <div class="prof-row"><span>About</span><div class="prof-bio"><?= e($p['bio']) ?></div></div>
  <?php endif; ?>
  <?php if ($links): ?>
    <div class="prof-row"><span>Links</span>
      <div><?php foreach ($links as $l): $l = trim($l); if ($l === '') continue; ?>
        <div><a href="<?= e($l) ?>" rel="noopener nofollow" target="_blank"><?= e($l) ?></a></div>
      <?php endforeach; ?></div>
    </div>
  <?php endif; ?>

  <div class="prof-row"><span></span><div><a class="btn secondary" href="/chat">Find <?= e($display) ?> in the chat</a></div></div>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
