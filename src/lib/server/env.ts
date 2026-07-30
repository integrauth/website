// Shared Worker environment/bindings shape, matching wrangler.toml.

export interface Env {
  /** Static-asset binding (serves the existing site: index.html, css/, js/, images/, ...). */
  ASSETS: Fetcher;
  /** Shared D1 instance (lab-db) — see wrangler.toml for the "shared, not owned" contract. */
  DB: D1Database;
  /** Same Turnstile site key the Lab uses. Placeholder until CI/provisioning fills it in. */
  PUBLIC_TURNSTILE_SITE_KEY: string;
  /**
   * P-256 private key (JWK, JSON-stringified) used to sign Academy certificate JWTs.
   * A Wrangler secret, provisioned out-of-band (not this Worker's job) — mirrors the
   * Lab's LAB_PRIVATE_JWK convention: generate once, never rotate.
   *
   * If it is missing, certificate issuance FAILS (500) rather than falling back to anything — see
   * ALLOW_EPHEMERAL_CERT_KEY for the one deliberate exception and why it has to be opt-in.
   */
  ACADEMY_PRIVATE_JWK?: string;
  /**
   * Local-development escape hatch: when set to `1`, certs.ts may generate an ephemeral per-isolate
   * P-256 keypair if ACADEMY_PRIVATE_JWK is unset, so the certificate and JWKS routes are
   * exercisable with `npm run worker:dev` and no secrets configured.
   *
   * THIS MUST NEVER BE SET IN PRODUCTION, and the mechanism is chosen so that it cannot be by
   * accident: it lives ONLY in `.dev.vars`, which is gitignored, listed in .assetsignore, and never
   * uploaded by `wrangler deploy`. It is deliberately NOT a wrangler.toml `[vars]` entry, because
   * those DO get deployed.
   *
   * Why it needs to be opt-in at all: the fallback used to fire unconditionally on a missing secret,
   * which fails OPEN in the worst way. In production that silently mints certificates signed by a
   * key that dies with the isolate, publishes a DIFFERENT public key per isolate from
   * /.well-known/jwks.json (so verification succeeds or fails depending on which isolate answers),
   * and leaves every already-stored JWT permanently unverifiable — all with no error, no log, and
   * nothing in the UI to suggest anything is wrong. Failing closed turns that into a loud 500 on the
   * first issuance attempt instead.
   */
  ALLOW_EPHEMERAL_CERT_KEY?: string;
  /**
   * Client secret for the `integrauth-website` OIDC client, shared with the Lab's
   * `IA_WEBSITE_OIDC_SECRET`. A Wrangler secret; the Lab stores only its SHA-256, so the SAME RAW
   * VALUE must be set on both sides. Unset until provisioned, which is why `rpConfigFromEnv`
   * returns null rather than throwing — the site must keep serving pages either way.
   */
  IA_WEBSITE_OIDC_SECRET?: string;
  /**
   * The OpenID Provider's issuer identifier. Overridable so a local Lab checkout can be pointed
   * at during development; defaults to https://lab.integrauth.com. Must match the `iss` claim
   * byte for byte, so no trailing slash.
   */
  LAB_ISSUER?: string;
  /** OIDC client_id registered at the Lab. Defaults to `integrauth-website`. */
  OIDC_CLIENT_ID?: string;
}
