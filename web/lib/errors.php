<?php
/**
 * Global error handling: turn uncaught exceptions and fatal errors into a
 * friendly styled page (never a blank 500) and log the real cause for us.
 * Loaded first in boot.php so it covers everything after it.
 */

/** Render the self-contained error page for a status code and stop. */
function qc_render_error(int $code): void
{
    if (!headers_sent()) {
        http_response_code($code);
    }
    $GLOBALS['__qc_error_code'] = $code;
    $page = __DIR__ . '/../error.php';
    if (is_file($page)) {
        require $page;
    } else {
        echo "Error {$code}";
    }
}

function qc_init_error_handling(): void
{
    // Uncaught exceptions (e.g. a database error) → friendly 500 + log.
    set_exception_handler(function (Throwable $e): void {
        error_log('[qchat] Uncaught ' . get_class($e) . ': ' . $e->getMessage()
            . ' @ ' . $e->getFile() . ':' . $e->getLine());
        qc_render_error(500);
    });

    // Fatal errors (parse/compile/out-of-memory) → friendly 500 + log.
    register_shutdown_function(function (): void {
        $e = error_get_last();
        if ($e !== null && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
            error_log('[qchat] Fatal: ' . $e['message'] . ' @ ' . $e['file'] . ':' . $e['line']);
            qc_render_error(500);
        }
    });
}
