import { zValidator } from "@hono/zod-validator";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createCodeVerifier, createSessionId, createState, getActor, isLocal, newId, normalizeTitle, now, sessionCookie, sha256Base64Url, type AppEnv } from "./env";
import { getFranchiseMovies, getMovie, getNowShowing, getRemainingFranchiseMovies, movieSelect, type MovieRow } from "./db";

const app = new Hono<AppEnv>();
app.use("/api/*", cors({ origin: "*" }));

const mutationActor = async (c: Context<AppEnv>) => {
  const actor = await getActor(c.env, c.req.raw);
  if (!actor && !isLocal(c.env)) {
    return null;
  }
  return actor;
};

const audit = async (
  env: AppEnv["Bindings"],
  entityType: string,
  entityId: string,
  action: string,
  actorId: string | null,
  details?: Record<string, unknown>,
) => {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, entity_type, entity_id, action, actor_id, created_at, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(newId(), entityType, entityId, action, actorId, now(), details ? JSON.stringify(details) : null)
    .run();
};

const movieInput = z.object({
  title: z.string().trim().min(1).max(200),
  franchiseName: z.string().trim().max(200).optional().default(""),
  releaseDate: z.string().trim().max(20).optional().nullable(),
  posterPath: z.string().trim().max(300).optional().nullable(),
  tmdbId: z.number().int().positive().optional().nullable(),
  imdbId: z.string().trim().max(30).optional().nullable(),
});

const movieEditInput = movieInput.partial().refine((input) => Object.keys(input).length > 0, "Provide at least one field");

const ratingInput = z.object({
  score: z.number().min(0).max(5).refine((value) => Number.isInteger(value * 2), "Use whole or half points"),
  phrase: z.string().trim().max(120).optional().default(""),
});

const orderInput = z.object({ movieIds: z.array(z.string().uuid()).min(1) });

app.get("/api/health", (c) => c.json({ ok: true, environment: c.env.APP_ENV ?? "development" }));

app.get("/api/auth/me", async (c) => {
  const actor = await getActor(c.env, c.req.raw);
  return c.json({ authenticated: Boolean(actor), actor: actor ? { email: actor.email, displayName: actor.displayName } : null, local: isLocal(c.env) });
});

app.get("/api/auth/google", async (c) => {
  if (isLocal(c.env)) return c.redirect("/");
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_REDIRECT_URI) return c.text("Google OAuth is not configured", 503);
  const state = createState();
  const verifier = createCodeVerifier();
  const challenge = await sha256Base64Url(verifier);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await c.env.DB.prepare(
    "INSERT INTO oauth_states (state, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(state, verifier, createdAt, expiresAt).run();
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get("/api/auth/google/callback", async (c) => {
  if (isLocal(c.env)) return c.redirect("/");
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET || !c.env.GOOGLE_REDIRECT_URI) return c.text("Invalid OAuth callback", 400);
  const oauthState = await c.env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(state).first<{ state: string; code_verifier: string; expires_at: string }>();
  await c.env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!oauthState || oauthState.expires_at <= now()) return c.text("OAuth state expired", 400);

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET, redirect_uri: c.env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code", code_verifier: oauthState.code_verifier }),
  });
  if (!tokenResponse.ok) return c.text("Google token exchange failed", 502);
  const tokens = await tokenResponse.json() as { access_token?: string };
  if (!tokens.access_token) return c.text("Google token exchange returned no access token", 502);
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) return c.text("Google profile lookup failed", 502);
  const profile = await profileResponse.json() as { email?: string; email_verified?: boolean; name?: string };
  const email = profile.email?.toLowerCase();
  const allowedEmails = new Set((c.env.ALLOWED_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (!email || !profile.email_verified || !allowedEmails.has(email)) return c.text("This account is not on the invite list", 403);

  const timestamp = now();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, last_seen_at = excluded.last_seen_at`,
  ).bind(newId(), email, profile.name ?? email, timestamp, timestamp).run();
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (!user) return c.text("Unable to create user session", 500);
  const sessionId = createSessionId();
  await c.env.DB.prepare("INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(sessionId, user.id, timestamp, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()).run();
  c.header("Set-Cookie", sessionCookie(sessionId, true));
  return c.redirect("/");
});

app.post("/api/auth/logout", async (c) => {
  const sessionId = c.req.raw.headers.get("Cookie")?.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith("movie_list_session="))?.split("=")[1];
  if (sessionId) await c.env.DB.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(sessionId).run();
  c.header("Set-Cookie", sessionCookie("", !isLocal(c.env), 0));
  return c.json({ ok: true });
});

app.get("/api/movies", async (c) => {
  const status = c.req.query("status") ?? "all";
  const query = status === "unwatched" ? `${movieSelect} WHERE movies.rating_score IS NULL` : status === "watched" ? `${movieSelect} WHERE movies.rating_score IS NOT NULL` : movieSelect;
  const result = await c.env.DB.prepare(`${query} ORDER BY movies.title COLLATE NOCASE`).all<MovieRow>();
  return c.json({ movies: result.results });
});

app.get("/api/franchises", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT franchises.*, COUNT(movies.id) AS movie_count,
      SUM(CASE WHEN movies.watched_at IS NOT NULL THEN 1 ELSE 0 END) AS watched_count
     FROM franchises LEFT JOIN movies ON movies.franchise_id = franchises.id
     GROUP BY franchises.id ORDER BY franchises.name COLLATE NOCASE`,
  ).all();
  return c.json({ franchises: result.results });
});

app.get("/api/franchises/:id", async (c) => {
  const franchise = await c.env.DB.prepare("SELECT * FROM franchises WHERE id = ?").bind(c.req.param("id")).first();
  if (!franchise) return c.json({ error: "Franchise not found" }, 404);
  const movies = await c.env.DB.prepare(
    `${movieSelect} WHERE movies.franchise_id = ? ORDER BY franchise_movies.position ASC`,
  ).bind(c.req.param("id")).all<MovieRow>();
  return c.json({ franchise, movies: movies.results });
});

app.get("/api/now-showing", async (c) => {
  const current = await getNowShowing(c.env);
  if (!current) return c.json({ nowShowing: null });
  const remaining = current.franchise_id ? await getRemainingFranchiseMovies(c.env, current.franchise_id) : [];
  return c.json({ nowShowing: current, remainingFranchiseMovies: remaining });
});

app.post("/api/movies", zValidator("json", movieInput), async (c) => {
  const actor = await mutationActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const input = c.req.valid("json");
  const id = newId();
  const timestamp = now();
  let franchiseId: string | null = null;

  if (input.franchiseName) {
    const existing = await c.env.DB.prepare("SELECT id FROM franchises WHERE name = ?").bind(input.franchiseName).first<{ id: string }>();
    franchiseId = existing?.id ?? newId();
    if (!existing) {
      await c.env.DB.prepare(
        "INSERT INTO franchises (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).bind(franchiseId, input.franchiseName, timestamp, timestamp).run();
    }
  }

  const position = franchiseId
    ? ((await c.env.DB.prepare("SELECT COALESCE(MAX(position), 0) AS max_position FROM franchise_movies WHERE franchise_id = ?").bind(franchiseId).first<{ max_position: number }>())?.max_position ?? 0) + 1
    : null;

  await c.env.DB.prepare(
    `INSERT INTO movies (id, title, title_normalized, added_at, added_by, updated_at, updated_by,
      release_date, poster_path, tmdb_id, tmdb_fetched_at, imdb_id, franchise_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.title, normalizeTitle(input.title), timestamp, actor.id, timestamp, actor.id, input.releaseDate ?? null, input.posterPath ?? null, input.tmdbId ?? null, input.tmdbId ? timestamp : null, input.imdbId ?? null, franchiseId).run();

  if (franchiseId && position !== null) {
    await c.env.DB.prepare("INSERT INTO franchise_movies (franchise_id, movie_id, position) VALUES (?, ?, ?)").bind(franchiseId, id, position).run();
  }
  await audit(c.env, "movie", id, "created", actor.id, { title: input.title });
  return c.json({ movie: await getMovie(c.env, id) }, 201);
});

app.patch("/api/movies/:id", zValidator("json", movieEditInput), async (c) => {
  const actor = await mutationActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const movieId = c.req.param("id");
  const input = c.req.valid("json");
  const existing = await getMovie(c.env, movieId);
  if (!existing) return c.json({ error: "Movie not found" }, 404);
  const timestamp = now();
  const title = input.title ?? existing.title;
  await c.env.DB.prepare(
    `UPDATE movies SET title = ?, title_normalized = ?, updated_at = ?, updated_by = ?,
      release_date = ?, poster_path = ?, tmdb_id = ?, tmdb_fetched_at = ?, imdb_id = ? WHERE id = ?`,
  ).bind(title, normalizeTitle(title), timestamp, actor.id, input.releaseDate === undefined ? existing.release_date : input.releaseDate, input.posterPath === undefined ? existing.poster_path : input.posterPath, input.tmdbId === undefined ? existing.tmdb_id : input.tmdbId, input.tmdbId !== undefined || input.releaseDate !== undefined || input.posterPath !== undefined ? timestamp : existing.tmdb_fetched_at, input.imdbId === undefined ? existing.imdb_id : input.imdbId, movieId).run();
  await audit(c.env, "movie", movieId, "updated", actor.id, { fields: Object.keys(input) });
  return c.json({ movie: await getMovie(c.env, movieId) });
});

app.post("/api/roll", async (c) => {
  const actor = await mutationActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const current = await getNowShowing(c.env);
  if (current?.movie_id && current.rating_score === null) return c.json({ error: "Rate the current movie before rolling again" }, 409);

  const rolled = await c.env.DB.prepare(
    "SELECT id, title, franchise_id FROM movies WHERE rating_score IS NULL ORDER BY RANDOM() LIMIT 1",
  ).first<{ id: string; title: string; franchise_id: string | null }>();
  if (!rolled) return c.json({ error: "There are no unwatched movies left" }, 409);

  const timestamp = now();
  const franchiseMovies = rolled.franchise_id ? await getFranchiseMovies(c.env, rolled.franchise_id) : [];
  const franchise = rolled.franchise_id
    ? await c.env.DB.prepare("SELECT order_confirmed FROM franchises WHERE id = ?").bind(rolled.franchise_id).first<{ order_confirmed: number }>()
    : null;
  const remainingFranchiseMovies = rolled.franchise_id ? await getRemainingFranchiseMovies(c.env, rolled.franchise_id) : [];
  const actual = rolled.franchise_id && franchise?.order_confirmed ? remainingFranchiseMovies[0] ?? rolled : rolled;
  const status = rolled.franchise_id && !franchise?.order_confirmed ? "pending_order" : "ready";

  const stateUpdate = await c.env.DB.prepare(
    `UPDATE now_showing SET rolled_movie_id = ?, movie_id = ?, franchise_id = ?,
       status = ?, rolled_at = ?, updated_at = ?
     WHERE id = 1 AND (movie_id IS NULL OR status = 'watched')`,
  ).bind(rolled.id, actual.id, rolled.franchise_id, status, timestamp, timestamp).run();
  if (!stateUpdate.meta.changes) return c.json({ error: "Someone else is already choosing the next movie" }, 409);
  await envRoll(c.env, rolled.id, actual.id, rolled.franchise_id, actor.id);
  return c.json({
    rolledMovie: await getMovie(c.env, rolled.id),
    nowShowing: await getNowShowing(c.env),
    needsOrder: status === "pending_order",
    franchiseMovies,
  });
});

const envRoll = async (env: AppEnv["Bindings"], rolledMovieId: string, actualMovieId: string, franchiseId: string | null, actorId: string) => {
  await env.DB.prepare(
    "INSERT INTO rolls (id, rolled_movie_id, actual_movie_id, franchise_id, created_at, actor_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(newId(), rolledMovieId, actualMovieId, franchiseId, now(), actorId).run();
};

app.post("/api/franchises/:id/order", zValidator("json", orderInput), async (c) => {
  const actor = await mutationActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const franchiseId = c.req.param("id");
  const input = c.req.valid("json");
  const members = await c.env.DB.prepare("SELECT id FROM movies WHERE franchise_id = ?").bind(franchiseId).all<{ id: string }>();
  const memberIds = new Set(members.results.map((movie) => movie.id));
  if (input.movieIds.length !== memberIds.size || input.movieIds.some((id) => !memberIds.has(id))) {
    return c.json({ error: "Order must include every movie in the franchise exactly once" }, 400);
  }

  const statements = input.movieIds.map((movieId, index) => c.env.DB.prepare(
    "UPDATE franchise_movies SET position = ? WHERE franchise_id = ? AND movie_id = ?",
  ).bind(index + 1, franchiseId, movieId));
  statements.push(c.env.DB.prepare("UPDATE franchises SET order_confirmed = 1, updated_at = ? WHERE id = ?").bind(now(), franchiseId));
  await c.env.DB.batch(statements);

  const current = await getNowShowing(c.env);
  if (current?.franchise_id === franchiseId && current.status === "pending_order") {
    const next = await getRemainingFranchiseMovies(c.env, franchiseId);
    const first = next[0];
    if (first) {
      await c.env.DB.prepare("UPDATE now_showing SET movie_id = ?, status = 'ready', updated_at = ? WHERE id = 1").bind(first.id, now()).run();
    }
  }
  await audit(c.env, "franchise", franchiseId, "order_updated", actor.id, { movieIds: input.movieIds });
  return c.json({ nowShowing: await getNowShowing(c.env) });
});

app.post("/api/next", async (c) => {
  const actor = await mutationActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const current = await getNowShowing(c.env);
  if (!current?.movie_id || current.rating_score === null || !current.franchise_id) return c.json({ error: "No watched franchise movie is ready to advance" }, 409);
  const next = (await getRemainingFranchiseMovies(c.env, current.franchise_id))[0];
  if (!next) return c.json({ error: "This franchise is complete", complete: true }, 409);
  await c.env.DB.prepare("UPDATE now_showing SET rolled_movie_id = ?, movie_id = ?, status = 'ready', updated_at = ? WHERE id = 1").bind(next.id, next.id, now()).run();
  await audit(c.env, "now_showing", "1", "advanced", actor.id, { movieId: next.id });
  return c.json({ nowShowing: await getNowShowing(c.env) });
});

app.post("/api/movies/:id/rate", zValidator("json", ratingInput), async (c) => {
  const actor = await mutationActor(c);
  if (!actor) return c.json({ error: "Authentication required" }, 401);
  const movieId = c.req.param("id");
  const input = c.req.valid("json");
  const movie = await getMovie(c.env, movieId);
  if (!movie) return c.json({ error: "Movie not found" }, 404);
  const timestamp = now();
  await c.env.DB.prepare(
    "UPDATE movies SET rating_score = ?, rating_phrase = ?, watched_at = COALESCE(watched_at, ?), updated_at = ?, updated_by = ? WHERE id = ?",
  ).bind(input.score, input.phrase, timestamp, timestamp, actor.id, movieId).run();
  await c.env.DB.prepare("UPDATE now_showing SET status = 'watched', updated_at = ? WHERE id = 1 AND movie_id = ?").bind(timestamp, movieId).run();
  await audit(c.env, "movie", movieId, "rated", actor.id, { score: input.score });
  return c.json({ movie: await getMovie(c.env, movieId), nowShowing: await getNowShowing(c.env) });
});

app.get("/api/tmdb/search", async (c) => {
  const query = c.req.query("query")?.trim();
  if (!query) return c.json({ results: [] });
  if (!c.env.TMDB_READ_ACCESS_TOKEN) return c.json({ error: "TMDB is not configured" }, 503);
  const response = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false&language=en-US`, {
    headers: { Authorization: `Bearer ${c.env.TMDB_READ_ACCESS_TOKEN}`, accept: "application/json" },
  });
  if (!response.ok) return c.json({ error: "TMDB lookup failed" }, response.status as 400 | 401 | 403 | 404 | 429 | 500);
  const data = (await response.json()) as { results?: Array<{ id: number; title: string; release_date?: string; poster_path?: string | null; imdb_id?: string }> };
  return c.json({ results: (data.results ?? []).slice(0, 8).map(({ id, title, release_date, poster_path, imdb_id }) => ({ id, title, releaseDate: release_date ?? null, posterPath: poster_path ?? null, imdbId: imdb_id ?? null })) });
});

app.get("*", async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text("Movie List API is running. Start Vite for the UI.", 404);
});

export default app;
