import { parseArgs } from 'node:util';
import { issueApiKey } from './api-key.js';

const USAGE = 'Usage: pnpm apikey:new -- --user <id> --groups <GROUP1,GROUP2>';

/** Implements `apikey:new`. Returns the process exit code; `print` receives each output line. */
export function runIssueApiKey(argv: readonly string[], print: (line: string) => void): number {
  // pnpm may forward a literal "--" before the options.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let user: string | undefined;
  let groupsArg: string | undefined;
  try {
    const { values } = parseArgs({
      args,
      options: { user: { type: 'string' }, groups: { type: 'string' } },
      strict: true,
    });
    user = values.user?.trim();
    groupsArg = values.groups;
  } catch {
    print(USAGE);
    return 1;
  }
  const groups = (groupsArg ?? '')
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group !== '');
  if (user === undefined || user === '' || groups.length === 0) {
    print(USAGE);
    return 1;
  }

  const { key, entry } = issueApiKey({ user, groups });
  print(`API key for ${user} (shown only once, deliver it over a secure channel):`);
  print(key);
  print('');
  print('Add this entry to "apiKeys" in the strahana-secrets service, then restage/restart:');
  print(JSON.stringify(entry));
  return 0;
}
