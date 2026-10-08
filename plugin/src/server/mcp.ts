// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). No network listener.
import { guide } from '../engine/engine.ts';
import { KanbanService, tools, toolNames } from './service.ts';

export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'cogumi-claude-kanban', version: '2.0.0' };
const MAX_MESSAGE = 1_000_000;

export function instructions(pluginRoot: string) {
    return guide.replaceAll('<plugin>', pluginRoot);
}

type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export function createHandler(service: KanbanService, pluginRoot: string) {
    return async function handle(raw: string): Promise<Reply | null> {
        let msg: any;
        try {
            if (raw.length > MAX_MESSAGE) throw Error('Too large');
            msg = JSON.parse(raw);
        } catch {
            return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
            return { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
        // Notifications (no id) never get a response.
        if (msg.id === undefined || msg.id === null) return null;
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
// apply in the order Claude issued them.
export function serveStdio(service: KanbanService, pluginRoot: string, input = process.stdin, output = process.stdout) {
    const handle = createHandler(service, pluginRoot);
    let buffer = '';
    let chain: Promise<void> = Promise.resolve();
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            chain = chain.then(async () => {
                const response = await handle(line);
                if (response) output.write(JSON.stringify(response) + '\n');
            }).catch(e => { process.stderr.write(`cogumi-claude-kanban: ${(e as Error).message}\n`); });
        }
        if (buffer.length > MAX_MESSAGE) {
            buffer = '';
            output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } }) + '\n');
        }
    });
    input.on('end', () => { chain.then(() => service.close()); });
}
