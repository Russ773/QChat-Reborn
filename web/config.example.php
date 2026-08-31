<?php
/**
 * Copy to config.php and fill in. config.php is gitignored.
 */
return [
    // Public site URL (no trailing slash).
    'site_url' => 'https://qchat.co.uk',
    'site_name' => 'QChat Reborn',

    // MySQL (the same database Anope uses).
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'name' => 'qchat',
        'user' => 'qchat',
        'pass' => 'CHANGE_ME',
    ],

    // The Node gateway's internal identity API (same machine, over localhost).
    // 'secret' must equal INTERNAL_API_SECRET in the gateway's .env.
    'gateway' => [
        'url' => 'http://127.0.0.1:8080',
        'secret' => 'CHANGE_ME_match_the_gateway_INTERNAL_API_SECRET',
    ],

    // Avatar uploads (a writable directory served at /avatars/).
    'avatar_dir' => __DIR__ . '/avatars',
    'avatar_url' => '/avatars',
    'avatar_max_bytes' => 1048576, // 1 MiB

    // Password-reset email (PHPMailer or PHP mail()). Set from a real address.
    'mail' => [
        'from' => 'no-reply@qchat.co.uk',
        'from_name' => 'QChat Reborn',
        // Optional SMTP relay; leave 'smtp' null to use PHP mail().
        'smtp' => null,
        // 'smtp' => ['host' => 'smtp.example.com', 'port' => 587, 'user' => '', 'pass' => '', 'secure' => 'tls'],
    ],

    'reset_ttl_minutes' => 60,
    'bcrypt_cost' => 10,
];
