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

    // Profile fields. profile_html is sanitised inside save_profile().
    save_profile($acct, [
        'display_name' => post('display_name'),
        'pronouns' => post('pronouns'),
        'status' => post('status'),
        'bio' => post('bio'),
        'links' => post('links'),
        'accent' => post('accent'),
        'profile_html' => (string) ($_POST['profile_html'] ?? ''),
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
    <label>Accent colour
      <input type="color" name="accent" value="<?= e($p['accent'] ?? '#7c8cff') ?>">
    </label>

    <div class="pe-custom">
      <div class="pe-custom-label">Custom profile page</div>
      <p class="sub">Make it yours: colours, formatting, emojis and images. Anything unsafe is stripped automatically when you save.</p>
      <div class="qc-editor-wrap" data-csrf="<?= e(csrf_token()) ?>" data-upload="/profile_image.php">
        <div class="qc-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
          <button type="button" data-cmd="underline" title="Underline"><u>U</u></button>
          <button type="button" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
          <span class="qc-sep"></span>
          <button type="button" data-cmd="formatBlock" data-value="h2" title="Heading">H2</button>
          <button type="button" data-cmd="formatBlock" data-value="h3" title="Subheading">H3</button>
          <button type="button" data-cmd="formatBlock" data-value="blockquote" title="Quote">&#10077;</button>
          <button type="button" data-cmd="insertUnorderedList" title="Bullet list">&bull;</button>
          <button type="button" data-cmd="insertOrderedList" title="Numbered list">1.</button>
          <span class="qc-sep"></span>
          <label class="qc-color" title="Text colour"><span>A</span><input type="color" data-cmd="foreColor" value="#7c8cff"></label>
          <label class="qc-color" title="Highlight"><span>&#9608;</span><input type="color" data-cmd="hiliteColor" value="#fff3a0"></label>
          <span class="qc-sep"></span>
          <button type="button" data-action="link" title="Insert link">&#128279;</button>
          <button type="button" data-action="image" title="Insert image">&#128444;&#65039;</button>
          <select data-action="emoji" title="Insert emoji" class="qc-emoji">
            <option value="">&#128512;</option>
            <?php foreach (['😀','😎','😍','😂','🥳','😇','🤔','😴','👍','🙏','🔥','✨','⭐','❤️','💜','🎵','🎮','🍕','☕','🌈'] as $em): ?>
              <option value="<?= e($em) ?>"><?= e($em) ?></option>
            <?php endforeach; ?>
          </select>
          <span class="qc-sep"></span>
          <button type="button" data-cmd="removeFormat" title="Clear formatting">Clear</button>
        </div>
        <div class="qc-editor" contenteditable="true"><?= sanitize_profile_html($p['profile_html'] ?? '') ?></div>
        <textarea name="profile_html" hidden><?= e($p['profile_html'] ?? '') ?></textarea>
        <input type="file" class="qc-image-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      </div>
    </div>

    <button type="submit">Save profile</button>
  </form>
</div>
<script src="/assets/profile-editor.js"></script>
<?php require __DIR__ . '/templates/footer.php'; ?>
