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
}
