// Runs one reviewed check for real and reports its evidence (PRD TST 01).
// Usage: node test-and-report.mjs CONFIG.json   (run from the product checkout)
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { send, enqueue, flush, redact } from './reporting.mjs';
import { deliverAsReporter } from '../dist/lib.mjs';
import { checkpoint, observe, runsFolder } from './checkpoint.mjs';

const OUTPUT_LIMIT = 8 * 1024 * 1024;
const git = args => spawnSync('git', args, { encoding: 'utf8' });

function validate(cfg) {
    if (!Array.isArray(cfg.command) || !cfg.command.length || cfg.command.some(x => typeof x !== 'string')) throw Error('command must be argument array');
    if (typeof cfg.mocked !== 'boolean') throw Error('Explicit mocked boolean required');
    if (!cfg.binding) throw Error('Exact binding required in reporter configuration');
    if (!cfg.attempt_id) throw Error('Reporter configuration requires attempt_id');
}

// Runs the command in its own process group so timeouts and interrupts also stop
// its descendants. Heartbeat failures are recorded as warnings, never fatal.
function execute(cfg, run) {
    return new Promise(resolve => {
        let stdout = '', stderr = '', error, escalation;
        const warnings = [];
        const child = spawn(cfg.command[0], cfg.command.slice(1), {
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                COGUMI_RUN_ID: run.id,
                ...(cfg.assertion_file ? { COGUMI_ASSERTION_FILE: path.resolve(cfg.assertion_file) } : {}),
                ...(run.target_url ? { COGUMI_TARGET_URL: run.target_url, COGUMI_RELEASE_VERSION: run.release_version } : {}),
            },
        });
        const terminate = signal => {
            if (!child.pid) return;
            if (process.platform === 'win32') { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); return; }
            try { process.kill(-child.pid, signal); } catch (e) { if (e.code !== 'ESRCH') child.kill(signal); }
        };
        child.stdout.on('data', d => { stdout = (stdout + d).slice(-OUTPUT_LIMIT); });
        child.stderr.on('data', d => { stderr = (stderr + d).slice(-OUTPUT_LIMIT); });
        child.on('error', e => { error = e; });
        const timeout = setTimeout(() => { error = Error('Command timed out'); terminate('SIGKILL'); }, cfg.timeout_ms || 300000);
        // One attempt per tick, no retries: a slow or failed heartbeat must never delay
        // or stop the check itself.
        const heartbeat = setInterval(() => {
            deliverAsReporter('heartbeat_attempt', { project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: run.attempt_id, event_id: crypto.randomUUID() })
                .catch(e => { warnings.push(`heartbeat failed at ${new Date().toISOString()}: ${e.message}`); });
        }, cfg.heartbeat_ms || 60000);
        const stop = () => { error = Error('Wrapper interrupted'); terminate('SIGTERM'); escalation = setTimeout(() => terminate('SIGKILL'), 250); };
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
        child.on('close', (status, signal) => {
            clearTimeout(timeout);
            clearTimeout(escalation);
            clearInterval(heartbeat);
            terminate('SIGKILL');
            process.removeListener('SIGTERM', stop);
            process.removeListener('SIGINT', stop);
            resolve({ status, signal, error, stdout, stderr, warnings });
        });
    });
}

async function main() {
    const cfg = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    validate(cfg);
    const start = git(['rev-parse', 'HEAD']), before = git(['status', '--porcelain']);
    if (start.status !== 0 || before.status !== 0) throw Error('Cannot identify starting source/tree; command not executed');
    observe(cfg); // binding check before anything runs
    const source = start.stdout.trim(), dirtyStart = before.stdout.trim().length > 0;
    const run = await send('begin_run', {
        binding: cfg.binding, project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: cfg.attempt_id,
        kind: cfg.kind || 'functional', commit: source, command: cfg.command.join(' '), environment: cfg.environment,
        criteria: cfg.criteria, verification_types: cfg.verification_types, mocked: cfg.mocked, dirty: dirtyStart,
        release_version: cfg.release_version, check_ids: cfg.check_ids,
    });
    await fs.mkdir(runsFolder(), { recursive: true, mode: 0o700 });
    const logPath = path.join(runsFolder(), run.id + '.json');
    await fs.writeFile(logPath, JSON.stringify({ project_id: cfg.project_id, story_id: cfg.story_id, run, command: redact(cfg.command), state: 'started', pid: process.pid, host: os.hostname() }), { mode: 0o600 });
    if (run.kind === 'deployed' && (!run.target_url || cfg.target_url !== run.target_url)) throw Error('Deployed config must explicitly target observed release URL');
    if (cfg.assertion_file) await fs.rm(cfg.assertion_file, { force: true });
    const context = { ...cfg, attempt_id: run.attempt_id };
    await checkpoint(context, 'before_test');

    const result = await execute(cfg, run);
    const end = git(['rev-parse', 'HEAD']), after = git(['status', '--porcelain']);
    const drift = end.status !== 0 || after.status !== 0 || end.stdout.trim() !== source;
    const error = result.error?.message || (drift ? 'Source changed or became unavailable during execution' : undefined);
    const notes = result.warnings.length ? `\n[cogumi] ${result.warnings.join('\n[cogumi] ')}\n` : '';
    const evidence = {
        run_id: run.id, attempt_id: run.attempt_id, criterion_revision: run.criterion_revision,
        commit: source, end_commit: end.status === 0 ? end.stdout.trim() : source,
        dirty: dirtyStart || after.status !== 0 || after.stdout.trim().length > 0 || drift,
        mocked: cfg.mocked, result: result.status === 0 && !error ? 'pass' : 'fail',
        exit_code: result.status, signal: result.signal, error,
        output: ((result.stdout || '') + (result.stderr || '') + notes).slice(-64000),
        finished_at: new Date().toISOString(),
    };
    if (cfg.assertion_file) {
        try { evidence.assertions = JSON.parse(await fs.readFile(cfg.assertion_file, 'utf8')); }
        catch (e) { evidence.result = 'fail'; evidence.error = 'Required assertion output unavailable: ' + e.message; }
    }
    const event_id = crypto.randomUUID();
    const safeEvidence = redact(evidence);
    await fs.writeFile(logPath, JSON.stringify({ project_id: cfg.project_id, story_id: cfg.story_id, run, evidence: safeEvidence, event_id, state: 'finished' }), { mode: 0o600 });
    await enqueue('record_evidence', { project_id: cfg.project_id, story_id: cfg.story_id, evidence: safeEvidence, event_id });
    let reportFailed = false;
    try {
        await checkpoint(context, 'after_test');
        const delivered = await flush(context);
        if (delivered.some(r => r.rejected)) { reportFailed = true; for (const r of delivered.filter(r => r.rejected)) console.error(`Rejected ${r.event_id}: ${r.rejected}`); }
        await checkpoint(context, 'after_test');
    } catch (e) {
        console.error(e.message);
        reportFailed = true;
    }
    process.stdout.write(redact(result.stdout || ''));
    process.stderr.write(redact(result.stderr || ''));
    if (result.warnings.length) console.error(result.warnings.map(w => '[cogumi] ' + w).join('\n'));
    const passed = result.status === 0 && !error && evidence.result === 'pass';
    process.exitCode = passed ? (reportFailed ? 2 : 0) : (typeof result.status === 'number' && result.status !== 0 ? result.status : 1);
}

main().catch(e => { console.error(e.message); process.exitCode = 2; });
