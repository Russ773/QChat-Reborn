<?php
require __DIR__ . '/lib/boot.php';

$acct = trim((string) ($_GET['a'] ?? ''));
if (!valid_account_name($acct)) {
    qc_render_error(404);
    exit;
}

// Render a page for any valid account name; the profile may be empty if the
// user has not set one up yet. (Existence is not gated on the accounts table.)
$p = get_profile($acct) ?: [];
$prefs = profile_prefs($p);

// A field shows only if the user filled it AND hasn't hidden it in preferences.
$show = static fn(string $f): bool => profile_field_visible($prefs, $f) && !empty($p[$f]);

$display = !empty($p['display_name']) ? $p['display_name'] : $acct;
$links = $show('links') ? preg_split('/\r\n|\r|\n/', $p['links']) : [];
$accent = !empty($p['accent']) && preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $p['accent']) ? $p['accent'] : null;

$facts = [
    'age' => 'Age', 'gender' => 'Gender', 'location' => 'Location', 'timezone' => 'Timezone',
    'relationship' => 'Relationship', 'looking_for' => 'Looking for', 'occupation' => 'Occupation',
    'interests' => 'Interests',
];
$visibleFacts = array_filter($facts, static fn($lbl, $k) => $show($k), ARRAY_FILTER_USE_BOTH);

$pageTitle = $display;
require __DIR__ . '/templates/header.php';
?>
<div class="card"<?= $accent ? ' style="--accent: ' . e($accent) . '"' : '' ?>>
  <div class="prof-head prof-hero">
    <?php if (!empty($p['avatar'])): ?>
      <img class="avatar" src="<?= e($p['avatar']) ?>" alt="">
    <?php else: ?>
      <span class="avatar" style="background:linear-gradient(135deg,#7c8cff,#b06bff)"><?= e(strtoupper(substr($acct, 0, 1))) ?></span>
    <?php endif; ?>
    <div>
      <h1 class="prof-name"><?= e($display) ?></h1>
      <div class="prof-sub">
        <?= e($acct) ?><?php if ($show('pronouns')): ?> &middot; <?= e($p['pronouns']) ?><?php endif; ?>
      </div>
      <?php if ($show('status')): ?>
        <div class="prof-tagline">&#128172; <?= e($p['status']) ?></div>
      <?php endif; ?>
    </div>
  </div>

  <?php if ($visibleFacts): ?>
    <div class="prof-facts">
      <?php foreach ($visibleFacts as $k => $lbl): ?>
        <div class="fact">
          <span class="fact-label"><?= e($lbl) ?></span>
          <span class="fact-value"><?= e((string) $p[$k]) ?></span>
        </div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <?php if ($show('favourites')): ?>
    <div class="prof-row"><span>Favourites</span><div class="prof-bio"><?= e($p['favourites']) ?></div></div>
  <?php endif; ?>
  <?php if ($show('bio')): ?>
    <div class="prof-row"><span>About</span><div class="prof-bio"><?= e($p['bio']) ?></div></div>
  <?php endif; ?>
  <?php if ($links): ?>
    <div class="prof-row"><span>Links</span>
      <div><?php foreach ($links as $l): $l = trim($l); if ($l === '') continue; ?>
        <div><a href="<?= e($l) ?>" rel="noopener nofollow" target="_blank"><?= e($l) ?></a></div>
      <?php endforeach; ?></div>
    </div>
  <?php endif; ?>

  <?php if (!empty($p['profile_html'])): ?>
    <div class="profile-custom"><?= sanitize_profile_html($p['profile_html']) ?></div>
  <?php endif; ?>

  <div class="prof-row"><span></span><div><a class="btn secondary" href="/chat/">Find <?= e($display) ?> in the chat</a></div></div>
</div>
<?php require __DIR__ . '/templates/footer.php'; ?>
