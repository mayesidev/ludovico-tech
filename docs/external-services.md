# Authentication and metadata service contract

This document records the security and operational contract for Google identity
and TMDB metadata. Credentials remain only in ignored local Worker secret files
and Cloudflare/GitHub secret stores.

## Google authentication

Staging and production use the OAuth 2.0 authorization-code flow for the minimal
`openid email profile` scopes. The Worker generates an unguessable state and a
PKCE verifier, stores them only in D1, and sends an S256 challenge. State expires
after ten minutes and is atomically consumed before token exchange, including on
a failed callback, so it cannot be replayed.

The Worker exchanges the code and calls Google's OpenID Connect UserInfo endpoint
server-side. A profile must include a stable subject, a verified email, and an
email present in the current allowlist. The allowlist is checked on every later
session lookup as well as at login, so removing an address revokes mutation access
without waiting for its session to expire.

Sessions contain only an opaque random ID in an HttpOnly, SameSite=Lax cookie.
Staging and production cookies are Secure, sessions expire after 30 days,
expired sessions are removed when encountered, and logout deletes the current
server-side session.
Provider failures return a generic response and never include provider bodies,
tokens, or client credentials.

Implementation references:

- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OpenID Connect API reference](https://developers.google.com/identity/openid-connect/reference)
- [Google OAuth security practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)

## TMDB metadata

The browser never receives the TMDB read token and never calls the TMDB API.
Production search and detail routes require a currently allowlisted actor. Search
returns a small public candidate DTO. When a user attaches a TMDB identity, the
Worker fetches or reuses the authoritative movie-detail record and ignores any
client-supplied title, date, or poster metadata for that identity.

Successful normalized search results are cached in D1 for six hours. Successful
normalized movie details are cached for seven days. Failed responses are not
cached. Expired entries are removed during successful cache writes, provider 429
responses are preserved as a sanitized 429 with a safe Retry-After value when
available, and other network/provider failures map to a generic 502. Tests replace
all provider requests and assert that cache hits make no additional request.

Implementation references:

- [TMDB movie search](https://developer.themoviedb.org/reference/search-movie)
- [TMDB movie details](https://developer.themoviedb.org/reference/movie-details)
- [TMDB application authentication](https://developer.themoviedb.org/docs/authentication-application)
- [TMDB rate limiting](https://developer.themoviedb.org/docs/rate-limiting)
- [TMDB attribution requirements](https://developer.themoviedb.org/docs/faq)

The application Credits footer uses TMDB's unmodified approved short blue SVG and
the required non-endorsement notice. The logo is vendored so automated tests and
ordinary page loads do not make an unrelated external asset request.
