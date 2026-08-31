<?php
/**
 * Minimal mail sender. Uses PHP mail() by default (Virtualmin boxes have a
 * working MTA). If you configure config['mail']['smtp'], swap this for
 * PHPMailer, the interface stays the same.
 */
function send_mail(string $to, string $subject, string $body): bool
{
    global $CONFIG;
    $from = $CONFIG['mail']['from'];
    $fromName = $CONFIG['mail']['from_name'];
    $headers = [
        'From: ' . $fromName . ' <' . $from . '>',
        'Reply-To: ' . $from,
        'Content-Type: text/plain; charset=UTF-8',
        'MIME-Version: 1.0',
        'X-Mailer: QChat',
    ];
    return mail($to, $subject, $body, implode("\r\n", $headers), '-f' . $from);
}
