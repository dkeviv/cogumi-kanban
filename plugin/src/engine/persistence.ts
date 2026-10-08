import { dispatch, readActions, type Actor, type Board } from './engine.ts';
export async function runWithDb(db: any, owner: string, action: string, args: any, actor: Actor = { id: owner, role: 'owner' }) {
    const row = await db.prepare('SELECT revision,data FROM boards WHERE owner=?').bind(owner).first();
    const board: Board = row ? JSON.parse(row.data) : { projects: [] };
    let result;
    try { result = dispatch(board, action, args, new Date(), actor); }
    catch(error) {
        // Re-read before recording a rejected operation: never overwrite a winning CAS.
        for(let tries=0;tries<3;tries++) {
            const latest=await db.prepare('SELECT revision,data FROM boards WHERE owner=?').bind(owner).first();
            if(!latest)break;const fresh=JSON.parse(latest.data),project=fresh.projects.find((p:any)=>p.id===args.project_id);if(!project)break;
            project.rejections ||= [];project.rejections.push({at:new Date().toISOString(),actor:actor.id,action:/^[a-z_]{1,60}$/.test(action)?action:'invalid_action',category:'request_rejected'});
            const saved=await db.prepare('UPDATE boards SET data=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(fresh),owner,latest.revision).run();if(saved.meta.changes===1)break;
        }
        throw error;
    }
    if (readActions.includes(action) && (!row || row.data === JSON.stringify(board)))
        return result;
    if (row) {
        const r = await db.prepare('UPDATE boards SET data=?,revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(board), owner, row.revision).run();
        if (r.meta.changes !== 1)
            throw Error('Concurrent update; retry same event_id after rereading');
    }
    else {
        try {
            await db.prepare('INSERT INTO boards(owner,revision,data) VALUES(?,1,?)').bind(owner, JSON.stringify(board)).run();
        }
        catch {
            throw Error('Concurrent initialization; retry same event_id');
        }
    }
    return result;
}
