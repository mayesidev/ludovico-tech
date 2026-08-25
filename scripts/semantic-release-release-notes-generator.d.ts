declare module "@semantic-release/release-notes-generator" {
  type GenerateNotesContext = {
    commits: Array<{ hash: string; message: string }>;
    cwd?: string;
    lastRelease: { gitHead: string; gitTag?: string };
    nextRelease: { gitHead: string; gitTag?: string; version: string };
    options: { repositoryUrl: string };
  };

  type GenerateNotesOptions = {
    config?: string;
    preset?: string;
  };

  export const generateNotes: (
    options: GenerateNotesOptions,
    context: GenerateNotesContext,
  ) => Promise<string>;
}
