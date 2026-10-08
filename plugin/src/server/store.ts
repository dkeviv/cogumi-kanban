// Local SQLite storage adapter. It exposes the small D1-shaped surface that
// engine/persistence.ts expects (prepare().bind().first()/run()), so the engine's
// compare-and-swap persistence runs unchanged against a local file.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

export function dataHome(): string {
    return path.resolve(process.env.COGUMI_KANBAN_HOME || path.join(os.homedir(), '.cogumi-claude-kanban'));
}

export function databasePath(): string {
    return path.resolve(process.env.COGUMI_KANBAN_DB || path.join(dataHome(), 'kanban.db'));
}

export function assertNodeVersion(version = process.versions.node) {
    const [major, minor] = version.split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 13))
        throw Error(`Cogumi Claude Kanban requires Node.js 22.13 or newer (found ${version})`);
}

export type Statement = { bind(...values: unknown[]): Statement; first(): Promise<any>; run(): Promise<{ meta: { changes: number } }> };
export type Store = { prepare(sql: string): Statement; close(): void; file: string };

// create:false is for reporter scripts: a missing database means a wrong data root or
// an unmounted volume, so it must be retried later rather than silently recreated empty.
export function openStore(file = databasePath(), { create = true } = {}): Store {
    assertNodeVersion();
    if (file !== ':memory:') {
        if (!create && !fs.existsSync(file))
            throw Object.assign(new Error(`Tracker database not found at ${file}; check COGUMI_KANBAN_HOME/COGUMI_KANBAN_DB`), { code: 'COGUMI_UNAVAILABLE' });
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        if (!fs.existsSync(file))
            fs.closeSync(fs.openSync(file, 'a', 0o600));
        fs.chmodSync(file, 0o600);
    }
    const sql = new DatabaseSync(file);
    try {
        prepareSchema(sql, file);
    } catch (e) {
        sql.close(); // never leak the handle when setup fails (busy, newer schema)
        throw e;
    }
    return {
        file,
        close: () => sql.close(),
        prepare(query: string) {
            let values: unknown[] = [];
            const statement: Statement = {
                bind(...args: unknown[]) { values = args; return statement; },
                async first() { return sql.prepare(query).get(...(values as any[])) ?? null; },
                async run() { const r = sql.prepare(query).run(...(values as any[])); return { meta: { changes: Number(r.changes) } }; },
            };
            return statement;
        },
    };
}

function prepareSchema(sql: DatabaseSync, file: string) {
    // WAL lets the MCP server, reporter scripts and snapshot command share the file;
    // busy_timeout makes concurrent writers wait instead of failing immediately.
    sql.exec('PRAGMA busy_timeout=5000');
    if (file !== ':memory:')
        sql.exec('PRAGMA journal_mode=WAL');
    sql.exec(`CREATE TABLE IF NOT EXISTS boards(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    const version = sql.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as any;
    if (!version)
        sql.prepare("INSERT OR IGNORE INTO meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION));
    else if (Number(version.value) > SCHEMA_VERSION)
        throw Error(`Database schema ${version.value} is newer than this plugin supports (${SCHEMA_VERSION}); update the plugin`);
}

// Lock/availability failures are worth retrying; validation failures are not.
// SQLite primary result codes: BUSY 5, LOCKED 6, IOERR 10, FULL 13, CANTOPEN 14;
// extended READONLY_RECOVERY 264 and READONLY_CANTLOCK 520 clear up on their own.
const TRANSIENT_SQLITE = new Set([5, 6, 10, 13, 14]);
const TRANSIENT_EXTENDED = new Set([264, 520]);
export function isTransient(error: unknown): boolean {
    const e = error as any;
    if (typeof e?.errcode === 'number' && (TRANSIENT_SQLITE.has(e.errcode & 0xff) || TRANSIENT_EXTENDED.has(e.errcode)))
        return true;
    // Missing or busy files can come back (an unmounted volume); permission errors cannot.
    if (['ENOENT', 'EBUSY', 'EMFILE', 'ENFILE', 'ENOSPC', 'COGUMI_UNAVAILABLE'].includes(e?.code))
        return true;
    return /^Concurrent (update|initialization)/.test(String(e?.message || ''));
}
