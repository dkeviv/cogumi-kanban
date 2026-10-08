// Queue one reporter event from stdin and/or flush the outbox, or move rejected
// events back into the outbox after fixing their cause.
// Usage: report.mjs ACTION < event.json  |  report.mjs flush  |  report.mjs requeue [EVENT_ID...]
import { enqueue, flush, requeue } from './reporting.mjs';
import { closeReporterService } from '../dist/lib.mjs';

async function main() {
    const [action, ...rest] = process.argv.slice(2);
    if (action === 'requeue') {
        const moved = await requeue(rest);
        console.log(moved.length ? `Requeued ${moved.join(', ')}` : 'No rejected events matched');
        if (!moved.length) return;
    } else if (action && action !== 'flush') {
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
