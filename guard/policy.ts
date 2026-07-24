export type BoundaryCategory = "local" | "git" | "github";

const EXEMPTION_VARIABLE = "OMP_REPOSITORY_BOUNDARY_GUARD_EXEMPT_CATEGORIES";

export type BoundaryPolicy = { exemptions: Set<BoundaryCategory>; error?: string };

export function boundaryPolicy(): BoundaryPolicy {
  const raw = process.env[EXEMPTION_VARIABLE];
  if (raw === undefined || raw.trim() === "") return { exemptions: new Set() };
  const exemptions = new Set<BoundaryCategory>();
  for (const value of raw.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    if (value !== "local" && value !== "git" && value !== "github") {
      return { exemptions: new Set(), error: `${EXEMPTION_VARIABLE} contains unknown category ${JSON.stringify(value)}` };
    }
    exemptions.add(value);
  }
  return { exemptions };
}
