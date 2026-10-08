// Queue one reporter event from stdin and/or flush the outbox.
// Usage: node report.mjs ACTION < event.json     |     node report.mjs flush
import { enqueue, flush } from './reporting.mjs';
import { closeReporterService } from '../dist/lib.mjs';

async function main() {
    const [action] = process.argv.slice(2);
    if (action && action !== 'flush') {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        await enqueue(action, JSON.parse(input));
    }
    let rejected = 0;
    for (const r of await flush()) {
        if (r.rejected) { rejected++; console.error('Rejected', r.event_id, r.rejected); }
        else console.log('Delivered', r.event_id);
    }
    if (rejected) process.exitCode = 3;
}

main().catch(e => { console.error(e.message); process.exitCode = 2; }).finally(closeReporterService);
