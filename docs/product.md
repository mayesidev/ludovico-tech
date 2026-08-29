# Product intent

Ludovico Tech replaces a shared form and spreadsheet with one movie catalog and
one group viewing state.

- Anyone may browse the catalog, current selection, and viewing history.
- An authenticated allowlisted member may change shared state.
- Authenticated members can see the resolved user or automation and timestamp
  for localized movie, rating, metadata, collection, selection, and refresh
  schedule attribution. Anonymous responses omit this information.
- The singleton Now Showing slot retains the last rolled movie until another is
  rolled. Rating means it has been shown and moves it to viewing history; the
  page may keep displaying it as context while the group chooses what is next.
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
- TMDB supplies application metadata. IMDb identifiers are optional external
  links rather than application identity.
- A confirmed TMDB movie stores up to five top-billed cast members and up to
  three directors by TMDB person ID and name. Their names appear on Now Showing
  and Movie Details; missing credits are omitted.
- A confirmed TMDB movie may optionally specify a manually sourced version,
  version runtime, and reference URL. The version is appended to displayed
  movie titles in parentheses. Its runtime is displayed when present;
  otherwise the TMDB runtime remains authoritative.
- The application must run from empty migrations. Loading an existing catalog is an
  optional operator action, never a bootstrap or test dependency.
- An optional catalog import may restore the current unwatched selection. It does
  not invent an unknown originating user or roll time. The importer is identified
  as the last updater of other state it materializes.
- Known prior addition and rating-recording times may be preserved during import.
  An imported rating establishes watched state without inventing unknown rating or
  watch times.

Behavioral details belong in named tests, schemas, migrations, and runtime code.
Environment and delivery mechanics belong in checked-in configuration, validators,
and workflows.
