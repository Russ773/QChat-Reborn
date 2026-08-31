/*
 * Lightweight profile editor: a contenteditable surface with a formatting
 * toolbar. No external libraries. Output HTML is sanitised server-side on save,
 * so this only needs to be convenient, not trusted.
 */
(function () {
  'use strict';

  function initEditor(wrap) {
    var editor = wrap.querySelector('.qc-editor');
    var mirror = wrap.querySelector('textarea[name="profile_html"]');
    var fileInput = wrap.querySelector('.qc-image-input');
    var form = wrap.closest('form');
    var csrf = wrap.getAttribute('data-csrf') || '';
    var uploadUrl = wrap.getAttribute('data-upload') || '/profile_image.php';
    if (!editor || !mirror) return;

    function exec(cmd, value) {
      editor.focus();
      try {
        document.execCommand(cmd, false, value);
      } catch (e) {
        /* ignore unsupported command */
      }
      sync();
    }

    function sync() {
      mirror.value = editor.innerHTML;
    }

    // Simple command buttons (bold, italic, lists, headings, etc.).
    wrap.querySelectorAll('[data-cmd]').forEach(function (el) {
      if (el.tagName === 'INPUT') {
        el.addEventListener('input', function () {
          exec(el.getAttribute('data-cmd'), el.value);
        });
      } else {
        el.addEventListener('click', function (e) {
          e.preventDefault();
          exec(el.getAttribute('data-cmd'), el.getAttribute('data-value') || undefined);
        });
      }
    });

    // Insert a link.
    var linkBtn = wrap.querySelector('[data-action="link"]');
    if (linkBtn) {
      linkBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var url = window.prompt('Link URL (https://…):', 'https://');
        if (url) exec('createLink', url);
      });
    }

    // Emoji picker (a small <select>).
    var emoji = wrap.querySelector('[data-action="emoji"]');
    if (emoji) {
      emoji.addEventListener('change', function () {
        if (emoji.value) {
          exec('insertText', emoji.value);
          emoji.selectedIndex = 0;
        }
      });
    }

    // Image upload → insert as an <img> pointing at our stored copy.
    var imageBtn = wrap.querySelector('[data-action="image"]');
    if (imageBtn && fileInput) {
      imageBtn.addEventListener('click', function (e) {
        e.preventDefault();
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var data = new FormData();
        data.append('image', file);
        data.append('csrf', csrf);
        imageBtn.disabled = true;
        imageBtn.textContent = '⏳';
        fetch(uploadUrl, { method: 'POST', body: data, credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.url) {
              exec('insertHTML', '<img src="' + res.url + '" alt="" style="max-width: 100%;">');
            } else {
              window.alert((res && res.error) || 'Upload failed.');
            }
          })
          .catch(function () { window.alert('Upload failed.'); })
          .finally(function () {
            imageBtn.disabled = false;
            imageBtn.textContent = '🖼️';
            fileInput.value = '';
          });
      });
    }

    editor.addEventListener('input', sync);
    if (form) form.addEventListener('submit', sync);
    sync();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.qc-editor-wrap').forEach(initEditor);
  });
})();
