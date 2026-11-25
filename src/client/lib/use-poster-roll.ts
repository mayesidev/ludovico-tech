import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HomeMovie, type NowShowing } from "../api";
import type { AppRoute } from "../route";
import type { RunAction } from "../types";
import {
  POSTER_REEL_LEAD_IN_MS,
  POSTER_REEL_LIMIT,
  POSTER_REVEAL_DURATION_MS,
  posterReelDurationMs,
  preloadPosterPath,
  preloadPosterReel,
  selectPosterReel,
  wait,
} from "./poster-reel";
import { formatMovieTitle } from "./utils";

type RollRevealState = {
  reel: HomeMovie[];
  starting: { posterPath: string | null; title: string } | null;
  selected: { posterPath: string | null; title: string } | null;
};

export function usePosterRoll({
  authenticated,
  nowShowing,
  page,
  posterReelMovies,
  run,
  setNowShowing,
}: {
  authenticated: boolean;
  nowShowing: NowShowing | null;
  page: AppRoute["page"];
  posterReelMovies: HomeMovie[];
  run: RunAction;
  setNowShowing: (movie: NowShowing) => void;
}) {
  const [rollReveal, setRollReveal] = useState<RollRevealState | null>(null);
  const preparedPosterReelRef = useRef<Promise<HomeMovie[]> | null>(null);
  const preparedPosterReelSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      page !== "home" ||
      authenticated !== true ||
      posterReelMovies.length === 0
    ) {
      preparedPosterReelRef.current = null;
      preparedPosterReelSourceRef.current = null;
      return;
    }
    const source = posterReelMovies
      .map((movie) => `${movie.id}:${movie.poster_path ?? ""}`)
      .join("|");
    if (
      preparedPosterReelSourceRef.current === source &&
      preparedPosterReelRef.current
    )
      return;

    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const reel = selectPosterReel(
      posterReelMovies,
      Math.random,
      reducedMotion ? 1 : POSTER_REEL_LIMIT,
    );
    preparedPosterReelSourceRef.current = source;
    preparedPosterReelRef.current = preloadPosterReel(reel);
  }, [authenticated, posterReelMovies, page]);

  const roll = useCallback(() => {
    void run(async () => {
      const reducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const preparedReel =
        preparedPosterReelRef.current ??
        preloadPosterReel(
          selectPosterReel(
            posterReelMovies,
            Math.random,
            reducedMotion ? 1 : POSTER_REEL_LIMIT,
          ),
        );
      preparedPosterReelRef.current = null;
      const starting = nowShowing?.title
        ? {
            posterPath: nowShowing.poster_path,
            title: formatMovieTitle(nowShowing.title, nowShowing.version),
          }
        : null;
      setRollReveal({ reel: [], starting, selected: null });
      try {
        const [reel, result] = await Promise.all([
          preparedReel,
          api.roll(),
          wait(POSTER_REEL_LEAD_IN_MS),
        ]);
        setRollReveal((current) => (current ? { ...current, reel } : current));
        const [posterPath] = await Promise.all([
          preloadPosterPath(result.nowShowing.poster_path),
          wait(posterReelDurationMs(reel.length)),
        ]);
        const selected = {
          posterPath,
          title: formatMovieTitle(
            result.nowShowing.title ?? result.rolledMovie.title,
            result.nowShowing.version ?? result.rolledMovie.version,
          ),
        };
        setNowShowing(result.nowShowing);
        setRollReveal((current) => ({
          reel: current?.reel ?? [],
          starting: current?.starting ?? null,
          selected,
        }));
        await wait(POSTER_REVEAL_DURATION_MS);
      } finally {
        setRollReveal(null);
      }
    });
  }, [nowShowing, posterReelMovies, run, setNowShowing]);

  return { roll, rollReveal };
}
