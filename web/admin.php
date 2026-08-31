<?php
require __DIR__ . '/lib/boot.php';
$acct = require_login();
if (!is_admin($acct)) {
    http_response_code(403);
    $pageTitle = 'Admin';
    require __DIR__ . '/templates/header.php';
    echo '<div class="card"><h2>Admins only</h2><p class="sub">You do not have access to this page.</p></div>';
    require __DIR__ . '/templates/footer.php';
    exit;
}

if (is_post()) {
    check_csrf();
    $do = post('do');
    if ($do === 'announce') {
        $body = post('body');
        if ($body !== '') {
            add_announcement($body, $acct);
            flash('Announcement posted.', 'ok');
        }
    } elseif ($do === 'grant') {
        $target = post('target');
        if (valid_account_name($target)) {
            db()->prepare('INSERT IGNORE INTO roles (account_lower, role) VALUES (?, "admin")')
                ->execute([mb_strtolower($target)]);
            flash($target . ' is now an admin.', 'ok');
        }
    } elseif ($do === 'revoke') {
        $target = post('target');
        if (strcasecmp($target, $acct) !== 0) {
            db()->prepare('DELETE FROM roles WHERE account_lower = ? AND role = "admin"')
                ->execute([mb_strtolower($target)]);
            flash($target . ' is no longer an admin.', 'ok');
        } else {
            flash('You cannot remove your own admin role.', 'error');
        }
    }
    redirect('/admin.php');
}

$admins = array_column(db()->query('SELECT account_lower FROM roles WHERE role = "admin" ORDER BY account_lower')->fetchAll(), 'account_lower');
$pageTitle = 'Admin';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Post an announcement</h2>
  <p class="sub">Shows on the homepage. (Live push into the chat is wired separately.)</p>
  <form class="stack" method="post" action="/admin.php">
    <?= csrf_field() ?>
    <input type="hidden" name="do" value="announce">
    <label>Message
      <textarea name="body" rows="3" maxlength="500" required></textarea>
    </label>
    <button type="submit">Post</button>
  </form>
</div>

<div class="card">
  <h2>Admins</h2>
  <p class="sub">Grant or remove the admin role.</p>
  <?php foreach ($admins as $a): ?>
    <div class="prof-row">
      <div style="flex:1"><?= e($a) ?></div>
      <?php if (strcasecmp($a, $acct) !== 0): ?>
        <form method="post" action="/admin.php" style="margin:0">
          <?= csrf_field() ?>
          <input type="hidden" name="do" value="revoke">
          <input type="hidden" name="target" value="<?= e($a) ?>">
          <button class="btn secondary" type="submit">Remove</button>
        </form>
      <?php else: ?><span class="muted">you</span><?php endif; ?>
    </div>
  <?php endforeach; ?>
  <form class="stack" method="post" action="/admin.php" style="margin-top:16px">
    <?= csrf_field() ?>
    <input type="hidden" name="do" value="grant">
    <label>Make someone an admin (by nickname)
      <input name="target" required>
    </label>
    <button type="submit">Grant admin</button>
  </form>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
