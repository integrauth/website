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
   * Lab's LAB_PRIVATE_JWK convention: generate once, never rotate. Unset in local dev,
   * where certs.ts falls back to an ephemeral per-isolate key instead.
   */
  ACADEMY_PRIVATE_JWK?: string;
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
