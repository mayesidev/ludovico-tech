export type Tab = "credits" | "home" | "library" | "tmdb-status";

export type Navigate = (path: string) => void;

export type RunAction = (
  action: () => Promise<unknown>,
  after?: () => void,
) => Promise<void>;
