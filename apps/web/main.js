/* =============================================================================
   CommitOnce — site behaviour.

   Deliberately small, dependency-free and progressive. The page is fully readable
   and complete with JavaScript disabled: the mechanism diagram defaults to the
   guarded path in the HTML, and every fact is in the markup rather than rendered
   by script. Script only adds two conveniences:

     1. switching the mechanism diagram between the guarded and unguarded path
     2. copying a program id / address / code block to the clipboard

   No analytics, no tracking, no network requests, no cookies, no storage.
   ============================================================================= */

(function () {
    'use strict';

    /* ------------------------------------------------ mechanism mode toggle */

    var diagram = document.getElementById('mechanism-diagram');
    var note = document.getElementById('modes-note');

    var NOTES = {
        guarded:
            'The guard runs first. On the retry it errors, and the error fails the whole transaction.',
        unguarded:
            'Nothing in the transaction knows the intent already committed, so the retry executes too.'
    };

    if (diagram) {
        var modes = Array.prototype.slice.call(diagram.querySelectorAll('[data-set-mode]'));

        var setMode = function (mode) {
            if (mode !== 'guarded' && mode !== 'unguarded') {
                return;
            }
            diagram.setAttribute('data-mode', mode);
            if (note && NOTES[mode]) {
                note.textContent = NOTES[mode];
            }
            modes.forEach(function (button) {
                button.setAttribute(
                    'aria-pressed',
                    button.getAttribute('data-set-mode') === mode ? 'true' : 'false'
                );
            });
        };

        modes.forEach(function (button) {
            button.addEventListener('click', function () {
                setMode(button.getAttribute('data-set-mode'));
            });
        });

        /* Left/right arrows move between the two modes, as a segmented control should. */
        diagram.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
            }
            if (modes.indexOf(document.activeElement) === -1) {
                return;
            }
            event.preventDefault();
            var current = diagram.getAttribute('data-mode');
            var next = current === 'guarded' ? 'unguarded' : 'guarded';
            setMode(next);
            modes.forEach(function (button) {
                if (button.getAttribute('data-set-mode') === next) {
                    button.focus();
                }
            });
        });
    }

    /* ------------------------------------------------------------- clipboard */

    var toast = document.getElementById('toast');
    var toastTimer = null;

    var announce = function (message) {
        if (!toast) {
            return;
        }
        toast.textContent = message;
        toast.classList.add('is-on');
        if (toastTimer !== null) {
            window.clearTimeout(toastTimer);
        }
        toastTimer = window.setTimeout(function () {
            toast.classList.remove('is-on');
        }, 2400);
    };

    var legacyCopy = function (text) {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (error) {
            ok = false;
        }
        document.body.removeChild(area);
        return ok;
    };

    var copy = function (text, button) {
        var done = function (ok) {
            if (ok) {
                button.textContent = 'Copied';
                announce('Copied to clipboard');
                window.setTimeout(function () {
                    button.textContent = 'Copy';
                }, 1600);
            } else {
                announce('Copy failed — select the text and copy it manually');
            }
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(
                function () {
                    done(true);
                },
                function () {
                    done(legacyCopy(text));
                }
            );
            return;
        }
        done(legacyCopy(text));
    };

    var copyButtons = Array.prototype.slice.call(document.querySelectorAll('[data-copy]'));

    copyButtons.forEach(function (button) {
        /* A bare "Copy" is ambiguous when read out of context, so name the target.
           Derived from the markup rather than duplicated as a second attribute, so the
           two can never disagree. Without JavaScript the visible "Copy" remains the name. */
        if (!button.hasAttribute('aria-label')) {
            var value = button.getAttribute('data-copy') || '';
            var isCode = button.parentElement && button.parentElement.classList.contains('code');
            button.setAttribute(
                'aria-label',
                isCode ? 'Copy this code block' : 'Copy ' + value
            );
        }

        button.addEventListener('click', function () {
            copy(button.getAttribute('data-copy') || '', button);
        });
    });
})();
