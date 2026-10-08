// Durable outbox for reporter events (PRD REL 01).
// Events are written atomically before delivery, delivered in producer order to the
// local engine, acknowledged with receipts, and retried on transient failures.
// A permanently rejected event is moved to .rejected/ with its reason instead of
// blocking every later event forever.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { deliverAsReporter, dataHome, isTransient, redactCredentials, CREDENTIAL_KEY } from '../dist/lib.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));
const EVENT_FILE = /^\d+-.+\.json$/;
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export function folder() {
    return path.resolve(process.env.COGUMI_OUTBOX || path.join(dataHome(), 'outbox'));
}

export function rejectedFolder() {
    return path.join(folder(), '.rejected');
}

async function atomic(file, value) {
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    const handle = await fs.open(tmp, 'wx', 0o600);
    try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.rename(tmp, file);
}

// Cross-process mutex: a directory created atomically, with owner metadata so a lock
// left by a dead local process can be recovered safely.
async function locked(dir, fn) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const lock = path.join(dir, '.lock'), guard = path.join(dir, '.recovery-lock'), nonce = crypto.randomUUID();
    let held = false;
    const dead = owner => {
        if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
        try { process.kill(owner.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
    };
    // Up to ~60 s: another worker's flush may hold the lock while SQLite is busy.
    for (let i = 0; i < 2400; i++) {
        try {
            await fs.mkdir(lock, { mode: 0o700 });
            await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), nonce }), { mode: 0o600 });
            held = true;
            break;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            let guarded = false;
            try {
                const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
                if (dead(owner)) {
                    try { await fs.mkdir(guard, { mode: 0o700 }); guarded = true; } catch (g) { if (g.code !== 'EEXIST') throw g; }
                    if (guarded) {
                        const current = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
                        if (dead(current)) {
                            const stale = lock + '.dead-' + crypto.randomUUID();
                            await fs.rename(lock, stale);
                            await fs.rm(stale, { recursive: true });
                        }
                    }
                }
            } catch (r) {
                // owner.json may be mid-write (SyntaxError) or the lock may vanish (ENOENT).
                if (!['ENOENT', 'EEXIST'].includes(r.code) && !(r instanceof SyntaxError)) throw r;
            } finally {
                if (guarded) await fs.rm(guard, { recursive: true });
            }
            await pause(25);
        }
    }
    if (!held) throw Error('Outbox busy or unknown prior lock owner. Verify the previous worker stopped before manual recovery.');
    try {
        return await fn();
    } finally {
        // Never let a missing owner file mask the original error.
        try {
            const owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
            if (owner.nonce === nonce) await fs.rm(lock, { recursive: true });
        } catch (e) {
            if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
        }
    }
}

async function acknowledgment(dir, eventId) {
    try { return JSON.parse(await fs.readFile(path.join(dir, '.receipts', eventId + '.ack'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export async function rejection(eventId) {
    try {
        for (const name of await fs.readdir(rejectedFolder()))
            if (name.endsWith(`-${eventId}.json`)) return JSON.parse(await fs.readFile(path.join(rejectedFolder(), name), 'utf8'));
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return null;
}

// Replaces credential-looking substrings in every string of a JSON value and drops
// credential-named keys. Applied at enqueue so the outbox, checkpoints and the database
// all hold the same redacted copy, and a checkpoint can never be refused for a key.
export function redact(value) {
    if (typeof value === 'string') return redactCredentials(value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !CREDENTIAL_KEY.test(k)).map(([k, v]) => [k, redact(v)]));
    return value;
}

const samePayload = (a, b) => JSON.stringify({ action: a.action, args: a.args }) === JSON.stringify({ action: b.action, args: b.args });

export async function enqueue(action, args) {
    if (!/^[a-z_]+$/.test(action)) throw Error('Invalid action');
    args = redact({ ...args, event_id: args.event_id || crypto.randomUUID() });
    if (!ID.test(args.event_id)) throw Error('Invalid event ID');
    const dir = folder();
    return locked(dir, async () => {
        // A rejected event is never silently resent under the same ID; requeue it explicitly.
        const refused = await rejection(args.event_id);
        if (refused) throw Object.assign(Error(`Event ${args.event_id} was rejected earlier (${refused.error}); run "report.mjs requeue ${args.event_id}" after fixing the cause`), { rejected: refused });
        const receipt = await acknowledgment(dir, args.event_id);
        if (receipt) {
            if (!samePayload({ action, args }, receipt.event)) throw Error('Event ID reused with different payload');
            return receipt.event;
        }
        for (const name of await fs.readdir(dir)) {
            if (!EVENT_FILE.test(name)) continue;
            const old = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
            if (old.args.event_id === args.event_id) {
                if (!samePayload({ action, args }, old)) throw Error('Event ID reused with different payload');
                return old;
            }
        }
        let n = 0;
        try { n = Number(await fs.readFile(path.join(dir, '.sequence'), 'utf8')); } catch { /* first event */ }
        n++;
        await atomic(path.join(dir, '.sequence'), n);
        const event = { sequence: n, queued_at: new Date().toISOString(), action, args };
        await atomic(path.join(dir, `${String(n).padStart(12, '0')}-${args.event_id}.json`), event);
        return event;
    });
}

// Delivers one event to the local engine. Transient storage failures are retried with
// bounded backoff; anything else is marked permanent.
export async function deliver(action, args, scope) {
    for (let i = 0; ; i++) {
        try {
            return await deliverAsReporter(action, args, scope);
        } catch (e) {
            if (e.permanent || !isTransient(e) || i === 2) {
                if (!e.permanent && !isTransient(e)) e.permanent = true;
                throw e;
            }
            await pause(200 * 2 ** i);
        }
    }
}

export function inScope(event, scope) {
    if (!scope) return true;
    const args = event.args || {};
    return (!scope.project_id || args.project_id === scope.project_id)
        && (!scope.story_id || args.story_id === scope.story_id)
        && (!scope.attempt_id || (args.attempt_id || args.evidence?.attempt_id) === scope.attempt_id);
}

const scopeFor = (event, scope) => ({
    project_id: scope?.project_id || event.args.project_id,
    story_id: scope?.story_id || event.args.story_id,
    attempt_id: scope?.attempt_id || event.args.attempt_id || event.args.evidence?.attempt_id,
});

export async function flush(scope) {
    const dir = folder();
    return locked(dir, async () => {
        const names = await fs.readdir(dir);
        if (names.some(n => n.endsWith('.json') && !EVENT_FILE.test(n)))
            throw Error('Legacy unordered outbox detected; reconcile and explicitly migrate old events before replay.');
        const results = [];
        for (const name of names.filter(n => EVENT_FILE.test(n)).sort()) {
            const file = path.join(dir, name), event = JSON.parse(await fs.readFile(file, 'utf8'));
            if (!inScope(event, scope)) continue;
            try {
                const result = await deliver(event.action, event.args, scopeFor(event, scope));
                await fs.mkdir(path.join(dir, '.receipts'), { recursive: true, mode: 0o700 });
                await atomic(path.join(dir, '.receipts', event.args.event_id + '.ack'), { event, result });
                await fs.unlink(file);
                results.push({ event_id: event.args.event_id, result });
            } catch (e) {
                if (e.permanent) {
                    await fs.mkdir(rejectedFolder(), { recursive: true, mode: 0o700 });
                    await atomic(path.join(rejectedFolder(), name), { event, error: e.message, rejected_at: new Date().toISOString() });
                    await fs.unlink(file);
                    results.push({ event_id: event.args.event_id, rejected: e.message, run_id: event.args.evidence?.run_id });
                    continue;
                }
                await atomic(path.join(dir, '.last-failure'), { event_id: event.args.event_id, scope: scopeFor(event), at: new Date().toISOString(), error: e.message });
                throw Error(`Retained ${event.args.event_id}: ${e.message}. Later events were not sent.`);
            }
        }
        // Clear the recorded failure only if its event is no longer waiting in the outbox.
        const failure = await lastFailure();
        if (failure && !(await fs.readdir(dir)).some(n => EVENT_FILE.test(n) && n.endsWith(`-${failure.event_id}.json`)))
            await fs.rm(path.join(dir, '.last-failure'), { force: true });
        return results;
    });
}

export async function lastFailure(scope) {
    try {
        const failure = JSON.parse(await fs.readFile(path.join(folder(), '.last-failure'), 'utf8'));
        return !scope || !failure.scope || inScope({ args: failure.scope }, scope) ? failure : null;
    } catch { return null; }
}

// Moves rejected events (all, or the named IDs) back into the outbox after the cause
// has been fixed. Their original order is kept.
export async function requeue(ids) {
    const dir = folder();
    return locked(dir, async () => {
        const moved = [];
        let names = [];
        try { names = (await fs.readdir(rejectedFolder())).filter(n => EVENT_FILE.test(n)).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        for (const name of names) {
            const record = JSON.parse(await fs.readFile(path.join(rejectedFolder(), name), 'utf8'));
            if (ids?.length && !ids.includes(record.event.args.event_id)) continue;
            await atomic(path.join(dir, name), record.event);
            await fs.unlink(path.join(rejectedFolder(), name));
            moved.push(record.event.args.event_id);
        }
        return moved;
    });
}

export async function rejected(scope) {
    try {
        const out = [];
        for (const name of (await fs.readdir(rejectedFolder())).filter(n => EVENT_FILE.test(n)).sort()) {
            const record = JSON.parse(await fs.readFile(path.join(rejectedFolder(), name), 'utf8'));
            if (inScope(record.event, scope)) out.push({ event_id: record.event.args.event_id, action: record.event.action, error: record.error, rejected_at: record.rejected_at });
        }
        return out;
    } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
    }
}

export async function send(action, args) {
    const event = await enqueue(action, args);
    await flush(scopeFor(event));
    const receipt = await acknowledgment(folder(), event.args.event_id);
    if (receipt) return receipt.result?.duplicate ? receipt.result.result : receipt.result;
    const refused = await rejection(event.args.event_id);
    if (refused) throw Error(`Rejected: ${refused.error}`);
    throw Error('Event delivery not acknowledged');
}
