<?php
/**
 * Allowlist sanitiser for user-authored profile HTML.
 *
 * Users customise their profile with a rich editor, and that HTML is shown to
 * everyone else, so it is a stored-XSS surface. We parse it with DOMDocument
 * and rebuild it from a strict allowlist: only known-safe tags survive, only
 * known-safe attributes on them, only known-safe inline style properties, and
 * links/images are restricted to safe schemes (images must be same-origin, i.e.
 * uploaded here, never hotlinked or data: URIs). Anything else is dropped.
 *
 * This is deliberately conservative. When in doubt, it removes.
 */

const QC_ALLOWED_TAGS = [
    'p', 'br', 'hr', 'div', 'span',
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'mark', 'small',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'a', 'img', 'font',
];

// Tags removed together with their contents (never unwrapped).
const QC_DROP_WITH_CONTENT = [
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
    'textarea', 'select', 'option', 'link', 'meta', 'base', 'title', 'noscript',
    'svg', 'math', 'template', 'audio', 'video', 'source', 'canvas', 'frame',
    'frameset', 'applet', 'marquee',
];

const QC_ALLOWED_ATTRS = [
    'a' => ['href', 'title'],
    'img' => ['src', 'alt', 'width', 'height'],
    'font' => ['color'],
    '*' => ['style'], // allowed on any surviving element
];

const QC_ALLOWED_STYLE_PROPS = [
    'color', 'background-color', 'background', 'font-weight', 'font-style',
    'font-size', 'font-family', 'text-align', 'text-decoration', 'line-height',
    'letter-spacing', 'padding', 'padding-left', 'padding-right', 'padding-top',
    'padding-bottom', 'margin', 'border', 'border-radius', 'text-shadow',
    'text-transform', 'opacity',
];

const QC_MAX_HTML_BYTES = 65536; // 64 KiB of stored markup is plenty.

/** Sanitise a profile HTML fragment. Returns safe HTML (possibly empty). */
function sanitize_profile_html(string $html): string
{
    $html = trim($html);
    if ($html === '') {
        return '';
    }
    if (strlen($html) > QC_MAX_HTML_BYTES) {
        $html = substr($html, 0, QC_MAX_HTML_BYTES);
    }

    $doc = new DOMDocument('1.0', 'UTF-8');
    libxml_use_internal_errors(true);
    // Wrap so we have a stable root, and force UTF-8 interpretation.
    $wrapped = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
        . '<div id="qc-root">' . $html . '</div></body></html>';
    $ok = $doc->loadHTML($wrapped, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    libxml_clear_errors();
    if (!$ok) {
        return '';
    }

    $xpath = new DOMXPath($doc);
    $roots = $xpath->query('//*[@id="qc-root"]');
    $root = $roots->length ? $roots->item(0) : null;
    if (!$root instanceof DOMElement) {
        return '';
    }

    qc_clean_children($root, $doc);

    // Serialise the inner HTML of the root.
    $out = '';
    foreach (iterator_to_array($root->childNodes) as $child) {
        $out .= $doc->saveHTML($child);
    }
    return trim($out);
}

/** Recursively clean the children of $parent in place. */
function qc_clean_children(DOMNode $parent, DOMDocument $doc): void
{
    // Snapshot the list first; we mutate the tree as we go.
    foreach (iterator_to_array($parent->childNodes) as $node) {
        if ($node instanceof DOMComment) {
            $parent->removeChild($node);
            continue;
        }
        if ($node instanceof DOMText) {
            continue; // text is inherently safe (serialised with escaping)
        }
        if (!$node instanceof DOMElement) {
            $parent->removeChild($node); // CDATA, PI, etc.
            continue;
        }

        $tag = strtolower($node->nodeName);

        if (in_array($tag, QC_DROP_WITH_CONTENT, true)) {
            $parent->removeChild($node);
            continue;
        }

        if (!in_array($tag, QC_ALLOWED_TAGS, true)) {
            // Unknown-but-not-dangerous tag: keep its (cleaned) contents, drop the tag.
            qc_clean_children($node, $doc);
            qc_unwrap($node);
            continue;
        }

        qc_clean_attributes($node, $tag);
        qc_clean_children($node, $doc);
    }
}

/** Move a node's children up into its place, then remove the node. */
function qc_unwrap(DOMElement $node): void
{
    $parent = $node->parentNode;
    if ($parent === null) {
        return;
    }
    while ($node->firstChild) {
        $parent->insertBefore($node->firstChild, $node);
    }
    $parent->removeChild($node);
}

/** Strip every attribute not explicitly allowed, and validate the ones kept. */
function qc_clean_attributes(DOMElement $node, string $tag): void
{
    $allowed = array_merge(QC_ALLOWED_ATTRS['*'], QC_ALLOWED_ATTRS[$tag] ?? []);

    foreach (iterator_to_array($node->attributes) as $attr) {
        $name = strtolower($attr->nodeName);
        $value = $attr->nodeValue;

        if (!in_array($name, $allowed, true)) {
            $node->removeAttribute($attr->nodeName);
            continue;
        }

        if ($name === 'style') {
            $clean = qc_clean_style($value);
            if ($clean === '') {
                $node->removeAttribute('style');
            } else {
                $node->setAttribute('style', $clean);
            }
        } elseif ($name === 'href') {
            if (!qc_safe_link($value)) {
                $node->removeAttribute('href');
            }
        } elseif ($name === 'src') {
            if (!qc_safe_image_src($value)) {
                // No safe image source: drop the whole element.
                if ($node->parentNode) {
                    $node->parentNode->removeChild($node);
                }
                return;
            }
        } elseif ($name === 'color') {
            if (qc_clean_style_value($value) === null) {
                $node->removeAttribute('color');
            }
        } elseif ($name === 'width' || $name === 'height') {
            if (!preg_match('/^\d{1,4}$/', trim((string) $value))) {
                $node->removeAttribute($name);
            }
        }
    }

    // Harden links.
    if ($tag === 'a' && $node->hasAttribute('href')) {
        $node->setAttribute('rel', 'nofollow noopener noreferrer ugc');
        $node->setAttribute('target', '_blank');
    }
}

/** True for http(s)/mailto links only. */
function qc_safe_link(?string $url): bool
{
    $url = trim((string) $url);
    if ($url === '') {
        return false;
    }
    return (bool) preg_match('#^(https?:)?//#i', $url)
        || (bool) preg_match('#^mailto:[^\s]+@[^\s]+#i', $url);
}

/**
 * Images must be same-origin absolute paths (e.g. /profile-media/... or
 * /avatars/...), which is what our uploader returns. This blocks external
 * hotlinking (tracking) and data:/javascript: URIs.
 */
function qc_safe_image_src(?string $url): bool
{
    $url = trim((string) $url);
    // Single leading slash, not protocol-relative "//".
    return (bool) preg_match('#^/[^/]#', $url);
}

/** Filter an inline style string down to allowed, safe declarations. */
function qc_clean_style(?string $style): string
{
    $out = [];
    foreach (explode(';', (string) $style) as $decl) {
        if (strpos($decl, ':') === false) {
            continue;
        }
        [$prop, $value] = explode(':', $decl, 2);
        $prop = strtolower(trim($prop));
        if (!in_array($prop, QC_ALLOWED_STYLE_PROPS, true)) {
            continue;
        }
        $clean = qc_clean_style_value($value);
        if ($clean !== null) {
            $out[] = $prop . ': ' . $clean;
        }
    }
    return implode('; ', $out);
}

/** Validate a single CSS value; return the trimmed value or null if unsafe. */
function qc_clean_style_value(?string $value): ?string
{
    $v = trim((string) $value);
    if ($v === '') {
        return null;
    }
    $low = strtolower($v);
    foreach (['url(', 'expression', 'javascript:', '@import', 'behavior', '<', '\\'] as $bad) {
        if (strpos($low, $bad) !== false) {
            return null;
        }
    }
    // Conservative character allowlist (covers hex, rgb()/hsl(), names, units).
    if (!preg_match('/^[a-z0-9#%.,\s()\-\/\'"!]+$/i', $v)) {
        return null;
    }
    return $v;
}
