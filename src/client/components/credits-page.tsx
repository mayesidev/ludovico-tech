import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "../api";
import tmdbLogo from "../assets/tmdb-logo.svg";

const linkClassName =
  "inline-flex items-center gap-2 font-semibold text-highlight-soft transition hover:text-text-primary";

export function CreditsPage() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .health()
      .then((health) => {
        if (active) setVersion(health.version);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <article className="w-full py-4 sm:py-8">
      <header className="border-b border-border-subtle pb-8">
        <h1 className="font-heading text-5xl font-medium leading-none tracking-[-0.045em] text-text-primary sm:text-7xl">
          Credits
        </h1>
      </header>

      <div className="mt-10 space-y-12 sm:mt-14 sm:space-y-16">
        <section
          aria-labelledby="credits-background"
          className="grid gap-5 md:grid-cols-[minmax(180px,0.28fr)_minmax(0,1fr)] md:gap-10"
        >
          <h2
            className="font-heading text-2xl font-medium tracking-tight text-text-primary"
            id="credits-background"
          >
            Background
          </h2>
          <p className="text-base leading-8 text-text-secondary sm:text-lg">
            Ludovico Tech is a shared movie watchlist for a group of friends
            with more recommendations than movie nights. It grew from the group
            repeatedly asking one friend, “You haven&apos;t seen that?!” into a
            long-running, RiffTrax-esque pop-culture re-education program. The
            group maintains the list and randomly chooses what to watch next to
            keep things fair and interesting. After each movie, that one friend
            has to rate it with a contextual reference to check it off the list
            before another can be chosen. The name is a tongue-in-cheek nod to
            the Ludovico Technique in <cite>A Clockwork Orange</cite>. After
            all, while the group tries to make movie nights enjoyable for
            everyone, that one friend <em>is</em> still being forced to watch a
            lot of movies...
          </p>
        </section>

        <section
          aria-labelledby="credits-production"
          className="grid gap-5 md:grid-cols-[minmax(180px,0.28fr)_minmax(0,1fr)] md:gap-10"
        >
          <h2
            className="font-heading text-2xl font-medium tracking-tight text-text-primary"
            id="credits-production"
          >
            Production
          </h2>
          <dl className="surface-panel grid overflow-hidden rounded-sm border sm:grid-cols-3">
            <div className="border-b border-border-subtle p-5 sm:border-b-0 sm:border-r">
              <dt className="ui-label text-text-muted">Version</dt>
              <dd className="mt-3 font-semibold text-text-primary">
                {version ?? "Unavailable"}
              </dd>
            </div>
            <div className="border-b border-border-subtle p-5 sm:border-b-0 sm:border-r">
              <dt className="ui-label text-text-muted">Source Code</dt>
              <dd className="mt-3">
                <a
                  className={linkClassName}
                  href="https://github.com/mayesidev/ludovico-tech"
                  rel="noreferrer"
                  target="_blank"
                >
                  Ludovico Tech on GitHub
                  <ExternalLink size={15} />
                </a>
              </dd>
            </div>
            <div className="p-5">
              <dt className="ui-label text-text-muted">License</dt>
              <dd className="mt-3">
                <a
                  className={linkClassName}
                  href="https://github.com/mayesidev/ludovico-tech/blob/main/LICENSE"
                  rel="noreferrer"
                  target="_blank"
                >
                  MIT License
                  <ExternalLink size={15} />
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="credits-movie-data"
          className="grid gap-5 md:grid-cols-[minmax(180px,0.28fr)_minmax(0,1fr)] md:gap-10"
        >
          <h2
            className="font-heading text-2xl font-medium tracking-tight text-text-primary"
            id="credits-movie-data"
          >
            Movie Data
          </h2>
          <div>
            <a
              aria-label="The Movie Database"
              className="inline-block"
              href="https://www.themoviedb.org/"
              rel="noreferrer"
              target="_blank"
            >
              <img alt="TMDB" className="h-5 w-auto sm:h-6" src={tmdbLogo} />
            </a>
            <p className="mt-6 max-w-xl text-sm leading-6 text-text-muted">
              This application uses TMDB and the TMDB APIs but is not endorsed,
              certified, or otherwise approved by TMDB.
            </p>
          </div>
        </section>
      </div>
    </article>
  );
}
