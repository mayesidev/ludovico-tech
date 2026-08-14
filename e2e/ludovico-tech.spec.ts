import { expect, test } from "@playwright/test";

test.describe.serial("Ludovico Tech browser workflows", () => {
  test("presents the project credits and required attribution", async ({
    page,
  }) => {
    await page.goto("/credits");

    await expect(page).toHaveURL(/\/credits$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Credits" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ludovico Tech on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/mayesidev/ludovico-tech");
    await expect(
      page.getByText(
        "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
      ),
    ).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(0);
  });

  test("adds a movie, rolls it, and records its required final rating", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Ludovico Tech");
    await expect(
      page.getByText("A Pop Culture Re-education Program", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "No movie selected" }),
    ).toBeVisible();
    const tmdbResponse = await page.request.get(
      "/api/tmdb/search?query=Browser%20Test%20Feature",
    );
    expect(tmdbResponse.status()).toBe(503);
    await expect(tmdbResponse.json()).resolves.toEqual({
      error: "TMDB is not configured",
    });
    await page.getByRole("button", { name: "Add a movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Test Feature");
    await page.getByRole("button", { name: "Add movie", exact: true }).click();

    await page
      .getByRole("button", { name: "Choose a movie", exact: true })
      .click();
    const reveal = page.getByRole("status");
    await expect(reveal).toContainText("Choosing a movie");
    await expect(reveal).toBeHidden({
      timeout: 5_000,
    });

    await page.getByRole("slider", { name: "Final rating" }).fill("4.5");
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("A browser-tested classic");
    await page.getByRole("button", { name: "Rate it", exact: true }).click();

    await expect(page.getByText("Watched", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/A browser-tested classic/).first(),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "Browser Test Feature", exact: true })
      .click();
    await expect(page).toHaveURL(/\/movies\/[^?]+\?from=now-showing$/);
    await page.getByRole("link", { name: "Return to Now Showing" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page
      .getByRole("link", { name: "View details for Browser Test Feature" })
      .click();
    await expect(
      page.getByRole("link", { name: "Return to Now Showing" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Return to Now Showing" }).click();
  });

  test("orders and continues a collection, then rerolls with reduced motion", async ({
    page,
  }) => {
    await page.goto("/");

    for (const title of [
      "Browser Chapter One",
      "Browser Chapter Two",
      "Browser Chapter Three",
    ]) {
      await page.getByRole("button", { name: "Add a movie" }).click();
      await page.getByRole("textbox", { name: "Movie title" }).fill(title);
      await page
        .getByRole("textbox", { name: "Collection (optional)" })
        .fill("Browser Saga");
      await page
        .getByRole("button", { name: "Add movie", exact: true })
        .click();
    }

    await page
      .getByRole("button", { name: "Choose the next movie", exact: true })
      .click();
    await expect(page.getByRole("status")).toBeHidden({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter One" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Browser Saga" }).click();
    await expect(page).toHaveURL(/\/collections\//);
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Saga" }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByRole("button", { name: "Move Browser Chapter Two up" })
      .click();
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByRole("status")).toHaveText("Order saved.");
    await page.getByRole("link", { name: "Return to Now Showing" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter Two" }),
    ).toBeVisible();

    await page.getByRole("slider", { name: "Final rating" }).fill("4");
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("The second one goes first");
    await page.getByRole("button", { name: "Rate it" }).click();
    await page.getByRole("button", { name: "Continue collection" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter One" }),
    ).toBeVisible();

    await page.getByRole("slider", { name: "Final rating" }).fill("3.5");
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("Back to chapter one");
    await page.getByRole("button", { name: "Rate it" }).click();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Choose another movie" }).click();
    const reveal = page.getByRole("status");
    await expect(reveal).toBeVisible();
    expect(
      await reveal.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");
    await expect(reveal).toBeHidden({ timeout: 5_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Chapter Three" }),
    ).toBeVisible();
  });

  test("edits a movie and collection from its details page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add a movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Editable Movie");
    await page.getByRole("button", { name: "Add movie", exact: true }).click();

    await page.getByRole("link", { name: "Library" }).click();
    await page
      .getByRole("link", { name: "Browser Editable Movie", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Edited Movie");
    await page
      .getByRole("textbox", { name: "Collection" })
      .fill("Browser Edit Saga");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Edited Movie" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browser Edit Saga" }),
    ).toBeVisible();
    await expect(page.getByText("Collection")).toBeVisible();
  });

  test("confirms deletion of an unwatched movie from its details", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add a movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Deletion Candidate");
    await page.getByRole("button", { name: "Add movie", exact: true }).click();

    await page.getByRole("link", { name: "Library" }).click();
    await page
      .getByRole("link", { name: "Browser Deletion Candidate", exact: true })
      .click();
    await page.getByRole("button", { name: "Delete movie" }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Delete Browser Deletion Candidate?",
    });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Delete movie" }).click();

    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.getByRole("link", {
        name: "Browser Deletion Candidate",
        exact: true,
      }),
    ).toHaveCount(0);
  });

  test("keeps the catalog browse-only when auth is anonymous", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          actor: null,
          authenticated: false,
          local: false,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    const home = await page
      .getByRole("link", { name: "Ludovico Tech home" })
      .boundingBox();
    const nowShowing = await page
      .getByRole("link", { name: "Now showing" })
      .boundingBox();
    const library = await page
      .getByRole("link", { name: "Library" })
      .boundingBox();
    const signIn = await page
      .getByRole("button", { name: "Sign in", exact: true })
      .boundingBox();

    expect(home).not.toBeNull();
    expect(nowShowing).not.toBeNull();
    expect(library).not.toBeNull();
    expect(signIn).not.toBeNull();
    expect(home!.x + home!.width).toBeLessThanOrEqual(signIn!.x);
    expect(signIn!.x + signIn!.width).toBeLessThanOrEqual(320);
    expect(signIn!.height).toBeLessThanOrEqual(40);
    expect(nowShowing!.y).toBeGreaterThan(home!.y);
    expect(library!.x + library!.width).toBeLessThanOrEqual(320);
    await expect(page.getByRole("button", { name: "Add a movie" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Rate it" })).toHaveCount(0);
    const nowShowingLabel = page
      .locator("main section")
      .first()
      .getByText("Now showing", { exact: true });
    expect(
      await nowShowingLabel.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(18);
    await expect(page.getByText(/unwatched out of \d+ movies/)).toHaveCount(0);
    await page.getByRole("link", { name: "Library" }).click();
    await expect(
      page.getByText(/\d+ unwatched out of \d+ movies/),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Order" })).toHaveCount(0);
    const titleSort = page.getByRole("button", { name: "Title" });
    const renderedTitles = page.locator("tbody tr td:first-child a");
    await titleSort.click();
    const ascendingTitles = await renderedTitles.allTextContents();
    expect(ascendingTitles).toEqual(
      [...ascendingTitles].sort((left, right) => left.localeCompare(right)),
    );
    await titleSort.click();
    expect(await renderedTitles.allTextContents()).toEqual(
      [...ascendingTitles].reverse(),
    );
    await page.getByRole("link", { name: "Browser Test Feature" }).click();
    await expect(page).toHaveURL(/\/movies\//);
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Test Feature" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Browser Test Feature" }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
  });

  test("starts browser login through the Google authorization route", async ({
    page,
  }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          actor: null,
          authenticated: false,
          local: false,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/auth/google", async (route) => {
      await route.fulfill({
        headers: {
          location: "http://127.0.0.1:5174/oauth-provider/google",
        },
        status: 302,
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL("http://127.0.0.1:5174/oauth-provider/google");
  });
});
