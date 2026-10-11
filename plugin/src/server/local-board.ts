// Read-only loopback transport for the existing board, shared with MCP/reporters.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { KanbanService } from './service.ts';

export async function serveLocalBoard(template: string, { service = new KanbanService(), port = 0 } = {}) {
    const token = randomBytes(24).toString('hex');
    const prefix = `/${token}`;
    const server = http.createServer(async (req, res) => {
        const host = `127.0.0.1:${(server.address() as any).port}`;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`)) {
            res.writeHead(403).end('Forbidden'); return;
        }
        if (req.method !== 'GET') { res.writeHead(405).end('Read-only board'); return; }
        const url = new URL(req.url || '/', `http://${host}`);
        if (url.pathname === `${prefix}/`) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(template.replace('<!--COGUMI_SNAPSHOT-->', '<script>window.COGUMI_LOCAL_BOARD = true;</script>')); return;
        }
        const action = url.pathname.slice(`${prefix}/api/`.length);
        if (!url.pathname.startsWith(`${prefix}/api/`) || !['list_projects', 'board_overview', 'story_detail'].includes(action)) {
            res.writeHead(404).end('Not found'); return;
        }
        try {
            const args = Object.fromEntries(url.searchParams);
            const result = await service.call(action, args);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ payload: { result } }));
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: (e as Error).message }));
        }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    server.once('close', () => service.close());
    return { server, url: `http://127.0.0.1:${(server.address() as any).port}${prefix}/` };
}
