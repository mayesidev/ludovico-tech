import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, type Movie } from "../api";
import type { RunAction } from "../types";
import { EditMovieDialog } from "./edit-movie-dialog";

const movie = (id: string, title: string): Movie => ({
  added_at: "2026-08-07T00:00:00.000Z",
  franchise_id: "franchise-id",
  franchise_name: "Test Saga",
  franchise_position: 1,
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
    expect(screen.getByRole("dialog", { name: "Edit title" })).toBeVisible();
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByText("Enter a movie title.")).toHaveRole("alert");
    expect(api.updateMovie).not.toHaveBeenCalled();

    await user.type(input, "Updated Title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(api.updateMovie).toHaveBeenCalledWith("movie-id", {
      title: "Updated Title",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
