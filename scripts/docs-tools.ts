import { writeFileSync } from 'node:fs';
import { hanaTools } from '../src/hana/mcp/tool-catalog.js';
import { renderToolsDoc } from '../src/platform/mcp/tools-doc.js';

writeFileSync('docs/tools.md', renderToolsDoc(hanaTools));
process.stdout.write('docs/tools.md updated\n');
