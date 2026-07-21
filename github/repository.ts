export function normalizeRepository(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim().replace(/\.git$/, "");
  const match =
    trimmed.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)$/i) ??
    trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  const owner = match?.[1];
  const repository = match?.[2];
  return owner && repository ? `${owner}/${repository}`.toLowerCase() : undefined;
}

export function remoteRepository(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const match = value
    .trim()
    .replace(/\.git$/, "")
    .match(/^(?:git@github\.com:|(?:git\+)?https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+)$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
