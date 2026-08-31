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

    // How Anope stores account data in that database.
    //  - table_prefix: Anope's db_sql "prefix" setting (default "anope_db_").
    //  - pass_prefix:  Anope stores passwords as "<encmodule>:<hash>". With
    //    enc_bcrypt that is "bcrypt:". Confirm from an existing row:
    //      SELECT display, LEFT(pass, 8) FROM anope_db_NickCore LIMIT 1;
    'anope' => [
        'table_prefix' => 'anope_db_',
        'pass_prefix' => 'bcrypt:',
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
