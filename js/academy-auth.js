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
// Sign-in is a same-tab redirect: this page hands itself over to the Lab at /auth/start, the Lab
// does its thing, and /auth/callback sends the browser back to the exact page (and hash) it left,
// where the ordinary boot path picks the now-confirmed session up like any fresh page load — no
// popup, no window.opener, no polling needed for THIS tab. (An earlier version ran the handshake in
// a pop-up instead, to avoid navigating a learner away mid-lesson; it was replaced by request.)
//
// The callback page still writes a localStorage entry under AUTH_EVENT_KEY when it finishes, purely
// for the benefit of any OTHER open tab: that tab's own `storage` listener (see reconcileProgressOwner
// and the boot-time session refresh below) is what lets a sign-in completed in one tab update every
// other tab without each of them polling /auth/session on a timer. `MUST MATCH AUTH_EVENT_KEY in
// src/lib/server/auth.ts` below is about that shared channel, not anything popup-specific.
//
// Being signed in at the Lab does not sign you in here automatically — the provider has no silent-
// authentication mode and its `frame-ancestors 'none'` rules out the hidden-iframe trick. It costs
// one redirect round trip; with an existing grant it self-approves with nothing to type.
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
      if (owner && owner !== session.userId) {
        // Stash before wiping here too, exactly as the signed-out branch does. A DIRECT A→B switch
        // with no confirmed signed-out state in between is reachable — a sign-in relayed from
        // another tab by the storage listener, or a /auth/start deep link taken while this tab still
        // believes A is signed in — and without this, A's unrecorded passing exam is destroyed on
        // the spot. The entry is bound to A, so B can neither see nor claim it (that cross-learner
        // claim is the exact hole the wipe exists to close); it simply waits for A to come back.
        stashExamForOwner(owner);
        wipeLocalProgress();
      }
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

  /**
   * How many owners' stashes may be held at once. A shared browser is the whole reason this exists,
   * so a single slot was wrong: it made every stash a hostage to the next person to use the machine.
   */
  var EXAM_STASH_MAX = 4;

  /** Reads the stash as a list of `{owner, exam}`, tolerating the old single-object form. */
  function readExamStash() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(EXAM_STASH_KEY) || 'null'); } catch (e) { return []; }
    if (!raw) return [];
    // Migration: the first version of this stored one `{owner, exam}` object rather than a list. A
    // learner mid-upgrade must not silently lose the pass it was holding.
    var list = Array.isArray(raw) ? raw : [raw];
    return list.filter(function (entry) { return entry && entry.owner && entry.exam; });
  }

  function writeExamStash(list) {
    try {
      if (!list.length) localStorage.removeItem(EXAM_STASH_KEY);
      else localStorage.setItem(EXAM_STASH_KEY, JSON.stringify(list.slice(0, EXAM_STASH_MAX)));
    } catch (e) {}
  }

  /**
   * Moves a PASSING exam record aside before the wipe destroys it, keyed to the account that earned
   * it. Never overwrites another account's entry: on a shared machine, B signing out must not
   * destroy A's still-unclaimed pass — B's own entry goes alongside it, newest first.
   */
  function stashExamForOwner(owner) {
    var exam = null;
    try { exam = JSON.parse(localStorage.getItem('acad_exam') || 'null'); } catch (e) { return; }
    if (!exam || !exam.passed) return;
    var list = readExamStash().filter(function (entry) { return entry.owner !== owner; });
    list.unshift({ owner: owner, exam: exam });
    writeExamStash(list);
  }

  /**
   * Puts an account's stashed pass back when that same account signs in.
   *
   * The entry is CONSUMED ONLY WHEN IT IS ACTUALLY RESTORED, or when what is already stored is at
   * least as good. Deleting it unconditionally — the original shape — threw away the one artifact
   * this whole mechanism exists to protect: learner A's unrecorded passing sitting is stashed, then
   * anyone using the browser anonymously sits the exam and FAILS, which writes a worthless
   * `acad_exam`; A signs back in, the restore is skipped because a record exists, and the stash was
   * then deleted anyway. A's 50-question pass, gone, with nothing left to claim.
   *
   * So: restore unless what is already there is a pass too (an exam sat while signed in outranks a
   * stashed one, and re-passing makes the stash moot either way).
   */
  function restoreExamStash(userId) {
    var list = readExamStash();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].owner === userId) { idx = i; break; }
    }
    if (idx === -1) return;

    var current = null;
    try { current = JSON.parse(localStorage.getItem('acad_exam') || 'null'); } catch (e) { current = null; }
    if (current && current.passed) {
      // Already holding a pass — the stash has nothing left to add. Drop it.
      list.splice(idx, 1);
      writeExamStash(list);
      return;
    }
    try {
      localStorage.setItem('acad_exam', JSON.stringify(list[idx].exam));
    } catch (e) {
      return; // Storage refused the write — keep the stash rather than lose the record.
    }
    list.splice(idx, 1);
    writeExamStash(list);
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
    // A confirmed sign-in retires ANY sign-in overlay still on screen, including one this flow's own
    // timeout already replaced with a failure message. The popup handshake can legitimately land
    // after we stopped waiting (the learner finished at the Lab, the global AUTH_EVENT_KEY listener
    // picked it up), and leaving "sign-in didn't finish" over a page that is now signed in states
    // the opposite of the truth. Idempotent when nothing is open.
    if (confirmed && session && session.loggedIn) closeSignInOverlay();
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
        // SHAPE-CHECK BEFORE TREATING THIS AS THE SERVER'S ANSWER. `parseResponse` turns a 200 whose
        // body is empty or not JSON into `{}`, and `normalizeSession({})` is indistinguishable from a
        // genuine signed-out reply — which, marked confirmed, runs reconcileProgressOwner and WIPES
        // this browser's Academy progress while the session cookie is still perfectly valid. A
        // captive portal or corporate proxy answering 200 with an HTML interstitial is all it takes.
        // isApiAvailable() already refuses to trust /auth/session without exactly this check; the
        // path that can destroy data must not be laxer than the path that merely probes. An
        // unusable body is a network-shaped failure, so it keeps the cache like one.
        if (!data || typeof data.loggedIn !== 'boolean') {
          return loadCachedSession() || { loggedIn: false };
        }
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
        // The whole parsed body, not just its `error` code. Some rejections carry the only
        // information that makes them actionable — a 429 says WHICH limit was hit and when it
        // frees up — and dropping it here meant every caller could say no more than "something
        // went wrong", which for a rate limit is indistinguishable from a bug.
        err.data = data || {};
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
   * Sign-in (same-tab redirect to the Lab's OpenID Provider)
   * --------------------------------------------------------------------- */

  function currentReturnPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function startUrl(mode) {
    return '/auth/start?mode=' + mode + '&return=' + encodeURIComponent(currentReturnPath());
  }

  /** Hands the whole page over to the Lab. */
  function signInViaRedirect() {
    window.location.href = startUrl('redirect');
  }

  /**
   * Begins a sign-in: a same-tab redirect to the Lab, which redirects back to this exact page
   * (including hash) once it's done — initAcademy()'s ordinary boot path then picks the confirmed
   * session up and re-renders whatever needed it, the same way it does on any fresh page load.
   *
   * opts.reason optional sentence explaining why sign-in is being asked for; shown only if
   *             isApiAvailable() says accounts don't exist on this host and there is nowhere to
   *             redirect to.
   */
  function signIn(opts) {
    opts = opts || {};
    isApiAvailable().then(function (available) {
      if (!available) {
        showSignInOverlay({ reason: opts.reason, unavailable: true });
        return;
      }
      signInViaRedirect();
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
  /**
   * Resolves with `{attempts:[...], limits:{...}}` — NOT a bare array.
   *
   * The limits ride along because they cannot be derived from the list: the per-network half of the
   * exam allowance is counted across accounts, so a learner's own history says nothing about whether
   * their connection has any attempts left. See the route in src/lib/server/api.ts.
   */
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
    if (e.key === 'Escape') { closeSignInOverlay(); return; }
    if (e.key === 'Tab') {
      var order = overlayFocusables();
      if (!order.length) return;
      var idx = order.indexOf(document.activeElement);
      e.preventDefault();
      var step = e.shiftKey ? -1 : 1;
      order[(idx + step + order.length) % order.length].focus();
    }
  }

  /**
   * A date-and-time a learner can act on, in THEIR timezone.
   *
   * Everything the API returns is ISO-8601 UTC, which is right on the wire and useless on screen —
   * "2026-08-01T04:12:07.881Z" does not answer "when can I retake this?" for someone in Chennai.
   * Falls back to a plainly-labelled UTC string if the browser has no Intl support rather than
   * printing an unlabelled time in the wrong zone.
   */
  function formatDateTime(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    try {
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (e) {
      return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }
  }

  function describeApiError(err) {
    var code = err && err.code;

    // Rate limits get built rather than looked up: the useful sentence depends on WHICH limit was
    // hit and when it lifts, both of which ride on the error body. A learner sharing an office or
    // campus connection can be refused for attempts they did not make, and "too many attempts" tells
    // them their own account is at fault — which is both wrong and unfixable from their side.
    if (code === 'rate_limited') {
      var d = (err && err.data) || {};
      var limit = typeof d.limit === 'number' ? d.limit : 3;
      var hours = typeof d.windowHours === 'number' ? d.windowHours : 24;
      var when = formatDateTime(d.nextAttemptAt);
      var tail = when ? ' The next attempt frees up at ' + when + '.' : '';
      if (d.scope === 'network') {
        return 'All ' + limit + ' final-exam attempts allowed from this internet connection in ' +
          hours + ' hours have been used. Attempts are counted per connection as well as per ' +
          'account, so this can happen on a shared or office network even if you have not used ' +
          'yours.' + tail;
      }
      if (d.scope === 'account') {
        return 'You have used all ' + limit + ' of your final-exam attempts for the last ' + hours +
          ' hours.' + tail;
      }
      return 'Too many attempts — please wait a bit and try again.' + tail;
    }

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
   * Renders the sign-in overlay explaining that accounts are not available on this host yet. Sign-in
   * itself is a same-tab redirect (see signIn()), which leaves the page before there is anything to
   * show an overlay for — this is the one state reachable without ever navigating away.
   */
  function showSignInOverlay(opts) {
    opts = opts || {};
    closeSignInOverlay();
    overlayTriggerFocus = overlayTriggerFocus || document.activeElement;

    var closeBtn = mk('button', { type: 'button', class: 'acad-auth-close', 'aria-label': 'Close' }, '×');
    var titleEl = mk('h2', { class: 'acad-auth-title', id: 'acadAuthOverlayTitle' }, 'Accounts aren’t available yet');

    var kids = [closeBtn, titleEl];
    if (opts.reason) kids.push(mk('p', { class: 'acad-auth-reason' }, opts.reason));
    kids.push(mk('p', { class: 'acad-auth-msg' },
      'Sign-in and certificates are still being rolled out on this address. Every lesson, lab, ' +
      'the Flow Explorer and Challenge mode work right now without an account.'));

    var card = mk('div', { class: 'acad-auth-card' }, kids);
    overlayEl = mk('div', {
      class: 'acad-auth-overlay', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'acadAuthOverlayTitle'
    }, [card]);
    overlayEl.addEventListener('mousedown', function (e) {
      if (e.target === overlayEl) closeSignInOverlay();
    });
    closeBtn.addEventListener('click', function () { closeSignInOverlay(); });
    document.addEventListener('keydown', overlayKeydown);
    document.body.appendChild(overlayEl);
    closeBtn.focus();
  }

  /* ---------------------------------------------------------------------
   * Navbar control — identical markup/behavior on all 11 pages
   * --------------------------------------------------------------------- */

  // { email, firstName } for the identity the navbar control currently shows — null when signed
  // out. Lets renderNavAuth avoid re-fetching the profile on every call (it runs on boot AND on
  // every academy-auth-changed event) while still refetching the moment the signed-in email changes.
  var navProfileCache = null;

  function renderNavAuth(session) {
    var nav = document.getElementById('acadAuthNav');
    if (!nav) return;
    var signInEl = document.getElementById('acadAuthSignIn');
    var accountBtn = document.getElementById('acadAuthAccountBtn');
    var emailLabel = document.getElementById('acadAuthEmailLabel');
    if (!signInEl || !accountBtn) return;
    if (session.loggedIn) {
      signInEl.hidden = true;
      accountBtn.hidden = false;
      var email = session.email || '';
      // The avatar is a fixed user icon (markup, not JS) — it represents "signed in", not
      // who. Only the label text distinguishes identities, and email renders immediately,
      // synchronously, so the control never shows nothing while the name fetch below is in
      // flight. Once the learner has set a certificate name, it's friendlier than an email
      // address, so it replaces this the moment it's known.
      if (emailLabel) emailLabel.textContent = email;

      if (navProfileCache && navProfileCache.email === email && navProfileCache.firstName) {
        if (emailLabel) emailLabel.textContent = navProfileCache.firstName;
      } else if (!navProfileCache || navProfileCache.email !== email) {
        navProfileCache = { email: email, firstName: null };
        getProfile().then(function (profile) {
          if (!profile || !profile.firstName) return;
          // The signed-in identity may have moved on while this was in flight (sign-out, a switch
          // to a different account) — a stale response must not paint someone else's name in.
          if (getSession().email !== email) return;
          navProfileCache = { email: email, firstName: profile.firstName };
          if (emailLabel) emailLabel.textContent = profile.firstName;
        }).catch(function () {});
      }
    } else {
      signInEl.hidden = false;
      accountBtn.hidden = true;
      navProfileCache = null;
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

  /**
   * The same doctrine as signOutFailed, for the action where it matters MORE.
   *
   * "Sign out everywhere" is what someone clicks after losing a laptop. Swallowing the failure —
   * the previous `.catch(function () {})` — meant the button appeared to do nothing at all: no
   * reload, no message, and every session on every device still live, while the learner reasonably
   * concluded the job was done. Single-device sign-out already shouts on failure; the fleet-wide one
   * must not be quieter than the thing it supersedes.
   */
  function signOutEverywhereFailed(err) {
    return authConfirm({
      title: 'Sign-out failed',
      message: 'The server could not be reached (' + describeApiError(err) + '), so you are STILL ' +
        'SIGNED IN — on this device and on every other one. Nothing was signed out. Check your ' +
        'connection and try again.',
      confirmLabel: 'Try again',
      cancelLabel: 'Not now'
    }).then(function (retry) {
      if (retry) {
        return signOutEverywhere()
          .then(function () { window.location.reload(); })
          .catch(signOutEverywhereFailed);
      }
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
      }).catch(signOutEverywhereFailed);
    });
  }

  /* ---------------------------------------------------------------------
   * academy.html-only: benefits info icon + #acadAccount panel.
   * Both no-op cleanly on every other page (the elements simply don't exist).
   * --------------------------------------------------------------------- */

  function wireBenefitsInfo() {
    var icon = document.getElementById('acadBenefitsInfo');
    if (!icon) return;
    // Bootstrap's own 'hover focus' trigger shows/hides this — no click needed to see it, and it
    // dismisses itself on mouseleave/blur, so there is nothing to wire for "close on click outside".
    // Content applies whether or not the visitor is signed in, so this no longer gates on session
    // state the way the old manual-toggle version did.
    if (window.bootstrap && window.bootstrap.Popover) {
      new window.bootstrap.Popover(icon, {
        trigger: 'hover focus',
        html: false,
        placement: 'bottom',
        title: 'Signing in is optional',
        content: 'Progress syncs across your devices. Certificates are saved permanently and independently verifiable at /verify. Sign-in is only required for the final exam & certificate — everything else stays fully free and public.'
      });
    }
    // A click is still a stronger action than a hover: for a signed-out visitor it starts sign-in
    // rather than just explaining it. Signed in, the hover popover already says everything, so a
    // click does nothing extra.
    icon.addEventListener('click', function () {
      if (!getSession().loggedIn) {
        signIn({ reason: 'Sign in to sync your progress across devices and save your certificate permanently.' });
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
          onclick: function () { signIn({}); }
        }, 'Sign in')
      ]));
      return;
    }

    host.appendChild(mk('p', { class: 'acad-lab-note' }, 'Loading your account…'));

    Promise.all([
      // A FAILED load must stay distinguishable from "no name set yet". Collapsing both to null —
      // the previous shape — meant a 500 or a dropped connection rendered the "Set the name you want
      // on your certificate" editor to a learner whose name is already locked, inviting them to type
      // a name that the server then refuses with 409. Nothing corrupts, but the panel states
      // something false about their account, which is the failure mode this repo keeps closing
      // everywhere else (see the /verify contract and signOutFailed).
      getProfile().catch(function (err) { return { loadFailed: true, error: err }; }),
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
      if (profile && profile.loadFailed) {
        // Say what happened and offer a retry, rather than guessing at the account's real state.
        profileBox.appendChild(mk('p', { class: 'acad-lab-note' },
          'Couldn’t load your profile (' + describeApiError(profile.error) + '), so your ' +
          'certificate name isn’t shown here. Nothing has changed on your account.'));
        profileBox.appendChild(mk('div', { class: 'acad-lab-row' }, [
          mk('button', {
            type: 'button', class: 'acad-lab-btn',
            onclick: function () { renderAccountPanel(); }
          }, 'Try again')
        ]));
      } else if (profile && profile.nameLocked && profile.firstName && profile.lastName) {
        profileBox.appendChild(mk('p', null, [
          'Certificate name: ',
          mk('strong', null, profile.firstName + ' ' + profile.lastName),
          // The separating space lives OUT here, not inside the badge's own text: `.acad-lab-badge`
          // is `display:inline-block`, which starts its own line box, so a leading space inside it
          // is trimmed as "start of line" whitespace and the badge renders jammed against the name.
          ' ',
          mk('span', { class: 'acad-lab-badge neutral' }, 'locked after first certificate')
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
              // Space lives here, not inside the badge — see the identical note by the other
              // acad-lab-badge usage above (`.acad-lab-badge` is inline-block and trims a leading
              // space in its own text as "start of line" whitespace).
              s.current ? ' ' : null,
              s.current ? mk('span', { class: 'acad-lab-badge info' }, 'this device') : null
            ])
          ]);
          if (!s.current) {
            row.appendChild(mk('button', {
              type: 'button', class: 'acad-lab-btn danger acad-auth-device-revoke',
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
          type: 'button', class: 'acad-lab-btn danger',
          onclick: function () {
            // Success reloads into the signed-out page; failure is loud (see signOutFailed) —
            // this tab is genuinely still signed in when the round trip fails, and reloading
            // into a signed-in page while claiming otherwise would be the worst of both.
            signOut().then(function () { window.location.reload(); }).catch(signOutFailed);
          }
        }, 'Sign out'),
        mk('button', {
          type: 'button', class: 'acad-lab-btn danger',
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
    describeApiError: describeApiError,
    formatDateTime: formatDateTime
  };
})();
