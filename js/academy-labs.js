/*!
 * IntegrAuth Academy — interactive labs (fully simulated, client-side only).
 * Loaded only by academy.html. No network calls; every flow is a simulation.
 */
(function () {
  'use strict';

  var REG = {};
  window.AcadLabs = {
    register: function (id, def) { REG[id] = def; }
  };

  /* ---------- DOM helpers ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null) return;
        if (typeof v === 'function' && k.indexOf('on') === 0) {
          node.addEventListener(k.slice(2), v);
        } else if (k === 'class') {
          node.className = v;
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }

  function button(label, kind, onClick) {
    return el('button', { type: 'button', class: 'acad-lab-btn' + (kind ? ' ' + kind : ''), onclick: onClick }, label);
  }

  function badge(text, kind) {
    return el('span', { class: 'acad-lab-badge ' + (kind || 'neutral') }, text);
  }

  function note(text) { return el('p', { class: 'acad-lab-note' }, text); }

  function panel(title, children) {
    var kids = [];
    if (title) kids.push(el('div', { class: 'acad-lab-panel-title' }, title));
    var p = el('div', { class: 'acad-lab-panel' }, kids);
    appendChildren(p, children);
    return p;
  }

  function row(children) { return el('div', { class: 'acad-lab-row' }, children); }
  function col(children) { return el('div', { class: 'acad-lab-col' }, children); }

  function field(labelText, inputEl) {
    return el('label', { class: 'acad-lab-field' }, [
      el('span', { class: 'acad-lab-field-label' }, labelText),
      inputEl
    ]);
  }

  function select(options, onChange) {
    var s = el('select', { class: 'acad-lab-input' }, options.map(function (o) {
      var opt = el('option', { value: o.value }, o.label);
      if (o.selected) opt.selected = true;
      return opt;
    }));
    if (onChange) s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  function input(attrs) {
    var a = { type: 'text' };
    Object.keys(attrs || {}).forEach(function (k) { a[k] = attrs[k]; });
    a.class = 'acad-lab-input' + (a.class ? ' ' + a.class : '');
    return el('input', a);
  }

  function chip(label, pressed, onToggle) {
    var c = el('button', {
      type: 'button',
      class: 'acad-lab-chip',
      'aria-pressed': pressed ? 'true' : 'false',
      onclick: function () {
        var now = c.getAttribute('aria-pressed') !== 'true';
        c.setAttribute('aria-pressed', now ? 'true' : 'false');
        if (onToggle) onToggle(now);
      }
    }, label);
    return c;
  }

  function stage(children) { return el('div', { class: 'acad-lab-stage' }, children); }

  /* ---------- fake-crypto helpers (simulation only, tamper-evident not secure) ---------- */

  function b64url(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
  }

  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'sim' + ('0000000' + h.toString(16)).slice(-8);
  }

  function fakeJwt(payload, key) {
    var p1 = b64url(JSON.stringify({ alg: 'HS256 (sim)', typ: 'JWT' }));
    var p2 = b64url(JSON.stringify(payload));
    return p1 + '.' + p2 + '.' + fnv(p1 + '.' + p2 + '.' + (key || 'idp-key'));
  }

  function verifyJwt(token, key) {
    var parts = String(token || '').split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' };
    if (parts[2] !== fnv(parts[0] + '.' + parts[1] + '.' + (key || 'idp-key'))) {
      return { ok: false, reason: 'signature mismatch' };
    }
    try { return { ok: true, payload: JSON.parse(b64urlDecode(parts[1])) }; }
    catch (e) { return { ok: false, reason: 'bad payload' }; }
  }

  function decodeJwt(token) {
    var parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    try {
      return { header: JSON.parse(b64urlDecode(parts[0])), payload: JSON.parse(b64urlDecode(parts[1])), sig: parts[2] };
    } catch (e) { return null; }
  }

  function tokenView(token) {
    var parts = String(token || '').split('.');
    var segs = ['seg-h', 'seg-p', 'seg-s'];
    var codeEl = el('code', { class: 'acad-lab-token' });
    parts.forEach(function (p, i) {
      if (i) codeEl.appendChild(el('span', { class: 'seg-dot' }, '.'));
      codeEl.appendChild(el('span', { class: segs[i] || 'seg-s' }, p));
    });
    return codeEl;
  }

  function jsonView(obj) {
    return el('pre', { class: 'acad-lab-json' }, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
  }

  function rand(n) {
    var bytes = new Uint8Array(Math.ceil((n || 8) / 2));
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, n || 8);
  }

  /* ---------- HTTP simulation card ---------- */

  var STATUS_TEXT = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 302: 'Found',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    409: 'Conflict', 428: 'Precondition Required', 429: 'Too Many Requests', 503: 'Service Unavailable'
  };

  function httpCard(opts) {
    var cls = opts.status < 300 ? 's2xx' : (opts.status < 400 ? 's3xx' : 's4xx');
    var kids = [
      el('div', { class: 'acad-lab-http-req' }, [
        el('span', { class: 'acad-lab-http-method' }, opts.method),
        ' ' + opts.path
      ])
    ];
    if (opts.reqBody != null) kids.push(jsonView(opts.reqBody));
    kids.push(el('div', { class: 'acad-lab-http-res' },
      '← ' + opts.status + ' ' + (opts.statusText || STATUS_TEXT[opts.status] || '')));
    if (opts.resBody != null) kids.push(jsonView(opts.resBody));
    if (opts.note) kids.push(note(opts.note));
    return el('div', { class: 'acad-lab-http ' + cls }, kids);
  }

  /* ---------- event log ---------- */

  function logPanel() {
    var list = el('div', { class: 'acad-lab-log', 'aria-live': 'polite' });
    var t0 = Date.now();
    return {
      root: list,
      add: function (kind, text) {
        var t = ((Date.now() - t0) / 1000).toFixed(1);
        list.insertBefore(
          el('div', { class: 'acad-lab-log-entry ' + (kind || 'info') }, [
            el('span', { class: 'acad-lab-log-time' }, 't+' + t + 's'),
            ' ' + text
          ]),
          list.firstChild
        );
      }
    };
  }

  /* ---------- meter ---------- */

  function meter(percent, kind) {
    var fill = el('div', { class: 'acad-lab-meter-fill ' + (kind || 'info'), style: 'width:' + percent + '%' });
    var root = el('div', { class: 'acad-lab-meter' }, fill);
    return {
      root: root,
      set: function (pct, k) {
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (k) fill.className = 'acad-lab-meter-fill ' + k;
      }
    };
  }

  function flash(elem) {
    elem.classList.remove('acad-lab-flash');
    void elem.offsetWidth;
    elem.classList.add('acad-lab-flash');
  }

  /* ---------- mount / lifecycle ---------- */

  function makeH(ctx) {
    return {
      el: el, button: button, badge: badge, note: note, panel: panel, row: row, col: col,
      field: field, select: select, input: input, chip: chip, stage: stage,
      fakeJwt: fakeJwt, verifyJwt: verifyJwt, decodeJwt: decodeJwt,
      tokenView: tokenView, jsonView: jsonView, rand: rand,
      httpCard: httpCard, logPanel: logPanel, meter: meter, flash: flash,
      interval: function (fn, ms) {
        var id = setInterval(fn, ms);
        ctx.cleanup.push(function () { clearInterval(id); });
        return id;
      },
      timeout: function (fn, ms) {
        var id = setTimeout(fn, ms);
        ctx.cleanup.push(function () { clearTimeout(id); });
        return id;
      },
      onCleanup: function (fn) { ctx.cleanup.push(fn); }
    };
  }

  function mount(host, def) {
    var ctx = { cleanup: [] };
    host.innerHTML = '';

    var body = el('div', { class: 'acad-lab-body' });
    var head = el('div', { class: 'acad-lab-head' }, [
      el('div', { class: 'acad-lab-head-text' }, [
        el('span', { class: 'acad-lab-pill' }, '🧪 Interactive lab · simulated'),
        el('h4', { class: 'acad-lab-title' }, def.title),
        def.blurb ? el('p', { class: 'acad-lab-blurb' }, def.blurb) : null
      ]),
      el('button', {
        type: 'button', class: 'acad-lab-reset', 'aria-label': 'Reset lab',
        onclick: function () {
          ctx.cleanup.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
          mount(host, def);
        }
      }, '↺ Reset')
    ]);

    host.appendChild(head);
    host.appendChild(body);
    try {
      def.render(body, makeH(ctx));
    } catch (e) {
      body.appendChild(note('This lab hit a snag — press Reset to try again.'));
    }
  }

  function initAcademyLabs() {
    document.querySelectorAll('.acad-lab[data-lab]').forEach(function (host) {
      var def = REG[host.getAttribute('data-lab')];
      if (def) mount(host, def);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAcademyLabs);
  } else {
    // Lab registrations in this bundle run after the framework — defer one tick.
    setTimeout(initAcademyLabs, 0);
  }
})();

/* lab-assurance | lesson: f2-proof */
AcadLabs.register('lab-assurance', {
  title: 'Spin the assurance dial',
  blurb: 'Toggle authentication factors and watch which APIs will let Maya in — and which demand step-up.',
  render: function (root, h) {
    var factors = { password: false, sms: false, totp: false, passkey: false, key: false };

    // NIST SP 800-63B: AAL3 = hardware-bound phishing-resistant authenticator (device-bound key);
    // AAL2 = two distinct factor types, OR one multi-factor cryptographic authenticator (a passkey);
    // AAL1 = a single factor; AAL0 = nothing proven yet.
    function aal() {
      if (factors.key) return 3;                 // device-bound security key: hardware, phishing-resistant
      if (factors.passkey) return 2;             // synced passkey is itself multi-factor + phishing-resistant
      var types = {};
      if (factors.password) types.know = 1;      // something you know
      if (factors.sms || factors.totp) types.have = 1; // something you have
      if (Object.keys(types).length >= 2) return 2;
      if (factors.password || factors.sms || factors.totp) return 1;
      return 0;
    }
    function phishResistant() { return factors.passkey || factors.key; }

    var out = h.stage([]);
    var meter = h.meter(0, 'bad');
    var badgeBox = h.el('div', { class: 'acad-lab-row' });
    var log = h.logPanel();

    function refresh() {
      var a = aal();
      var pct = [0, 33, 66, 100][a];
      var kind = ['bad', 'warn', 'info', 'ok'][a];
      meter.set(pct, kind);
      badgeBox.innerHTML = '';
      badgeBox.appendChild(h.badge(a === 0 ? 'AAL0 · nothing proven' : 'AAL' + a, kind === 'bad' ? 'bad' : (a >= 2 ? 'ok' : 'warn')));
      badgeBox.appendChild(h.badge(phishResistant() ? '🛡️ phishing-resistant' : '🎣 phishable', phishResistant() ? 'ok' : 'warn'));
      if (factors.sms) badgeBox.appendChild(h.badge('SMS OTP = SIM-swappable, fallback only', 'warn'));
    }

    var chips = [
      ['🧠 Password (know)', 'password'],
      ['📩 SMS OTP (have)', 'sms'],
      ['📟 Authenticator TOTP (have)', 'totp'],
      ['🔑 Synced passkey (WebAuthn)', 'passkey'],
      ['🔐 Device-bound security key', 'key']
    ].map(function (c) {
      return h.chip(c[0], false, function (on) { factors[c[1]] = on; refresh(); });
    });

    function call(need, method, path, reqBody, okStatus, okBody) {
      out.innerHTML = '';
      var a = aal();
      if (a >= need) {
        out.appendChild(h.httpCard({
          method: method, path: path, reqBody: reqBody, status: okStatus, resBody: okBody,
          note: 'Presented acr="aal' + a + '"; endpoint required aal' + need + '. ✅'
        }));
        log.add('ok', method + ' ' + path + ' → ' + okStatus + ' (aal' + a + ' ≥ aal' + need + ')');
      } else {
        out.appendChild(h.httpCard({
          method: method, path: path, reqBody: reqBody, status: 401,
          resBody: { error: 'insufficient_user_authentication' },
          note: 'WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="aal' + need + '" — step up per RFC 9470.'
        }));
        log.add('bad', method + ' ' + path + ' → 401 needs aal' + need + ', have aal' + a);
      }
    }

    root.appendChild(h.row([
      h.col([
        h.panel('1 · Choose Maya\'s factors', chips.concat([h.note('Two of the SAME type (e.g. SMS + TOTP, both "have") stays AAL1 — you need two different kinds.')])),
        h.panel('Achieved assurance (NIST SP 800-63B)', [meter.root, badgeBox])
      ]),
      h.col([
        h.panel('2 · Try to open something', [
          h.button('GET /balance — read only (needs AAL1)', 'ghost', function () {
            call(1, 'GET', '/balance', null, 200, { account: 'maya-8271', balance: '$4,120.00' });
          }),
          h.button('POST /transfer — send $500 (needs AAL2)', 'primary', function () {
            call(2, 'POST', '/transfer', { to: 'sam', amount: 500, currency: 'USD' }, 200, { status: 'settled', ref: 'txn_' + h.rand(6) });
          }),
          h.button('POST /payout-account — change payout dest (needs AAL3)', 'danger', function () {
            call(3, 'POST', '/payout-account', { iban: 'XX' + h.rand(8) }, 200, { status: 'updated' });
          }),
          out
        ])
      ])
    ]));
    root.appendChild(h.panel('Event log', [log.root]));
    refresh();
    log.add('info', 'No factors selected yet — you are AAL0. Mash some chips.');
  }
});

/* lab-jwt | lesson: f3-tokens */
AcadLabs.register('lab-jwt', {
  title: 'Mint, read, tamper',
  blurb: 'Mint Maya an access token, read every claim (no key needed!), then tamper the payload and watch the seal break.',
  render: function (root, h) {
    var token = null;

    function b64url(s) {
      return btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function freshClaims() {
      var now = Math.floor(Date.now() / 1000);
      return {
        sub: 'maya-8271', iss: 'https://idp.example.com', aud: 'api.example.com',
        scope: 'read:balance', iat: now, exp: now + 900
      };
    }

    var tokenBox = h.el('div', {});
    var decodeBox = h.el('div', {});
    var verifyBox = h.el('div', { class: 'acad-lab-row' });
    var payloadTa = h.el('textarea', { class: 'acad-lab-input', rows: '8', spellcheck: 'false' });
    var apiOut = h.el('div', {});
    var log = h.logPanel();

    function render() {
      tokenBox.innerHTML = '';
      decodeBox.innerHTML = '';
      verifyBox.innerHTML = '';
      if (!token) { tokenBox.appendChild(h.note('No token yet — mint one.')); return; }
      tokenBox.appendChild(h.tokenView(token));
      var dec = h.decodeJwt(token);
      decodeBox.appendChild(h.jsonView(dec ? dec.payload : 'unreadable'));
      var v = h.verifyJwt(token);
      verifyBox.appendChild(h.badge(v.ok ? '✔ signature valid' : '✘ ' + v.reason, v.ok ? 'ok' : 'bad'));
      verifyBox.appendChild(h.badge('anyone can READ this — base64, not encryption', 'warn'));
    }

    function loadTextarea() {
      var dec = h.decodeJwt(token);
      payloadTa.value = dec ? JSON.stringify(dec.payload, null, 2) : '';
    }

    function mint() {
      token = h.fakeJwt(freshClaims());
      loadTextarea(); render(); h.flash(tokenBox);
      log.add('ok', 'IdP minted a fresh, correctly-signed access token for Maya.');
    }

    function tamper() {
      if (!token) return;
      var payload;
      try { payload = JSON.parse(payloadTa.value); }
      catch (e) { log.add('bad', 'Payload is not valid JSON — fix it first.'); return; }
      var parts = token.split('.');
      // Keep the OLD header + OLD signature; swap in the edited payload. The seal no longer matches.
      token = parts[0] + '.' + b64url(JSON.stringify(payload)) + '.' + parts[2];
      render(); h.flash(tokenBox);
      log.add('warn', 'You rewrote the payload but reused the old signature — the seal is now broken.');
    }

    function resign() {
      if (!token) return;
      var payload;
      try { payload = JSON.parse(payloadTa.value); } catch (e) { payload = freshClaims(); }
      token = h.fakeJwt(payload);
      render(); h.flash(tokenBox);
      log.add('info', 'Re-signed. Valid again — but a real IdP would NEVER sign claims Maya isn\'t entitled to.');
    }

    function callApi() {
      apiOut.innerHTML = '';
      if (!token) return;
      var v = h.verifyJwt(token);
      if (!v.ok) {
        apiOut.appendChild(h.httpCard({
          method: 'GET', path: '/balance', status: 401,
          resBody: { error: 'invalid_token', error_description: 'signature ' + v.reason },
          note: 'WWW-Authenticate: Bearer error="invalid_token" — the API recomputed the seal and it didn\'t match.'
        }));
        log.add('bad', 'GET /balance → 401 invalid_token (' + v.reason + ')');
        return;
      }
      if (String(v.payload.scope || '').split(' ').indexOf('read:balance') < 0) {
        apiOut.appendChild(h.httpCard({
          method: 'GET', path: '/balance', status: 403,
          resBody: { error: 'insufficient_scope', scope: 'read:balance' },
          note: 'Signature was fine, but the granted scope does not cover this endpoint.'
        }));
        log.add('warn', 'GET /balance → 403 insufficient_scope');
        return;
      }
      apiOut.appendChild(h.httpCard({
        method: 'GET', path: '/balance', status: 200, resBody: { account: 'maya-8271', balance: '$4,120.00' },
        note: 'Signature verified against the IdP key + scope covers it.'
      }));
      log.add('ok', 'GET /balance → 200 (valid signature, scope ok)');
    }

    root.appendChild(h.row([
      h.col([
        h.panel('1 · Get a token', [
          h.button('Mint access token for Maya', 'primary', mint),
          h.note('Edit the payload below — e.g. change "scope" to "admin" — then rebuild.'),
          h.field('Raw payload (editable JSON)', payloadTa),
          h.row([
            h.button('Rebuild with tampered payload', 'danger', tamper),
            h.button('Ask the IdP to re-sign', 'ghost', resign)
          ]),
          h.button('Call GET /balance with this token', '', callApi),
          apiOut
        ])
      ]),
      h.col([
        h.panel('The token', [tokenBox, verifyBox]),
        h.panel('Decoded payload (no key required)', [decodeBox])
      ])
    ]));
    root.appendChild(h.panel('Event log', [log.root]));
    render();
    log.add('info', 'A JWT is signed, not encrypted: header + payload are just base64 anyone can decode. Only the signature makes it trustworthy.');
  }
});

/* lab-lifecycle | lesson: f4-lifecycle */
AcadLabs.register('lab-lifecycle', {
  title: 'Run Priya through the revolving door',
  blurb: 'Joiner → Mover → Leaver. Watch her access track her real-world status — or leave a door wide open.',
  render: function (root, h) {
    var state = 'none';   // none | hired | moved | left
    var skip = false;     // "skip deprovisioning" mischief toggle
    var dept = null;      // department she actually holds: 'Support' | 'Finance'

    function role() { return dept === 'Finance' ? 'finance-ledger' : 'support-desk'; }

    var entBox = h.el('div', {});
    var statusBox = h.el('div', { class: 'acad-lab-row' });
    var apiOut = h.el('div', {});
    var log = h.logPanel();

    // Entitlements as a function of state (+ skip on leave).
    function ents() {
      if (state === 'none') return [];
      var alive = !(state === 'left' && !skip);
      var list = [
        { k: 'Directory account', on: alive },
        { k: 'Email mailbox', on: alive }
      ];
      if (state === 'hired') list.push({ k: 'support-desk role (Support)', on: true });
      if (state === 'moved') list.push({ k: 'finance-ledger role (Finance)', on: true });
      if (state === 'left') list.push({ k: role() + ' role (' + dept + ')', on: skip });
      return list;
    }

    function renderEnts() {
      entBox.innerHTML = '';
      var list = ents();
      if (!list.length) { entBox.appendChild(h.note('No accounts — Priya doesn\'t exist to us yet.')); return; }
      list.forEach(function (e) {
        entBox.appendChild(h.row([h.badge(e.on ? 'active' : 'disabled', e.on ? 'ok' : 'neutral'), e.k]));
      });
      statusBox.innerHTML = '';
      statusBox.appendChild(h.badge('Status: ' + state, state === 'left' ? 'neutral' : 'info'));
      if (state === 'left' && skip) statusBox.appendChild(h.badge('⚠️ ORPHANED ACCESS — attacker gold', 'bad'));
      if (state === 'left' && !skip) statusBox.appendChild(h.badge('🔒 fully deprovisioned same day', 'ok'));
    }

    // Auto-fire: "Priya calls GET /payroll/profile" after each transition.
    function probe() {
      apiOut.innerHTML = '';
      if (state === 'hired') {
        apiOut.appendChild(h.httpCard({ method: 'GET', path: '/payroll/profile', status: 200,
          resBody: { user: 'priya', department: 'Support', roles: ['support-desk'] },
          note: 'Day-one access via JIT provisioning (SCIM POST /scim/v2/Users → 201).' }));
      } else if (state === 'moved') {
        apiOut.appendChild(h.httpCard({ method: 'GET', path: '/payroll/profile', status: 200,
          resBody: { user: 'priya', department: 'Finance', roles: ['finance-ledger'] },
          note: 'Mover = REMOVE old access, not just add. support-desk is gone (SoD keeps the toxic combo apart).' }));
      } else if (state === 'left' && skip) {
        apiOut.appendChild(h.httpCard({ method: 'GET', path: '/payroll/profile', status: 200,
          resBody: { user: 'priya', department: dept, roles: [role()] },
          note: 'She left weeks ago — yet the token still works. This is the orphaned account every audit hunts for.' }));
      } else if (state === 'left') {
        apiOut.appendChild(h.httpCard({ method: 'GET', path: '/payroll/profile', status: 401,
          resBody: { error: 'invalid_token' },
          note: 'WWW-Authenticate: Bearer error="invalid_token" — sessions revoked, SSO disabled, account deactivated (SCIM active:false).' }));
      }
    }

    function go(next) {
      state = next;
      if (next === 'hired') dept = 'Support';
      if (next === 'moved') dept = 'Finance';
      renderEnts();
      probe();
      if (next === 'hired') log.add('ok', 'JOINER: Priya hired into Support. Provisioned birthright + support-desk role.');
      if (next === 'moved') log.add('warn', 'MOVER: Support → Finance. Granted finance-ledger, REVOKED support-desk.');
      if (next === 'left' && !skip) log.add('ok', 'LEAVER: sessions revoked, SSO off, account deactivated. All doors closed.');
      if (next === 'left' && skip) log.add('bad', 'LEAVER: deprovisioning SKIPPED — every entitlement left live. Orphaned access!');
      refreshButtons();
      h.flash(entBox);
    }

    var bHire = h.button('① Hire (into Support)', 'primary', function () { if (state === 'none') go('hired'); });
    var bMove = h.button('② Move (Support → Finance)', 'ghost', function () { if (state === 'hired') go('moved'); });
    var bLeave = h.button('③ Leave (offboard)', 'danger', function () { if (state === 'hired' || state === 'moved') go('left'); });
    function refreshButtons() {
      bHire.disabled = state !== 'none';
      bMove.disabled = state !== 'hired';
      bLeave.disabled = !(state === 'hired' || state === 'moved');
    }

    root.appendChild(h.row([
      h.col([
        h.panel('Drive the lifecycle', [
          bHire, bMove, bLeave,
          h.field('', h.chip('⚠️ Skip deprovisioning on Leave', false, function (on) {
            skip = on; if (state === 'left') { renderEnts(); probe(); }
            log.add(on ? 'warn' : 'info', 'Skip-deprovisioning ' + (on ? 'ON — Leavers keep their access.' : 'OFF — Leavers lose everything same day.'));
          })),
          h.note('Every stage should fire automatically from an authoritative HR event — not a support ticket.')
        ]),
        h.panel('Priya\'s accounts & entitlements', [statusBox, entBox])
      ]),
      h.col([
        h.panel('Priya calls GET /payroll/profile', [apiOut])
      ])
    ]));
    root.appendChild(h.panel('Event log', [log.root]));
    renderEnts();
    refreshButtons();
    apiOut.appendChild(h.note('Hire Priya to begin.'));
    log.add('info', 'JML: keep access exactly in step with someone\'s real-world status — automatically.');
  }
});

/* lab-zerotrust | lesson: f6-zerotrust */
AcadLabs.register('lab-zerotrust', {
  title: 'The context dials',
  blurb: 'Feed the policy engine device, location, network and action signals — and watch it re-decide allow / step-up / deny on every request.',
  render: function (root, h) {
    var sig = { device: 'managed', location: 'usual', network: 'corp', action: 'read' };

    // Additive risk model (toy numbers, tuned so edges are findable).
    var W = {
      device: { managed: [0, 'Managed, compliant device'], personal: [20, 'Personal (unmanaged) device'], unknown: [40, 'Unknown device — no health signal'] },
      location: { usual: [0, 'Usual city'], newcountry: [30, 'New country'], impossible: [50, 'Impossible travel (two places at once)'] },
      network: { corp: [0, 'Corporate network'], home: [10, 'Home network'], public: [25, 'Public Wi-Fi'] },
      action: { read: [0, 'Read dashboard (low sensitivity)'], export: [30, 'Export customer list (sensitive)'], mfaoff: [50, 'Disable MFA for a user (high privilege)'] }
    };

    var meter = h.meter(0, 'ok');
    var verdictBox = h.el('div', { class: 'acad-lab-row' });
    var reasonBox = h.el('div', {});
    var log = h.logPanel();

    function decide() {
      var score = 0, reasons = [];
      Object.keys(sig).forEach(function (dim) {
        var w = W[dim][sig[dim]];
        score += w[0];
        if (w[0] > 0) reasons.push('+' + w[0] + ' · ' + w[1]);
      });
      var verdict = score >= 90 ? 'deny' : (score >= 40 ? 'stepup' : 'allow');
      // Disabling MFA is high-privilege: never silently allow it.
      if (sig.action === 'mfaoff' && verdict === 'allow') { verdict = 'stepup'; reasons.push('rule · disabling MFA always demands stronger proof'); }
      return { score: score, verdict: verdict, reasons: reasons };
    }

    function render() {
      var r = decide();
      var kind = r.verdict === 'allow' ? 'ok' : (r.verdict === 'stepup' ? 'warn' : 'bad');
      meter.set(Math.min(100, r.score), kind);
      verdictBox.innerHTML = '';
      var label = { allow: '✅ ALLOW', stepup: '🔐 STEP-UP', deny: '⛔ DENY' }[r.verdict];
      verdictBox.appendChild(h.badge(label + ' · risk ' + r.score, kind));
      if (r.verdict === 'stepup') verdictBox.appendChild(h.badge('challenge for a phishing-resistant factor', 'info'));
      reasonBox.innerHTML = '';
      if (!r.reasons.length) reasonBox.appendChild(h.note('All signals nominal — nothing raised risk.'));
      r.reasons.forEach(function (t) { reasonBox.appendChild(h.note('• ' + t)); });
      h.flash(verdictBox);
    }

    function evaluate() {
      var r = decide();
      log.add(r.verdict === 'deny' ? 'bad' : (r.verdict === 'stepup' ? 'warn' : 'ok'),
        'POST /access-decision → ' + r.verdict + ' (risk ' + r.score + ')');
    }

    function picker(dim, label, opts) {
      return h.field(label, h.select(opts.map(function (o) {
        return { value: o[0], label: o[1], selected: sig[dim] === o[0] };
      }), function (v) { sig[dim] = v; render(); }));
    }

    root.appendChild(h.row([
      h.col([
        h.panel('Context signals (change any, any time)', [
          picker('device', 'Device', [['managed', 'Managed / compliant'], ['personal', 'Personal'], ['unknown', 'Unknown']]),
          picker('location', 'Location', [['usual', 'Usual city'], ['newcountry', 'New country'], ['impossible', 'Impossible travel']]),
          picker('network', 'Network', [['corp', 'Corporate'], ['home', 'Home'], ['public', 'Public Wi-Fi']]),
          picker('action', 'Requested action', [['read', 'Read dashboard'], ['export', 'Export customer list'], ['mfaoff', 'Disable MFA for a user']]),
          h.button('Send the request →', 'primary', evaluate),
          h.note('The verdict is recomputed on EVERY request — not once at login. Impossible travel alone tips even a read into step-up.')
        ])
      ]),
      h.col([
        h.panel('Policy engine verdict', [meter.root, verdictBox]),
        h.panel('Signals that fired', [reasonBox])
      ])
    ]));
    root.appendChild(h.panel('Event log', [log.root]));
    render();
    log.add('info', 'Zero trust: never trust, always verify. Every checkpoint keeps asking.');
  }
});

/* lab-passkey | lesson: a1-passkeys */
AcadLabs.register('lab-passkey', {
  title: 'Phish yourself (and fail)',
  blurb: 'Register a passkey at shop.example, sign in, then watch a look-alike phishing site walk away with nothing.',
  render: function (root, h) {
    var RP = 'shop.example';
    var EVIL = 'shop-example.evil';
    var cred = null; // {id, pub, priv}
    var log = h.logPanel();

    var privSlot = h.el('div');
    var devicePanel = h.panel('📱 Maya\'s device', [
      h.note('The private key is sealed behind Maya\'s fingerprint. It signs here and never crosses the wire.'),
      privSlot
    ]);

    var pubSlot = h.el('div');
    var rpPanel = h.panel('🏬 shop.example (relying party)', [
      h.note('The server keeps only the public key. Useless to a thief — you can\'t sign with it.'),
      pubSlot
    ]);

    var out = h.el('div');

    function renderKeys() {
      privSlot.innerHTML = '';
      pubSlot.innerHTML = '';
      if (!cred) {
        privSlot.appendChild(h.note('No passkey yet — press Register.'));
        pubSlot.appendChild(h.note('Nothing stored yet.'));
        return;
      }
      privSlot.appendChild(h.badge('🔒 private key · never leaves this device', 'bad'));
      privSlot.appendChild(h.jsonView({ rpId: RP, credId: cred.id, privateKey: cred.priv }));
      pubSlot.appendChild(h.badge('🔓 public key · safe to share', 'ok'));
      pubSlot.appendChild(h.jsonView({ rpId: RP, credId: cred.id, publicKey: cred.pub }));
    }

    function register() {
      cred = { id: 'cred_' + h.rand(10), pub: 'pk_' + h.rand(40), priv: 'sk_' + h.rand(40) };
      renderKeys();
      h.flash(devicePanel);
      out.innerHTML = '';
      out.appendChild(h.httpCard({
        method: 'POST', path: 'https://' + RP + '/webauthn/register',
        reqBody: { rpId: RP, credentialId: cred.id, publicKey: cred.pub },
        status: 201,
        resBody: { stored: 'publicKey', account: 'maya' },
        note: 'Only the public key travelled. The private key stayed sealed on the device.'
      }));
      log.add('ok', 'Registered a passkey for ' + RP + ' — the private half never left Maya\'s device.');
    }

    function signin() {
      if (!cred) { log.add('warn', 'Register a passkey first.'); return; }
      var origin = 'https://' + RP;
      var clientData = { type: 'webauthn.get', challenge: h.rand(24), origin: origin, rpId: RP };
      h.flash(devicePanel);
      out.innerHTML = '';
      out.appendChild(h.httpCard({
        method: 'POST', path: origin + '/webauthn/authenticate',
        reqBody: { credentialId: cred.id, clientDataJSON: clientData, signature: 'sig_' + h.rand(32) },
        status: 200,
        resBody: { verified: true, session: 'maya', amr: ['phr'] },
        note: 'Server verified the signature with the stored public key. The signature covers origin + rpId. amr: phr = phishing-resistant.'
      }));
      log.add('ok', 'Signed in at ' + RP + ' ✓ — device signed over {challenge, origin, rpId}.');
    }

    function phish() {
      if (!cred) { log.add('warn', 'Register a passkey first — then try to phish it.'); return; }
      out.innerHTML = '';
      out.appendChild(h.panel('🎣 ' + EVIL + ' (look-alike phishing page)', [
        h.note('The fake site loads a perfect copy and asks the browser to use your passkey…'),
        h.jsonView({
          origin: 'https://' + EVIL,
          browserCheck: 'credential is scoped to rpId "' + RP + '"',
          thisOrigin: EVIL,
          result: 'no passkey offered — rpId does not match'
        }),
        h.badge('🚫 phishing failed — nothing to hand over', 'ok')
      ]));
      log.add('bad', EVIL + ' asked for a passkey — browser refused: rpId mismatch (' + RP + ' ≠ ' + EVIL + ').');
      log.add('info', 'The fake site gets nothing — not even a wrong password to steal. 🎉 The origin is signed, so a relayed signature wouldn\'t verify either.');
    }

    renderKeys();
    root.appendChild(h.stage([
      h.row([devicePanel, rpPanel]),
      h.row([
        h.button('1 · Register at shop.example', 'primary', register),
        h.button('2 · Sign in at shop.example', '', signin),
        h.button('3 · Try the phish 🎣', 'danger', phish)
      ]),
      out
    ]));
    root.appendChild(log.root);
    log.add('info', 'A passkey is a key pair: Register creates it, Sign in proves it, and the phish can\'t touch it.');
  }
});

/* lab-totp | lesson: a2-mfa */
AcadLabs.register('lab-totp', {
  title: 'A real code generator',
  blurb: 'Enroll a secret, then watch genuine RFC 6238 TOTP codes tick over every 30 seconds — real HMAC-SHA1, no faking.',
  render: function (root, h) {
    var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    var secret = crypto.getRandomValues(new Uint8Array(20)); // 160-bit shared secret
    var currentCounter = 0, currentCode = '------';
    var log = h.logPanel();

    function base32(bytes) {
      var bits = 0, val = 0, out = '';
      for (var i = 0; i < bytes.length; i++) {
        val = (val << 8) | bytes[i]; bits += 8;
        while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
      }
      if (bits > 0) out += B32[(val << (5 - bits)) & 31];
      return out;
    }
    function counterBytes(counter) {
      var b = new Uint8Array(8);
      for (var i = 7; i >= 0; i--) { b[i] = counter & 0xff; counter = Math.floor(counter / 256); }
      return b;
    }
    function totp(counter) {
      return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
        .then(function (key) { return crypto.subtle.sign('HMAC', key, counterBytes(counter)); })
        .then(function (buf) {
          var s = new Uint8Array(buf);
          var offset = s[19] & 0x0f; // dynamic truncation: low nibble of last byte
          var bin = ((s[offset] & 0x7f) << 24) | ((s[offset + 1] & 0xff) << 16) |
                    ((s[offset + 2] & 0xff) << 8) | (s[offset + 3] & 0xff);
          return ('000000' + (bin % 1000000)).slice(-6);
        });
    }

    var codeEl = h.el('code', { class: 'acad-lab-token' }, '••• •••');
    var secsEl = h.el('span', {}, '30s');
    var countdown = h.meter(100, 'info');

    function tick() {
      var now = Math.floor(Date.now() / 1000);
      var counter = Math.floor(now / 30);
      var remaining = 30 - (now % 30);
      currentCounter = counter;
      secsEl.textContent = remaining + 's';
      countdown.set((remaining / 30) * 100, remaining <= 5 ? 'warn' : 'info');
      totp(counter).then(function (code) {
        currentCode = code;
        codeEl.textContent = code.slice(0, 3) + ' ' + code.slice(3);
      });
    }
    tick();
    h.interval(tick, 1000);

    var inp = h.input({ inputmode: 'numeric', maxlength: '7', placeholder: '6-digit code' });
    function verify() {
      var entered = (inp.value || '').replace(/\s+/g, '');
      if (!/^\d{6}$/.test(entered)) { log.add('warn', 'Enter the 6 digits shown above.'); return; }
      var c = currentCounter;
      Promise.all([totp(c), totp(c - 1), totp(c + 1)]).then(function (r) {
        if (entered === r[0]) {
          log.add('ok', 'Verified ✓ — matched the current 30-second step.');
        } else if (entered === r[1] || entered === r[2]) {
          log.add('ok', 'Verified ✓ — matched the ' + (entered === r[1] ? 'previous' : 'next') +
            ' step. The ±1 window absorbed clock drift between phone and server.');
        } else {
          log.add('bad', 'Rejected ✗ — that code doesn\'t match this step or its ±1 neighbours (invalid or expired).');
        }
      });
    }

    root.appendChild(h.stage([
      h.row([
        h.panel('🔐 Shared secret (enrolled once)', [
          h.note('Server and phone both learn this secret at enrollment — often via QR. After that, nothing is transmitted; each side computes the code independently.'),
          h.jsonView({ base32: base32(secret).replace(/.{4}/g, '$& ').trim(), algorithm: 'SHA-1', digits: 6, period: 30 })
        ]),
        h.panel('📟 Current code', [
          codeEl,
          h.row([h.badge('changes every 30s', 'info'), secsEl]),
          countdown.root,
          h.note('code = HMAC-SHA1(secret, floor(unixtime / 30)) → dynamic truncation → 6 digits.')
        ])
      ]),
      h.field('Type the code to verify', inp),
      h.button('Verify', 'primary', verify)
    ]));
    root.appendChild(log.root);
    log.add('info', 'These are real TOTP codes computed in your browser with WebCrypto HMAC-SHA1. Type the current one before it rolls over.');
  }
});

/* lab-breach | lesson: a6-breached */
AcadLabs.register('lab-breach', {
  title: 'Check a password without revealing it',
  blurb: 'Compute a real SHA-1 hash, send only 5 hex characters to the range API, and match the rest at home — k-anonymity in action.',
  render: function (root, h) {
    var log = h.logPanel();
    var SEEDS = [
      { pw: 'password123', count: 251682 },
      { pw: 'hunter2', count: 19842 },
      { pw: 'Summer2026!', count: 4123 },
      { pw: 'letmein', count: 176802 },
      { pw: 'qwerty', count: 393928 }
    ];

    function sha1hex(str) {
      return crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('').toUpperCase();
      });
    }

    var corpus = {}; // fullHash -> count
    var corpusReady = Promise.all(SEEDS.map(function (s) {
      return sha1hex(s.pw).then(function (hh) { corpus[hh] = s.count; });
    }));

    var inp = h.input({ type: 'text', placeholder: 'demo only — do NOT type a real password' });
    var out = h.el('div');

    function check() {
      var pw = inp.value || '';
      if (!pw) { log.add('warn', 'Type a (fake!) password to check.'); return; }
      corpusReady.then(function () { return sha1hex(pw); }).then(function (hash) {
        var prefix = hash.slice(0, 5);
        var suffix = hash.slice(5); // 35 chars kept local
        var list = [];
        var hit = null;
        Object.keys(corpus).forEach(function (hh) {
          if (hh.slice(0, 5) === prefix) {
            var e = { suffix: hh.slice(5), count: corpus[hh] };
            list.push(e);
            if (e.suffix === suffix) hit = e;
          }
        });
        for (var i = 0; i < 4; i++) {
          list.push({ suffix: h.rand(35).toUpperCase(), count: Math.floor(Math.random() * 9000) + 11 });
        }

        out.innerHTML = '';
        out.appendChild(h.panel('1 · Hash locally', [
          h.jsonView({ sha1: hash, sentToApi: prefix + ' (first 5 hex chars only)', keptLocal: suffix }),
          h.note('The full password and even the full hash never leave the device.')
        ]));
        out.appendChild(h.httpCard({
          method: 'GET', path: 'https://api.example.com/range/' + prefix,
          status: 200,
          resBody: { suffixes: list },
          note: 'The service only ever sees 5 hex chars — it returns every suffix sharing that prefix (hundreds in reality) and learns nothing about which one is yours. That is k-anonymity.'
        }));

        var verdict, advice;
        if (hit) {
          verdict = h.badge('⚠ Breached — block & force reset', 'bad');
          advice = h.note('Found in public breach dumps (~' + hit.count.toLocaleString() +
            ' times). Block the sign-in, route to a guided reset, and rotate it anywhere it was reused.');
          log.add('bad', 'Match found locally — this password is breached (~' + hit.count.toLocaleString() + ' occurrences).');
        } else {
          verdict = h.badge('No match in corpus', 'neutral');
          advice = h.note('Not in this corpus — but "not breached" is not "strong". Still enforce length and entropy. The strongest answer is no shared secret to leak at all: passkeys.');
          log.add('info', 'No local match — password not in the demo breach corpus.');
        }
        out.appendChild(h.panel('2 · Match at home', [verdict, advice]));
        h.flash(out);
      });
    }

    root.appendChild(h.stage([
      h.note('Built-in demo corpus: password123, hunter2, Summer2026!, letmein, qwerty. Try one for a hit, anything else for a miss.'),
      h.field('Password to check', inp),
      h.button('Check breach corpus', 'primary', check),
      out
    ]));
    root.appendChild(log.root);
    log.add('info', 'k-anonymity: hash with SHA-1, send 5 hex chars, compare the rest locally. The API never learns the password or its full hash.');
  }
});

/* lab-rotation | lesson: t1-rotation */
AcadLabs.register('lab-rotation', {
  title: 'Burn the token family',
  blurb: "Rotate Maya's refresh token, then play the attacker and replay a stale one to watch the whole family die.",
  render: function (root, h) {
    // Each family member: { id, status: 'active' | 'stale' | 'revoked' }
    var family = [];
    var appHolds = null;      // id of the RT Maya's app currently holds
    var attackerHolds = null; // id the attacker snapshotted (or null)
    var revoked = false;
    var seq = 0;

    var log = h.logPanel();
    var familyBox = h.el('div', { class: 'acad-lab-col' });
    var appOut = h.el('div', {});
    var atkOut = h.el('div', {});

    function mint() {
      seq += 1;
      var id = 'RT-' + seq;
      family.forEach(function (t) { if (t.status === 'active') t.status = 'stale'; });
      family.push({ id: id, status: 'active' });
      return id;
    }

    function statusOf(id) {
      var t = family.filter(function (x) { return x.id === id; })[0];
      return t ? t.status : 'revoked';
    }

    function burnFamily() {
      revoked = true;
      family.forEach(function (t) { t.status = 'revoked'; });
    }

    function renderFamily() {
      familyBox.innerHTML = '';
      familyBox.appendChild(h.el('div', { class: 'acad-lab-panel-title' }, 'Refresh-token family (IdP view)'));
      family.forEach(function (t) {
        var kind = t.status === 'active' ? 'ok' : (t.status === 'stale' ? 'warn' : 'bad');
        var label = t.status === 'active'
          ? h.el('code', { class: 'acad-lab-token' }, t.id)
          : h.el('del', {}, h.el('code', { class: 'acad-lab-token' }, t.id));
        familyBox.appendChild(h.row([label, h.badge(t.status, kind)]));
      });
      appOut.textContent = '';
      appOut.appendChild(h.note('Maya’s app holds: ' + (appHolds || '—')));
      atkOut.textContent = '';
      atkOut.appendChild(h.note('Attacker’s stolen copy: ' + (attackerHolds || '— (nothing yet)')));
    }

    function refresh() {
      if (revoked) {
        log.add('bad', 'App refresh rejected — family already burned.');
        appOut.appendChild(h.httpCard({ method: 'POST', path: '/token', reqBody: { grant_type: 'refresh_token', refresh_token: appHolds },
          status: 400, resBody: { error: 'invalid_grant' }, note: 'Family revoked. Maya must sign in again.' }));
        return;
      }
      var presented = statusOf(appHolds);
      if (presented === 'stale') {
        burnFamily();
        log.add('bad', 'REUSE DETECTED (app presented stale ' + appHolds + ') — whole family revoked.');
        appOut.appendChild(h.httpCard({ method: 'POST', path: '/token', reqBody: { grant_type: 'refresh_token', refresh_token: appHolds },
          status: 400, resBody: { error: 'invalid_grant' }, note: 'That token was already rotated — the attacker used the fresh one. Every token in the family is now dead.' }));
        renderFamily(); h.flash(familyBox); return;
      }
      var newRt = mint();
      appHolds = newRt;
      log.add('ok', 'App rotated ' + presented + ' → ' + newRt + ' + fresh access token.');
      appOut.appendChild(h.httpCard({ method: 'POST', path: '/token', reqBody: { grant_type: 'refresh_token' },
        status: 200, resBody: { access_token: 'at_' + h.rand(6), refresh_token: newRt, token_type: 'Bearer', expires_in: 300 },
        note: 'Old token invalidated; ' + newRt + ' is now the only live refresh token.' }));
      renderFamily(); h.flash(familyBox);
    }

    function steal() {
      if (!appHolds) { log.add('warn', 'Nothing to steal yet — make the app refresh first.'); return; }
      attackerHolds = appHolds;
      log.add('warn', 'Malware copied ' + attackerHolds + ' from Maya’s device. Silent so far.');
      renderFamily();
    }

    function replay() {
      if (!attackerHolds) { log.add('warn', 'Attacker has no token — steal one first.'); return; }
      if (revoked) {
        log.add('bad', 'Replay rejected — family already burned.');
        atkOut.appendChild(h.httpCard({ method: 'POST', path: '/token', reqBody: { grant_type: 'refresh_token', refresh_token: attackerHolds },
          status: 400, resBody: { error: 'invalid_grant' }, note: 'Attacker locked out for good.' }));
        return;
      }
      var st = statusOf(attackerHolds);
      if (st === 'active') {
        var newRt = mint();
        attackerHolds = newRt; // attacker got the fresh token; app still holds the now-stale one
        log.add('warn', '😈 Attacker replayed live ' + statusOf(attackerHolds) + ' token and won — 200 OK, silently. Now watch Maya refresh.');
        atkOut.appendChild(h.httpCard({ method: 'POST', path: '/token', reqBody: { grant_type: 'refresh_token', refresh_token: family[family.length - 2].id },
          status: 200, resBody: { access_token: 'at_' + h.rand(6), refresh_token: newRt, token_type: 'Bearer' },
          note: 'Scary case: the theft succeeded quietly. But the app still holds a token the IdP just rotated away — its next Refresh will trip the alarm.' }));
      } else {
        burnFamily();
        log.add('bad', 'REUSE DETECTED (attacker replayed stale ' + attackerHolds + ') — whole family revoked.');
        atkOut.appendChild(h.httpCard({ method: 'POST', path: '/token', reqBody: { grant_type: 'refresh_token', refresh_token: attackerHolds },
          status: 400, resBody: { error: 'invalid_grant' }, note: 'The stolen token was already spent by Maya’s app. Reuse → family burned. Both sides logged out.' }));
      }
      renderFamily(); h.flash(familyBox);
    }

    // initial login
    appHolds = mint();
    log.add('info', 'Maya signed in. First refresh token: ' + appHolds + '.');

    root.appendChild(h.stage([familyBox]));
    root.appendChild(h.row([
      h.col([h.panel('Maya’s app', [h.button('Refresh (rotate token)', 'primary', refresh), appOut])]),
      h.col([h.panel('Attacker', [
        h.row([h.button('Steal current token', 'danger', steal), h.button('Replay stolen token', 'danger', replay)]),
        atkOut
      ])])
    ]));
    root.appendChild(h.note('Try both orders: replay the stolen token BEFORE Maya refreshes (attacker wins, then Maya’s next refresh trips it), or AFTER she refreshes (the stolen copy is already stale — instant burn). Reuse in either direction kills the whole family.'));
    root.appendChild(log.root);
    renderFamily();
  }
});

/* lab-revoke | lesson: t2-stolen1 */
AcadLabs.register('lab-revoke', {
  title: 'Kill it before it expires',
  blurb: 'Mint a 60-second access token, then race a revocation against the clock while the API introspects every call.',
  render: function (root, h) {
    var TTL = 60; // seconds
    var token = null, iat = 0, exp = 0, revoked = false;

    var log = h.logPanel();
    var tokenBox = h.el('div', { class: 'acad-lab-col' });
    var ttlLabel = h.note('No token yet.');
    var m = h.meter(0, 'info');
    var callOut = h.el('div', {});
    var tick = null;

    function now() { return Math.floor(Date.now() / 1000); }
    function active() { return !!token && !revoked && now() < exp; }

    function renderToken() {
      tokenBox.innerHTML = '';
      tokenBox.appendChild(h.el('div', { class: 'acad-lab-panel-title' }, 'Access token (JWT)'));
      if (!token) { tokenBox.appendChild(h.note('Mint one to begin.')); return; }
      tokenBox.appendChild(h.tokenView(token));
      tokenBox.appendChild(h.jsonView(h.decodeJwt(token).payload));
    }

    function updateTtl() {
      var left = exp - now();
      if (left <= 0) {
        m.set(0, 'bad');
        ttlLabel.textContent = 'Token expired (exp reached). The API will now refuse it.';
        if (tick) { clearInterval(tick); tick = null; log.add('bad', 'exp reached — token expired on its own.'); }
        return;
      }
      var pct = Math.round((left / TTL) * 100);
      m.set(pct, pct > 50 ? 'ok' : (pct > 20 ? 'warn' : 'bad'));
      ttlLabel.textContent = 'Time-to-live: ' + left + 's until exp' + (revoked ? ' — but already revoked server-side.' : '.');
    }

    function mint() {
      iat = now(); exp = iat + TTL; revoked = false;
      token = h.fakeJwt({ iss: 'the IdP', sub: 'maya', aud: 'api.example.com', scope: 'read:account', iat: iat, exp: exp });
      log.add('ok', 'Minted access token for Maya, valid ' + TTL + 's.');
      renderToken(); callOut.innerHTML = '';
      if (tick) clearInterval(tick);
      tick = h.interval(updateTtl, 1000); updateTtl();
    }

    function callAccount() {
      if (!token) { log.add('warn', 'Mint a token first.'); return; }
      var sigOk = h.verifyJwt(token).ok; // always true — revocation never touches the sig
      var wwwAuth = 'Bearer error="invalid_token"';
      if (active()) {
        log.add('ok', 'GET /account → 200. Token valid and session live.');
        callOut.appendChild(h.httpCard({ method: 'GET', path: '/account', status: 200,
          resBody: { sub: 'maya', tier: 'gold', balance: '$4,210.00' },
          note: 'Signature ok AND introspection says active:true → served.' }));
        return;
      }
      var expired = now() >= exp;
      log.add('bad', 'GET /account → 401 invalid_token (' + (expired ? 'expired' : 'revoked') + ').');
      callOut.appendChild(h.httpCard({ method: 'GET', path: '/account', status: 401,
        statusText: 'Unauthorized', resBody: { error: 'invalid_token' },
        note: 'WWW-Authenticate: ' + wwwAuth + ' — ' + (expired
          ? 'now ≥ exp, so the self-contained token lapsed on its own.'
          : 'signature still verifies (sig=' + (sigOk ? 'ok' : 'bad') + ') — revocation is a server-side lookup, NOT a signature change. High-value APIs introspect (or use short TTLs) exactly for this.') }));
    }

    function revoke() {
      if (!token) { log.add('warn', 'Nothing to revoke — mint a token first.'); return; }
      revoked = true;
      log.add('warn', 'Zara flipped the session: introspection now returns active:false.');
      callOut.appendChild(h.httpCard({ method: 'POST', path: '/revoke', reqBody: { token: 'at_maya', token_type_hint: 'access_token' },
        status: 200, resBody: { revoked: true, active: false },
        note: 'The JWT bytes are unchanged and still verify — but the server-side session/introspection record now says active:false. Next API call fails the lookup.' }));
      updateTtl(); h.flash(callOut);
    }

    root.appendChild(h.stage([tokenBox, h.field('TTL countdown', m.root), ttlLabel]));
    root.appendChild(h.row([
      h.col([h.panel('Maya’s app', [
        h.button('Mint access token', 'primary', mint),
        h.button('Call GET /account', '', callAccount)
      ])]),
      h.col([h.panel('Zara (security operator)', [
        h.button('Revoke the session', 'danger', revoke),
        h.note('Then call /account again — or just let the 60s run out. Either way it’s a 401.')
      ])])
    ]));
    root.appendChild(h.note('A self-contained JWT can’t be “un-issued”. Revocation works by making the API check a server-side record (introspection / revocation marker) on every call — the signature never changes, so waiting for exp and getting revoked both surface as 401 invalid_token.'));
    root.appendChild(callOut);
    root.appendChild(log.root);
    renderToken();
  }
});

/* lab-dpop | lesson: t3-stolen2 */
AcadLabs.register('lab-dpop', {
  title: 'Steal the token, miss the key',
  blurb: 'Flip between a bearer token and a DPoP sender-constrained token, then let the attacker replay a stolen copy.',
  render: function (root, h) {
    var mode = 'dpop';
    var token = null, stolen = false;
    // A keypair = { priv (secret used to sign proofs), jkt (public thumbprint) }.
    var maya = { priv: 'maya-priv-' + h.rand(6), jkt: 'jkt_' + h.rand(10) };
    var atk = { priv: 'atk-priv-' + h.rand(6), jkt: 'jkt_' + h.rand(10) };

    var log = h.logPanel();
    var tokenBox = h.el('div', { class: 'acad-lab-col' });
    var appBadge = h.el('span', {});
    var atkBadge = h.el('span', {});
    var appOut = h.el('div', {});
    var atkOut = h.el('div', {});

    function renderToken() {
      tokenBox.innerHTML = '';
      tokenBox.appendChild(h.el('div', { class: 'acad-lab-panel-title' },
        mode === 'dpop' ? 'DPoP access token (sender-constrained)' : 'Bearer access token'));
      if (!token) { tokenBox.appendChild(h.note('Mint a token to begin.')); return; }
      tokenBox.appendChild(h.tokenView(token));
      tokenBox.appendChild(h.jsonView(h.decodeJwt(token).payload));
    }

    function mint() {
      var payload = { iss: 'the IdP', sub: 'maya', aud: 'api.example.com', scope: 'read:account' };
      if (mode === 'dpop') payload.cnf = { jkt: maya.jkt }; // binds token to Maya's key thumbprint
      token = h.fakeJwt(payload);
      stolen = false;
      log.add('ok', 'Minted a ' + (mode === 'dpop' ? 'DPoP' : 'bearer') + ' token'
        + (mode === 'dpop' ? ' bound to cnf.jkt=' + maya.jkt : '') + '.');
      appBadge.textContent = ''; atkBadge.textContent = '';
      appOut.innerHTML = ''; atkOut.innerHTML = '';
      renderToken();
    }

    function makeProof(kp) {
      return h.fakeJwt({ htm: 'GET', htu: 'https://api.example.com/account', jti: h.rand(12), jkt: kp.jkt }, kp.priv);
    }

    // who: 'app' uses Maya's key; 'atk' uses the attacker's key.
    function call(kp, who, out, setBadge) {
      if (!token) { log.add('warn', 'Mint a token first.'); return; }
      if (mode === 'bearer') {
        setBadge(h.badge('200 OK — served', 'ok'));
        log.add(who === 'atk' ? 'bad' : 'ok', (who === 'atk' ? '😈 Attacker' : 'App') + ' called with the bearer token → 200. Whoever holds it, spends it.');
        out.innerHTML = '';
        out.appendChild(h.httpCard({ method: 'GET', path: '/account', status: 200,
          reqBody: null, resBody: { sub: 'maya', balance: '$4,210.00' },
          note: 'Bearer = cash. No key check. A stolen copy works exactly as well as the original.' }));
        return;
      }
      // DPoP mode: proof required, key must match cnf.jkt
      var proof = makeProof(kp);
      var tokenJkt = (h.decodeJwt(token).payload.cnf || {}).jkt;
      var proofJkt = h.decodeJwt(proof).payload.jkt;
      out.innerHTML = '';
      if (proofJkt === tokenJkt) {
        setBadge(h.badge('200 OK — proof valid', 'ok'));
        log.add('ok', 'App signed a fresh DPoP proof; thumbprint matches cnf.jkt → 200.');
        out.appendChild(h.httpCard({ method: 'GET', path: '/account', status: 200,
          resBody: { sub: 'maya', balance: '$4,210.00' },
          note: 'DPoP: ' + proof.slice(0, 28) + '…  — proof key thumbprint == cnf.jkt, htm/htu bound, fresh jti (no replay). Served.' }));
      } else {
        setBadge(h.badge('401 invalid_dpop_proof', 'bad'));
        log.add('bad', '😈 Attacker has the token but not Maya’s private key. Their proof’s thumbprint ≠ cnf.jkt → refused.');
        out.appendChild(h.httpCard({ method: 'GET', path: '/account', status: 401,
          resBody: { error: 'invalid_dpop_proof' },
          note: 'WWW-Authenticate: DPoP error="invalid_dpop_proof". token_type is DPoP. Proof jkt=' + proofJkt
            + ' ≠ token cnf.jkt=' + tokenJkt + '. The stolen token is a dead number without the key.' }));
      }
    }

    function steal() {
      if (!token) { log.add('warn', 'Mint a token first.'); return; }
      stolen = true;
      log.add('warn', 'Attacker exfiltrated the access token (from logs / XSS). They can read it — can they use it?');
      atkBadge.textContent = '';
    }

    root.appendChild(h.stage([tokenBox]));
    root.appendChild(h.field('Token type', h.select([
      { value: 'dpop', label: 'DPoP — sender-constrained (RFC 9449)', selected: true },
      { value: 'bearer', label: 'Bearer — anyone who holds it' }
    ], function (v) { mode = v; token = null; renderToken(); appBadge.textContent = ''; atkBadge.textContent = ''; appOut.innerHTML = ''; atkOut.innerHTML = ''; })));
    root.appendChild(h.button('Mint token', 'primary', mint));
    root.appendChild(h.row([
      h.col([h.panel('Maya’s app (holds the key)', [
        h.button('Call GET /account', '', function () { call(maya, 'app', appOut, function (b) { appBadge.innerHTML = ''; appBadge.appendChild(b); }); }),
        h.row([appBadge]), appOut
      ])]),
      h.col([h.panel('Attacker (stole the token)', [
        h.row([h.button('Steal token', 'danger', steal), h.button('Replay token', 'danger', function () {
          if (!stolen) { log.add('warn', 'Steal the token first.'); return; }
          call(atk, 'atk', atkOut, function (b) { atkBadge.innerHTML = ''; atkBadge.appendChild(b); });
        })]),
        h.row([atkBadge]), atkOut
      ])])
    ]));
    root.appendChild(h.note('mTLS (RFC 8705) is the same idea with a TLS client certificate instead of a browser key — the token binds to cnf.x5t#S256 and the API reads the verified cert from the TLS layer. Encryption (JWE) is different: it hides the token’s contents, but doesn’t stop a thief using it. DPoP/mTLS fix possession; JWE fixes confidentiality.'));
    root.appendChild(log.root);
    renderToken();
  }
});

/* lab-claims | lesson: t5-claims */
AcadLabs.register('lab-claims', {
  title: 'Build a token the API will believe',
  blurb: 'Compose scopes, amr factors and a delegation act claim, then watch three API gates decide from the signed claims.',
  render: function (root, h) {
    var cfg = {
      scopes: { 'read:balance': true, 'transfer:write': false },
      amr: { pwd: true, otp: false, hwk: false },
      act: false
    };
    var token = null;

    var audit = h.logPanel(); // the audit trail is the centerpiece
    var tokenBox = h.el('div', { class: 'acad-lab-col' });
    var out = h.el('div', {});

    function actor() { return cfg.act ? 'maya (via agent:kai)' : 'maya'; }

    function amrList() {
      return Object.keys(cfg.amr).filter(function (k) { return cfg.amr[k]; });
    }
    function scopeList() {
      return Object.keys(cfg.scopes).filter(function (k) { return cfg.scopes[k]; });
    }

    function renderToken() {
      tokenBox.innerHTML = '';
      tokenBox.appendChild(h.el('div', { class: 'acad-lab-panel-title' }, 'Composed access token'));
      if (!token) { tokenBox.appendChild(h.note('Toggle chips, then Mint.')); return; }
      tokenBox.appendChild(h.tokenView(token));
      tokenBox.appendChild(h.jsonView(h.decodeJwt(token).payload));
    }

    function mint() {
      var payload = { iss: 'the IdP', sub: 'maya', aud: 'api.example.com',
        scope: scopeList().join(' '), amr: amrList() };
      if (cfg.act) payload.act = { sub: 'agent:kai' }; // delegation: sub stays maya, act names the agent
      token = h.fakeJwt(payload);
      out.innerHTML = '';
      audit.add('info', 'Minted token for ' + actor() + ' — scope="' + payload.scope + '" amr=[' + payload.amr.join(',') + ']' + (cfg.act ? ' act.sub=agent:kai' : '') + '.');
      renderToken(); h.flash(tokenBox);
    }

    function need() { if (!token) { audit.add('warn', 'Mint a token first.'); return false; } return true; }

    function callBalance() {
      if (!need()) return;
      var p = h.decodeJwt(token).payload;
      var has = (p.scope || '').split(' ').indexOf('read:balance') >= 0;
      out.innerHTML = '';
      if (has) {
        audit.add('ok', actor() + ' → GET /balance → 200.');
        out.appendChild(h.httpCard({ method: 'GET', path: '/balance', status: 200,
          resBody: { balance: '$4,210.00' }, note: 'Token carries scope read:balance → allowed.' }));
      } else {
        audit.add('bad', actor() + ' → GET /balance → 403 insufficient_scope.');
        out.appendChild(h.httpCard({ method: 'GET', path: '/balance', status: 403,
          resBody: { error: 'insufficient_scope' },
          note: 'WWW-Authenticate: Bearer error="insufficient_scope", scope="read:balance". Add the read:balance chip and re-mint.' }));
      }
    }

    function callTransfer() {
      if (!need()) return;
      var p = h.decodeJwt(token).payload;
      var hasScope = (p.scope || '').split(' ').indexOf('transfer:write') >= 0;
      var phishResistant = (p.amr || []).indexOf('hwk') >= 0;
      out.innerHTML = '';
      if (!hasScope) {
        audit.add('bad', actor() + ' → POST /transfer → 403 insufficient_scope.');
        out.appendChild(h.httpCard({ method: 'POST', path: '/transfer', reqBody: { to: 'sam', amount: 500 }, status: 403,
          resBody: { error: 'insufficient_scope' },
          note: 'WWW-Authenticate: Bearer error="insufficient_scope", scope="transfer:write".' }));
        return;
      }
      if (!phishResistant) {
        audit.add('warn', actor() + ' → POST /transfer → 401 insufficient_user_authentication (step-up).');
        out.appendChild(h.httpCard({ method: 'POST', path: '/transfer', reqBody: { to: 'sam', amount: 500 }, status: 401,
          resBody: { error: 'insufficient_user_authentication' },
          note: 'RFC 9470 step-up: WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="phr". Right scope, but amr lacks a phishing-resistant factor (hwk, a hardware-secured key). The client must step Maya up and re-mint.' }));
        return;
      }
      audit.add('ok', actor() + ' moved $500 to Sam → POST /transfer → 200.');
      out.appendChild(h.httpCard({ method: 'POST', path: '/transfer', reqBody: { to: 'sam', amount: 500 }, status: 200,
        resBody: { moved: '$500.00', to: 'sam', by: actor() },
        note: 'Scope transfer:write present AND amr includes hwk (hardware-secured key — phishing-resistant). Executed — and the audit line names the delegate.' }));
    }

    function callWhoami() {
      if (!need()) return;
      var p = h.decodeJwt(token).payload;
      out.innerHTML = '';
      audit.add('info', actor() + ' → GET /whoami → 200.');
      out.appendChild(h.httpCard({ method: 'GET', path: '/whoami', status: 200,
        resBody: { sub: p.sub, acting_as: p.act ? p.act.sub : null, effective_actor: actor() },
        note: p.act ? 'sub stays "maya" — the act claim exposes agent:kai as the delegate. Delegation is visible, not hidden.'
          : 'No act claim: Maya is acting directly. Toggle the act chip to let Kai act on her behalf.' }));
    }

    // build chip rows
    function chipRow(label, obj, keys) {
      return h.field(label, h.row(keys.map(function (k) {
        return h.chip(k, obj[k], function (on) { obj[k] = on; });
      })));
    }

    root.appendChild(h.stage([tokenBox]));
    root.appendChild(h.panel('Compose the token', [
      chipRow('Scopes', cfg.scopes, ['read:balance', 'transfer:write']),
      chipRow('amr (methods proven at login)', cfg.amr, ['pwd', 'otp', 'hwk']),
      h.field('Delegation (act)', h.row([h.chip('Kai acts for Maya', cfg.act, function (on) { cfg.act = on; })])),
      h.button('Mint token', 'primary', mint)
    ]));
    root.appendChild(h.row([
      h.col([h.button('GET /balance', '', callBalance)]),
      h.col([h.button('POST /transfer', 'danger', callTransfer)]),
      h.col([h.button('GET /whoami', '', callWhoami)])
    ]));
    root.appendChild(out);
    root.appendChild(h.note('The API authorizes on signed claims only: scope gates the resource, amr gates the strength (step-up when a factor like hwk is missing), and act makes delegation auditable — the agent can’t hide behind Maya’s sub.'));
    root.appendChild(h.el('div', { class: 'acad-lab-panel-title' }, 'Audit trail'));
    root.appendChild(audit.root);
    renderToken();
  }
});

/* lab-mcp | lesson: ai1-mcp */
AcadLabs.register('lab-mcp', {
  title: 'Man the MCP gateway',
  blurb: 'Kai the AI agent fires tool calls; you watch the gateway policy allow, park for a human, or deny — with a kill switch Zara can flip.',
  render: function (root, h) {
    var log = h.logPanel();
    var disabled = false;
    var out = h.stage(h.note('Press a tool button — the gateway decides before the tool ever runs.'));

    function show(node) { out.innerHTML = ''; out.appendChild(node); h.flash(out); }

    // Every decision is logged with WHO (agent+user), WHAT (tool), WHY (verdict).
    function audit(kind, tool, verdict, why) {
      log.add(kind, 'Kai (for Maya) · ' + tool + ' · ' + verdict + ' — ' + why);
    }

    function killed(tool) {
      audit('bad', tool, 'BLOCKED', 'agent Kai is disabled in the registry');
      show(h.httpCard({
        method: 'POST', path: '/mcp/tools/' + tool,
        status: 403, resBody: { error: 'agent_disabled', detail: 'Kai is disabled in the agent registry' },
        note: 'Kill switch is on — the gateway short-circuits every call before policy.'
      }));
    }

    function readInvoices() {
      if (disabled) return killed('read_invoices');
      audit('ok', 'read_invoices', 'ALLOW', 'read scope + in Kai’s allowlist');
      show(h.httpCard({
        method: 'POST', path: '/mcp/tools/read_invoices',
        reqBody: { on_behalf_of: 'maya', scope: 'invoices:read' },
        status: 200, resBody: { invoices: [{ id: 'inv-118', total: '$50.00', status: 'due' }] },
        note: 'Read is non-destructive and allowlisted — policy allows, tool executes.'
      }));
    }

    function deleteRecords() {
      if (disabled) return killed('delete_records');
      audit('bad', 'delete_records', 'DENY', 'destructive, not in Kai’s allowlist');
      show(h.httpCard({
        method: 'POST', path: '/mcp/tools/delete_records',
        reqBody: { on_behalf_of: 'maya' },
        status: 403, resBody: { error: 'policy_denied', detail: 'delete_records is not in Kai’s allowlist' },
        note: 'Denied at the gateway — the tool is never invoked.'
      }));
    }

    function sendPayment() {
      if (disabled) return killed('send_payment');
      var ref = 'PAY-' + h.rand(4).toUpperCase();
      var body = { on_behalf_of: 'maya', amount: '$50.00', to: 'acct-' + h.rand(6) };
      audit('warn', 'send_payment', 'PENDING', 'write over threshold → human approval required');
      var reqCard = h.httpCard({
        method: 'POST', path: '/mcp/tools/send_payment', reqBody: body,
        status: 202, statusText: 'Accepted (pending approval)',
        resBody: { status: 'pending_approval', ref: ref }, note: 'Parked. A human must approve before this runs.'
      });
      var resolved = false;
      var approveBtn = h.button('✅ Approve', 'primary', function () { if (!resolved) decide(true); });
      var denyBtn = h.button('❌ Deny', 'danger', function () { if (!resolved) decide(false); });
      var pend = h.panel('Human-in-the-loop · ' + ref, [
        h.note('Kai proposes: pay ' + body.amount + ' to ' + body.to + '. Approve only what you recognize.'),
        h.row([approveBtn, denyBtn])
      ]);
      function decide(ok) {
        resolved = true; approveBtn.disabled = true; denyBtn.disabled = true;
        if (ok) {
          audit('ok', 'send_payment', 'APPROVED', 'human approved ' + ref);
          show(h.httpCard({ method: 'POST', path: '/mcp/tools/send_payment', reqBody: body,
            status: 200, resBody: { status: 'executed', ref: ref, amount: body.amount },
            note: 'Approved by a human — only now does the payment tool run.' }));
        } else {
          audit('bad', 'send_payment', 'DENIED', 'human denied ' + ref);
          show(h.httpCard({ method: 'POST', path: '/mcp/tools/send_payment', reqBody: body,
            status: 403, resBody: { error: 'access_denied', detail: 'human denied ' + ref },
            note: 'Denied by a human — the tool never executed.' }));
        }
      }
      show(h.el('div', {}, [reqCard, pend]));
    }

    var killBtn = h.button('🔴 Kill switch: OFF', 'danger', function () {
      disabled = !disabled;
      killBtn.textContent = disabled ? '🟢 Kill switch: ON (Kai disabled)' : '🔴 Kill switch: OFF';
      log.add(disabled ? 'bad' : 'ok', 'Zara ' + (disabled ? 'DISABLED' : 're-enabled') + ' agent Kai in the registry');
    });

    var controls = h.col([
      h.panel('Kai’s tool calls', [
        h.button('read_invoices', 'primary', readInvoices),
        h.button('send_payment  ($50)', 'ghost', sendPayment),
        h.button('delete_records', 'ghost', deleteRecords)
      ]),
      h.panel('Registry override (Zara)', [
        h.note('The kill switch flips Kai to disabled — every later call is refused before policy even runs.'),
        killBtn
      ])
    ]);

    root.appendChild(h.row([controls, h.col([h.panel('Gateway response', out)])]));
    root.appendChild(h.panel('Audit log — who · what · verdict · why', log.root));
    log.add('info', 'Gateway ready. Two principals ride every call: the human (Maya) and the agent (Kai).');
  }
});

/* lab-fga | lesson: ai2-fga */
AcadLabs.register('lab-fga', {
  title: 'The tuple playground',
  blurb: 'Write and delete relationship tuples in a tiny ReBAC store, then run Check() and watch the resolution path (or the denial) change.',
  render: function (root, h) {
    // Tuple = {s: subject, r: relation, o: object}. Subject may be a userset like group:x#member.
    var tuples = [
      { s: 'folder:strategy', r: 'parent', o: 'doc:roadmap' },
      { s: 'group:leadership#member', r: 'viewer', o: 'folder:strategy' },
      { s: 'user:priya', r: 'member', o: 'group:leadership' },
      { s: 'user:zara', r: 'owner', o: 'doc:payroll' }
    ];
    // owner implies editor implies viewer (a stronger relation grants the weaker).
    var IMPLIES = { viewer: ['viewer', 'editor', 'owner'], editor: ['editor', 'owner'], owner: ['owner'], member: ['member'], parent: ['parent'] };

    // Bounded-depth graph walk. Returns an array of hop labels, or null if no path.
    function check(user, rel, obj, depth) {
      if (depth > 8) return null;
      var accept = IMPLIES[rel] || [rel];
      for (var i = 0; i < tuples.length; i++) {
        var t = tuples[i];
        if (t.o !== obj || accept.indexOf(t.r) < 0) continue;
        if (t.s === user) return [t.r + ' of ' + obj];
        var hash = t.s.indexOf('#');
        if (hash > -1) { // userset: is `user` related to that set?
          var grp = t.s.slice(0, hash), memRel = t.s.slice(hash + 1);
          var inner = check(user, memRel, grp, depth + 1);
          if (inner) return inner.concat([t.r + ' of ' + obj]);
        }
      }
      // Inheritance: viewer/editor flow down from a parent folder.
      if (rel === 'viewer' || rel === 'editor') {
        for (var j = 0; j < tuples.length; j++) {
          if (tuples[j].r === 'parent' && tuples[j].o === obj) {
            var up = check(user, rel, tuples[j].s, depth + 1);
            if (up) return up.concat(['parent of ' + obj]);
          }
        }
      }
      return null;
    }

    var listBox = h.el('div', { class: 'acad-lab-col' });
    function renderList() {
      listBox.innerHTML = '';
      tuples.forEach(function (t, idx) {
        listBox.appendChild(h.row([
          h.badge(t.s + ' · ' + t.r + ' · ' + t.o, 'info'),
          h.button('✕', 'ghost', function () { tuples.splice(idx, 1); renderList(); })
        ]));
      });
      if (!tuples.length) listBox.appendChild(h.note('Store is empty — every Check will DENY.'));
    }

    // Add-tuple form
    var subj = h.select([
      { value: 'user:priya', label: 'user:priya' }, { value: 'user:zara', label: 'user:zara' },
      { value: 'user:maya', label: 'user:maya' }, { value: 'user:sam', label: 'user:sam' },
      { value: 'group:leadership#member', label: 'group:leadership#member' }
    ]);
    var addRel = h.select(['viewer', 'editor', 'owner', 'member', 'parent'].map(function (r) { return { value: r, label: r }; }));
    var addObj = h.select([
      { value: 'doc:roadmap', label: 'doc:roadmap' }, { value: 'doc:payroll', label: 'doc:payroll' },
      { value: 'folder:strategy', label: 'folder:strategy' }, { value: 'group:leadership', label: 'group:leadership' }
    ]);
    var addForm = h.panel('Add a tuple (sharing = writing a fact)', [
      h.row([h.field('subject', subj), h.field('relation', addRel), h.field('object', addObj)]),
      h.button('+ Write tuple', 'primary', function () {
        var s = subj.value, r = addRel.value, o = addObj.value;
        if (tuples.some(function (t) { return t.s === s && t.r === r && t.o === o; })) return;
        tuples.push({ s: s, r: r, o: o }); renderList(); h.flash(listBox);
      })
    ]);

    // Check form
    var ckUser = h.select(['user:priya', 'user:zara', 'user:maya', 'user:sam'].map(function (u) { return { value: u, label: u }; }));
    var ckRel = h.select(['viewer', 'editor', 'owner'].map(function (r) { return { value: r, label: r }; }));
    var ckObj = h.select(['doc:roadmap', 'doc:payroll', 'folder:strategy'].map(function (o) { return { value: o, label: o }; }));
    var result = h.el('div', {});
    var checkForm = h.panel('Check(user, relation, object)', [
      h.row([h.field('user', ckUser), h.field('relation', ckRel), h.field('object', ckObj)]),
      h.button('Run check', 'primary', function () {
        var u = ckUser.value, r = ckRel.value, o = ckObj.value;
        var path = check(u, r, o, 0);
        result.innerHTML = '';
        if (path) {
          result.appendChild(h.badge('ALLOW', 'ok'));
          result.appendChild(h.el('p', { class: 'acad-lab-note' }, u + ' → ' + path.join(' → ') + ' ⇒ ' + r));
        } else {
          result.appendChild(h.badge('DENY', 'bad'));
          result.appendChild(h.note('No relationship path from ' + u + ' to ' + r + ' of ' + o + '.'));
        }
        h.flash(result);
      })
    ]);

    renderList();
    root.appendChild(h.row([
      h.col([h.panel('Current tuples (the store)', listBox), addForm]),
      h.col([checkForm, h.panel('Result', result)])
    ]));
    root.appendChild(h.note('Try: remove "user:priya · member · group:leadership" then re-check priya/viewer/doc:roadmap — the whole inherited path collapses. Or make Maya a viewer of just doc:roadmap and watch folder:strategy stay off-limits.'));
  }
});

/* lab-rag | lesson: ai3-rag */
AcadLabs.register('lab-rag', {
  title: 'Give the AI a library card',
  blurb: 'Retrieve 4 chunks by meaning, then watch naive RAG leak — and FGA checks filter — before the model reads.',
  render: function (root, h) {
    /* --- FGA-style state: who may view each document (tuples, mutable at query time) --- */
    var viewers = {
      'doc:public-faq':     ['maya', 'priya', 'sam'],
      'doc:roadmap-teaser': ['maya', 'priya', 'sam'],
      'doc:roadmap':        ['priya', 'sam'],
      'doc:finance-q3':     ['priya'],
      'doc:partner-brief':  ['sam']
    };
    var USERS = [
      { value: 'maya', label: 'Maya (customer)', selected: true },
      { value: 'priya', label: 'Priya (employee)' },
      { value: 'sam', label: 'Sam (partner)' }
    ];
    var QUESTIONS = {
      roadmap: { label: "What's on the product roadmap?", chunks: [
        { doc: 'doc:roadmap-teaser', src: 'Public roadmap teaser', snip: 'Q4 ships passkey login and a self-serve dashboard.' },
        { doc: 'doc:roadmap', src: 'Internal roadmap', snip: 'H1 2027: agent-identity beta, SSO for the SMB tier.' },
        { doc: 'doc:finance-q3', src: 'Finance Q3 memo', snip: 'Roadmap spend capped at $1.4M; net margin 62%.' },
        { doc: 'doc:partner-brief', src: 'Partner brief', snip: 'Co-sell motion for the agent-identity beta.' }
      ] },
      finance: { label: "What were last quarter's finance numbers?", chunks: [
        { doc: 'doc:finance-q3', src: 'Finance Q3 memo', snip: 'Q3 revenue $4.2M, up 28% QoQ; net margin 62%.' },
        { doc: 'doc:finance-q3', src: 'Finance Q3 memo', snip: 'Cash runway 19 months; roadmap spend $1.4M.' },
        { doc: 'doc:public-faq', src: 'Public pricing FAQ', snip: 'Plans start at $0; Pro is $29 / user / month.' },
        { doc: 'doc:roadmap', src: 'Internal roadmap', snip: 'Budget line: agent-identity beta funded through H1.' }
      ] }
    };

    var state = { user: 'maya', q: null, permAware: true };
    var log = h.logPanel();

    function nameOf(u) { return USERS.filter(function (x) { return x.value === u; })[0].label; }
    function may(user, doc) { return viewers[doc].indexOf(user) !== -1; }

    /* --- output areas --- */
    var chunksBox = h.el('div', { class: 'acad-lab-col' });
    var answerBox = h.el('div', { class: 'acad-lab-col' });

    function run() {
      chunksBox.innerHTML = '';
      answerBox.innerHTML = '';
      if (!state.q) { chunksBox.appendChild(h.note('Pick a question to retrieve candidate chunks.')); return; }
      var q = QUESTIONS[state.q];
      chunksBox.appendChild(h.el('div', { class: 'acad-lab-panel-title' },
        'Vector search · top-4 by meaning · asked by ' + nameOf(state.user)));

      var reaching = [];  // chunks that actually reach the model
      var leaked = [];    // chunks that reach the model but the asker may NOT see
      q.chunks.forEach(function (c) {
        var allowed = may(state.user, c.doc);
        var badge;
        if (state.permAware) {
          log.add(allowed ? 'ok' : 'bad', 'Check(' + state.user + ', viewer, ' + c.doc + ') → ' + (allowed ? 'allow' : 'deny'));
          badge = h.badge(allowed ? 'allow · sent' : 'deny · dropped', allowed ? 'ok' : 'bad');
          if (allowed) reaching.push(c);
        } else {
          badge = h.badge('→ sent to model', 'warn');
          reaching.push(c);
          if (!allowed) leaked.push(c);
        }
        var reason = allowed
          ? 'tuple (user:' + state.user + ', viewer, ' + c.doc + ') ✓'
          : 'no tuple (user:' + state.user + ', viewer, ' + c.doc + ')';
        chunksBox.appendChild(h.panel(c.src, [
          h.note('“' + c.snip + '”'),
          h.row([badge, h.el('code', { class: 'acad-lab-token' }, reason)])
        ]));
      });

      /* --- answer --- */
      answerBox.appendChild(h.el('div', { class: 'acad-lab-panel-title' }, 'Model answer'));
      if (!state.permAware) log.add('warn', 'Naive RAG: model received ' + reaching.length + ' chunks, unfiltered.');

      if (reaching.length === 0) {
        answerBox.appendChild(h.panel(null, [
          h.badge('no sources', 'neutral'),
          h.note('No chunk you are permitted to see was found. I can’t answer this from your library card — and I won’t guess.')
        ]));
        return;
      }
      var lines = reaching.map(function (c) { return '• ' + c.snip + '  [' + c.src + ']'; });
      var kids = [h.jsonView('Grounded in ' + reaching.length + ' source(s):\n' + lines.join('\n'))];
      if (leaked.length) {
        var docs = leaked.map(function (c) { return c.doc; }).join(', ');
        kids.unshift(h.row([h.badge('⚠️ data leak', 'bad'),
          h.el('span', {}, nameOf(state.user) + ' should not see: ' + docs)]));
        log.add('bad', '⚠️ LEAK — ' + nameOf(state.user) + ' was served restricted ' + docs);
      } else if (state.permAware) {
        kids.unshift(h.badge('filtered · no leak', 'ok'));
      }
      answerBox.appendChild(h.panel(null, kids));
    }

    /* --- controls --- */
    var userSel = h.select(USERS, function (v) { state.user = v; run(); });
    var modeChip = h.chip('Permission-aware filter (FGA)', true, function (on) {
      state.permAware = on;
      log.add('info', on ? 'Filter ON — chunks checked before the model reads.' : 'Filter OFF — naive RAG, every chunk flows through.');
      run();
    });
    function askBtn(id) {
      return h.button(QUESTIONS[id].label, state.q === id ? 'primary' : 'ghost', function () {
        state.q = id; log.add('info', nameOf(state.user) + ' asks: “' + QUESTIONS[id].label + '”'); run();
      });
    }
    var revoke = h.button('Revoke Priya’s finance access', 'danger', function () {
      viewers['doc:finance-q3'] = viewers['doc:finance-q3'].filter(function (u) { return u !== 'priya'; });
      state.user = 'priya'; state.q = 'finance'; state.permAware = true;
      userSel.value = 'priya'; modeChip.setAttribute('aria-pressed', 'true');
      log.add('warn', 'Tuple deleted: (user:priya, viewer, doc:finance-q3). No re-indexing — the check runs at query time.');
      run();
    });

    var controls = h.col([
      h.field('Who is asking?', userSel),
      h.panel('Ask a question', [askBtn('roadmap'), askBtn('finance')]),
      h.panel('Retrieval mode', [modeChip, h.note('Off = naive RAG (all chunks reach the model). On = FGA-filtered.')]),
      revoke
    ]);

    root.appendChild(h.stage(h.row([controls, chunksBox, answerBox])));
    root.appendChild(log.root);
    run();
  }
});

/* lab-ciba | lesson: ai4-hitl */
AcadLabs.register('lab-ciba', {
  title: 'Ask the human (asynchronously)',
  blurb: 'Sam the partner agent has no browser, so it asks the IdP to push Maya for a $120 approval — then polls the token endpoint until she decides (or it expires).',
  render: function (root, h) {
    var log = h.logPanel();
    var reqId = null, decision = null, expired = false, remaining = 60, timer = null;
    var acct = 'acct-' + h.rand(6);
    var binding = null;
    var GRANT = 'urn:openid:params:grant-type:ciba';

    var out = h.el('div', {}, h.note('Step 1: Sam initiates a backchannel request. Step 2: poll the token endpoint. Meanwhile Maya decides on her phone.'));
    function show(node) { out.innerHTML = ''; out.appendChild(node); h.flash(out); }

    var clock = h.meter(100, 'ok');
    var phoneBox = h.el('div', {});
    function renderPhone() {
      phoneBox.innerHTML = '';
      if (!reqId) { phoneBox.appendChild(h.note('No pending request. Maya’s phone is quiet.')); return; }
      if (expired) { phoneBox.appendChild(h.badge('Request expired', 'warn')); return; }
      if (decision === 'approve') { phoneBox.appendChild(h.badge('You approved this payment', 'ok')); return; }
      if (decision === 'deny') { phoneBox.appendChild(h.badge('You denied this payment', 'bad')); return; }
      var ap = h.button('✅ Approve', 'primary', function () { decide('approve'); });
      var dn = h.button('❌ Deny', 'danger', function () { decide('deny'); });
      phoneBox.appendChild(h.panel('🔔 Push from the IdP', [
        h.note('Approve this transaction?'),
        h.badge(binding, 'info'),
        h.note('You are approving THIS exact transaction — not a vague "login?". Mismatch → deny.'),
        h.row([ap, dn])
      ]));
    }

    function decide(d) {
      if (expired || decision) return;
      decision = d; renderPhone();
      log.add(d === 'approve' ? 'ok' : 'bad', 'Maya ' + (d === 'approve' ? 'APPROVED' : 'DENIED') + ' ' + binding + ' on her phone');
    }

    function initiate() {
      reqId = 'req-' + h.rand(12); decision = null; expired = false; remaining = 60;
      binding = 'PAY-' + h.rand(4).toUpperCase() + ' · $120 · to ' + acct;
      if (timer) clearInterval(timer);
      timer = h.interval(function () {
        remaining--; clock.set(remaining / 60 * 100, remaining > 15 ? 'ok' : 'warn');
        if (remaining <= 0) { expired = true; clock.set(0, 'bad'); clearInterval(timer); renderPhone(); log.add('warn', 'auth_req_id expired — Maya never answered'); }
      }, 1000);
      renderPhone();
      log.add('info', 'Sam → POST /bc-authorize (login_hint=maya, binding_message="' + binding + '")');
      show(h.httpCard({
        method: 'POST', path: '/bc-authorize',
        reqBody: { scope: 'openid payment', login_hint: 'maya', binding_message: binding },
        status: 200, resBody: { auth_req_id: reqId, expires_in: 60, interval: 5 },
        note: 'Backchannel accepted. No redirect, no browser — Sam now polls the token endpoint every ' + 5 + 's.'
      }));
    }

    function poll() {
      if (!reqId) { log.add('warn', 'Nothing to poll — initiate first.'); return; }
      var req = { grant_type: GRANT, auth_req_id: reqId };
      if (expired) {
        log.add('bad', 'poll → 400 expired_token');
        return show(h.httpCard({ method: 'POST', path: '/token', reqBody: req, status: 400, resBody: { error: 'expired_token' }, note: 'The window closed before Maya approved. Start over.' }));
      }
      if (decision === 'deny') {
        log.add('bad', 'poll → 400 access_denied');
        return show(h.httpCard({ method: 'POST', path: '/token', reqBody: req, status: 400, resBody: { error: 'access_denied' }, note: 'Maya said no. Sam gets nothing.' }));
      }
      if (decision === 'approve') {
        var tok = h.fakeJwt({ sub: 'maya', act: { sub: 'agent:sam' }, scope: 'payment:once', amount: '$120', to: acct });
        log.add('ok', 'poll → 200, access token issued (scope narrowed to this one payment)');
        return show(h.httpCard({ method: 'POST', path: '/token', reqBody: req, status: 200, resBody: { access_token: tok, token_type: 'Bearer', scope: 'payment:once' }, note: 'Sam never saw Maya’s credentials — only this narrowly-scoped token, good for exactly this payment.' }));
      }
      log.add('info', 'poll → 400 authorization_pending (keep polling)');
      show(h.httpCard({ method: 'POST', path: '/token', reqBody: req, status: 400, resBody: { error: 'authorization_pending' }, note: 'Maya hasn’t decided yet. Wait the interval, poll again.' }));
    }

    var controls = h.col([
      h.panel('Sam (partner agent · no browser)', [
        h.button('1 · Initiate  /bc-authorize', 'primary', initiate),
        h.button('2 · Poll  /token', 'ghost', poll),
        h.field('time left', clock.root)
      ]),
      h.panel('Endpoint response', out)
    ]);
    root.appendChild(h.row([controls, h.col([h.panel('Maya’s phone', phoneBox)])]));
    root.appendChild(h.panel('Event log', log.root));
    renderPhone();
    log.add('info', 'Two devices: Sam requests, Maya’s phone approves. Different device is the whole point.');
  }
});

/* lab-scim | lesson: o1-scim */
AcadLabs.register('lab-scim', {
  title: 'Provisioning, on the wire',
  blurb: 'Drive the Joiner–Mover–Leaver lifecycle over SCIM v2 — hire Priya, move her to Finance, offboard her — and read the exact request/response the IdP pushes to your app.',
  render: function (root, h) {
    var log = h.logPanel();
    var priya = null; // the app-side user record, null until provisioned
    var out = h.el('div', {}, h.note('The wire format IS the lesson — every button shows the real SCIM request and response.'));
    function show(node) { out.innerHTML = ''; out.appendChild(node); h.flash(out); }

    var storeBox = h.el('div', {});
    function renderStore() {
      storeBox.innerHTML = '';
      if (!priya) { storeBox.appendChild(h.note('App user store is empty. No account exists yet.')); return; }
      storeBox.appendChild(h.panel(priya.userName, [
        h.row([h.badge(priya.active ? 'active' : 'disabled', priya.active ? 'ok' : 'bad'), h.badge('id ' + priya.id, 'neutral')]),
        h.note('department: ' + priya.department + ' · groups: ' + priya.groups.join(', '))
      ]));
    }

    function hire() {
      if (priya) { log.add('warn', 'Priya already exists — a retried create must be idempotent, not a duplicate.'); return; }
      priya = { id: 'usr-' + h.rand(8), userName: 'priya@example.com', department: 'Sales', groups: ['Store-Managers'], active: true };
      var body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'priya@example.com', name: { givenName: 'Priya', familyName: 'N' },
        emails: [{ value: 'priya@example.com', primary: true }], active: true
      };
      log.add('ok', 'Joiner: SCIM create → account provisioned BEFORE first login');
      show(h.httpCard({ method: 'POST', path: '/scim/v2/Users', reqBody: body, status: 201,
        resBody: { id: priya.id, userName: 'priya@example.com', active: true, groups: [{ value: 'Store-Managers' }], meta: { resourceType: 'User' } },
        note: 'Group Store-Managers maps to her app role — she lands with access, no ticket.' }));
      renderStore();
    }

    function move() {
      if (!priya || !priya.active) { log.add('warn', 'No active account to move — hire Priya first.'); return; }
      priya.department = 'Finance'; priya.groups = ['Finance-Team'];
      var body = { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [
        { op: 'replace', path: 'department', value: 'Finance' },
        { op: 'replace', path: 'groups', value: [{ value: 'Finance-Team' }] }
      ] };
      log.add('info', 'Mover: department + group membership updated in place');
      show(h.httpCard({ method: 'PATCH', path: '/scim/v2/Users/' + priya.id, reqBody: body, status: 200,
        resBody: { id: priya.id, department: 'Finance', groups: [{ value: 'Finance-Team' }] },
        note: 'Same account, new attributes — the directory stays the source of truth.' }));
      renderStore();
    }

    function deactivate() {
      if (!priya) { log.add('warn', 'No account to deactivate — hire Priya first.'); return; }
      if (!priya.active) { log.add('warn', 'Already disabled.'); return; }
      priya.active = false;
      var body = { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [
        { op: 'replace', path: 'active', value: false }
      ] };
      log.add('bad', 'Leaver: active:false — new logins blocked instantly');
      log.add('warn', 'SCIM flips the account; live tokens/sessions need CAEP session revocation (see the session lessons).');
      show(h.httpCard({ method: 'PATCH', path: '/scim/v2/Users/' + priya.id, reqBody: body, status: 200,
        resBody: { id: priya.id, active: false },
        note: 'active:false cuts access the second HR clicks offboard — but already-issued tokens live until CAEP revokes the session.' }));
      renderStore();
    }

    function del() {
      if (!priya) { log.add('warn', 'Nothing to delete.'); return; }
      var id = priya.id; priya = null;
      log.add('info', 'Hard delete: resource removed');
      show(h.httpCard({ method: 'DELETE', path: '/scim/v2/Users/' + id, status: 204,
        note: 'No content on success — the user is gone from the app store entirely.' }));
      renderStore();
    }

    var controls = h.col([
      h.panel('HR directory → your app (SCIM)', [
        h.button('Hire Priya  (POST)', 'primary', hire),
        h.button('Move to Finance  (PATCH)', 'ghost', move),
        h.button('Deactivate leaver  (PATCH)', 'danger', deactivate),
        h.button('Delete  (DELETE)', 'ghost', del)
      ]),
      h.panel('Wire trace', out)
    ]);
    renderStore();
    root.appendChild(h.row([controls, h.col([h.panel('App user store', storeBox)])]));
    root.appendChild(h.panel('Event log', log.root));
    log.add('info', 'Deliveries are at-least-once — a retried create must dedupe on the stable id, never duplicate.');
  }
});

/* lab-push | lesson: o4-authenticator */
AcadLabs.register('lab-push', {
  title: 'Approve, deny, or get fatigued',
  blurb: 'Run a number-matching push approval for a real login, then feel an MFA-fatigue attack and learn why matching beats a blind Approve.',
  render: function (root, h) {
    var log = h.logPanel();
    var loginSlot = h.el('div');
    var phoneSlot = h.el('div');
    var outSlot = h.el('div');

    function reset() {
      loginSlot.innerHTML = '';
      phoneSlot.innerHTML = '';
      outSlot.innerHTML = '';
      loginSlot.appendChild(h.note('No sign-in in progress.'));
      phoneSlot.appendChild(h.note('Quiet — no pushes.'));
    }
    reset();

    function pick2() { return 10 + Math.floor(Math.random() * 90); }

    function legit() {
      reset();
      var correct = pick2();
      var opts = [correct];
      while (opts.length < 3) { var n = pick2(); if (opts.indexOf(n) < 0) opts.push(n); }
      opts.sort(function () { return Math.random() - 0.5; });

      loginSlot.innerHTML = '';
      loginSlot.appendChild(h.badge('Priya is signing in', 'info'));
      loginSlot.appendChild(h.note('Enter this number on your phone:'));
      loginSlot.appendChild(h.el('code', { class: 'acad-lab-token' }, String(correct)));
      h.flash(loginSlot);

      phoneSlot.innerHTML = '';
      phoneSlot.appendChild(h.badge('🔔 Sign-in attempt', 'warn'));
      phoneSlot.appendChild(h.note('Tap the number shown on your login screen:'));
      phoneSlot.appendChild(h.row(opts.map(function (n) {
        return h.button(String(n), '', function () {
          if (n === correct) { approve(); } else {
            outSlot.innerHTML = '';
            outSlot.appendChild(h.httpCard({
              method: 'POST', path: 'https://api.example.com/mfa/push/verify',
              reqBody: { selected: n, expected: correct }, status: 403,
              resBody: { error: 'access_denied', reason: 'number_mismatch' },
              note: 'Wrong number — the approval is rejected. Tapping is not enough; the digits must match.'
            }));
            log.add('bad', 'Denied ✗ — tapped ' + n + ' but the login screen showed ' + correct + '.');
          }
        });
      })));
      log.add('info', 'Priya started a sign-in. Number-matching challenge pushed to her phone.');
    }

    function approve() {
      var tok = h.fakeJwt({ sub: 'priya', amr: ['pwd', 'hwk'], acr: 'aal2' });
      outSlot.innerHTML = '';
      outSlot.appendChild(h.httpCard({
        method: 'POST', path: 'https://api.example.com/mfa/push/verify',
        reqBody: { selected: 'matched', signature: 'sig_' + h.rand(24) }, status: 200,
        resBody: { token_type: 'Bearer', access_token: tok, amr: ['pwd', 'hwk'], acr: 'aal2' },
        note: 'The phone signed the approval with a key that never leaves its keystore. Token carries amr and acr:aal2.'
      }));
      log.add('ok', 'Approved ✓ — numbers matched, phone signed, IdP minted a token bound to two factors.');
    }

    function attacker() {
      reset();
      loginSlot.innerHTML = '';
      loginSlot.appendChild(h.badge('Attacker has Priya\'s password', 'bad'));
      loginSlot.appendChild(h.note('This login is on the ATTACKER\'s machine. Priya\'s own screen shows nothing — she never started this.'));

      phoneSlot.innerHTML = '';
      phoneSlot.appendChild(h.badge('🔔 Push you didn\'t request', 'warn'));
      phoneSlot.appendChild(h.note('A sign-in you never started just buzzed your phone. What do you do?'));
      phoneSlot.appendChild(h.row([
        h.button('Approve', '', function () {
          outSlot.innerHTML = '';
          outSlot.appendChild(h.httpCard({
            method: 'POST', path: 'https://api.example.com/mfa/push/verify',
            status: 200, resBody: { token_type: 'Bearer', session: 'attacker' },
            note: 'Blindly approving a request you never made hands the account to the attacker. This is exactly the MFA-fatigue win.'
          }));
          log.add('bad', 'Approved ✗ — you approved a login you never started. Account compromised.');
          log.add('info', 'This is why number matching removes the blind Approve button: the attacker can\'t see your login screen, so there is no number for you to match.');
        }),
        h.button('Deny', 'danger', function () {
          outSlot.innerHTML = '';
          outSlot.appendChild(h.httpCard({
            method: 'POST', path: 'https://api.example.com/mfa/push/verify',
            status: 403, resBody: { error: 'access_denied', reason: 'user_denied' },
            note: 'You didn\'t start it, so you deny it. The attacker had the password but not your phone.'
          }));
          log.add('ok', 'Denied ✓ — never approve a push you didn\'t initiate.');
        }),
        h.button('Report', 'primary', function () {
          log.add('ok', 'Reported ✓ — Zara (security) is notified and the repeated pushes are throttled. Classic MFA-fatigue spam, shut down.');
        })
      ]));
      log.add('warn', 'MFA-fatigue attack: attacker spams pushes hoping Priya taps Approve out of habit.');
    }

    root.appendChild(h.stage([
      h.row([
        h.panel('💻 Login screen', [loginSlot]),
        h.panel('📱 Priya\'s phone', [phoneSlot])
      ]),
      h.row([
        h.button('Priya signs in', 'primary', legit),
        h.button('Attacker signs in as Priya', 'danger', attacker)
      ]),
      outSlot
    ]));
    root.appendChild(log.root);
    log.add('info', 'Number matching binds the phone tap to something only the real login screen shows — a blind Approve button can\'t do that.');
  }
});
