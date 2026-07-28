// IntegrAuth Academy — shared "who am I" + auth-overlay layer (js/academy-auth.js)
//
// Loaded on every page (alongside functions.min.js) so the navbar's Sign-in control
// works site-wide. True SSO: the session cookie (__Secure-ia_session, Domain=.integrauth.com)
// is minted by the sister Cloudflare Worker at https://lab.integrauth.com — every call that
// reads/changes the SESSION itself (account, signup start/verify, revoke-all, erase) is a
// CROSS-ORIGIN credentialed fetch to that origin. Calls that only touch THIS site's own
// Academy data (profile, progress, exam attempts, certificates) are same-origin fetches to
// this site's own Cloudflare Worker at /api/academy/*.
//
// Plain jQuery-era JS to match functions.js/academy-labs.js — no ES modules, no build step.
// Exposes window.AcademyAuth. Self-initializes: wires the navbar control + (on academy.html
// only) the account panel + benefits info icon, once the DOM is ready.
(function () {
  'use strict';

  var LAB_ORIGIN = 'https://lab.integrauth.com';
  var SESSION_KEY = 'acad_auth_session_v1';
  var NUDGE_DISMISS_KEY = 'acad_nudge_dismissed';

  var memSession = null; // last-known session, {loggedIn:true,...} or {loggedIn:false}
  var sessionPromise = null; // in-flight refreshSession() promise, so concurrent callers share it

  /* ---------------------------------------------------------------------
   * Session cache (in-memory + sessionStorage — per-tab, not per-browser)
   * --------------------------------------------------------------------- */

  function loadCachedSession() {
    if (memSession) return memSession;
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) memSession = JSON.parse(raw);
    } catch (e) { /* noop */ }
    return memSession;
  }

  function saveCachedSession(session) {
    memSession = session;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* noop */ }
  }

  function fireChanged(session) {
    try {
      document.dispatchEvent(new CustomEvent('academy-auth-changed', { detail: { session: session } }));
    } catch (e) { /* very old browsers without CustomEvent ctor — not a supported target */ }
  }

  function normalizeAccount(data) {
    return {
      loggedIn: true,
      id: data.id || null,
      email: data.email || null,
      emailVerified: !!data.email_verified,
      isAdmin: !!data.is_admin,
      credentials: data.credentials || [],
      sessions: data.sessions || [],
      totpEnrolled: !!data.totp_enrolled
    };
  }

  function refreshSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = fetch(LAB_ORIGIN + '/api/account', { credentials: 'include', mode: 'cors' })
      .then(function (res) {
        if (res.status === 401) {
          var out = { loggedIn: false };
          saveCachedSession(out);
          fireChanged(out);
          return out;
        }
        if (!res.ok) throw new Error('http_' + res.status);
        return res.json().then(function (data) {
          var out = normalizeAccount(data);
          saveCachedSession(out);
          fireChanged(out);
          return out;
        });
      })
      .catch(function () {
        // Network hiccup / lab.integrauth.com unreachable — keep whatever we had cached
        // rather than flipping a genuinely-logged-in learner to "signed out".
        return loadCachedSession() || { loggedIn: false };
      })
      .then(function (out) {
        sessionPromise = null;
        return out;
      });
    return sessionPromise;
  }

  function getSession() {
    return loadCachedSession() || { loggedIn: false };
  }

  function checkOnFocus() {
    if (document.visibilityState === 'visible') refreshSession();
  }
  document.addEventListener('visibilitychange', checkOnFocus);

  /* ---------------------------------------------------------------------
   * Same-origin fetch helper for THIS site's own Worker (/api/academy/*)
   * --------------------------------------------------------------------- */

  function apiFetch(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch('/api/academy' + path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { /* noop */ }
        if (!res.ok) {
          var err = new Error((data && data.error) || ('http_' + res.status));
          err.code = (data && data.error) || null;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------------------------------------------------------------------
   * Cross-origin Lab calls (account lifecycle)
   * --------------------------------------------------------------------- */

  function labFetch(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'include',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(LAB_ORIGIN + path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { /* noop */ }
        if (!res.ok) {
          var err = new Error((data && data.error) || ('http_' + res.status));
          err.code = (data && data.error) || null;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function signOutEverywhere() {
    // The Lab's /api/account/revoke-all revokes every OTHER live session but
    // deliberately keeps the session driving the request alive (it's the "panic button"
    // endpoint, designed to be self-service-safe) — use signOut() below to also end THIS
    // browser's own session.
    return labFetch('/api/account/revoke-all', { method: 'POST' }).then(function (out) {
      refreshSession();
      return out;
    });
  }

  function signOut() {
    // Ends just the current session (this browser/device only) — /api/logout, distinct
    // from the panic-button revoke-all above.
    return labFetch('/api/logout', { method: 'POST' }).then(function (out) {
      var loggedOut = { loggedIn: false };
      saveCachedSession(loggedOut);
      fireChanged(loggedOut);
      return out;
    });
  }

  function revokeSession(sessionId) {
    return labFetch('/api/session/revoke', { method: 'POST', body: { session_id: sessionId } })
      .then(function (out) {
        refreshSession();
        return out;
      });
  }

  function deleteAccount() {
    // No internal confirmation here by design — the caller (the account panel below)
    // is responsible for a strong, explicit confirm step before ever calling this.
    return labFetch('/api/account/erase', { method: 'POST' }).then(function (out) {
      var loggedOut = { loggedIn: false };
      saveCachedSession(loggedOut);
      fireChanged(loggedOut);
      return out;
    });
  }

  function syncProgress(localSnapshot) {
    return apiFetch('/progress/sync', { method: 'POST', body: localSnapshot || {} });
  }

  function getProfile() {
    return apiFetch('/profile');
  }

  function saveProfile(profile) {
    return apiFetch('/profile', { method: 'PUT', body: profile });
  }

  function recordExamAttempt(attempt) {
    return apiFetch('/exam/attempts', { method: 'POST', body: attempt });
  }

  function listExamAttempts() {
    return apiFetch('/exam/attempts');
  }

  function issueCertificate(attemptId) {
    return apiFetch('/certificates/issue', { method: 'POST', body: { attemptId: attemptId } });
  }

  function listCertificates() {
    return apiFetch('/certificates');
  }

  function getCertificateJwt(serial) {
    return apiFetch('/certificates/' + encodeURIComponent(serial) + '/jwt');
  }

  /* ---------------------------------------------------------------------
   * Progressive-profiling nudge (data-only; UI rendering lives in functions.js
   * on academy.html, per the existing acad-update-toast pattern)
   * --------------------------------------------------------------------- */

  function shouldShowProfileNudge() {
    var session = getSession();
    if (!session.loggedIn) return Promise.resolve(false);
    var dismissed = false;
    try { dismissed = sessionStorage.getItem(NUDGE_DISMISS_KEY) === '1'; } catch (e) { /* noop */ }
    if (dismissed) return Promise.resolve(false);
    return getProfile().then(function (profile) {
      return !(profile && profile.firstName && profile.lastName);
    }).catch(function () { return false; });
  }

  function dismissProfileNudge() {
    try { sessionStorage.setItem(NUDGE_DISMISS_KEY, '1'); } catch (e) { /* noop */ }
  }

  /* ---------------------------------------------------------------------
   * Tiny DOM helper (independent of academy-labs.js's private `h` — this
   * file loads on every page, academy-labs.js loads only on academy.html)
   * --------------------------------------------------------------------- */

  function mk(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'class') node.className = v;
        else node.setAttribute(k, v);
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /* ---------------------------------------------------------------------
   * Themed confirm dialog (mirrors initAcademy()'s private acadConfirm in
   * functions.js — same .acad-confirm-* classes, reimplemented here since
   * that one is closure-private to academy.html's reader).
   * --------------------------------------------------------------------- */

  function authConfirm(opts) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var overlay = mk('div', { class: 'acad-confirm-overlay' });
      var cancelBtn = mk('button', { type: 'button', class: 'acad-confirm-cancel' }, opts.cancelLabel || 'Cancel');
      var okBtn = mk('button', { type: 'button', class: 'acad-confirm-ok' + (opts.danger ? ' acad-confirm-ok-danger' : '') }, opts.confirmLabel || 'OK');
      var extra = typeof opts.extra === 'function' ? opts.extra(function setOkEnabled(enabled) { okBtn.disabled = !enabled; }) : null;
      if (opts.requireTyped) okBtn.disabled = true;
      var card = mk('div', {
        class: 'acad-confirm-card', role: 'alertdialog', 'aria-modal': 'true',
        'aria-labelledby': 'acadAuthConfirmTitle', 'aria-describedby': 'acadAuthConfirmMsg'
      }, [
        mk('h3', { class: 'acad-confirm-title', id: 'acadAuthConfirmTitle' }, opts.title || 'Are you sure?'),
        mk('p', { class: 'acad-confirm-msg', id: 'acadAuthConfirmMsg' }, opts.message || ''),
        extra,
        mk('div', { class: 'acad-confirm-btns' }, [cancelBtn, okBtn])
      ]);
      overlay.appendChild(card);

      function close(result) {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
        resolve(result);
      }
      function onKeydown(e) {
        if (e.key === 'Escape') { close(false); return; }
        if (e.key === 'Tab') {
          var order = [cancelBtn, okBtn].filter(function (b) { return !b.disabled; });
          var idx = order.indexOf(document.activeElement);
          e.preventDefault();
          var step = e.shiftKey ? -1 : 1;
          if (order.length) order[(idx + step + order.length) % order.length].focus();
        }
      }
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(false); });
      cancelBtn.addEventListener('click', function () { close(false); });
      okBtn.addEventListener('click', function () { if (!okBtn.disabled) close(true); });
      document.addEventListener('keydown', onKeydown);
      document.body.appendChild(overlay);
      cancelBtn.focus();
    });
  }

  /* ---------------------------------------------------------------------
   * Turnstile: lazy-loaded only the first time the login overlay opens.
   * --------------------------------------------------------------------- */

  var turnstileLoadPromise = null;

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileLoadPromise) return turnstileLoadPromise;
    turnstileLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(window.turnstile); };
      s.onerror = function () { reject(new Error('turnstile_load_failed')); };
      document.head.appendChild(s);
    });
    return turnstileLoadPromise;
  }

  function turnstileSiteKey() {
    var meta = document.querySelector('meta[name="turnstile-site-key"]');
    return meta ? meta.getAttribute('content') : '';
  }

  /* ---------------------------------------------------------------------
   * Login overlay
   *
   * Markup contract (all classes below are what css/styles.css themes):
   *   .acad-auth-overlay              full-viewport backdrop, role="dialog" aria-modal="true"
   *     .acad-auth-card                 the panel itself
   *       .acad-auth-close                dismiss button, top-right
   *       .acad-auth-title                "Sign in"
   *       .acad-auth-reason                only present when opts.reason was given
   *       .acad-auth-step .acad-auth-step-email   (hidden via [hidden] once step 2 shows)
   *         .acad-lab-field > input.acad-lab-input.acad-auth-email-input
   *         .acad-auth-msg (+ .is-error / .is-ok)
   *         button.acad-lab-btn.primary.acad-auth-send
   *       .acad-auth-turnstile-wrap > #acadAuthTurnstile   (persists across both steps)
   *       .acad-auth-step .acad-auth-step-code    ([hidden] until step 1 succeeds)
   *         .acad-auth-code-hint > strong.acad-auth-code-email
   *         .acad-lab-field > input.acad-lab-input.acad-auth-code-input
   *         .acad-auth-msg (+ .is-error / .is-ok)
   *         button.acad-lab-btn.primary.acad-auth-verify
   *         .acad-auth-links > button.acad-auth-link.acad-auth-resend
   *                          > button.acad-auth-link.acad-auth-back
   * --------------------------------------------------------------------- */

  var overlayEl = null;
  var overlayTriggerFocus = null;
  var resendCooldownTimer = null;

  function closeLoginOverlay() {
    if (!overlayEl) return;
    document.removeEventListener('keydown', overlayKeydown);
    overlayEl.remove();
    overlayEl = null;
    if (resendCooldownTimer) { clearTimeout(resendCooldownTimer); resendCooldownTimer = null; }
    if (overlayTriggerFocus && typeof overlayTriggerFocus.focus === 'function') overlayTriggerFocus.focus();
    overlayTriggerFocus = null;
  }

  function overlayFocusables() {
    if (!overlayEl) return [];
    return Array.prototype.slice.call(
      overlayEl.querySelectorAll('button:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled), a[href]')
    ).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function overlayKeydown(e) {
    if (e.key === 'Escape') { closeLoginOverlay(); return; }
    if (e.key === 'Tab') {
      var order = overlayFocusables();
      if (!order.length) return;
      var idx = order.indexOf(document.activeElement);
      e.preventDefault();
      var step = e.shiftKey ? -1 : 1;
      order[(idx + step + order.length) % order.length].focus();
    }
  }

  function describeApiError(err) {
    var code = err && err.code;
    var MAP = {
      invalid_input: 'That doesn’t look like a valid email address.',
      turnstile_failed: 'We couldn’t verify you’re human. Please try again.',
      rate_limited: 'Too many attempts — please wait a bit and try again.',
      daily_email_cap: 'We’ve hit today’s sending limit — please try again tomorrow.',
      code_invalid: 'That code isn’t right. Double-check it and try again.',
      code_expired: 'That code has expired — send a new one.',
      code_locked: 'Too many wrong attempts — request a fresh code.',
      email_unavailable: 'We couldn’t send an email right now — please try again shortly.'
    };
    return MAP[code] || 'Something went wrong — please try again.';
  }

  function openLoginOverlay(opts) {
    opts = opts || {};
    if (overlayEl) return; // already open
    overlayTriggerFocus = document.activeElement;

    var emailInput = mk('input', {
      type: 'email', class: 'acad-lab-input acad-auth-email-input',
      autocomplete: 'email', placeholder: 'you@example.com', required: 'required'
    });
    var emailMsg = mk('div', { class: 'acad-auth-msg', role: 'alert' });
    var sendBtn = mk('button', { type: 'button', class: 'acad-lab-btn primary acad-auth-send' }, 'Send code');
    var turnstileWrap = mk('div', { class: 'acad-auth-turnstile-wrap' }, [
      mk('div', { id: 'acadAuthTurnstile', class: 'acad-auth-turnstile' })
    ]);

    var codeEmailLabel = mk('strong', { class: 'acad-auth-code-email' });
    var codeInput = mk('input', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6',
      autocomplete: 'one-time-code', class: 'acad-lab-input acad-auth-code-input'
    });
    var codeMsg = mk('div', { class: 'acad-auth-msg', role: 'alert' });
    var verifyBtn = mk('button', { type: 'button', class: 'acad-lab-btn primary acad-auth-verify' }, 'Verify');
    var resendBtn = mk('button', { type: 'button', class: 'acad-auth-link acad-auth-resend' }, 'Resend code');
    var backBtn = mk('button', { type: 'button', class: 'acad-auth-link acad-auth-back' }, '← use a different email');

    var stepEmail = mk('div', { class: 'acad-auth-step acad-auth-step-email' }, [
      mk('label', { class: 'acad-lab-field' }, [
        mk('span', { class: 'acad-lab-field-label' }, 'Email address'),
        emailInput
      ]),
      emailMsg,
      mk('div', { class: 'acad-lab-row' }, [sendBtn])
    ]);
    var stepCode = mk('div', { class: 'acad-auth-step acad-auth-step-code', hidden: 'hidden' }, [
      mk('p', { class: 'acad-auth-code-hint' }, ['We sent a 6-digit code to ', codeEmailLabel, '.']),
      mk('label', { class: 'acad-lab-field' }, [
        mk('span', { class: 'acad-lab-field-label' }, '6-digit code'),
        codeInput
      ]),
      codeMsg,
      mk('div', { class: 'acad-lab-row' }, [verifyBtn]),
      mk('div', { class: 'acad-auth-links' }, [resendBtn, backBtn])
    ]);

    var closeBtn = mk('button', { type: 'button', class: 'acad-auth-close', 'aria-label': 'Close' }, '×');
    var titleEl = mk('h2', { class: 'acad-auth-title', id: 'acadAuthOverlayTitle' }, 'Sign in');
    var cardKids = [closeBtn, titleEl];
    if (opts.reason) cardKids.push(mk('p', { class: 'acad-auth-reason' }, opts.reason));
    cardKids.push(stepEmail, turnstileWrap, stepCode);
    var card = mk('div', { class: 'acad-auth-card' }, cardKids);

    overlayEl = mk('div', {
      class: 'acad-auth-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'acadAuthOverlayTitle'
    }, [card]);
    overlayEl.addEventListener('mousedown', function (e) { if (e.target === overlayEl) closeLoginOverlay(); });
    closeBtn.addEventListener('click', closeLoginOverlay);
    document.addEventListener('keydown', overlayKeydown);
    document.body.appendChild(overlayEl);
    emailInput.focus();

    var widgetId = null;
    loadTurnstile().then(function (turnstile) {
      try {
        widgetId = turnstile.render('#acadAuthTurnstile', { sitekey: turnstileSiteKey() });
      } catch (e) { /* placeholder sitekey / widget unavailable — Send will surface the server's turnstile_failed */ }
    }).catch(function () { /* CDN unreachable — Send will surface the server's turnstile_failed */ });

    function turnstileToken() {
      try { return (window.turnstile && widgetId != null) ? (window.turnstile.getResponse(widgetId) || '') : ''; }
      catch (e) { return ''; }
    }
    function resetTurnstile() {
      try { if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId); } catch (e) { /* noop */ }
    }

    var currentEmail = '';

    function setMsg(el, text, kind) {
      el.textContent = text || '';
      el.classList.toggle('is-error', kind === 'error');
      el.classList.toggle('is-ok', kind === 'ok');
    }

    function startCooldown(seconds) {
      var remaining = seconds;
      resendBtn.disabled = true;
      function tick() {
        if (remaining <= 0) {
          resendBtn.disabled = false;
          resendBtn.textContent = 'Resend code';
          resendCooldownTimer = null;
          return;
        }
        resendBtn.textContent = 'Resend code (' + remaining + 's)';
        remaining--;
        resendCooldownTimer = setTimeout(tick, 1000);
      }
      tick();
    }

    function sendCode(isResend) {
      var email = emailInput.value.trim();
      if (!email) { setMsg(emailMsg, 'Enter your email address first.', 'error'); return; }
      var btn = isResend ? resendBtn : sendBtn;
      var msgEl = isResend ? codeMsg : emailMsg;
      btn.disabled = true;
      setMsg(msgEl, '', null);
      apiSignupStart(email, turnstileToken())
        .then(function () {
          currentEmail = email;
          codeEmailLabel.textContent = email;
          stepEmail.hidden = true;
          stepCode.hidden = false;
          setMsg(codeMsg, isResend ? 'A new code is on its way.' : '', isResend ? 'ok' : null);
          codeInput.value = '';
          codeInput.focus();
          startCooldown(30);
        })
        .catch(function (err) {
          setMsg(msgEl, describeApiError(err), 'error');
        })
        .then(function () {
          resetTurnstile();
          btn.disabled = false;
        });
    }

    function apiSignupStart(email, token) {
      return labFetch('/api/signup/start', { method: 'POST', body: { email: email, purpose: 'signup', turnstileToken: token } });
    }

    sendBtn.addEventListener('click', function () { sendCode(false); });
    emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendCode(false); });

    resendBtn.addEventListener('click', function () {
      emailInput.value = currentEmail;
      sendCode(true);
    });

    backBtn.addEventListener('click', function () {
      stepCode.hidden = true;
      stepEmail.hidden = false;
      setMsg(codeMsg, '', null);
      if (resendCooldownTimer) { clearTimeout(resendCooldownTimer); resendCooldownTimer = null; }
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend code';
      emailInput.focus();
    });

    function verify() {
      var code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) { setMsg(codeMsg, 'Enter the 6-digit code from your email.', 'error'); return; }
      verifyBtn.disabled = true;
      setMsg(codeMsg, '', null);
      labFetch('/api/signup/verify', { method: 'POST', body: { email: currentEmail, purpose: 'signup', code: code } })
        .then(function () {
          return refreshSession();
        })
        .then(function () {
          closeLoginOverlay();
          if (typeof opts.onSuccess === 'function') opts.onSuccess();
        })
        .catch(function (err) {
          setMsg(codeMsg, describeApiError(err), 'error');
          verifyBtn.disabled = false;
        });
    }
    verifyBtn.addEventListener('click', verify);
    codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') verify(); });
    codeInput.addEventListener('paste', function () {
      setTimeout(function () { codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6); }, 0);
    });
  }

  /* ---------------------------------------------------------------------
   * Navbar control — identical markup/behavior on all 11 pages, wired here.
   * --------------------------------------------------------------------- */

  function renderNavAuth(session) {
    var nav = document.getElementById('acadAuthNav');
    if (!nav) return;
    var signIn = document.getElementById('acadAuthSignIn');
    var accountBtn = document.getElementById('acadAuthAccountBtn');
    var avatar = document.getElementById('acadAuthAvatar');
    var emailLabel = document.getElementById('acadAuthEmailLabel');
    if (!signIn || !accountBtn) return;
    if (session.loggedIn) {
      signIn.hidden = true;
      accountBtn.hidden = false;
      var email = session.email || '';
      if (avatar) avatar.textContent = email ? email.charAt(0).toUpperCase() : '?';
      if (emailLabel) emailLabel.textContent = email;
    } else {
      signIn.hidden = false;
      accountBtn.hidden = true;
    }
  }

  function wireNavAuth() {
    var nav = document.getElementById('acadAuthNav');
    if (!nav) return;
    renderNavAuth(getSession());
    document.addEventListener('academy-auth-changed', function (e) { renderNavAuth(e.detail.session); });

    var signIn = document.getElementById('acadAuthSignIn');
    if (signIn) {
      signIn.addEventListener('click', function (e) {
        e.preventDefault();
        openLoginOverlay({});
      });
    }

    nav.addEventListener('click', function (e) {
      var actionEl = e.target.closest ? e.target.closest('[data-acad-auth-action]') : null;
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-acad-auth-action');
      if (action === 'signout') {
        e.preventDefault();
        signOut().then(function () {
          window.location.reload();
        }).catch(function () { /* best-effort */ });
      } else if (action === 'signout-all') {
        e.preventDefault();
        authConfirm({
          title: 'Sign out of every other device?',
          message: 'This revokes every OTHER active session for your account (this browser tab stays signed in). Connected apps lose their access too.',
          confirmLabel: 'Sign out everywhere',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          signOutEverywhere().catch(function () { /* best-effort */ });
        });
      } else if (action === 'delete') {
        e.preventDefault();
        confirmAndDeleteAccount();
      }
      // 'profile' / 'certificates' are plain <a href="/academy#..."> — no JS needed.
    });
  }

  function confirmAndDeleteAccount() {
    var typedOk = false;
    authConfirm({
      title: 'Delete your account?',
      message: 'This permanently erases your account across BOTH the Academy (integrauth.com) and the IntegrAuth Lab (lab.integrauth.com) — every lesson’s progress, quiz results, exam attempts, certificates, and passkeys. This cannot be undone. Type DELETE to confirm.',
      confirmLabel: 'Delete my account',
      danger: true,
      requireTyped: true,
      extra: function (setOkEnabled) {
        var input = mk('input', { type: 'text', class: 'acad-lab-input', placeholder: 'Type DELETE', autocomplete: 'off' });
        input.addEventListener('input', function () {
          typedOk = input.value.trim().toUpperCase() === 'DELETE';
          setOkEnabled(typedOk);
        });
        return mk('div', { class: 'acad-lab-field' }, [input]);
      }
    }).then(function (ok) {
      if (!ok || !typedOk) return;
      deleteAccount().then(function () {
        window.location.href = '/';
      }).catch(function (err) {
        if (err && err.code === 'step_up_required') {
          window.alert('Your account has an extra security step (TOTP) enabled, which this site can’t satisfy yet. Please delete your account from lab.integrauth.com instead.');
        } else {
          window.alert('Couldn’t delete your account right now. Please try again in a moment.');
        }
      });
    });
  }

  /* ---------------------------------------------------------------------
   * academy.html-only: benefits info icon + #acadAccount panel.
   * Both no-op cleanly on every other page (elements simply don't exist).
   * --------------------------------------------------------------------- */

  function wireBenefitsInfo() {
    var icon = document.getElementById('acadBenefitsInfo');
    if (!icon) return;
    var popover = null;
    icon.addEventListener('click', function () {
      if (!getSession().loggedIn) {
        openLoginOverlay({ reason: 'Sign in to sync your progress across devices and save your certificate permanently.' });
        return;
      }
      if (window.bootstrap && window.bootstrap.Popover) {
        if (!popover) {
          popover = new window.bootstrap.Popover(icon, {
            trigger: 'manual',
            html: false,
            placement: 'bottom',
            title: 'Signing in is optional',
            content: 'Progress syncs across your devices. Certificates are saved permanently and independently verifiable at /verify. Sign-in is only required for the final exam & certificate — everything else stays fully free and public.'
          });
        }
        popover.toggle();
      }
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return iso.slice(0, 10); }
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return iso; }
  }

  function renderAccountPanel() {
    var host = document.getElementById('acadAccountPanel');
    if (!host) return;
    var session = getSession();
    host.innerHTML = '';

    if (!session.loggedIn) {
      host.appendChild(mk('p', { class: 'acad-lab-note' }, 'Sign in to manage your profile, devices and data.'));
      host.appendChild(mk('div', { class: 'acad-lab-row' }, [
        mk('button', {
          type: 'button', class: 'acad-lab-btn primary',
          onclick: function () { openLoginOverlay({ onSuccess: renderAccountPanel }); }
        }, 'Sign in')
      ]));
      return;
    }

    host.appendChild(mk('p', { class: 'acad-lab-note' }, 'Loading your account…'));

    Promise.all([getProfile().catch(function () { return null; }), refreshSession()]).then(function (results) {
      var profile = results[0];
      var acct = results[1];
      host.innerHTML = '';

      // --- profile ---
      var profileBox = mk('div', { class: 'acad-lab-panel' });
      profileBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Profile'));
      profileBox.appendChild(mk('p', { class: 'acad-lab-note' }, 'Signed in as ' + (acct.email || '—') + '.'));
      if (profile && profile.firstName && profile.lastName) {
        profileBox.appendChild(mk('p', null, [
          'Certificate name: ',
          mk('strong', null, profile.firstName + ' ' + profile.lastName),
          profile.nameLocked ? mk('span', { class: 'acad-lab-badge neutral' }, ' locked after first certificate') : null
        ]));
      } else {
        profileBox.appendChild(mk('p', { class: 'acad-lab-note' }, 'No certificate name set yet — you’ll be asked for one the first time you earn a certificate.'));
      }
      host.appendChild(profileBox);

      // --- sessions / devices ---
      var sessBox = mk('div', { class: 'acad-lab-panel' });
      sessBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Active sessions'));
      var sessions = acct.sessions || [];
      if (!sessions.length) {
        sessBox.appendChild(mk('p', { class: 'acad-lab-note' }, 'No session data available.'));
      } else {
        sessions.forEach(function (s) {
          var row = mk('div', { class: 'acad-lab-row acad-auth-device-row' }, [
            mk('p', { class: 'acad-lab-note' }, [
              (s.ua_summary || 'Unknown device') + ' · last active ' + fmtDate(s.last_seen_at) + ' · started ' + fmtDate(s.created_at),
              s.current ? mk('span', { class: 'acad-lab-badge info' }, ' this device') : null
            ])
          ]);
          if (!s.current) {
            row.appendChild(mk('button', {
              type: 'button', class: 'acad-lab-btn acad-auth-device-revoke',
              onclick: function () { revokeSession(s.id).then(renderAccountPanel); }
            }, 'Sign out this device'));
          }
          sessBox.appendChild(row);
        });
      }
      host.appendChild(sessBox);

      // --- danger zone ---
      var dangerBox = mk('div', { class: 'acad-lab-panel' });
      dangerBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Danger zone'));
      dangerBox.appendChild(mk('div', { class: 'acad-lab-row' }, [
        mk('button', {
          type: 'button', class: 'acad-lab-btn',
          onclick: function () { signOut().then(function () { window.location.reload(); }); }
        }, 'Sign out'),
        mk('button', {
          type: 'button', class: 'acad-lab-btn',
          onclick: function () {
            authConfirm({
              title: 'Sign out of every other device?',
              message: 'This revokes every OTHER active session for your account (this browser tab stays signed in). Connected apps lose their access too.',
              confirmLabel: 'Sign out everywhere',
              danger: true
            }).then(function (ok) { if (ok) signOutEverywhere().then(renderAccountPanel); });
          }
        }, 'Sign out everywhere'),
        mk('button', {
          type: 'button', class: 'acad-lab-btn danger',
          onclick: confirmAndDeleteAccount
        }, 'Delete account')
      ]));
      host.appendChild(dangerBox);
    });
  }

  function wireAccountPanel() {
    var host = document.getElementById('acadAccountPanel');
    if (!host) return;
    renderAccountPanel();
    document.addEventListener('academy-auth-changed', renderAccountPanel);
  }

  /* ---------------------------------------------------------------------
   * Boot
   * --------------------------------------------------------------------- */

  function init() {
    wireNavAuth();
    wireBenefitsInfo();
    wireAccountPanel();
    refreshSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AcademyAuth = {
    getSession: getSession,
    refreshSession: refreshSession,
    checkOnFocus: checkOnFocus,
    openLoginOverlay: openLoginOverlay,
    closeLoginOverlay: closeLoginOverlay,
    signOutEverywhere: signOutEverywhere,
    signOut: signOut,
    revokeSession: revokeSession,
    deleteAccount: deleteAccount,
    syncProgress: syncProgress,
    getProfile: getProfile,
    saveProfile: saveProfile,
    recordExamAttempt: recordExamAttempt,
    listExamAttempts: listExamAttempts,
    issueCertificate: issueCertificate,
    listCertificates: listCertificates,
    getCertificateJwt: getCertificateJwt,
    shouldShowProfileNudge: shouldShowProfileNudge,
    dismissProfileNudge: dismissProfileNudge,
    describeApiError: describeApiError
  };
})();
