// cogumi-kanban command line (bundled to dist/cli.mjs).
//   doctor                       environment and database health
//   binding                      print this checkout's repository binding
//   export [--out FILE]          write every project (get_board form) as JSON
//   import FILE [--replace]      import a ChatGPT-edition board export (PRD MIG 01)
//   snapshot [--project ID] [--out FILE]   static board HTML with embedded data (PRD UI 01)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KanbanService } from '../server/service.ts';
import { assertNodeVersion, databasePath, dataHome } from '../server/store.ts';
import { observeBinding } from '../server/binding.ts';
import { importBoard, exportBoard } from '../server/migrate.ts';
import { renderSnapshot } from '../server/snapshot.ts';

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function flag(args: string[], name: string) {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw Error(`${name} requires a value`);
    return value;
}

function writeOut(file: string | undefined, text: string) {
    if (!file) { process.stdout.write(text + '\n'); return; }
    fs.writeFileSync(file, text, { mode: 0o600 });
    console.error(`Wrote ${path.resolve(file)}`);
}

async function main(argv: string[]) {
    process.umask(0o077);
    assertNodeVersion();
    const [command, ...args] = argv;
    const service = new KanbanService();
    try {
        switch (command) {
            case 'doctor': {
                const projects = await service.call('list_projects');
                let binding: string | null = null;
                try { binding = observeBinding().binding; } catch { /* not a repository */ }
                const resolved = binding ? projects.filter((p: any) => (p.bindings || [p.binding]).includes(binding)) : [];
                console.log(JSON.stringify({ node: process.versions.node, plugin_root: pluginRoot, data_home: dataHome(), database: databasePath(), projects: projects.length, binding, bound_project: resolved.length === 1 ? resolved[0].id : resolved.length ? 'ambiguous' : null }, null, 2));
                return;
            }
            case 'binding':
                console.log(JSON.stringify(observeBinding(), null, 2));
                return;
            case 'export':
                writeOut(flag(args, '--out'), JSON.stringify(await exportBoard(service), null, 2));
                return;
            case 'import': {
                const file = args.find(a => !a.startsWith('--'));
                if (!file) throw Error('Usage: import FILE [--replace]');
                const result = await importBoard(service, JSON.parse(fs.readFileSync(file, 'utf8')), { replace: args.includes('--replace') });
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            case 'snapshot': {
                const template = fs.readFileSync(path.join(pluginRoot, 'board', 'kanban-board.html'), 'utf8');
                let projectId = flag(args, '--project');
                if (!projectId) {
                    const projects = await service.call('list_projects');
                    let binding: string | null = null;
                    try { binding = observeBinding().binding; } catch { /* not a repository */ }
                    const bound = projects.filter((p: any) => binding && (p.bindings || [p.binding]).includes(binding));
                    if (bound.length === 1) projectId = bound[0].id;
                    else if (projects.length === 1) projectId = projects[0].id;
                    else throw Error('Choose a project with --project ID (run list_projects to see IDs)');
                }
                const html = await renderSnapshot(service, template, projectId!);
                const out = flag(args, '--out') || path.join(dataHome(), 'snapshots', `board-${projectId}.html`);
                fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
                writeOut(out, html);
                return;
            }
            default:
                throw Error('Usage: cli.mjs doctor | binding | export [--out FILE] | import FILE [--replace] | snapshot [--project ID] [--out FILE]');
        }
    } finally {
        service.close();
    }
}

main(process.argv.slice(2)).catch(e => { console.error((e as Error).message); process.exitCode = 2; });
