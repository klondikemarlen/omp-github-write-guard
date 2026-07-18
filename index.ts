type ExtensionAPI = { on(event: string, handler: unknown): void };

// ponytail: OMP owns external-issue authorization; a second hook only duplicates its prompt.
export function createGitHubWriteGuard(): (pi: ExtensionAPI) => void {
  return () => {};
}

export default createGitHubWriteGuard();
