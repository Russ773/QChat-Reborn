<?php
require __DIR__ . '/lib/boot.php';
global $CONFIG;
$acct = require_login();

$allowed = ['image/png' => '.png', 'image/jpeg' => '.jpg', 'image/webp' => '.webp', 'image/gif' => '.gif'];
$errors = [];

if (is_post()) {
    check_csrf();

    // Avatar upload (optional).
    if (!empty($_FILES['avatar']['tmp_name']) && is_uploaded_file($_FILES['avatar']['tmp_name'])) {
        $f = $_FILES['avatar'];
        if ($f['size'] > $CONFIG['avatar_max_bytes']) {
            $errors[] = 'Avatar is too large (max 1 MB).';
        } else {
            $mime = mime_content_type($f['tmp_name']);
            if (!isset($allowed[$mime])) {
                $errors[] = 'Avatar must be a PNG, JPG, WebP or GIF image.';
            } else {
                $safe = preg_replace('/[^a-z0-9_-]/', '_', mb_strtolower($acct));
                @mkdir($CONFIG['avatar_dir'], 0755, true);
                $file = $CONFIG['avatar_dir'] . '/' . $safe . $allowed[$mime];
                if (move_uploaded_file($f['tmp_name'], $file)) {
                    set_avatar($acct, $CONFIG['avatar_url'] . '/' . $safe . $allowed[$mime] . '?v=' . time());
                } else {
                    $errors[] = 'Could not save the avatar.';
                }
            }
        }
    }

    // Profile fields.
    save_profile($acct, [
        'display_name' => post('display_name'),
        'pronouns' => post('pronouns'),
        'status' => post('status'),
        'bio' => post('bio'),
        'links' => post('links'),
    ]);

    if (!$errors) {
        flash('Profile saved.', 'ok');
        redirect('/profile.php');
    }
}

$p = get_profile($acct) ?? [];
$pageTitle = 'Your profile';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Your profile</h2>
  <p class="sub">This is what other people see. <a href="/u.php?a=<?= rawurlencode($acct) ?>">View your public page</a>.</p>

  <?php foreach ($errors as $er): ?><div class="flash flash-error"><?= e($er) ?></div><?php endforeach; ?>

  <form class="stack" method="post" action="/profile.php" enctype="multipart/form-data">
    <?= csrf_field() ?>
    <div class="prof-head">
      <?php if (!empty($p['avatar'])): ?>
        <img class="avatar" src="<?= e($p['avatar']) ?>" alt="">
      <?php else: ?>
        <span class="avatar" style="background:linear-gradient(135deg,#7c8cff,#b06bff)"><?= e(strtoupper(substr($acct, 0, 1))) ?></span>
      <?php endif; ?>
      <label style="flex:1">Avatar (PNG/JPG/WebP/GIF, up to 1 MB)
        <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif">
      </label>
    </div>
    <label>Display name
      <input name="display_name" value="<?= e($p['display_name'] ?? '') ?>" maxlength="64">
    </label>
    <label>Pronouns
      <input name="pronouns" value="<?= e($p['pronouns'] ?? '') ?>" maxlength="32" placeholder="e.g. they/them">
    </label>
    <label>Status
      <input name="status" value="<?= e($p['status'] ?? '') ?>" maxlength="120" placeholder="e.g. watching movies">
    </label>
    <label>Bio
      <textarea name="bio" rows="3" maxlength="300"><?= e($p['bio'] ?? '') ?></textarea>
    </label>
    <label>Links (one per line)
      <textarea name="links" rows="3" placeholder="https://..."><?= e($p['links'] ?? '') ?></textarea>
    </label>
    <button type="submit">Save profile</button>
  </form>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
