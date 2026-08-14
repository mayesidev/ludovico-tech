import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { CreditsPage } from "./credits-page";

describe("credits page", () => {
  it("presents the project and provider credits", async () => {
    vi.spyOn(api, "health").mockResolvedValue({
      commit: "release-commit",
      environment: "production",
      ok: true,
      version: "v1.4.1",
    });
    render(<CreditsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Credits" }),
    ).toBeVisible();
    expect(
      screen.getByText(/shared movie watchlist for a group of friends/),
    ).toBeVisible();

    expect(
      screen.getByRole("link", { name: "Ludovico Tech on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/mayesidev/ludovico-tech");
    expect(screen.getByRole("link", { name: "MIT License" })).toHaveAttribute(
      "href",
      "https://github.com/mayesidev/ludovico-tech/blob/main/LICENSE",
    );
    expect(await screen.findByText("v1.4.1")).toBeVisible();
    expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(
      ["Version", "Source code", "License"],
    );

    expect(
      screen.getByRole("link", { name: "The Movie Database" }),
    ).toHaveAttribute("href", "https://www.themoviedb.org/");
    expect(screen.getByAltText("TMDB")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml/),
    );
    expect(
      screen.getByText(
        "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
      ),
    ).toBeVisible();
  });

  it("remains available when release health cannot be loaded", () => {
    vi.spyOn(api, "health").mockRejectedValue(new Error("Unavailable"));

    render(<CreditsPage />);

    expect(screen.getByText("Version")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
  });
});
