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
import { send } from './reporting.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = 'Usage: workflow.mjs binding | observe|resume|checkpoint|before-close|test CONFIG | release CONFIG ACTUAL_PROVIDER_RESULT';

async function main() {
    const [action, file, providerFile] = process.argv.slice(2);
    if (action === 'binding') { console.log(JSON.stringify(observeBinding(), null, 2)); return; }
    if (!action || !file) throw Error(USAGE);
    const cfg = JSON.parse(await fs.readFile(file, 'utf8'));
    const scope = cfg.attempt_id ? { project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: cfg.attempt_id } : { project_id: cfg.project_id, story_id: cfg.story_id };
    if (action === 'observe') {
        const state = await snapshot(scope);
        console.log(JSON.stringify({ ...observe(cfg), pending_events: state.events.length, rejected_events: state.rejected, ...state }, null, 2));
    } else if (action === 'checkpoint' || action === 'before-close') {
        await checkpoint(cfg, action === 'before-close' ? 'before_close' : 'resume');
        console.log('Source, report delivery and evidence reconciled.');
    } else if (action === 'resume') {
        await resume(cfg);
        console.log('Recovered pending results; source and attempt reconciled.');
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
        if (provider.environment !== undefined && provider.environment !== cfg.environment) throw Error('Provider environment contradicts approved configuration');
        if (!provider.url?.startsWith('https://')) throw Error('Observed provider HTTPS URL required');
        await send('record_release', { project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: cfg.attempt_id, release: { commit: source.commit, version: provider.version_id, url: provider.url, environment: cfg.environment, result: provider.status, provider: provider.provider, deployment_id: provider.deployment_id } });
        await checkpoint(cfg, 'after_deploy');
        console.log('Actual provider release recorded. Run prescribed deployed checks before closure.');
    } else {
        throw Error(USAGE);
    }
}

main().catch(e => { console.error(e.message); process.exitCode = 2; }).finally(closeReporterService);
