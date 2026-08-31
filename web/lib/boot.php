<?php
/** One include to load the whole app. Pages do: require __DIR__ . '/lib/boot.php'; */
require __DIR__ . '/db.php';
require __DIR__ . '/helpers.php';
require __DIR__ . '/sanitize.php';
require __DIR__ . '/app.php';
require __DIR__ . '/identity.php';
require __DIR__ . '/mailer.php';
