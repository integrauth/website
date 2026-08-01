# The RFC 7638 thumbprint (`kid`) of the Academy certificate SIGNING key.
#
# This is PUBLIC by construction — it is published to the world at
# GET /api/academy/.well-known/jwks.json, and a thumbprint discloses nothing about the private half.
# It is recorded here so CI has something to compare against, because the failure it guards is
# invisible: `ACADEMY_PRIVATE_JWK` is a Wrangler secret that can never be read back, so "is the
# Worker still signing with the same key it signed last year's certificates with?" is otherwise an
# unanswerable question.
#
# WHAT LOSING THE KEY COSTS. Certificates keep verifying through the PRIMARY path either way — that
# is a serial lookup in D1 and involves no crypto — so /verify goes on working and nothing looks
# broken. What breaks is the SECONDARY artifact: the signed JWT learners forward to employers. Every
# one ever issued becomes unverifiable against the published JWKS, silently, with no error on any
# side. Hence a guard rather than a comment.
#
# THREE WAYS THE KEY GETS LOST, none of which the deploy workflow can see on its own:
#   1. Someone deletes the secret in the Cloudflare dashboard (or `wrangler secret delete`).
#   2. `name` in wrangler.toml changes — that is a DIFFERENT Worker, with no secrets at all.
#   3. `account_id` changes, same reasoning.
# In all three the next deploy's generate-if-absent branch would mint a replacement and report
# success. With a kid recorded here it refuses instead, and the post-deploy probe cross-checks what
# is actually live.
#
# TO RECORD IT (once, after the first deploy that creates the key): take the value the
# "Certificate signing key continuity" step prints and commit it below.
#
# TO CHANGE IT DELIBERATELY: clearing or editing this value is the documented way to accept a
# rotation. That it takes a reviewed commit is the entire point — a key rotation should be a
# decision someone signs off on, not something a deploy does on its own.
#
# Format: comments (`#`) and blank lines ignored; the first remaining token is the expected kid.

# Recorded 2026-08-01, from the key created by the first production deploy (main @ 80edae9).
# Cross-checked two ways before committing: it matches the RFC 7638 thumbprint recomputed from the
# published x/y, and that JWKS carries no "d" member, so no private material was ever exposed.
5_mi33ReoQEsp9OLZtiGu0IyXmDGUM8nT_l1cmM8-e8
