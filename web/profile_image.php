<?php
/**
 * Uploads a single profile image and returns its same-origin URL as JSON.
 * Called by the profile editor (fetch) when the user inserts an image.
 */
require __DIR__ . '/lib/boot.php';

header('Content-Type: application/json');

$acct = current_account();
if ($acct === null) {
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in.']);
    exit;
}
if (!is_post() || !hash_equals($_SESSION['csrf'] ?? '', $_POST['csrf'] ?? '')) {
    http_response_code(400);
    echo json_encode(['error' => 'Bad request.']);
    exit;
}

[$url, $err] = save_profile_image($acct, $_FILES['image'] ?? []);
if ($url === null) {
    http_response_code(422);
    echo json_encode(['error' => $err ?? 'Upload failed.']);
    exit;
}

echo json_encode(['url' => $url]);
