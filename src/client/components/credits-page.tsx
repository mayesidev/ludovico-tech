import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "../api";
import tmdbLogo from "../assets/tmdb-logo.svg";

const linkClassName =
  "inline-flex items-center gap-2 font-normal text-highlight-soft transition hover:text-text-primary";

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
    <article className="w-full">
      <header className="flex items-center justify-center gap-4 text-center sm:gap-5">
        <span aria-hidden="true" className="block h-px w-12 bg-highlight/70" />
        <h1 className="font-heading text-3xl font-medium leading-none tracking-[0.01em] text-text-primary sm:text-4xl">
          Credits
        </h1>
        <span aria-hidden="true" className="block h-px w-12 bg-highlight/70" />
      </header>

      <div className="mx-auto mt-10 max-w-5xl space-y-10 sm:mt-12 sm:space-y-12">
        <section aria-labelledby="credits-background">
          <h2
            className="text-center font-heading text-2xl font-medium leading-none tracking-tight text-text-primary"
            id="credits-background"
          >
            Background
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-3 md:gap-8">
            <p className="text-center text-base font-normal leading-7 text-text-secondary">
              Ludovico Tech is a shared movie watchlist for a group of friends
              with more recommendations than movie nights. It grew from the
              group repeatedly asking one friend, “You haven&apos;t seen that?!”
              into a long-running, RiffTrax-esque pop-culture re-education
              program.
            </p>
            <p className="text-center text-base font-normal leading-7 text-text-secondary">
              The group maintains the list and randomly chooses what to watch
              next to keep things fair and interesting. After each movie, that
              one friend has to rate it with a contextual reference to check it
              off the list before another can be chosen.
            </p>
            <p className="text-center text-base font-normal leading-7 text-text-secondary">
              The name is a tongue-in-cheek nod to the Ludovico Technique in{" "}
              <cite>A Clockwork Orange</cite>. After all, while the group tries
              to make movie nights enjoyable for everyone, that one friend{" "}
              <em>is</em> still being forced to watch a lot of movies...
            </p>
          </div>
        </section>

        <section aria-labelledby="credits-production">
          <h2
            className="text-center font-heading text-2xl font-medium leading-none tracking-tight text-text-primary"
            id="credits-production"
          >
            Production
          </h2>
          <dl className="mt-5 grid gap-6 text-center text-base font-normal leading-7 sm:grid-cols-3 sm:gap-10">
            <div>
              <dt className="text-text-muted">Version</dt>
              <dd className="mt-1 text-text-primary">
                {version ?? "Unavailable"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Source Code</dt>
              <dd className="mt-1">
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
            <div>
              <dt className="text-text-muted">License</dt>
              <dd className="mt-1">
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

        <section aria-labelledby="credits-movie-data" className="text-center">
          <h2
            className="text-center font-heading text-2xl font-medium leading-none tracking-tight text-text-primary"
            id="credits-movie-data"
          >
            Movie Data
          </h2>
          <div className="mt-5">
            <a
              aria-label="The Movie Database"
              className="inline-block"
              href="https://www.themoviedb.org/"
              rel="noreferrer"
              target="_blank"
            >
              <img alt="TMDB" className="h-5 w-auto sm:h-6" src={tmdbLogo} />
            </a>
            <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-7 text-text-secondary">
              This application uses TMDB and the TMDB APIs but is not endorsed,
              certified, or otherwise approved by TMDB.
            </p>
          </div>
        </section>
      </div>
    </article>
  );
}
