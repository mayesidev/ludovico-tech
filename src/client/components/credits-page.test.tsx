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

    const pageHeading = screen.getByRole("heading", {
      level: 1,
      name: "Credits",
    });
    expect(pageHeading).toBeVisible();
    expect(pageHeading).toHaveClass("tracking-[0.01em]");
    expect(pageHeading.closest("article")).toHaveClass("w-full");
    expect(pageHeading.closest("article")).not.toHaveClass("py-2", "sm:py-4");
    const pageHeader = pageHeading.closest("header");
    expect(pageHeader).toHaveClass(
      "flex",
      "items-center",
      "justify-center",
      "text-center",
    );
    const decorations = pageHeader?.querySelectorAll(
      "span[aria-hidden='true']",
    );
    expect(decorations).toHaveLength(2);
    for (const decoration of decorations ?? []) {
      expect(decoration).toHaveClass("h-px", "w-12");
      expect(decoration).not.toHaveClass("mb-3", "mt-3");
    }
    const backgroundCopy = screen.getByText(
      /shared movie watchlist for a group of friends/,
    );
    expect(backgroundCopy).toBeVisible();
    expect(backgroundCopy).toHaveClass("text-base", "font-normal", "leading-7");
    expect(backgroundCopy).not.toHaveClass("sm:text-lg", "font-semibold");

    const sourceLink = screen.getByRole("link", {
      name: "Ludovico Tech on GitHub",
    });
    expect(sourceLink).toHaveAttribute(
      "href",
      "https://github.com/mayesidev/ludovico-tech",
    );
    expect(sourceLink).toHaveClass("font-normal");
    const licenseLink = screen.getByRole("link", { name: "MIT License" });
    expect(licenseLink).toHaveAttribute(
      "href",
      "https://github.com/mayesidev/ludovico-tech/blob/main/LICENSE",
    );
    expect(licenseLink).toHaveClass("font-normal");
    expect(await screen.findByText("v1.4.1")).toBeVisible();
    const productionTerms = screen.getAllByRole("term");
    expect(productionTerms.map((term) => term.textContent)).toEqual([
      "Version",
      "Source Code",
      "License",
    ]);
    expect(productionTerms[0]?.closest("dl")).toHaveClass(
      "text-base",
      "font-normal",
      "leading-7",
    );
    for (const term of productionTerms) {
      expect(term).not.toHaveClass("ui-label", "font-semibold");
    }
    for (const name of ["Background", "Production", "Movie Data"]) {
      const region = screen.getByRole("region", { name });
      expect(screen.getByRole("heading", { level: 2, name })).toHaveClass(
        "leading-none",
        "text-center",
      );
      const content = region.querySelector("h2 + *");
      expect(content).toHaveClass("mt-5");
      expect(content).not.toHaveClass("border-y");
    }
    expect(
      screen.getByRole("region", { name: "Background" }).querySelector("div"),
    ).toHaveClass("md:grid-cols-3");

    expect(
      screen.getByRole("link", { name: "The Movie Database" }),
    ).toHaveAttribute("href", "https://www.themoviedb.org/");
    expect(screen.getByAltText("TMDB")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml/),
    );
    const tmdbNotice = screen.getByText(
      "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
    );
    expect(tmdbNotice).toBeVisible();
    expect(tmdbNotice).toHaveClass("text-base", "font-normal", "leading-7");
    expect(tmdbNotice).not.toHaveClass("text-sm", "font-semibold");
  });

  it("remains available when release health cannot be loaded", () => {
    vi.spyOn(api, "health").mockRejectedValue(new Error("Unavailable"));

    render(<CreditsPage />);

    expect(screen.getByText("Version")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
  });
});
