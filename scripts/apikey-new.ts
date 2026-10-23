import { runIssueApiKey } from '../src/platform/auth/issue-api-key-cli.js';

process.exitCode = runIssueApiKey(process.argv.slice(2), (line) => {
  process.stdout.write(`${line}\n`);
});
