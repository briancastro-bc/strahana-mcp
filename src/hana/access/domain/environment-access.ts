/** Structural view of an environment for authorization: only the groups matter here. */
export interface EnvironmentGrants {
  readonly groups: readonly string[];
}

/** Names of the environments that share at least one group with the user. Sorted, deterministic. */
export function allowedEnvironments(
  userGroups: readonly string[],
  environments: Readonly<Record<string, EnvironmentGrants>>,
): string[] {
  const groups = new Set(userGroups);
  return Object.entries(environments)
    .filter(([, env]) => env.groups.some((group) => groups.has(group)))
    .map(([name]) => name)
    .sort();
}
