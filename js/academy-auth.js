// IntegrAuth Academy — shared "who am I" + sign-in layer (js/academy-auth.js)
//
// Loaded on every page (alongside functions.min.js) so the navbar's sign-in control works
// site-wide. Exposes window.AcademyAuth. Self-initializes on DOM ready: wires the navbar control
// and, on academy.html only, the account panel + benefits info icon.
//
// HOW SIGN-IN WORKS, and why it looks like this rather than the email+OTP form it replaced:
//
// The two sites share one user base but NOT a session cookie. An earlier design did share one
// (`__Secure-ia_session` with `Domain=.integrauth.com`), which meant any of the ~30 sibling
// *.integrauth.com hosts could overwrite a visitor's session — session fixation plus an
// unclearable forced logout. So integrauth.com is now an OIDC Relying Party against
// lab.integrauth.com's OpenID Provider, and holds its own host-locked cookie. This file therefore
// makes NO cross-origin calls at all any more: identity comes from this site's own /auth/* routes
// (src/lib/server/auth.ts) and Academy data from its own /api/academy/* routes.
//
// The login handshake runs in a POP-UP rather than by navigating the page, so a learner
// mid-lesson is not thrown out of it. Two consequences worth knowing before editing:
//
//   1. The popup cannot talk to this page directly. Both sites send `Cross-Origin-Opener-Policy:
//      same-origin`, so the moment the popup navigates to the Lab the browser puts it in a
//      separate browsing-context group and severs `window.opener` — permanently, even after it
//      comes back to our own origin. `postMessage` is therefore not available, and neither is
//      `popup.closed` (a severed handle reports `true` straight away, so "poll until it closes"
//      silently thinks the popup shut instantly). The callback page hands its result back through
//      a localStorage write instead, which is browsing-context-group independent and raises a
//      `storage` event here. A slow poll of /auth/session backs it up for private-mode browsers
//      where localStorage throws.
//   2. Being signed in at the Lab no longer signs you in here automatically — the provider has no
//      silent-authentication mode and its `frame-ancestors 'none'` rules out the hidden-iframe
//      trick. It costs one click. With an existing grant the popup approves itself and closes
//      without the learner typing anything.
//
// Plain jQuery-era JS to match functions.js/academy-labs.js — no ES modules, no build step.
(function () {
  'use strict';

  /** Where the Lab lives. Used ONLY for outbound links now — never for fetch(). */
  var LAB_ORIGIN = 'https://lab.integrauth.com';

  /**
   * Cached session state. localStorage, NOT sessionStorage.
   *
   * sessionStorage is per-tab, which made every new tab start out believing nobody was signed in:
   * the exam panel rendered its "sign in first" wall to a learner who was already signed in, and
   * the cache was rebuilt from scratch on every window. localStorage is shared across tabs,
   * windows and browser restarts, which is what "stay signed in" has to mean. The `storage` event
   * it raises is also how a sign-in or sign-out in ONE tab reaches all the others.
   */
  var SESSION_KEY = 'acad_auth_session_v1';

  /**
   * The channel the /auth/callback page uses to announce a completed login.
   * MUST MATCH `AUTH_EVENT_KEY` in src/lib/server/auth.ts.
   */
  var AUTH_EVENT_KEY = 'acad_auth_event_v1';

  var NUDGE_DISMISS_KEY = 'acad_nudge_dismissed';

  var memSession = null;     // last-known session: {loggedIn:true,...} or {loggedIn:false}
  var sessionPromise = null; // in-flight refreshSession(), so concurrent callers share one request

  /* ---------------------------------------------------------------------
   * Session cache
   * --------------------------------------------------------------------- */

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode / quota — in-memory only */ }
  }

  function loadCachedSession() {
    if (memSession) return memSession;
    var raw = readStore(SESSION_KEY);
    if (raw) {
      try { memSession = JSON.parse(raw); } catch (e) { memSession = null; }
    }
    return memSession;
  }

  /**
   * True when two session snapshots describe the same signed-in identity.
   *
   * Used to decide whether to fire `academy-auth-changed`. Previously the event fired on every
   * single tab focus, and each one cost an account fetch, a full teardown and rebuild of the
   * account panel, another profile GET and a progress sync — for a state that had not changed.
   * Comparing identity rather than object equality means the event now marks actual transitions:
   * signed out → in, in → out, or one account → a different one.
   */
  function sameIdentity(a, b) {
    if (!a || !b) return false;
    if (!a.loggedIn && !b.loggedIn) return true;
    if (a.loggedIn !== b.loggedIn) return false;
    return a.userId === b.userId;
  }

  /**
   * `confirmed` says whether `session` came from an answer by the server or from the localStorage
   * cache. Listeners that WRITE (the progress sync) must act only on a confirmed session: the cache
   * is a guess about who is signed in, and on a shared browser acting on a wrong guess is how one
   * learner's progress ends up in another's account. Listeners that only RENDER can use either.
   */
  function fireChanged(session, confirmed) {
    try {
      document.dispatchEvent(new CustomEvent('academy-auth-changed', {
        detail: { session: session, confirmed: !!confirmed }
      }));
    } catch (e) { /* pre-CustomEvent-constructor browsers are not a supported target */ }
  }

  /**
   * localStorage keys holding Academy progress. DUPLICATED from functions.js (KEY_READ, KEY_QUIZ,
   * KEY_POS, KEY_POS_AT, KEY_EXAM, KEY_OWNER) — keep the two lists equal.
   *
   * They live here as well as there because ownership reconciliation has to happen in THIS file. See
   * reconcileProgressOwner.
   */
  var PROGRESS_KEYS = ['acad_read', 'acad_quiz', 'acad_pos', 'acad_pos_at', 'acad_exam', 'acad_epoch'];
  var OWNER_KEY = 'acad_owner';

  /**
   * Makes sure this browser's local Academy progress belongs to whoever is signed in right now.
   *
   * WHY THIS LIVES IN academy-auth.js AND NOT IN initAcademy(). It used to be a listener inside
   * initAcademy() in functions.js, and it never ran, for two independent reasons:
   *
   *   1. Ordering. init() below runs synchronously while this deferred script executes, and fires
   *      the forced `academy-auth-changed` there and then. initAcademy() registers its listener from
   *      jQuery's ready callback, which jQuery resolves ASYNCHRONOUSLY — so the boot event had
   *      always already fired before anything was listening. Not a race: deterministic.
   *   2. Scope. initAcademy() returns early unless `#acadReader` exists, i.e. on academy.html only.
   *      This file loads on all 11 pages and puts a sign-in control in every navbar, so an account
   *      switch or sign-out performed from the home page's navbar reconciled nothing at all.
   *
   * What that cost, concretely, on a shared machine: learner A studies and passes the exam; learner
   * B signs in from the home-page navbar; nothing is wiped and acad_owner still says A; B opens
   * /academy, where the cached and server identities now agree so no transition event fires either;
   * the boot sync then uploads A's 133 read lessons into B's account, and the exam panel reads A's
   * surviving acad_exam and offers B "we found a passing score saved on this device" — one click
   * from a real, publicly verifiable certificate in B's name for an exam B never sat.
   *
   * Called from saveCachedSession BEFORE the change event fires, so no listener can act on — or sync
   * — progress that has not yet been reconciled.
   *
   * ONLY EVER CALLED WITH A SERVER-CONFIRMED SESSION, never with the localStorage cache. That
   * distinction is load-bearing in the destructive direction: on a fresh browser profile the cache is
   * empty, so a cache-derived session reads as SIGNED OUT, and reconciling against it wiped a
   * perfectly valid learner's progress on page load — a returning learner whose cookie outlived their
   * cached session snapshot would have lost everything, including a passing exam record. Waiting for
   * /auth/session costs nothing that matters (the first sync waits on ready() anyway) and removes the
   * whole class. Where there is no server to ask at all, nothing is confirmed and nothing is wiped,
   * which is the right answer for an account-free deployment.
   *
   * An ABSENT acad_owner means progress earned before signing in, which is deliberately treated as
   * claimable rather than wiped: carrying anonymous progress into a new account is a feature.
   */
  function reconcileProgressOwner(session) {
    var owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch (e) { return; }

    if (session && session.loggedIn && session.userId) {
      if (owner && owner !== session.userId) wipeLocalProgress();
      restoreExamStash(session.userId);
      try { localStorage.setItem(OWNER_KEY, session.userId); } catch (e) {}
      return;
    }
    // Signed out. Only wipe if this progress was owned by an account — anonymous progress on a
    // browser that has never signed in is the visitor's own and must survive.
    if (owner) {
      stashExamForOwner(owner);
      wipeLocalProgress();
      try { localStorage.removeItem(OWNER_KEY); } catch (e) {}
    }
  }

  /**
   * The one thing the signed-out wipe must NOT destroy: a passing exam result that never reached
   * the server.
   *
   * The exact loss: a learner passes, `POST /exam/attempts` 401s because the session ended
   * server-side between grading and recording (revoke-all from another device, a back-channel
   * logout from signing out at the Lab) — and the confirmed signed-out answer that follows runs the
   * wipe above, taking `acad_exam` with it. The full 50-question sitting is then unrecoverable:
   * signing back in finds no local pass for the claim path to offer, and the "Try again" button
   * 401s forever.
   *
   * So a passing `acad_exam` is moved aside here, BOUND TO THE ACCOUNT THAT EARNED IT, and put back
   * only when that same account signs back in — at which point the normal claim path sees it and
   * offers "save this result to your account". A different account signing in does not see it, does
   * not restore it, and cannot claim it (that cross-learner claim is the exact hole the wipe exists
   * to close); their stash entry is simply left in place in case the earner returns. Only a
   * passing record is worth stashing — everything else is either synced already or worthless.
   */
  var EXAM_STASH_KEY = 'acad_exam_stash_v1';

  function stashExamForOwner(owner) {
    var exam = null;
    try { exam = JSON.parse(localStorage.getItem('acad_exam') || 'null'); } catch (e) { return; }
    if (!exam || !exam.passed) return;
    try { localStorage.setItem(EXAM_STASH_KEY, JSON.stringify({ owner: owner, exam: exam })); } catch (e) {}
  }

  function restoreExamStash(userId) {
    var stash = null;
    try { stash = JSON.parse(localStorage.getItem(EXAM_STASH_KEY) || 'null'); } catch (e) { return; }
    if (!stash || stash.owner !== userId || !stash.exam) return;
    try {
      // Never clobber a fresher record: an exam sat while signed in outranks a stashed one.
      if (!localStorage.getItem('acad_exam')) {
        localStorage.setItem('acad_exam', JSON.stringify(stash.exam));
      }
      localStorage.removeItem(EXAM_STASH_KEY);
    } catch (e) {}
  }

  function wipeLocalProgress() {
    for (var i = 0; i < PROGRESS_KEYS.length; i++) {
      try { localStorage.removeItem(PROGRESS_KEYS[i]); } catch (e) {}
    }
    // Tell whoever is rendering to re-read from storage. functions.js keeps parsed copies of these
    // in memory, and clearing the keys underneath it would otherwise leave the ✓ marks and the
    // progress bar showing the previous account's work until a reload.
    try {
      document.dispatchEvent(new CustomEvent('academy-progress-wiped'));
    } catch (e) {}
  }

  /**
   * Stores a session snapshot, and fires `academy-auth-changed` only if the identity really moved.
   *
   * `force` exists for the boot path, where listeners need one event to render their initial state
   * even though nothing has "changed" yet.
   *
   * `confirmed` means "this identity came from the server" (a /auth/session answer, or another tab's
   * answer relayed by a storage event) as opposed to "this is what our localStorage cache guessed".
   * Only a confirmed session may reconcile progress ownership — see reconcileProgressOwner.
   */
  function saveCachedSession(session, force, confirmed) {
    var previous = loadCachedSession();
    memSession = session;
    writeStore(SESSION_KEY, JSON.stringify(session));
    // Before the event, always — see reconcileProgressOwner.
    if (confirmed) reconcileProgressOwner(session);
    if (force || !sameIdentity(previous, session)) fireChanged(session, confirmed);
  }

  function normalizeSession(data) {
    if (!data || !data.loggedIn) return { loggedIn: false };
    return {
      loggedIn: true,
      userId: data.userId || null,
      email: data.email || null,
      sessions: data.sessions || []
    };
  }

  function getSession() {
    return loadCachedSession() || { loggedIn: false };
  }

  /**
   * Re-reads session state from the server.
   *
   * A network failure deliberately keeps whatever was cached rather than reporting "signed out": a
   * flaky connection should not make a signed-in learner's exam panel slam shut. A real 401/200
   * `loggedIn:false` answer is trusted immediately — that is the server speaking, not the network.
   */
  function refreshSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = authFetch('/session')
      .then(function (data) {
        var out = normalizeSession(data);
        // Confirmed: this identity IS the server's answer.
        saveCachedSession(out, false, true);
        return out;
      })
      .catch(function (err) {
        if (err && err.status === 401) {
          var out = { loggedIn: false };
          // A 401 is the server speaking too — confirmed signed out.
          saveCachedSession(out, false, true);
          return out;
        }
        return loadCachedSession() || { loggedIn: false };
      })
      .then(function (out) {
        sessionPromise = null;
        return out;
      });
    return sessionPromise;
  }

  /**
   * Cross-tab propagation. Two keys matter:
   *   SESSION_KEY    — another tab signed in or out; adopt its answer without a network call.
   *   AUTH_EVENT_KEY — the sign-in popup finished; go ask the server who we are now.
   */
  window.addEventListener('storage', function (e) {
    if (!e.key) return;
    if (e.key === SESSION_KEY) {
      var incoming = null;
      try { incoming = e.newValue ? JSON.parse(e.newValue) : null; } catch (err) { return; }
      if (!incoming) return;
      var previous = memSession;
      memSession = incoming;
      // Reconcile before the event here too: this is the path a sign-in performed in ANOTHER tab
      // arrives by, so it is just as capable of handing this tab a different account as our own
      // refresh is. Runs unconditionally rather than only on a fired change, because this tab's
      // acad_owner may be stale even when the identity it is being told about matches its cache.
      reconcileProgressOwner(incoming);
      // Confirmed: another tab only writes SESSION_KEY after ITS /auth/session answered, so this
      // value is server truth relayed between tabs, not this tab's own cached guess.
      if (!sameIdentity(previous, incoming)) fireChanged(incoming, true);
      return;
    }
    if (e.key === AUTH_EVENT_KEY && e.newValue) {
      refreshSession();
    }
  });

  /* ---------------------------------------------------------------------
   * Fetch helpers — both same-origin, since nothing cross-origin remains
   * --------------------------------------------------------------------- */

  function parseResponse(res) {
    return res.text().then(function (text) {
      var data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (e) { /* non-JSON body, handled below */ }
      if (!res.ok) {
        var err = new Error((data && data.error) || ('http_' + res.status));
        err.code = (data && data.error) || null;
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    // `keepalive` lets a request outlive the page that started it. Only worth setting on the
    // unload-time progress flush: without it the browser cancels an in-flight fetch when the tab
    // goes away, so a learner who closes the tab right after finishing a lesson loses that lesson's
    // read mark. Not set by default — keepalive requests share a small per-origin budget, and
    // spending it on ordinary calls would starve the one case that needs it.
    if (opts.keepalive) init.keepalive = true;
    return fetch('/api/academy' + path, init).then(parseResponse).catch(noteUnauthorized);
  }

  /**
   * Re-checks identity whenever the API says we are not who we think we are, then rethrows.
   *
   * Centralised here because doing it per-caller meant it was done in exactly ONE place (the progress
   * sync) and forgotten everywhere else. The consequence was that a session which had ended
   * server-side — an idle timeout, a revoke-all from another device, a back-channel logout — left the
   * navbar and the exam panel cheerfully signed in, since nothing flipped the cached session. A
   * learner could sit the whole 50-question final exam and only discover on submit that they were
   * signed out. `refreshSession` de-duplicates concurrent calls, so a burst of 401s costs one request.
   */
  function noteUnauthorized(err) {
    if (err && err.status === 401) {
      try { refreshSession(); } catch (e) {}
    }
    throw err;
  }

  function authFetch(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch('/auth' + path, init).then(parseResponse);
  }

  /**
   * Is the Academy backend reachable at all?
   *
   * This matters because of how the hosting cutover is staged: the site is served by GitHub Pages
   * until DNS moves to the Cloudflare Worker, and on GitHub Pages every /auth/* and /api/academy/*
   * path is just a 404 (served as the custom 404 HTML page, so it does not even look like an API
   * error). Without this probe the sign-in button and exam panel would throw confusing failures at
   * visitors on the old host. With it, callers can degrade to "accounts aren't available here yet"
   * and leave the free, account-less Academy — lessons, labs, Flow Explorer, Challenge mode —
   * working exactly as before.
   *
   * The probe is /auth/session, which the Worker always answers 200 with a JSON body carrying a
   * `loggedIn` field. A 404, an HTML body, or a network error all mean "no Worker here".
   */
  var apiAvailablePromise = null;
  function isApiAvailable() {
    if (apiAvailablePromise) return apiAvailablePromise;
    apiAvailablePromise = fetch('/auth/session', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (data) {
          return !!data && typeof data.loggedIn === 'boolean';
        }).catch(function () { return false; });
      })
      .catch(function () { return false; })
      .then(function (available) {
        // Memoise only a POSITIVE answer. "No Worker here" is a permanent fact about the host
        // (pre-cutover GitHub Pages) but it is indistinguishable at this layer from a transient
        // one — an offline blip at boot, a Worker cold-start 5xx, a captive portal. Caching the
        // negative turns one unlucky request at page load into accounts being dead for the whole
        // page lifetime: no session refresh, no sync, and both Sign-in buttons stuck reading
        // "Accounts aren't available yet" long after connectivity came back. Clearing the cache on
        // a negative costs one extra probe per sign-in attempt on a genuinely account-free host,
        // which is the cheaper side of the trade by a wide margin.
        if (!available) apiAvailablePromise = null;
        return available;
      });
    return apiAvailablePromise;
  }

  /* ---------------------------------------------------------------------
   * Sign-in (OIDC popup, with a full-redirect fallback)
   * --------------------------------------------------------------------- */

  /** Interval between fallback /auth/session polls while a sign-in is in flight. */
  var SIGNIN_POLL_MS = 2500;
  /** Give up polling after this long. Generous: the learner may be typing an OTP at the Lab. */
  var SIGNIN_TIMEOUT_MS = 5 * 60 * 1000;

  function currentReturnPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function startUrl(mode) {
    return '/auth/start?mode=' + mode + '&return=' + encodeURIComponent(currentReturnPath());
  }

  /** Hands the whole page over to the Lab. Used when the popup is blocked or the user asks. */
  function signInViaRedirect() {
    window.location.href = startUrl('redirect');
  }

  var pendingSignIn = null; // { poll, timeout, onStorage, overlay } while a flow is in progress

  function endPendingSignIn(keepOverlay) {
    if (!pendingSignIn) return;
    if (pendingSignIn.poll) clearInterval(pendingSignIn.poll);
    if (pendingSignIn.timeout) clearTimeout(pendingSignIn.timeout);
    if (pendingSignIn.onStorage) window.removeEventListener('storage', pendingSignIn.onStorage);
    pendingSignIn = null;
    // Callers that are about to render their OWN overlay (an "unavailable" or "timed out" message)
    // pass true, so this does not close the thing they are in the middle of showing.
    if (!keepOverlay) closeSignInOverlay();
  }

  /**
   * Begins a sign-in.
   *
   * opts.reason    optional sentence explaining why sign-in is being asked for
   * opts.onSuccess called once the session is confirmed
   */
  function signIn(opts) {
    opts = opts || {};
    if (pendingSignIn) return;

    // Claim the slot SYNCHRONOUSLY, before the first await.
    //
    // The guard above is only meaningful if something is assigned before this function yields.
    // Assigning `pendingSignIn` inside the `.then` below — its previous shape — meant two clicks in
    // the same tick (an ordinary double-click on the navbar link, or the account and exam panels'
    // buttons in quick succession) both passed the guard, and the second flow's assignment
    // overwrote the first. endPendingSignIn then cleaned up only the survivor, leaving the first
    // flow's 2.5s /auth/session poll running for the rest of the page's life plus an orphaned
    // `storage` listener that would later pop a "sign-in didn't finish" modal in response to an
    // unrelated sign-in completing in another tab.
    pendingSignIn = { poll: null, timeout: null, onStorage: null };

    isApiAvailable().then(function (available) {
      if (!available) {
        endPendingSignIn(true);
        showSignInOverlay({
          reason: opts.reason,
          unavailable: true
        });
        return;
      }

      var popup = null;
      try {
        popup = window.open(
          startUrl('popup'),
          'ia-signin',
          'width=520,height=700,menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes'
        );
      } catch (e) {
        popup = null;
      }

      // Popup blocked. Do not nag — just use the whole window, which always works.
      if (!popup) {
        endPendingSignIn(true);
        signInViaRedirect();
        return;
      }

      var settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        endPendingSignIn();
        if (typeof opts.onSuccess === 'function') opts.onSuccess();
      }

      function check() {
        return refreshSession().then(function (session) {
          if (session.loggedIn) finish();
          return session;
        });
      }

      function onStorage(e) {
        if (e.key !== AUTH_EVENT_KEY || !e.newValue) return;
        var payload = null;
        try { payload = JSON.parse(e.newValue); } catch (err) { payload = null; }
        if (payload && payload.ok === false) {
          // The popup reported a real failure (denied consent, expired transaction). Say so
          // instead of leaving the learner watching a spinner until the timeout.
          endPendingSignIn(true);
          showSignInOverlay({ reason: opts.reason, failed: payload.error || null });
          return;
        }
        check();
      }

      window.addEventListener('storage', onStorage);
      pendingSignIn.onStorage = onStorage;
      // Backup for browsers where the popup's localStorage write throws (private mode) or where
      // the storage event does not arrive. Cheap, same-origin, and stops the moment we succeed.
      pendingSignIn.poll = setInterval(check, SIGNIN_POLL_MS);
      pendingSignIn.timeout = setTimeout(function () {
        // Timing out must SAY something. Silently closing the overlay — the previous behaviour —
        // is the worst available outcome: the learner watched "this page will update by itself"
        // for five minutes, then saw the dialog vanish with no statement about whether they are
        // signed in. Nothing writes the handshake if the popup is closed, the provider is
        // unreachable, or it errors before reaching our callback, so this is a reachable path and
        // not a theoretical one.
        endPendingSignIn(true);
        showSignInOverlay({ reason: opts.reason, failed: 'signin_timeout' });
      }, SIGNIN_TIMEOUT_MS);

      showSignInOverlay({ reason: opts.reason, waiting: true });
    });
  }

  /* ---------------------------------------------------------------------
   * Sign-out and session management
   * --------------------------------------------------------------------- */

  function signOut() {
    return authFetch('/logout', { method: 'POST' }).then(function (out) {
      saveCachedSession({ loggedIn: false }, false, true);
      return out;
    });
  }

  /**
   * Ends every session THIS SITE holds for the account, on every device.
   *
   * Scope note that the UI copy has to match: this does not reach lab.integrauth.com. Under the
   * OIDC design this site holds no credential that would let it revoke the Lab's own sessions, and
   * that boundary is intentional. The reverse direction does work — signing out at the Lab
   * back-channel-notifies us and revokes the matching session here.
   */
  function signOutEverywhere() {
    return authFetch('/logout-all', { method: 'POST' }).then(function (out) {
      saveCachedSession({ loggedIn: false }, false, true);
      return out;
    });
  }

  function revokeSession(sessionId) {
    return authFetch('/sessions/revoke', { method: 'POST', body: { sessionId: sessionId } })
      .then(function (out) {
        if (out && out.self) saveCachedSession({ loggedIn: false }, false, true);
        else refreshSession();
        return out;
      });
  }

  /* ---------------------------------------------------------------------
   * Academy data (same-origin, this site's own Worker)
   * --------------------------------------------------------------------- */

  function syncProgress(localSnapshot, opts) {
    opts = opts || {};
    return apiFetch('/progress/sync', {
      method: 'POST',
      body: localSnapshot || {},
      keepalive: !!opts.keepalive
    });
  }
  function getProgress() {
    return apiFetch('/progress');
  }

  /**
   * Tells the server to DELETE progress, which the ordinary sync cannot express.
   *
   * `payload` is `{scope:'all'}` or `{scope:'track', lessonIds:[...], trackIds:[...]}`. The server
   * deletes the rows and bumps a per-learner reset epoch; every device that syncs afterwards with
   * an older epoch has its payload ignored and adopts the post-reset truth instead. Without that,
   * a reset here was quietly undone later by another device re-uploading its stale copy — and
   * often undone within a second on THIS device, by the debounced sync that fired right after the
   * local clear. Resolves with the new canonical progress, including the new `epoch`.
   */
  function resetProgress(payload) {
    return apiFetch('/progress/reset', { method: 'POST', body: payload || { scope: 'all' } });
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
   * Progressive-profiling nudge (data only; academy.html renders it)
   * --------------------------------------------------------------------- */

  function shouldShowProfileNudge() {
    var session = getSession();
    if (!session.loggedIn) return Promise.resolve(false);
    if (readStore(NUDGE_DISMISS_KEY) === '1') return Promise.resolve(false);
    return getProfile().then(function (profile) {
      return !(profile && profile.firstName && profile.lastName);
    }).catch(function () { return false; });
  }

  function dismissProfileNudge() {
    writeStore(NUDGE_DISMISS_KEY, '1');
  }

  /* ---------------------------------------------------------------------
   * Tiny DOM helper (independent of academy-labs.js's private `h` — this file
   * loads on every page, academy-labs.js only on academy.html)
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
   * functions.js — same .acad-confirm-* classes, reimplemented here because
   * that one is closure-private to academy.html's reader)
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
   * Sign-in overlay
   *
   * Much smaller than the email+OTP form it replaces — the Lab collects the
   * credentials now. This only explains what is happening in the pop-up and
   * offers a way out if the pop-up misbehaves.
   *
   * Markup contract (classes are what css/styles.css themes):
   *   .acad-auth-overlay          full-viewport backdrop, role="dialog" aria-modal="true"
   *     .acad-auth-card
   *       .acad-auth-close
   *       .acad-auth-title
   *       .acad-auth-reason       present only when a reason was given
   *       .acad-auth-msg (+ .is-error)
   *       .acad-auth-links > button.acad-auth-link
   * --------------------------------------------------------------------- */

  var overlayEl = null;
  var overlayTriggerFocus = null;

  function closeSignInOverlay() {
    if (!overlayEl) return;
    document.removeEventListener('keydown', overlayKeydown);
    overlayEl.remove();
    overlayEl = null;
    if (overlayTriggerFocus && typeof overlayTriggerFocus.focus === 'function') overlayTriggerFocus.focus();
    overlayTriggerFocus = null;
  }

  function overlayFocusables() {
    if (!overlayEl) return [];
    return Array.prototype.slice.call(
      overlayEl.querySelectorAll('button:not([hidden]):not(:disabled), a[href]')
    ).filter(function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function overlayKeydown(e) {
    if (e.key === 'Escape') { endPendingSignIn(); closeSignInOverlay(); return; }
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
      // /auth/* outcomes
      sign_in_unavailable: 'Sign-in isn’t available on this site yet — please try again later.',
      no_transaction: 'That sign-in attempt expired. Please try again.',
      state_mismatch: 'That sign-in attempt couldn’t be verified. Please try again.',
      issuer_mismatch: 'That sign-in attempt couldn’t be verified. Please try again.',
      nonce_mismatch: 'That sign-in attempt couldn’t be verified. Please try again.',
      exchange_failed: 'We couldn’t complete sign-in. Please try again.',
      invalid_id_token: 'We couldn’t complete sign-in. Please try again.',
      access_denied: 'Sign-in was cancelled.',
      // Purely client-side: nothing was heard back from the pop-up before the timeout. The usual
      // cause is that the window was closed, so word it as unfinished rather than as an error.
      signin_timeout: 'Sign-in didn’t finish — the window may have been closed. Please try again.',
      internal_error: 'Something went wrong on our side. Please try again.',
      forbidden_origin: 'That request was blocked for security reasons. Please reload and retry.',
      // /api/academy/* outcomes
      unauthorized: 'You’re signed out — please sign in again.',
      rate_limited: 'Too many attempts — please wait a bit and try again.',
      name_locked: 'Your certificate name is locked and can’t be changed.',
      invalid_input: 'Please check what you entered and try again.'
    };
    return MAP[code] || 'Something went wrong — please try again.';
  }

  /**
   * Renders the sign-in overlay in one of three states: waiting on the pop-up, reporting a
   * failure, or explaining that accounts are not available on this host yet.
   */
  function showSignInOverlay(opts) {
    opts = opts || {};
    closeSignInOverlay();
    overlayTriggerFocus = overlayTriggerFocus || document.activeElement;

    var closeBtn = mk('button', { type: 'button', class: 'acad-auth-close', 'aria-label': 'Close' }, '×');
    var titleEl = mk('h2', { class: 'acad-auth-title', id: 'acadAuthOverlayTitle' },
      opts.unavailable ? 'Accounts aren’t available yet' : (opts.failed ? 'Sign-in didn’t finish' : 'Continue in the pop-up'));

    var kids = [closeBtn, titleEl];
    if (opts.reason) kids.push(mk('p', { class: 'acad-auth-reason' }, opts.reason));

    if (opts.unavailable) {
      kids.push(mk('p', { class: 'acad-auth-msg' },
        'Sign-in and certificates are still being rolled out on this address. Every lesson, lab, ' +
        'the Flow Explorer and Challenge mode work right now without an account.'));
    } else if (opts.failed) {
      kids.push(mk('div', { class: 'acad-auth-msg is-error', role: 'alert' },
        describeApiError({ code: opts.failed })));
      kids.push(mk('div', { class: 'acad-auth-links' }, [
        mk('button', {
          type: 'button', class: 'acad-auth-link',
          onclick: function () { closeSignInOverlay(); signIn({ reason: opts.reason }); }
        }, 'Try again')
      ]));
    } else {
      kids.push(mk('p', { class: 'acad-auth-msg', role: 'status' },
        'We opened a window at lab.integrauth.com to sign you in. Your Academy account is the same ' +
        'account you use there. This page will update by itself when you’re done.'));
      kids.push(mk('div', { class: 'acad-auth-links' }, [
        mk('button', {
          type: 'button', class: 'acad-auth-link',
          onclick: function () { endPendingSignIn(); signInViaRedirect(); }
        }, 'Pop-up blocked? Sign in in this window instead'),
        mk('button', {
          type: 'button', class: 'acad-auth-link',
          onclick: function () { endPendingSignIn(); }
        }, 'Cancel')
      ]));
    }

    var card = mk('div', { class: 'acad-auth-card' }, kids);
    overlayEl = mk('div', {
      class: 'acad-auth-overlay', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'acadAuthOverlayTitle'
    }, [card]);
    overlayEl.addEventListener('mousedown', function (e) {
      if (e.target === overlayEl) { endPendingSignIn(); closeSignInOverlay(); }
    });
    closeBtn.addEventListener('click', function () { endPendingSignIn(); closeSignInOverlay(); });
    document.addEventListener('keydown', overlayKeydown);
    document.body.appendChild(overlayEl);
    closeBtn.focus();
  }

  /* ---------------------------------------------------------------------
   * Navbar control — identical markup/behavior on all 11 pages
   * --------------------------------------------------------------------- */

  function renderNavAuth(session) {
    var nav = document.getElementById('acadAuthNav');
    if (!nav) return;
    var signInEl = document.getElementById('acadAuthSignIn');
    var accountBtn = document.getElementById('acadAuthAccountBtn');
    var avatar = document.getElementById('acadAuthAvatar');
    var emailLabel = document.getElementById('acadAuthEmailLabel');
    if (!signInEl || !accountBtn) return;
    if (session.loggedIn) {
      signInEl.hidden = true;
      accountBtn.hidden = false;
      var email = session.email || '';
      if (avatar) avatar.textContent = email ? email.charAt(0).toUpperCase() : '?';
      if (emailLabel) emailLabel.textContent = email;
    } else {
      signInEl.hidden = false;
      accountBtn.hidden = true;
    }
  }

  function wireNavAuth() {
    var nav = document.getElementById('acadAuthNav');
    if (!nav) return;
    renderNavAuth(getSession());
    document.addEventListener('academy-auth-changed', function (e) { renderNavAuth(e.detail.session); });

    var signInEl = document.getElementById('acadAuthSignIn');
    if (signInEl) {
      // The element is a real <a href="/auth/start?..."> so it still works with JS disabled (it
      // then does the full-page redirect flow). Intercept it here only to upgrade that to the
      // nicer pop-up, and let the plain navigation stand if anything goes wrong.
      signInEl.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        signIn({});
      });
    }

    nav.addEventListener('click', function (e) {
      var actionEl = e.target.closest ? e.target.closest('[data-acad-auth-action]') : null;
      if (!actionEl) return;
      var action = actionEl.getAttribute('data-acad-auth-action');
      if (action === 'signout') {
        e.preventDefault();
        signOut().then(function () { window.location.reload(); }).catch(signOutFailed);
      } else if (action === 'signout-all') {
        e.preventDefault();
        confirmSignOutEverywhere();
      }
      // 'profile' / 'certificates' / 'manage-account' are plain links — no JS needed.
    });
  }

  /**
   * A failed sign-out must be LOUD, and must not pretend. The tempting alternative — clear the
   * local cache first so the tab at least LOOKS signed out — is the dangerous one on the machine
   * where sign-out matters most: the shared one. The session cookie is still valid, so the learner
   * who saw "signed out" and walked away actually left their account open; the next visitor's page
   * load probes /auth/session and is straight back in it. Truthful failure + retry is the only
   * honest option.
   */
  function signOutFailed(err) {
    return authConfirm({
      title: 'Sign-out failed',
      message: 'The server could not be reached (' + describeApiError(err) + '), so you are STILL ' +
        'SIGNED IN on this device. Check your connection and try again.',
      confirmLabel: 'Try again',
      cancelLabel: 'Not now'
    }).then(function (retry) {
      if (retry) return signOut().then(function () { window.location.reload(); }).catch(signOutFailed);
    });
  }

  function confirmSignOutEverywhere() {
    return authConfirm({
      title: 'Sign out on all your devices?',
      message: 'This signs you out of the Academy everywhere, including this browser. It does not ' +
        'sign you out of lab.integrauth.com — use your account page there for that.',
      confirmLabel: 'Sign out everywhere',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      return signOutEverywhere().then(function () {
        window.location.reload();
      }).catch(function () { /* best-effort */ });
    });
  }

  /* ---------------------------------------------------------------------
   * academy.html-only: benefits info icon + #acadAccount panel.
   * Both no-op cleanly on every other page (the elements simply don't exist).
   * --------------------------------------------------------------------- */

  function wireBenefitsInfo() {
    var icon = document.getElementById('acadBenefitsInfo');
    if (!icon) return;
    var popover = null;
    icon.addEventListener('click', function () {
      if (!getSession().loggedIn) {
        signIn({ reason: 'Sign in to sync your progress across devices and save your certificate permanently.' });
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

  function renderAccountPanel() {
    var host = document.getElementById('acadAccountPanel');
    if (!host) return;
    host.innerHTML = '';

    var session = getSession();
    if (!session.loggedIn) {
      host.appendChild(mk('p', { class: 'acad-lab-note' }, 'Sign in to manage your profile, devices and data.'));
      host.appendChild(mk('div', { class: 'acad-lab-row' }, [
        mk('button', {
          type: 'button', class: 'acad-lab-btn primary',
          onclick: function () { signIn({ onSuccess: renderAccountPanel }); }
        }, 'Sign in')
      ]));
      return;
    }

    host.appendChild(mk('p', { class: 'acad-lab-note' }, 'Loading your account…'));

    Promise.all([
      getProfile().catch(function () { return null; }),
      refreshSession()
    ]).then(function (results) {
      var profile = results[0];
      var acct = results[1];
      host.innerHTML = '';

      // --- profile ---
      var profileBox = mk('div', { class: 'acad-lab-panel' });
      profileBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Profile'));
      profileBox.appendChild(mk('p', { class: 'acad-lab-note' }, 'Signed in as ' + (acct.email || '—') + '.'));
      // The name is LOCKED once a certificate has been issued, so a certificate's holder name can
      // never be edited out from under a verifier who already checked it. Show it read-only in that
      // case and say why, rather than offering a field that the server would reject.
      if (profile && profile.nameLocked && profile.firstName && profile.lastName) {
        profileBox.appendChild(mk('p', null, [
          'Certificate name: ',
          mk('strong', null, profile.firstName + ' ' + profile.lastName),
          mk('span', { class: 'acad-lab-badge neutral' }, ' locked after first certificate')
        ]));
      } else {
        // An actual editable form. This used to be absent, which made the "Add your name" nudge a
        // dead end: it scrolled the learner to this panel and there was nothing here to type into.
        profileBox.appendChild(mk('p', { class: 'acad-lab-note' },
          profile && profile.firstName
            ? 'This is the name that will appear on your certificate. You can change it until your first certificate is issued, after which it is locked.'
            : 'Set the name you want on your certificate. You can change it any time until your first certificate is issued.'));

        var firstInput = mk('input', {
          type: 'text', class: 'acad-lab-input', autocomplete: 'given-name',
          maxlength: '80', placeholder: 'First name',
          value: (profile && profile.firstName) || ''
        });
        var lastInput = mk('input', {
          type: 'text', class: 'acad-lab-input', autocomplete: 'family-name',
          maxlength: '80', placeholder: 'Last name',
          value: (profile && profile.lastName) || ''
        });
        var nameMsg = mk('div', { class: 'acad-auth-msg', role: 'alert' });
        var saveBtn = mk('button', { type: 'button', class: 'acad-lab-btn primary' }, 'Save name');

        saveBtn.addEventListener('click', function () {
          var f = firstInput.value.trim();
          var l = lastInput.value.trim();
          // Mirrors the server's own rule (it rejects empty/whitespace names) so the learner gets
          // an instant answer instead of a round trip that fails.
          if (!f || !l) {
            nameMsg.textContent = 'Please enter both a first and a last name.';
            nameMsg.className = 'acad-auth-msg is-error';
            return;
          }
          saveBtn.disabled = true;
          nameMsg.textContent = '';
          nameMsg.className = 'acad-auth-msg';
          saveProfile({ firstName: f, lastName: l }).then(function () {
            // Stop nagging: the nudge exists only to get a name, and there now is one.
            dismissProfileNudge();
            renderAccountPanel();
          }).catch(function (err) {
            nameMsg.textContent = describeApiError(err);
            nameMsg.className = 'acad-auth-msg is-error';
            saveBtn.disabled = false;
            if (err && err.status === 401) refreshSession();
          });
        });

        profileBox.appendChild(mk('label', { class: 'acad-lab-field' }, [
          mk('span', { class: 'acad-lab-field-label' }, 'First name'), firstInput
        ]));
        profileBox.appendChild(mk('label', { class: 'acad-lab-field' }, [
          mk('span', { class: 'acad-lab-field-label' }, 'Last name'), lastInput
        ]));
        profileBox.appendChild(nameMsg);
        profileBox.appendChild(mk('div', { class: 'acad-lab-row' }, [saveBtn]));
      }
      host.appendChild(profileBox);

      // --- devices ---
      var sessBox = mk('div', { class: 'acad-lab-panel' });
      sessBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Where you’re signed in'));
      sessBox.appendChild(mk('p', { class: 'acad-lab-note' },
        'Academy sessions only. Sessions at lab.integrauth.com are listed on your account page there.'));
      var sessions = acct.sessions || [];
      if (!sessions.length) {
        sessBox.appendChild(mk('p', { class: 'acad-lab-note' }, 'No session data available.'));
      } else {
        sessions.forEach(function (s) {
          var row = mk('div', { class: 'acad-lab-row acad-auth-device-row' }, [
            mk('p', { class: 'acad-lab-note' }, [
              (s.device || 'Unknown device') + ' · last active ' + fmtDate(s.lastSeenAt) + ' · started ' + fmtDate(s.createdAt),
              s.current ? mk('span', { class: 'acad-lab-badge info' }, ' this device') : null
            ])
          ]);
          if (!s.current) {
            row.appendChild(mk('button', {
              type: 'button', class: 'acad-lab-btn acad-auth-device-revoke',
              onclick: function () {
                // authFetch does not carry apiFetch's noteUnauthorized wrapper, so without a catch
                // a failed revoke is an unhandled rejection: no re-render, no message, and a row
                // that still claims the device is signed in.
                revokeSession(s.id).then(renderAccountPanel, function (err) {
                  window.alert(describeApiError(err));
                });
              }
            }, 'Sign out this device'));
          }
          sessBox.appendChild(row);
        });
      }
      host.appendChild(sessBox);

      // --- account-wide actions, which live at the Lab ---
      //
      // Deleting the account and signing out of the Lab itself are deliberately NOT done from
      // here. Both are operations on the SHARED account, and under the OIDC design this site holds
      // no credential that permits them — the Lab is the single canonical owner of the account
      // lifecycle (its erasure path is what cascades a deletion across both apps' data, including
      // everything the Academy stores). Linking out is the honest interface; reimplementing either
      // one here would mean a second, divergent deletion path.
      var acctBox = mk('div', { class: 'acad-lab-panel' });
      acctBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Account'));
      acctBox.appendChild(mk('p', { class: 'acad-lab-note' },
        'Your Academy account is the same account as lab.integrauth.com. Changing your email, ' +
        'managing passkeys or two-factor, and deleting your account are all done there — deleting ' +
        'it removes your Academy progress, exam attempts and certificates too.'));
      acctBox.appendChild(mk('div', { class: 'acad-lab-row' }, [
        mk('a', {
          class: 'acad-lab-btn', href: LAB_ORIGIN + '/account',
          target: '_blank', rel: 'noopener noreferrer'
        }, 'Manage account at the Lab ↗')
      ]));
      host.appendChild(acctBox);

      // --- session actions ---
      var dangerBox = mk('div', { class: 'acad-lab-panel' });
      dangerBox.appendChild(mk('div', { class: 'acad-lab-panel-title' }, 'Sign out'));
      dangerBox.appendChild(mk('div', { class: 'acad-lab-row' }, [
        mk('button', {
          type: 'button', class: 'acad-lab-btn',
          onclick: function () {
            // Success reloads into the signed-out page; failure is loud (see signOutFailed) —
            // this tab is genuinely still signed in when the round trip fails, and reloading
            // into a signed-in page while claiming otherwise would be the worst of both.
            signOut().then(function () { window.location.reload(); }).catch(signOutFailed);
          }
        }, 'Sign out'),
        mk('button', {
          type: 'button', class: 'acad-lab-btn',
          onclick: confirmSignOutEverywhere
        }, 'Sign out everywhere')
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

  /**
   * Resolves once identity has been settled with the SERVER (or once we know there is no server to
   * ask). Never rejects.
   *
   * Exists because the cached session is only a guess. Anything that WRITES on the learner's behalf —
   * above all the first progress sync — must wait for this, not for `getSession()`. Otherwise on a
   * slow link the debounced boot sync fires against a stale cached identity and uploads whatever
   * local progress is lying around under the current cookie, which on a shared browser means the
   * previous learner's work lands in this learner's account. Rendering may still use the cache
   * immediately; only writes need to wait.
   */
  var readyResolve;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
  function ready() { return readyPromise; }

  function init() {
    wireNavAuth();
    wireBenefitsInfo();
    wireAccountPanel();

    // Render from cache first (instant, no flash of the wrong state), then confirm with the
    // server. Fired directly rather than through saveCachedSession, for two reasons: the cache is
    // a guess, so no reconciling progress ownership on it (see reconcileProgressOwner) — and no
    // writing it BACK to the store either. The value came from the store, so a rewrite persists
    // nothing new, and it is not a no-op in the one case that matters: a corrupt/truncated stored
    // value parses to null, getSession() then answers {loggedIn:false}, and writing that back
    // raises a storage event that every other open tab treats as a server-confirmed sign-out —
    // wiping local progress while the session cookie is still perfectly valid.
    fireChanged(getSession(), false);

    // Only ask the server if there is a server to ask. On GitHub Pages, before the DNS cutover,
    // /auth/session is a 404 — probing first keeps a failed fetch out of the console on every page
    // load of the currently-live site.
    isApiAvailable()
      .then(function (available) {
        return available ? refreshSession() : null;
      })
      // Settle either way: a failed probe or a failed refresh still means "this is as good as our
      // knowledge gets", and leaving the promise pending would stall syncing forever.
      .catch(function () {})
      .then(function () { readyResolve(getSession()); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AcademyAuth = {
    getSession: getSession,
    ready: ready,
    refreshSession: refreshSession,
    isApiAvailable: isApiAvailable,
    signIn: signIn,
    signInViaRedirect: signInViaRedirect,
    closeSignInOverlay: closeSignInOverlay,
    signOut: signOut,
    signOutEverywhere: signOutEverywhere,
    revokeSession: revokeSession,
    syncProgress: syncProgress,
    getProgress: getProgress,
    resetProgress: resetProgress,
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
