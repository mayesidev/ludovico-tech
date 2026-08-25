declare module "@semantic-release/commit-analyzer" {
  type ReleaseType = "major" | "minor" | "patch" | null;

  type AnalyzeContext = {
    commits: Array<{ message: string }>;
    cwd?: string;
    logger: { log: (...arguments_: unknown[]) => void };
  };

  type AnalyzeOptions = {
    config?: string;
    preset?: string;
    releaseRules?: Array<Record<string, unknown>>;
  };

  export const analyzeCommits: (
    options: AnalyzeOptions,
    context: AnalyzeContext,
  ) => Promise<ReleaseType>;
}
