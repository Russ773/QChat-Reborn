<?php
/**
 * TEMPORARY upload diagnostic. Reports why image uploads do or don't work.
 * Delete this file once uploads are confirmed working. No secrets are shown.
 */
require __DIR__ . '/lib/boot.php';
global $CONFIG;
header('Content-Type: text/plain; charset=utf-8');

function check_dir(string $label, ?string $dir): void
{
    echo "{$label}: " . ($dir ?? '(unset)') . "\n";
    if ($dir === null) { echo "\n"; return; }
    $exists = is_dir($dir);
    echo "  exists: " . ($exists ? 'yes' : 'NO') . "\n";
    if (!$exists) {
        echo "  mkdir attempt: " . (@mkdir($dir, 0755, true) ? 'created' : 'FAILED') . "\n";
        $exists = is_dir($dir);
    }
    echo "  writable: " . (is_dir($dir) && is_writable($dir) ? 'yes' : 'NO') . "\n";
    if (is_dir($dir)) {
        $test = $dir . '/.__wtest';
        $ok = @file_put_contents($test, 'ok');
        echo "  write test: " . ($ok !== false ? 'OK' : 'FAILED') . "\n";
        if ($ok !== false) { @unlink($test); }
        echo "  owner uid: " . @fileowner($dir) . "  (php running as uid " . getmyuid() . ")\n";
    }
    echo "\n";
}

echo "=== PHP upload settings ===\n";
echo "file_uploads:        " . ini_get('file_uploads') . "\n";
echo "upload_max_filesize: " . ini_get('upload_max_filesize') . "\n";
echo "post_max_size:       " . ini_get('post_max_size') . "\n";
echo "memory_limit:        " . ini_get('memory_limit') . "\n";
echo "upload_tmp_dir:      " . (ini_get('upload_tmp_dir') ?: '(system default)') . "\n";
echo "fileinfo loaded:     " . (extension_loaded('fileinfo') ? 'yes' : 'NO (mime detection will fail!)') . "\n";
echo "gd/imagick:          gd=" . (extension_loaded('gd') ? 'yes' : 'no') . " imagick=" . (extension_loaded('imagick') ? 'yes' : 'no') . "\n\n";

echo "=== Configured upload paths ===\n";
check_dir('avatar_dir', $CONFIG['avatar_dir'] ?? null);
check_dir('profile_media_dir', $CONFIG['profile_media_dir'] ?? null);
echo "avatar_url:        " . ($CONFIG['avatar_url'] ?? '(unset)') . "\n";
echo "profile_media_url: " . ($CONFIG['profile_media_url'] ?? '(unset)') . "\n";
echo "avatar_max_bytes:  " . ($CONFIG['avatar_max_bytes'] ?? '(unset)') . "\n";
echo "profile_image_max_bytes: " . ($CONFIG['profile_image_max_bytes'] ?? '(unset)') . "\n";
