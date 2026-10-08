// Workflow helper for reporter configuration (PRD REC 01, REL 02, SHP 02).
// Usage:
//   node workflow.mjs binding
//   node workflow.mjs observe|resume|checkpoint|before-close|test CONFIG.json
//   node workflow.mjs release CONFIG.json ACTUAL_PROVIDER_RESULT.json
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { observeBinding, closeReporterService } from '../dist/lib.mjs';
import { checkpoint, resume, observe, snapshot } from './checkpoint.mjs';
import { send, flush, deliver, settle } from './reporting.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: workflow.mjs binding | observe|resume|checkpoint|before-close|test CONFIG | release CONFIG ACTUAL_PROVIDER_RESULT';

async function main() {
    process.umask(0o077);
    const [action, file, providerFile] = process.argv.slice(2);
    if (action === 'binding') { console.log(JSON.stringify(observeBinding(), null, 2)); return; }
    if (!action || !file) throw Error(USAGE);
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    const scope = cfg.attempt_id ? { project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: cfg.attempt_id } : { project_id: cfg.project_id, story_id: cfg.story_id };
    if (action === 'observe') {
        const state = await snapshot(scope);
        console.log(JSON.stringify({ ...observe(cfg), pending_events: state.events.length, rejected_events: state.rejected, ...state }, null, 2));
    } else if (action === 'checkpoint' || action === 'before-close') {
        try { await flush(scope); } catch (e) { console.error(e.message); }
        await settleResolved(cfg, scope);
        await checkpoint(cfg, action === 'before-close' ? 'before_close' : 'resume');
        const state = await snapshot(scope);
        if (state.events.length || state.rejected.length) {
            for (const r of state.rejected) console.error(`Unresolved rejected ${r.action} ${r.event_id}: ${r.error}`);
            console.error(`Not reconciled: ${state.events.length} pending and ${state.rejected.length} unresolved rejected event(s) for this attempt. Fix and "kanban report requeue", or with the owner's approval "kanban report discard EVENT_ID --reason ...".`);
            process.exitCode = 3;
        } else {
            console.log('Source, report delivery and evidence reconciled.');
        }
    } else if (action === 'resume') {
        const { rejected } = await resume(cfg);
        for (const r of rejected) console.error(`Rejected ${r.event_id}: ${r.error}`);
        if (rejected.length) console.error('Runs whose results were rejected are recorded as blocked; investigate the reasons before rerunning.');
        await settleResolved(cfg, scope);
        const remaining = (await snapshot(scope)).rejected;
        if (remaining.length) {
            for (const r of remaining) console.error(`Unresolved rejected ${r.action} ${r.event_id}: ${r.error}`);
            process.exitCode = 3;
        } else {
            console.log('Recovered pending results; source and attempt reconciled.');
        }
    } else if (action === 'test') {
        const child = spawn(process.execPath, [path.join(here, 'test-and-report.mjs'), file], { stdio: 'inherit' });
        process.exitCode = await new Promise(r => child.on('exit', code => r(code ?? 1)));
    } else if (action === 'release') {
        if (!providerFile) throw Error(USAGE);
        const source = observe(cfg);
        if (source.dirty) throw Error('Commit source before recording release');
        const provider = JSON.parse(await fs.readFile(providerFile, 'utf8'));
        // Explicit adapter boundary: the caller saves the provider's actual structured
        // result; a guessed URL or status is never accepted.
        if (!provider.provider || !provider.deployment_id || !provider.version_id || !['succeeded', 'failed'].includes(provider.status) || provider.commit_sha !== source.commit || !cfg.environment)
            throw Error('Actual provider, deployment, version, status, exact source and environment required');
        // The environment must come from the provider's own result, so a functional
        // config reused by mistake can never record a real deployment as "local".
        if (!provider.environment) throw Error('Provider result must state the deployed environment');
        if (provider.environment !== cfg.environment) throw Error(`Provider environment ${provider.environment} contradicts this configuration (${cfg.environment}); use a reporter config for the deployment environment`);
        if (!provider.url?.startsWith('https://')) throw Error('Observed provider HTTPS URL required');
        await send('record_release', { project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: cfg.attempt_id, release: { commit: source.commit, version: provider.version_id, url: provider.url, environment: cfg.environment, result: provider.status, provider: provider.provider, deployment_id: provider.deployment_id } });
        await checkpoint(cfg, 'after_deploy');
        console.log('Actual provider release recorded. Run prescribed deployed checks before closure.');
    } else {
        throw Error(USAGE);
    }
}

// Files away rejections nothing waits on, using the tracker's own list of runs that
// already have a recorded result.
async function settleResolved(cfg, scope) {
    if (!cfg.attempt_id) return;
    let completed = [];
    try { completed = (await deliver('restore_checkpoint', scope, scope)).completed_run_ids || []; } catch { /* settle only the obvious cases */ }
    for (const r of await settle(scope, completed)) console.error(`Resolved rejected ${r.action} ${r.event_id}: ${r.reason}`);
}

main().catch(e => { console.error(e.message); process.exitCode = 2; }).finally(closeReporterService);
