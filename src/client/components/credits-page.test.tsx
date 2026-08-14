import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreditsPage } from "./credits-page";

describe("credits page", () => {
  it("presents the project and provider credits", () => {
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
});
