# Product intent

Ludovico Tech replaces a shared form and spreadsheet with one movie catalog and
one group viewing state.

- Anyone may browse the catalog, current selection, and viewing history.
- An authenticated allowlisted member may change shared state.
- One movie is Now Showing for the group at a time.
- A movie is watched when its one shared rating exists. There is no skipped state
  or separate watched flag.
- A rating is 0–5 in half-point increments and requires the group's custom phrase.
- Every unwatched title is eligible for a random roll. Another roll is unavailable
  until the current movie is rated.
- A collection is an optional user-defined grouping. Members own its order; an
  external suggestion is never authoritative. A confirmed movie may link to
  TMDB's narrower collection without changing the local grouping.
- Rolling any collection member queues its first unwatched ordered member. After
  rating it, members may continue the collection or return to a fresh random roll.
- TMDB supplies application metadata. Legacy IMDb identifiers are optional,
  fallible import references rather than application identity.
- A confirmed TMDB movie stores up to five top-billed cast members and up to
  three directors by TMDB person ID and name. Their names appear on Now Showing
  and Movie Details; missing credits are omitted.
- A confirmed TMDB movie may optionally specify a manually sourced version,
  version runtime, and reference URL. The version is appended to displayed
  movie titles in parentheses. Its runtime is displayed when present;
  otherwise the TMDB runtime remains authoritative.
- Submitted title and collection information outrank a conflicting legacy external
  identifier during import.
- The application must run from empty migrations. Loading a legacy catalog is an
  optional operator action, never a bootstrap or test dependency.
- An optional legacy import may restore the current unwatched selection. It does
  not invent an unknown roll, actor, audit event, or selection time.
- Legacy title-submission time may establish when a movie was added. A manually
  entered legacy rating establishes watched state but not an unknown watch time.

Behavioral details belong in named tests, schemas, migrations, and runtime code.
Environment and delivery mechanics belong in checked-in configuration, validators,
and workflows.
