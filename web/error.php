<?php
/**
 * Self-contained error page. Used both by the global handler (via
 * qc_render_error) and by Apache's ErrorDocument (see .htaccess). It has no
 * dependencies on the rest of the app, so it still works when the app is broken.
 */
$code = (int) ($GLOBALS['__qc_error_code']
    ?? ($_SERVER['REDIRECT_STATUS'] ?? ($_GET['code'] ?? 500)));

$pages = [
    400 => ['Bad request', 'That request could not be understood.'],
    403 => ['Forbidden', 'You do not have access to this page.'],
    404 => ['Page not found', 'The page you were looking for does not exist.'],
    500 => ['Something went wrong', 'An unexpected error occurred on our side. Please try again in a moment.'],
];
[$title, $message] = $pages[$code] ?? ['Error', 'Something went wrong.'];

if (!headers_sent()) {
    http_response_code($code);
}
?><!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= $code ?> · QChat Reborn</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0a0d13; color: #e7eaf0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .box { text-align: center; padding: 40px 28px; max-width: 460px; }
    .code {
      font-size: 4.5rem; font-weight: 800; line-height: 1; margin: 0;
      background: linear-gradient(135deg, #7c8cff, #b06bff);
      -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    h1 { font-size: 1.5rem; margin: 14px 0 6px; }
    p { color: #9aa4b4; margin: 0 0 24px; line-height: 1.5; }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    a {
      text-decoration: none; padding: 10px 18px; border-radius: 10px; font-weight: 600;
      color: #0b0f16; background: linear-gradient(135deg, #7c8cff, #b06bff);
    }
    a.secondary { color: #e7eaf0; background: #1b2230; border: 1px solid #232c3b; }
  </style>
</head>
<body>
  <div class="box">
    <p class="code"><?= $code ?></p>
    <h1><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></h1>
    <p><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></p>
    <div class="actions">
      <a href="/">Back home</a>
      <a class="secondary" href="/chat/">Open the chat</a>
    </div>
  </div>
</body>
</html>
