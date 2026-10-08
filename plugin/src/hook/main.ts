// SessionStart hook entry (bundled to dist/hook.mjs). Always runs: a symlinked plugin
// path must never turn the hook into a silent no-op.
import { runHook } from './session-start.ts';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
try {
    const out = await runHook(raw);
    if (out) process.stdout.write(out);
} catch (e) {
    process.stderr.write(`cogumi-claude-kanban hook: ${(e as Error).message}\n`);
}
