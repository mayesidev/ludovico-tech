import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "../api";
import tmdbLogo from "../assets/tmdb-logo.svg";

const linkClassName =
  "inline-flex items-center justify-center gap-2 font-semibold text-marquee-light transition hover:text-cream";

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
    <article className="mx-auto max-w-3xl py-6 text-center sm:py-10">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-marquee-gold">
          A Ludovico Tech production
        </p>
        <h1 className="mt-5 font-display text-5xl font-bold uppercase tracking-[0.08em] text-cream sm:text-7xl">
          Credits
        </h1>
      </header>

      <div className="mt-16 space-y-16 sm:mt-24 sm:space-y-24">
        <section aria-labelledby="credits-background">
          <h2
            className="text-xs font-bold uppercase tracking-[0.28em] text-marquee-gold"
            id="credits-background"
          >
            Background
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-zinc-300 sm:text-lg">
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

        <section aria-labelledby="credits-production">
          <h2
            className="text-xs font-bold uppercase tracking-[0.28em] text-marquee-gold"
            id="credits-production"
          >
            Production
          </h2>
          <dl className="mx-auto mt-8 grid max-w-2xl gap-10 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Source code
              </dt>
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
            <div>
              <dt className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                License
              </dt>
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
            <div>
              <dt className="text-xs uppercase tracking-[0.22em] text-zinc-500">
                Version
              </dt>
              <dd className="mt-3 font-semibold text-cream">
                {version ?? "Unavailable"}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="credits-movie-data">
          <h2
            className="text-xs font-bold uppercase tracking-[0.28em] text-marquee-gold"
            id="credits-movie-data"
          >
            Movie data
          </h2>
          <a
            aria-label="The Movie Database"
            className="mt-8 inline-block"
            href="https://www.themoviedb.org/"
            rel="noreferrer"
            target="_blank"
          >
            <img alt="TMDB" className="h-5 w-auto sm:h-6" src={tmdbLogo} />
          </a>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-6 text-zinc-400">
            This application uses TMDB and the TMDB APIs but is not endorsed,
            certified, or otherwise approved by TMDB.
          </p>
        </section>
      </div>
    </article>
  );
}
