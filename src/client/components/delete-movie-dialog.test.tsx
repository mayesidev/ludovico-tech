import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Movie } from "../api";
import { DeleteMovieDialog } from "./delete-movie-dialog";

const movie: Movie = {
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: null,
  id: "movie-id",
  imdb_id: null,
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  version: null,
  version_runtime: null,
  version_reference_url: null,
  title: "Unwatched Movie",
  tmdb_id: null,
  watched_at: null,
};

describe("delete movie confirmation", () => {
  it("starts on the safe action and requires explicit confirmation", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DeleteMovieDialog
        busy={false}
        movie={movie}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Delete Unwatched Movie?" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Keep Movie" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Delete Movie" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with Escape without confirming", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <DeleteMovieDialog
        busy={false}
        movie={movie}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
