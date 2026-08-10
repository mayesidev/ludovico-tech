import type { Movie } from "./api";

export type Tab = "home" | "library";

export type Navigate = (path: string) => void;

export type RunAction = (
  action: () => Promise<unknown>,
  after?: () => void,
) => Promise<void>;

export type MovieOrderState = {
  draft: Movie[];
  franchiseId: string;
};
