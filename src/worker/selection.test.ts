import { describe, expect, it } from "vitest";
import { selectQueuedMovie } from "./selection";

const movie = (id: string, collectionId: string | null) => ({
  collection_id: collectionId,
  id,
});

describe("collection queue selection", () => {
  it("keeps a standalone roll unchanged", () => {
    const rolled = movie("standalone", null);
    expect(selectQueuedMovie(rolled, true, [])).toBe(rolled);
  });

  it("waits for user ordering when collection order is unknown", () => {
    const rolled = movie("rolled-member", "collection");
    const first = movie("first-member", "collection");
    expect(selectQueuedMovie(rolled, false, [first, rolled])).toBe(rolled);
  });

  it("queues the first unwatched user-ordered member, not the rolled member", () => {
    const rolled = movie("rolled-later-member", "collection");
    const first = movie("first-unwatched-member", "collection");
    expect(selectQueuedMovie(rolled, true, [first, rolled])).toBe(first);
  });
});
