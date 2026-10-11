import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KanbanService } from './service.ts';
import { serveStdio } from './mcp.ts';
import { assertNodeVersion } from './store.ts';

// Bundled to <plugin>/dist/server.mjs, so the plugin root is one level up.
const pluginRoot = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.umask(0o077);
try {
    assertNodeVersion();
} catch (e) {
    process.stderr.write((e as Error).message + '\n');
    process.exit(1);
}
serveStdio(new KanbanService(), pluginRoot);
