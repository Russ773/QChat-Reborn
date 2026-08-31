<?php
require __DIR__ . '/lib/boot.php';
$acct = require_login();

if (is_post()) {
    check_csrf();
    $visible = [];
    foreach (array_keys(profile_visibility_fields()) as $key) {
        $visible[$key] = isset($_POST['show'][$key]);
    }
    save_prefs($acct, $visible, isset($_POST['allow_pm']));
    flash('Preferences saved.', 'ok');
    redirect('/preferences.php');
}

$p = get_profile($acct) ?: [];
$prefs = profile_prefs($p);
$pageTitle = 'Preferences';
require __DIR__ . '/templates/header.php';
?>
<div class="card">
  <h2>Preferences</h2>
  <p class="sub">Choose what other people can see on your
    <a href="/u.php?a=<?= rawurlencode($acct) ?>">public profile</a>.</p>

  <form class="stack" method="post" action="/preferences.php">
    <?= csrf_field() ?>

    <fieldset class="pref-group">
      <legend>Show on my profile</legend>
      <div class="pref-toggles">
        <?php foreach (profile_visibility_fields() as $key => $label): ?>
          <label class="toggle">
            <input type="checkbox" name="show[<?= e($key) ?>]" value="1"<?= profile_field_visible($prefs, $key) ? ' checked' : '' ?>>
            <span><?= e($label) ?></span>
          </label>
        <?php endforeach; ?>
      </div>
      <p class="sub">Unchecked fields stay private, even if you've filled them in. Your name and avatar are always shown.</p>
    </fieldset>

    <fieldset class="pref-group">
      <legend>Privacy</legend>
      <label class="toggle">
        <input type="checkbox" name="allow_pm" value="1"<?= $prefs['allow_pm'] ? ' checked' : '' ?>>
        <span>Allow private messages</span>
      </label>
      <p class="sub">Private messaging is coming soon &mdash; this controls whether people can PM you once it's live.</p>
    </fieldset>

    <button type="submit">Save preferences</button>
  </form>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
