import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Clapperboard, LoaderCircle, Pencil, Plus, RotateCw, Search, Sparkles, Star, Table2, Ticket, X } from "lucide-react";
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { api, type AuthState, type Movie, type NowShowing, type TmdbResult } from "./api";
import { Badge, Button, Card, Input, SectionHeading } from "./components/ui";
import { cn, formatDate, posterUrl } from "./lib/utils";

type Tab = "home" | "library";

const scoreOptions = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [nowShowing, setNowShowing] = useState<NowShowing | null>(null);
  const [remaining, setRemaining] = useState<Movie[]>([]);
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rolledTitle, setRolledTitle] = useState<string | null>(null);
  const [orderDraft, setOrderDraft] = useState<Movie[] | null>(null);
  const [orderFranchiseId, setOrderFranchiseId] = useState<string | null>(null);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [current, list] = await Promise.all([api.nowShowing(), api.movies()]);
      setNowShowing(current.nowShowing);
      setRemaining(current.remainingFranchiseMovies);
      setMovies(list.movies);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the movie list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  useEffect(() => { void api.authMe().then(setAuth).catch(() => setAuth({ authenticated: false, actor: null, local: false })); }, []);

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try { await action(); after?.(); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Action failed"); } finally { setBusy(false); }
  };

  const roll = () => run(async () => {
    const result = await api.roll();
    setRolledTitle(result.rolledMovie.title);
    if (result.needsOrder) {
      setOrderDraft(result.franchiseMovies);
      setOrderFranchiseId(result.franchiseMovies[0]?.franchise_id ?? null);
    }
    window.setTimeout(() => setRolledTitle(null), 1800);
  });

  return (
    <div className="min-h-screen overflow-x-hidden bg-ink text-zinc-100">
      <div className="grain" />
      <header className="relative z-10 border-b border-white/8 bg-ink/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <button className="flex items-center gap-3 text-left" onClick={() => setTab("home")}>
            <span className="grid size-10 place-items-center rounded-2xl bg-lime-300 text-zinc-950 shadow-lg shadow-lime-300/10"><Clapperboard size={20} strokeWidth={2.5} /></span>
            <span><span className="block font-display text-lg font-bold tracking-tight">Movie List</span><span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">The watch club</span></span>
          </button>
          <div className="flex items-center gap-3"><nav className="flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] p-1"><NavButton active={tab === "home"} onClick={() => setTab("home")} icon={<Sparkles size={15} />}>Now showing</NavButton><NavButton active={tab === "library"} onClick={() => setTab("library")} icon={<Table2 size={15} />}>Library</NavButton></nav><AuthControls auth={auth} onLogout={() => void api.logout().then(() => setAuth({ authenticated: false, actor: null, local: false }))} /></div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-5 pb-20 pt-10 lg:px-8 lg:pt-16">
        {error && <div className="mb-6 flex items-center justify-between rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"><span>{error}</span><button onClick={() => setError(null)}><X size={16} /></button></div>}
        {loading ? <LoadingState /> : tab === "home" ? <Home nowShowing={nowShowing} remaining={remaining} movies={movies} busy={busy} roll={roll} run={run} refresh={refresh} /> : <Library movies={movies} onEdit={setEditingMovie} onOrder={async (franchiseId) => { const result = await api.franchise(franchiseId); setOrderDraft(result.movies); setOrderFranchiseId(franchiseId); }} />}
      </main>

      <Footer />
      {rolledTitle && <div className="reveal fixed inset-0 z-50 grid place-items-center bg-ink/90 p-6 backdrop-blur-md"><div className="text-center"><div className="mx-auto mb-6 grid size-24 place-items-center rounded-[2rem] border border-lime-300/30 bg-lime-300/10 text-lime-300"><Ticket size={40} /></div><p className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-lime-300">The roll is in</p><h2 className="font-display text-4xl font-bold text-white sm:text-6xl">{rolledTitle}</h2></div></div>}
      {orderDraft && orderFranchiseId && <OrderDialog draft={orderDraft} setDraft={(value) => { setOrderDraft(value); if (!value) setOrderFranchiseId(null); }} franchiseId={orderFranchiseId} run={run} />}
      {editingMovie && <EditMovieDialog movie={editingMovie} setMovie={setEditingMovie} run={run} />}
    </div>
  );
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn("flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition", active ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200")}>{icon}{children}</button>;
}

function AuthControls({ auth, onLogout }: { auth: AuthState | null; onLogout: () => void }) {
  if (!auth || auth.local) return null;
  if (!auth.authenticated) return <Button variant="secondary" onClick={() => { window.location.href = "/api/auth/google"; }}>Sign in</Button>;
  return <button onClick={onLogout} className="hidden max-w-[180px] truncate rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white sm:block">{auth.actor?.email}</button>;
}

function LoadingState() { return <div className="grid min-h-[50vh] place-items-center"><LoaderCircle className="animate-spin text-lime-300" /></div>; }

function Home({ nowShowing, remaining, movies, busy, roll, run, refresh }: { nowShowing: NowShowing | null; remaining: Movie[]; movies: Movie[]; busy: boolean; roll: () => void; run: (action: () => Promise<unknown>, after?: () => void) => Promise<void>; refresh: () => Promise<void> }) {
  const isWatched = nowShowing?.rating_score !== null && nowShowing?.rating_score !== undefined;
  const hasNext = remaining.some((movie) => movie.rating_score === null);
  const unwatchedCount = movies.filter((movie) => movie.rating_score === null).length;
  const franchiseId = nowShowing?.franchise_id;
  return <div className="space-y-16">
    <section className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      <div><p className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-lime-300"><span className="size-2 rounded-full bg-lime-300 shadow-[0_0_18px] shadow-lime-300" /> Weekly screening</p><h1 className="max-w-3xl font-display text-5xl font-bold leading-[0.95] tracking-[-0.055em] text-white sm:text-7xl">What’s on the <span className="text-lime-300">marquee?</span></h1><p className="mt-6 max-w-xl text-base leading-7 text-zinc-400">One shared list. One movie at a time. A little ceremony before the next screening.</p></div>
      <div className="justify-self-end text-right"><p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">The collection</p><p className="mt-1 font-display text-5xl font-bold text-white">{unwatchedCount || "—"}</p><p className="text-sm text-zinc-500">movies in rotation</p></div>
    </section>

    <section>
      <SectionHeading eyebrow="Now showing" title={nowShowing?.title ?? "The screen is waiting"} description={nowShowing?.franchise_name ? `${nowShowing.franchise_name} · choose your own order` : "Roll the list when the group is ready for something new."} />
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(190,242,100,0.12),transparent_32%),linear-gradient(120deg,rgba(255,255,255,0.02),transparent)]" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[220px_1fr] lg:p-10">
          <Poster path={nowShowing?.poster_path} title={nowShowing?.title ?? "Waiting for the next roll"} large />
          <div className="flex min-h-[300px] flex-col justify-between">
            <div>{nowShowing?.franchise_name && <Badge className="mb-5 border-lime-300/20 bg-lime-300/10 text-lime-200">{nowShowing.franchise_name}</Badge>}{nowShowing?.title ? <><h3 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">{nowShowing.title}</h3><p className="mt-3 text-sm text-zinc-500">{formatDate(nowShowing.release_date)}{isWatched && " · Watched"}</p></> : <h3 className="max-w-md font-display text-4xl font-bold tracking-tight text-white">Cue the drumroll.</h3>}{nowShowing?.rating_score !== null && nowShowing?.rating_score !== undefined && <div className="mt-7 flex items-center gap-3"><span className="flex items-center gap-1 text-lime-300"><Star size={17} fill="currentColor" /> {nowShowing.rating_score}/5</span><span className="text-sm italic text-zinc-400">“{nowShowing.rating_phrase || "A rating without a tagline."}”</span></div>}</div>
            {nowShowing?.movie_id && !isWatched ? <RatingForm movieId={nowShowing.movie_id} run={run} /> : <div className="mt-8 flex flex-wrap gap-3">{isWatched && franchiseId && hasNext && <Button onClick={() => void run(() => api.next())} disabled={busy}><ArrowDown size={16} /> Next movie</Button>}<Button onClick={roll} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <RotateCw size={16} />} {isWatched && franchiseId && hasNext ? "Roll something new" : "Roll next"}</Button></div>}
          </div>
        </div>
      </Card>
    </section>

    <section><SectionHeading eyebrow="Recently viewed" title="A little history" description="The movies that have already made it through the program." /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{movies.filter((movie) => movie.rating_score !== null).sort((a, b) => (b.watched_at ?? "").localeCompare(a.watched_at ?? "")).slice(0, 4).map((movie, index) => <HistoryCard key={movie.id} movie={movie} index={index} />)}{movies.filter((movie) => movie.rating_score !== null).length === 0 && [...Array(4)].map((_, index) => <HistoryCard key={`empty-${index}`} movie={null} index={index} />)}</div></section>
    <AddMovieSection run={run} refresh={refresh} />
  </div>;
}

function RatingForm({ movieId, run }: { movieId: string; run: (action: () => Promise<unknown>, after?: () => void) => Promise<void> }) {
  const [score, setScore] = useState<number | null>(null);
  const [phrase, setPhrase] = useState("");
  return <form className="mt-8 max-w-lg" onSubmit={(event) => { event.preventDefault(); if (score === null) return; void run(() => api.rate(movieId, score, phrase), () => { setScore(null); setPhrase(""); }); }}><p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Final rating</p><div className="flex flex-wrap gap-2">{scoreOptions.map((option) => <button type="button" key={option} onClick={() => setScore(option)} className={cn("grid size-10 place-items-center rounded-xl border text-sm font-bold transition", score === option ? "border-lime-300 bg-lime-300 text-zinc-950" : "border-white/10 bg-white/5 text-zinc-300 hover:border-lime-300/50")}>{option}</button>)}</div><div className="mt-3 flex gap-2"><Input value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder="Give it a goofy phrase…" maxLength={120} /><Button type="submit" disabled={score === null}>Rate it</Button></div></form>;
}

function OrderDialog({ draft, setDraft, franchiseId, run }: { draft: Movie[]; setDraft: (value: Movie[] | null) => void; franchiseId: string; run: (action: () => Promise<unknown>, after?: () => void) => Promise<void> }) {
  const move = (index: number, direction: -1 | 1) => { const next = [...draft]; const swap = index + direction; if (swap < 0 || swap >= next.length) return; [next[index], next[swap]] = [next[swap], next[index]]; setDraft(next); };
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-5 backdrop-blur-sm"><Card className="w-full max-w-lg p-6 sm:p-8"><div className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">Franchise order</p><h2 className="mt-2 font-display text-3xl font-bold text-white">How should we watch it?</h2><p className="mt-2 text-sm leading-6 text-zinc-400">Set the order once. You can edit it later from the library.</p></div><div className="space-y-2">{draft.map((movie, index) => <div key={movie.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.035] p-3"><span className="grid size-7 place-items-center rounded-lg bg-white/8 text-xs font-bold text-zinc-400">{index + 1}</span><span className="flex-1 text-sm font-medium text-white">{movie.title}</span><div className="flex gap-1"><button className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white" onClick={() => move(index, -1)}><ArrowUp size={15} /></button><button className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/10 hover:text-white" onClick={() => move(index, 1)}><ArrowDown size={15} /></button></div></div>)}</div><div className="mt-6 flex justify-end"><Button onClick={() => void run(() => api.order(franchiseId, draft.map((movie) => movie.id)), () => setDraft(null))}>Use this order</Button></div></Card></div>;
}

function Poster({ path, title, large = false }: { path: string | null | undefined; title: string; large?: boolean }) { const src = posterUrl(path); return src ? <img src={src} alt={`Poster for ${title}`} className={cn("aspect-[2/3] w-full rounded-2xl object-cover shadow-2xl shadow-black/40", large ? "max-w-[220px]" : "max-w-[90px]")} /> : <div className={cn("poster-fallback grid aspect-[2/3] w-full place-items-center rounded-2xl border border-white/10 p-5 text-center", large ? "max-w-[220px]" : "max-w-[90px]")}><Clapperboard className="text-lime-300/60" size={large ? 34 : 20} /><span className="mt-3 text-xs font-semibold text-zinc-500">{title}</span></div>; }

function HistoryCard({ movie, index }: { movie: Movie | null; index: number }) { return <Card className="overflow-hidden p-3"><div className="flex gap-3"><Poster path={movie?.poster_path} title={movie?.title ?? ["A recent favorite", "A questionable classic", "One for the archives", "A movie happened"][index]} /><div className="flex flex-col justify-center"><p className="text-xs uppercase tracking-[0.14em] text-zinc-600">{movie ? "Recently viewed" : "Coming soon"}</p><p className="mt-2 font-display text-lg font-bold text-white">{movie?.title ?? ["More history", "More history", "More history", "More history"][index]}</p>{movie?.rating_score !== null && movie?.rating_score !== undefined && <p className="mt-2 text-xs text-lime-300">{movie.rating_score}/5 · {movie.rating_phrase}</p>}</div></div></Card>; }

function AddMovieSection({ run, refresh }: { run: (action: () => Promise<unknown>, after?: () => void) => Promise<void>; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [franchiseName, setFranchiseName] = useState("");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [selected, setSelected] = useState<TmdbResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const reset = () => { setOpen(false); setTitle(""); setFranchiseName(""); setResults([]); setSelected(null); setSearchError(null); };
  const search = async () => {
    if (!title.trim()) return;
    setSearching(true); setSearchError(null);
    try { setResults((await api.tmdbSearch(title)).results); } catch (cause) { setSearchError(cause instanceof Error ? cause.message : "TMDB search failed"); } finally { setSearching(false); }
  };

  return <section className="border-t border-white/8 pt-16"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><SectionHeading eyebrow="Contribute" title="Add to the list" description="Find the movie, confirm the match, and send it into rotation." /><Button onClick={() => setOpen((value) => !value)} variant={open ? "secondary" : "primary"}>{open ? <X size={16} /> : <Plus size={16} />} {open ? "Close" : "Add a movie"}</Button></div>{open && <Card className="mt-5 p-5 sm:p-6"><div className="grid gap-4 lg:grid-cols-[1fr_auto]"><div className="flex gap-2"><Input value={title} onChange={(event) => { setTitle(event.target.value); setSelected(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="Movie title" /><Button onClick={() => void search()} disabled={searching || !title.trim()}>{searching ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />} Search TMDB</Button></div><Input value={franchiseName} onChange={(event) => setFranchiseName(event.target.value)} placeholder="Series / franchise (optional)" /></div>{searchError && <p className="mt-4 text-sm text-red-200">{searchError}</p>}{results.length > 0 && <div className="mt-5 grid gap-3 sm:grid-cols-2">{results.map((result) => <button key={result.id} onClick={() => { setSelected(result); setTitle(result.title); }} className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition", selected?.id === result.id ? "border-lime-300 bg-lime-300/10" : "border-white/8 bg-white/[0.03] hover:border-white/20")}><Poster path={result.posterPath} title={result.title} /><span><span className="block font-semibold text-white">{result.title}</span><span className="mt-1 block text-xs text-zinc-500">{result.releaseDate ? formatDate(result.releaseDate) : "Release date unknown"}</span></span></button>)}</div>}{title && <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/8 pt-5"><p className="text-sm text-zinc-400">{selected ? `Confirmed: ${selected.title}` : "You can add this title without a TMDB match."}</p><Button onClick={() => void run(() => api.addMovie({ title, franchiseName, releaseDate: selected?.releaseDate, posterPath: selected?.posterPath, tmdbId: selected?.id, imdbId: selected?.imdbId }), () => { reset(); void refresh(); })}><Plus size={16} /> Add movie</Button></div>}</Card>}</section>;
}

function Library({ movies, onEdit, onOrder }: { movies: Movie[]; onEdit: (movie: Movie) => void; onOrder: (franchiseId: string) => Promise<void> }) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo<ColumnDef<Movie>[]>(() => [
    { accessorKey: "title", header: "Title", cell: ({ row }) => <div><p className="font-semibold text-white">{row.original.title}</p><p className="text-xs text-zinc-500">{row.original.franchise_name ?? "Standalone"}</p></div> },
    { accessorKey: "release_date", header: "Release", cell: ({ getValue }) => formatDate(getValue<string | null>()) },
    { accessorKey: "rating_score", header: "Rating", cell: ({ row }) => row.original.rating_score === null ? <Badge>Not watched</Badge> : <span className="text-lime-300">{row.original.rating_score}/5</span> },
    { accessorKey: "watched_at", header: "Status", cell: ({ row }) => row.original.rating_score !== null ? <Badge className="border-lime-300/20 bg-lime-300/10 text-lime-200">Watched</Badge> : <Badge>In rotation</Badge> },
    { id: "actions", header: "Actions", enableSorting: false, cell: ({ row }) => <div className="flex gap-2"><button className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-white/25 hover:text-white" onClick={() => onEdit(row.original)}><Pencil size={13} /> Edit</button>{row.original.franchise_id && <button className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-white/25 hover:text-white" onClick={() => void onOrder(row.original.franchise_id!)}>Order</button>}</div> },
  ], [onEdit, onOrder]);
  const table = useReactTable({ data: movies, columns, state: { globalFilter: filter, sorting }, onGlobalFilterChange: setFilter, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel() });
  return <div><div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><SectionHeading eyebrow="The library" title="Every movie in rotation" description="Search the whole list, including movies already viewed." /><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-3.5 text-zinc-600" size={16} /><Input className="pl-9" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search titles…" /></div></div><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b border-white/8 bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-zinc-500">{table.getHeaderGroups().map((headerGroup) => <tr key={headerGroup.id}>{headerGroup.headers.map((header) => <th key={header.id} className="px-5 py-4 font-bold">{header.column.getCanSort() ? <button onClick={header.column.getToggleSortingHandler()} className="hover:text-white">{flexRender(header.column.columnDef.header, header.getContext())}{header.column.getIsSorted() ? header.column.getIsSorted() === "asc" ? " ↑" : " ↓" : ""}</button> : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead><tbody className="divide-y divide-white/6">{table.getRowModel().rows.map((row) => <tr key={row.id} className="transition hover:bg-white/[0.035]">{row.getVisibleCells().map((cell) => <td key={cell.id} className="px-5 py-4 text-zinc-400">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div><div className="border-t border-white/8 px-5 py-4 text-xs text-zinc-600">{table.getFilteredRowModel().rows.length} of {movies.length} movies</div></Card></div>;
}

function EditMovieDialog({ movie, setMovie, run }: { movie: Movie; setMovie: (movie: Movie | null) => void; run: (action: () => Promise<unknown>, after?: () => void) => Promise<void> }) {
  const [title, setTitle] = useState(movie.title);
  const [releaseDate, setReleaseDate] = useState(movie.release_date ?? "");
  const [posterPath, setPosterPath] = useState(movie.poster_path ?? "");
  const [imdbId, setImdbId] = useState(movie.imdb_id ?? "");
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/65 p-5 backdrop-blur-sm"><Card className="w-full max-w-lg p-6 sm:p-8"><div className="mb-6 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-lime-300">Movie details</p><h2 className="mt-2 font-display text-3xl font-bold text-white">Edit metadata</h2><p className="mt-2 text-sm leading-6 text-zinc-400">Changes are attributed to the signed-in contributor.</p></div><button className="text-zinc-500 hover:text-white" onClick={() => setMovie(null)}><X /></button></div><div className="space-y-4"><label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Title<Input className="mt-2" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Release date<Input className="mt-2" type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} /></label><label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Poster path<Input className="mt-2" value={posterPath} onChange={(event) => setPosterPath(event.target.value)} placeholder="/example-poster.jpg" /></label><label className="block text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">IMDb ID<Input className="mt-2" value={imdbId} onChange={(event) => setImdbId(event.target.value)} placeholder="tt1234567" /></label></div><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={() => setMovie(null)}>Cancel</Button><Button disabled={!title.trim()} onClick={() => void run(() => api.updateMovie(movie.id, { title, releaseDate: releaseDate || null, posterPath: posterPath || null, imdbId: imdbId || null }), () => setMovie(null))}>Save changes</Button></div></Card></div>;
}

function Footer() { return <footer className="relative z-10 mx-auto max-w-7xl border-t border-white/8 px-5 py-8 text-xs leading-5 text-zinc-600 lg:px-8"><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><a className="mt-1 inline-block text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-300" href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a></footer>; }
