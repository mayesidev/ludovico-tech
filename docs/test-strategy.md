# Test strategy

Passing processes and aggregate coverage are necessary but not sufficient release
evidence. This matrix records the behaviors that must be established directly.

## Coverage policy

- Istanbul coverage includes every maintained TypeScript/TSX source file, not
  only files imported by tests.
- Global thresholds are 80% for statements, functions, and lines and 70% for
  branches. Thresholds may increase as the suite improves; they must not be
  reduced merely to make CI pass.
- Critical authorization, import, state-transition, and deployment behavior needs
  an explicit test even when aggregate coverage is already above threshold.
- External Google and TMDB requests are always faked in automated tests.

## Required behavior matrix

| Area                   | Required scenarios                                                                                                                                                                                                                                                                                                                                                                                                              | Primary layer                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Runtime configuration  | Missing/unknown values fail closed; development auth cannot run in production; production readiness requires every integration                                                                                                                                                                                                                                                                                                  | Unit and Worker integration        |
| Public catalog         | All/watched/unwatched filters; public DTO excludes provenance and actor identifiers; missing resources return 404                                                                                                                                                                                                                                                                                                               | Worker integration                 |
| Authentication         | Anonymous identity; Google start state and PKCE; callback state expiry and single use; token/profile failures; verified allowlist success; rejected profile; session expiry; logout                                                                                                                                                                                                                                             | Worker integration                 |
| Authorization          | Every mutation and TMDB endpoint rejects an anonymous production request; every public read remains available                                                                                                                                                                                                                                                                                                                   | Worker integration                 |
| Movie metadata         | Manual title add; TMDB search; server-side TMDB confirmation; duplicate identity conflict; refresh timestamp; upstream failure mapping                                                                                                                                                                                                                                                                                          | Unit and Worker integration        |
| Rating                 | Score boundaries and half-points; required custom phrase; one shared rating per movie; rating marks watched                                                                                                                                                                                                                                                                                                                     | Unit and Worker integration        |
| Random roll            | Empty catalog; standalone selection; current unrated movie blocks another roll; only unrated movies are eligible; concurrent roll guard                                                                                                                                                                                                                                                                                         | Domain unit and Worker integration |
| Franchise selection    | Every member remains independently roll-eligible; a rolled member queues the first unrated ordered member; unknown order requests user order                                                                                                                                                                                                                                                                                    | Domain unit and Worker integration |
| Franchise order        | Exact membership required; duplicates/omissions rejected; reorder is atomic; user order remains authoritative                                                                                                                                                                                                                                                                                                                   | Domain unit and Worker integration |
| Franchise continuation | Rated current member may advance to the next unrated member or perform a new random roll; completed franchise reports completion                                                                                                                                                                                                                                                                                                | Domain unit and Worker integration |
| Atomicity              | Failed audit or related write cannot leave catalog, rating, roll, order, or Now Showing state partially updated                                                                                                                                                                                                                                                                                                                 | Worker integration                 |
| Import                 | Empty bootstrap requires no source artifact; positional sanitization emits only generalized fields; private headings/values never enter diagnostics; deterministic IDs; exact submission dedupe; same-title works remain distinct; IMDb title-reference validation; franchise inconsistency report; strict rating parsing; stale generated chunks removed; rerun idempotency; optional TMDB reconciliation is cached and mocked | Node unit and local D1 integration |
| Client authorization   | Anonymous users see sign-in calls to action but no mutation controls; authenticated users see valid controls; 401 refreshes auth presentation                                                                                                                                                                                                                                                                                   | Component                          |
| Client workflows       | Add/confirm movie, order franchise, roll, required rating, continue franchise, choose fresh roll, edit metadata                                                                                                                                                                                                                                                                                                                 | Component and Playwright           |
| Accessibility          | Dialog names, focus entry/return, keyboard dismissal, form labels/errors, navigation state, reduced-motion behavior                                                                                                                                                                                                                                                                                                             | Component and human review         |
| Migration              | Fresh database applies every migration; representative import succeeds; schema constraints reject invalid state                                                                                                                                                                                                                                                                                                                 | Local D1 integration               |
| Deployment             | Only exact published release tags accepted; pending migrations block deploy; deployed health matches tag/SHA; failed smoke check fails workflow                                                                                                                                                                                                                                                                                 | Script unit and workflow review    |

## CI release gate

The required CI job installs from the frozen lockfile and runs, in order:

1. Commit and pull-request metadata validation.
2. Formatting and linting.
3. Typechecking.
4. Unit, component, Worker integration, migration/import tests with coverage.
5. Production asset build.
6. Browser end-to-end tests.
7. Production dependency vulnerability and license checks.

Browser installation may run in parallel with non-browser checks when this does
not obscure failures. The protected branch requires the terminal aggregate gate,
not a subset of the matrix.
