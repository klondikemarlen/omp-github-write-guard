export function remoteRepository(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const match = value
    .trim()
    .replace(/\.git$/, "")
    .match(/^(?:git@github\.com:|(?:git\+)?https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
