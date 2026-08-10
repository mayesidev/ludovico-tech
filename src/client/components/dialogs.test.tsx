import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, type Movie } from "../api";
import type { RunAction } from "../types";
import { EditMovieDialog } from "./edit-movie-dialog";

const movie = (id: string, title: string): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  collection_id: "collection-id",
  collection_name: "Test Saga",
  collection_position: 1,
  id,
  poster_path: null,
  rating_phrase: null,
  rating_score: null,
  release_date: null,
  runtime_minutes: null,
  title,
  tmdb_id: null,
  watched_at: null,
});

const run: RunAction = async (action, after) => {
  await action();
  after?.();
};

function EditHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open edit</button>
      {open && (
        <EditMovieDialog
          busy={false}
          movie={movie("movie-id", "Original Title")}
          onAuthExpired={vi.fn().mockResolvedValue(undefined)}
          onClose={() => setOpen(false)}
          run={run}
        />
      )}
    </>
  );
}

describe("accessible dialogs", () => {
  it("names the edit dialog, validates, focuses, escapes, and restores focus", async () => {
    vi.spyOn(api, "updateMovie").mockResolvedValue({
      movie: movie("movie-id", "Updated Title"),
    });
    const user = userEvent.setup();
    render(<EditHarness />);

    const trigger = screen.getByRole("button", { name: "Open edit" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Edit movie" })).toBeVisible();
    const input = screen.getByRole("textbox", { name: "Movie title" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Enter a movie title.")).toHaveRole("alert");
    expect(api.updateMovie).not.toHaveBeenCalled();

    await user.type(input, "Updated Title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.updateMovie).toHaveBeenCalledWith("movie-id", {
      collectionName: "Test Saga",
      title: "Updated Title",
      tmdbId: null,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("searches again after a title change and updates collection membership", async () => {
    vi.spyOn(api, "tmdbSearch").mockResolvedValue({
      results: [
        {
          id: 42,
          posterPath: null,
          releaseDate: "2026-08-10",
          title: "Authoritative Title",
        },
      ],
    });
    vi.spyOn(api, "updateMovie").mockResolvedValue({
      movie: {
        ...movie("movie-id", "Authoritative Title"),
        collection_name: "New Saga",
        tmdb_id: 42,
      },
    });
    const user = userEvent.setup();
    render(<EditHarness />);

    await user.click(screen.getByRole("button", { name: "Open edit" }));
    const title = screen.getByRole("textbox", { name: "Movie title" });
    await user.clear(title);
    await user.type(title, "Candidate Title");
    expect(screen.queryByText(/TMDB #[0-9]+ will be checked/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Search TMDB" }));
    await user.click(
      await screen.findByRole("button", { name: /Authoritative Title/ }),
    );
    const collection = screen.getByRole("textbox", {
      name: "Collection",
    });
    await user.clear(collection);
    await user.type(collection, "New Saga");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(api.updateMovie).toHaveBeenCalledWith("movie-id", {
      collectionName: "New Saga",
      title: "Authoritative Title",
      tmdbId: 42,
    });
  });
});
