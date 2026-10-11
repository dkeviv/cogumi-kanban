// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). No network listener.
import { guide } from '../engine/engine.ts';
import { KanbanService, tools, toolNames } from './service.ts';

export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'cogumi-kanban', version: '2.5.0' };
export const MAX_MESSAGE = 4_000_000;

export function instructions(pluginRoot: string) {
    return guide.replaceAll('<plugin>', pluginRoot);
}

type Id = string | number | null;
type Reply = { jsonrpc: '2.0'; id: Id; result?: unknown; error?: { code: number; message: string } };

// Best-effort id recovery from a message too large to parse, so the caller's request
// is answered instead of waiting for a timeout.
// Only an "id" key at the top level of the object counts; when unsure, answer null.
export function sniffId(prefix: string): Id {
    let depth = 0, inString = false, escaped = false, keyStart = -1;
    for (let i = 0; i < prefix.length; i++) {
        const c = prefix[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') {
                inString = false;
                if (depth === 1 && keyStart >= 0 && prefix.slice(keyStart, i + 1) === '"id"') {
                    const m = /^\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+)/.exec(prefix.slice(i + 1));
                    if (m) { try { return JSON.parse(m[1]); } catch { return null; } }
                }
            }
            continue;
        }
        if (c === '"') { inString = true; keyStart = i; }
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
    }
    return null;
}

export function createHandler(service: KanbanService, pluginRoot: string) {
    return async function handle(raw: string): Promise<Reply | null> {
        let msg: any;
        try {
            msg = JSON.parse(raw);
        } catch {
            return { jsonrpc: '2.0', id: sniffId(raw.slice(0, 500)), error: { code: -32700, message: 'Parse error' } };
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
            return { jsonrpc: '2.0', id: typeof msg?.id === 'string' || typeof msg?.id === 'number' ? msg.id : null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
        // Only a missing id marks a notification; notifications never get a response.
        if (msg.id === undefined) return null;
        if (typeof msg.id !== 'string' && typeof msg.id !== 'number')
            return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request id must be a string or number' } };
        const reply = (result: unknown): Reply => ({ jsonrpc: '2.0', id: msg.id, result });
        switch (msg.method) {
            case 'initialize': {
                const requested = msg.params?.protocolVersion;
                return reply({
                    protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: SERVER_INFO,
                    instructions: instructions(pluginRoot),
                });
            }
            case 'ping':
                return reply({});
            case 'tools/list':
                return reply({ tools });
            case 'tools/call': {
                const name = msg.params?.name;
                const args = msg.params?.arguments ?? {};
                if (!toolNames.includes(name))
                    return reply({ content: [{ type: 'text', text: `Unknown tool: ${String(name)}` }], isError: true });
                if (typeof args !== 'object' || Array.isArray(args))
                    return reply({ content: [{ type: 'text', text: 'Tool arguments must be an object' }], isError: true });
                try {
                    const result = name === 'workflow' ? { instructions: instructions(pluginRoot) } : await service.call(name, args);
                    return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: { result } });
                } catch (e) {
                    return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
                }
            }
            default:
                return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
        }
    };
}

// Requests are handled one at a time in arrival order so writes from one session
// apply in the order Claude issued them; every reply, including size errors, goes
// through the same chain so replies never overtake each other.
export function serveStdio(service: KanbanService, pluginRoot: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
    const handle = createHandler(service, pluginRoot);
    let buffer = '';
    let oversized: string | null = null; // prefix of a message being skipped
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (work: () => Promise<Reply | null>) => {
        chain = chain.then(async () => {
            const response = await work();
            if (response) output.write(JSON.stringify(response) + '\n');
        }).catch(e => { process.stderr.write(`cogumi-kanban: ${(e as Error).message}\n`); });
    };
    const tooLarge = (prefix: string) => enqueue(async () => ({ jsonrpc: '2.0', id: sniffId(prefix), error: { code: -32600, message: `Message larger than ${MAX_MESSAGE} bytes` } }));
    const line = (text: string) => { const trimmed = text.trim(); if (trimmed) enqueue(() => handle(trimmed)); };
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const text = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (oversized !== null) { tooLarge(oversized); oversized = null; continue; }
            if (text.length > MAX_MESSAGE) { tooLarge(text.slice(0, 500)); continue; }
            line(text);
        }
        if (oversized === null && buffer.length > MAX_MESSAGE) { oversized = buffer.slice(0, 500); buffer = ''; }
        else if (oversized !== null) buffer = '';
    });
    input.on('end', () => {
        if (oversized !== null) tooLarge(oversized);
        else line(buffer); // a final message without a trailing newline still gets an answer
        buffer = '';
        chain.then(() => service.close());
    });
}
