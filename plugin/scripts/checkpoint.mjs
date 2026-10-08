// Durable checkpoints and resume recovery (PRD REL 02, REC 01).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { observeBinding, normalizeOrigin, dataHome, redactCredentials, assertNoCredentials } from '../dist/lib.mjs';
import { folder, deliver, enqueue, flush, inScope, rejected, redact } from './reporting.mjs';
export { redact };

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export function runsFolder() {
    return path.resolve(process.env.COGUMI_RUNS || path.join(dataHome(), 'runs'));
}

const sameBinding = (configured, observed) => configured === observed || (!configured.startsWith('local:') && normalizeOrigin(configured) === observed);

// Observes the actual checkout: exact commit, dirty state and repository binding.
export function observe(cfg) {
    const git = args => spawnSync('git', args, { encoding: 'utf8' });
    const head = git(['rev-parse', 'HEAD']), tree = git(['status', '--porcelain']);
    if (head.status !== 0 || tree.status !== 0) throw Error('Cannot inspect exact source checkout');
    const { binding } = observeBinding();
    if (!cfg.binding || !sameBinding(cfg.binding, binding)) throw Error(`Repository binding mismatch: configured ${cfg.binding || '(none)'}, observed ${binding}`);
    return { commit: head.stdout.trim(), dirty: !!tree.stdout.trim(), binding };
}

export async function snapshot(scope) {
    const dir = folder();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const events = [];
    for (const file of (await fs.readdir(dir)).filter(x => /^\d+-.+\.json$/.test(x)).sort())
        events.push(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')));
    const journals = [];
    try {
        for (const file of await fs.readdir(runsFolder()))
            if (file.endsWith('.json')) journals.push(JSON.parse(await fs.readFile(path.join(runsFolder(), file), 'utf8')));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return {
        events: events.filter(e => inScope(e, scope)),
        rejected: await rejected(scope),
        journals: journals.filter(j => !scope || ((!scope.attempt_id || j.run?.attempt_id === scope.attempt_id) && (!j.project_id || j.project_id === scope.project_id) && (!j.story_id || j.story_id === scope.story_id))),
    };
}

function localPath(cfg, attempt = cfg.attempt_id) {
    const dir = process.env.COGUMI_CHECKPOINT_DIR;
    if (!dir || !attempt) return null;
    for (const id of [cfg.project_id, cfg.story_id, attempt]) if (!ID.test(id)) throw Error('Invalid checkpoint identity');
    return path.join(dir, `${cfg.project_id}-${cfg.story_id}-${attempt}.json`);
}

async function loadLocal(cfg, attempt) {
    const file = localPath(cfg, attempt);
    if (!file) return null;
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function saveLocal(value) {
    const file = localPath(value);
    if (!file) return;
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    const handle = await fs.open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp, file);
}

// Checkpoints never hold credentials: values are redacted, and a credential *key*
// (exact denylist, not any key containing "token") is refused.
function safe(value) {
    const clean = redact(value);
    assertNoCredentials(clean);
    return clean;
}

const compactRun = r => ({ id: r.id, attempt_id: r.attempt_id, criterion_revision: r.criterion_revision, commit: r.commit, mocked: r.mocked, kind: r.kind, started_at: r.started_at });

function compactJournals(journals, events, attempt, completed = []) {
    const pending = new Set(events.map(e => e.args?.evidence?.run_id));
    return journals
        .filter(j => j.run?.attempt_id === attempt && !completed.includes(j.run.id))
        .map(j => ({ run: compactRun(j.run), state: j.state, pid: j.pid, host: j.host, event_id: j.event_id, ...(j.evidence && !pending.has(j.run.id) ? { evidence: j.evidence } : {}) }));
}

const scopeOf = cfg => ({ project_id: cfg.project_id, story_id: cfg.story_id, attempt_id: cfg.attempt_id });

export async function checkpoint(cfg, stage = 'resume') {
    if (!cfg.attempt_id) throw Error('Reporter configuration requires attempt_id');
    const source = observe(cfg), state = await snapshot(scopeOf(cfg)), local = await loadLocal(cfg);
    const attempt_id = cfg.attempt_id;
    const events = state.events.map(e => ({ action: e.action, args: e.args }));
    let delivery_error;
    try { delivery_error = JSON.parse(await fs.readFile(path.join(folder(), '.last-failure'), 'utf8')).error; } catch { /* none */ }
    let value = {
        project_id: cfg.project_id, story_id: cfg.story_id, attempt_id, binding: cfg.binding,
        commit: source.commit, dirty: source.dirty, sequence: (local?.sequence || 0) + 1,
        pending_events: events.length, rejected_events: state.rejected.length, events,
        journals: compactJournals(state.journals, events, attempt_id), stage,
        ...(delivery_error ? { delivery_error: redactCredentials(delivery_error).slice(0, 1000) } : {}),
    };
    // An approved durable location is written before touching the database, so a
    // checkpoint survives even when the database is unavailable.
    await saveLocal(safe(value));
    const remote = await deliver('restore_checkpoint', { project_id: cfg.project_id, story_id: cfg.story_id, attempt_id }, scopeOf(cfg));
    value = { ...value, sequence: Math.max(value.sequence, remote.sequence || 0) + 1, journals: compactJournals(state.journals, events, attempt_id, remote.completed_run_ids) };
    value = safe(value);
    await saveLocal(value);
    // rejected_events is local metadata; the engine's checkpoint schema predates it.
    const { rejected_events: _rejected, ...payload } = value;
    return deliver('checkpoint_attempt', { ...payload, event_id: crypto.randomUUID() }, scopeOf(cfg));
}

export async function resume(cfg) {
    if (!cfg.attempt_id) throw Error('Reporter configuration requires attempt_id');
    observe(cfg);
    const scope = scopeOf(cfg);
    const remote = await deliver('restore_checkpoint', scope, scope);
    const attempt = cfg.attempt_id;
    if (remote.attempt_id && remote.attempt_id !== attempt) throw Error('Reporter/configured attempt mismatch');
    const localSaved = await loadLocal(cfg, attempt);
    const saved = localSaved && localSaved.sequence > (remote.sequence || 0) ? localSaved : remote;
    const events = new Map();
    for (const e of [...(remote.events || []), ...(saved.events || [])]) {
        const old = events.get(e.args.event_id);
        if (old && JSON.stringify(old) !== JSON.stringify(e)) throw Error('Checkpoint event identity conflict; owner reconciliation required');
        events.set(e.args.event_id, e);
    }
    for (const e of events.values()) {
        if (!inScope(e, scope)) throw Error('Checkpoint event outside configured attempt');
        if (e.args.evidence && remote.completed_run_ids?.includes(e.args.evidence.run_id)) continue;
        await enqueue(e.action, e.args);
    }
    const local = await snapshot(scope), merged = new Map();
    for (const j of [...(remote.unfinished_runs || []).map(run => ({ run, state: 'started' })), ...(remote.journals || []), ...(saved.journals || []), ...local.journals]) {
        if (!j.run || j.run.attempt_id !== attempt || (j.project_id && j.project_id !== cfg.project_id) || (j.story_id && j.story_id !== cfg.story_id)) continue;
        const old = merged.get(j.run.id);
        if (!old || j.state === 'finished' || !old.host) merged.set(j.run.id, j);
    }
    const pendingIds = new Set([...events.values(), ...local.events].map(e => e.args?.evidence?.run_id));
    for (const j of merged.values()) {
        const run = j.run;
        if (remote.completed_run_ids?.includes(run.id) || pendingIds.has(run.id)) continue;
        if (j.state === 'started') {
            if (j.host === os.hostname() && j.pid) {
                try { process.kill(j.pid, 0); throw Error('Prior worker is still active; do not recover its run'); }
                catch (e) { if (e.code !== 'ESRCH') throw e; }
            } else if (!cfg.confirm_interrupted) {
                throw Error('Unknown prior worker state; verify it stopped and set confirm_interrupted before recovery');
            }
            await enqueue('record_evidence', {
                project_id: cfg.project_id, story_id: cfg.story_id, event_id: `interrupted-${run.id}`,
                evidence: { run_id: run.id, attempt_id: run.attempt_id, criterion_revision: run.criterion_revision, commit: run.commit, end_commit: observe(cfg).commit, dirty: true, mocked: run.mocked, result: 'blocked', exit_code: null, error: 'Worker stopped before reporting command outcome; investigate before rerunning', output: 'Interrupted registered run recovered without an asserted outcome', finished_at: new Date().toISOString() },
            });
        } else if (j.state === 'finished' && j.evidence) {
            await enqueue('record_evidence', { project_id: cfg.project_id, story_id: cfg.story_id, event_id: j.event_id || `recovered-${run.id}`, evidence: j.evidence });
        }
    }
    await flush(scope);
    if (remote.current_attempt === false) return { ...remote, replayed_history: true };
    return checkpoint(cfg, 'resume');
}
