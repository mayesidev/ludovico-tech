import { expect, test } from "@playwright/test";

test.describe.serial("Ludovico Tech browser workflows", () => {
  test("adds a movie, rolls it, and records its required final rating", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Ludovico Tech");
    await expect(
      page.getByRole("heading", { name: "What’s on the marquee?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add a movie" }).click();
    await page
      .getByRole("textbox", { name: "Movie title" })
      .fill("Browser Test Feature");
    await page.getByRole("button", { name: "Add movie", exact: true }).click();

    await page.getByRole("button", { name: "Roll next", exact: true }).click();
    await expect(page.getByText("The roll is in")).toBeHidden({
      timeout: 5_000,
    });

    await page.getByRole("button", { name: "4.5", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("A browser-tested classic");
    await page.getByRole("button", { name: "Rate it", exact: true }).click();

    await expect(page.getByText(/Unknown date · Watched/)).toBeVisible();
    await expect(
      page.getByText(/A browser-tested classic/).first(),
    ).toBeVisible();
  });

  test("orders and continues a series, then rerolls with reduced motion", async ({
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
        .getByRole("textbox", { name: "Series or franchise (optional)" })
        .fill("Browser Saga");
      await page
        .getByRole("button", { name: "Add movie", exact: true })
        .click();
    }

    await page.getByRole("button", { name: "Roll next", exact: true }).click();
    await expect(page.getByRole("status")).toBeHidden({
      timeout: 5_000,
    });
    const orderDialog = page.getByRole("dialog", {
      name: "How should we watch it?",
    });
    await expect(orderDialog).toBeVisible();
    await orderDialog
      .getByRole("button", { name: "Move Browser Chapter Two up" })
      .click();
    await orderDialog.getByRole("button", { name: "Use this order" }).click();
    await expect(
      page.getByRole("heading", { level: 3, name: "Browser Chapter Two" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "4", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("The second one goes first");
    await page.getByRole("button", { name: "Rate it" }).click();
    await page.getByRole("button", { name: "Continue series" }).click();
    await expect(
      page.getByRole("heading", { level: 3, name: "Browser Chapter One" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "3.5", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Custom rating phrase (required)" })
      .fill("Back to chapter one");
    await page.getByRole("button", { name: "Rate it" }).click();

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Roll something new" }).click();
    const reveal = page.getByRole("status");
    await expect(reveal).toBeVisible();
    expect(
      await reveal.evaluate(
        (element) => getComputedStyle(element).animationName,
      ),
    ).toBe("none");
    await expect(reveal).toBeHidden({ timeout: 5_000 });
    await expect(
      page.getByRole("heading", { level: 3, name: "Browser Chapter Three" }),
    ).toBeVisible();
  });

  test("keeps the catalog browse-only when auth is anonymous", async ({
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
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a movie" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Rate it" })).toHaveCount(0);
    await page.getByRole("button", { name: "Library" }).click();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Order" })).toHaveCount(0);
  });
});
