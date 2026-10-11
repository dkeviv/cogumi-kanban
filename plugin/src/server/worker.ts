import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { dataHome } from './store.ts';
import { observeBinding } from './binding.ts';
import { KanbanService } from './service.ts';
import { updateBoard } from './update-board.ts';

export function workerArgs(host:string, session?:string) {
    if(host==='codex') return session ? ['exec','resume','-c','approval_policy="never"','--json',session,'-'] : ['exec','-c','approval_policy="never"','--sandbox','workspace-write','--add-dir',dataHome(),'--json','-'];
    if(host==='claude') return ['--print','--permission-mode','auto','--output-format','stream-json','--verbose',...(session?['--resume',session]:[])];
    throw Error('Worker host must be codex or claude');
}
export function workerFingerprint(board:any) {
    return crypto.createHash('sha256').update(JSON.stringify({mode:board.workflow?.delivery_mode,approval:board.approval,stories:board.stories.map((s:any)=>({id:s.id,status:s.status,revision:s.revision,runs:s.runs?.length,evidence:s.evidence?.length,progress:s.last_progress_at,release:s.release?.id,commit:s.commit,claim:s.claim?.attempt_id,expired:s.claim?Date.parse(s.claim.expires)<=Date.now():false,source_review:s.source_review,proposal:s.proposal_pending,plan:s.proof_plan,dependencies:s.dependencies}))})).digest('hex');
}
function save(file:string,value:any) {const tmp=file+'.'+crypto.randomUUID();fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(tmp,file);}
function alive(pid:number) {try{process.kill(pid,0);return true;}catch{return false;}}
function xml(s:string) {return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));}
export async function workerCommand(args:string[],pluginRoot:string) {
    const action=args[0];if(['start','run'].includes(action))throw Error('Cogumi Kanban is tracking-only. Delivery execution belongs to your coding agent. Use update or record_progress.');const service=new KanbanService();
    try {
        const observed=observeBinding();const projects=await service.call('list_projects');const matches=projects.filter((p:any)=>(p.bindings||[p.binding]).includes(observed.binding));
        if(matches.length!==1)throw Error('Worker requires exactly one project bound to this repository');
        const project=matches[0];const dir=path.join(dataHome(),'workers',project.id);fs.mkdirSync(dir,{recursive:true,mode:0o700});
        const file=path.join(dir,'state.json');let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
        const label='com.cogumi.kanban.'+project.id;const plist=path.join(process.env.HOME!,'Library','LaunchAgents',label+'.plist');
        if(action==='status')return {...state,supervisor_alive:!!state.pid&&alive(state.pid),state_path:file};
        if(action==='stop') {
            save(file,{...state,enabled:false,status:'stopped'});
            if(process.platform==='darwin'&&fs.existsSync(plist)){spawnSync('launchctl',['bootout',`gui/${process.getuid!()}`,plist]);fs.unlinkSync(plist);}
            if(process.platform==='linux')spawnSync('systemctl',['--user','disable','--now','cogumi-kanban-'+project.id+'.service']);
            return {status:'stopped',state_path:file};
        }
        if(action==='start') {
            const board=await service.call('get_board',{project_id:project.id});if(board.workflow.delivery_mode!=='auto')throw Error('Select Auto mode before starting persistent delivery');
            const hostIndex=args.indexOf('--host');const host=hostIndex>=0?args[hostIndex+1]:process.env.CLAUDECODE?'claude':'codex';workerArgs(host);
            const command=spawnSync('which',[host],{encoding:'utf8'});if(command.status!==0)throw Error(`Install and sign in to the ${host} CLI first`);
            if(state.enabled&&state.pid&&alive(state.pid))return {...state,status:'already-running'};
            state={...state,host,executable:command.stdout.trim(),root:observed.root,pluginRoot,enabled:true,status:'starting',failures:0,no_progress_turns:0,retry_at:0};save(file,state);
            const argv=[path.join(pluginRoot,'dist/cli.mjs'),'worker','run'];
            if(process.platform==='darwin') {
                fs.mkdirSync(path.dirname(plist),{recursive:true});
                fs.writeFileSync(plist,`<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array>${[process.execPath,...argv].map(x=>'<string>'+xml(x)+'</string>').join('')}</array><key>WorkingDirectory</key><string>${xml(observed.root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH||'')}</string><key>COGUMI_KANBAN_HOME</key><string>${xml(dataHome())}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer><key>StandardErrorPath</key><string>${xml(path.join(dir,'supervisor.log'))}</string></dict></plist>`,{mode:0o600});
                spawnSync('launchctl',['bootout',`gui/${process.getuid!()}`,plist]);
                const loaded=spawnSync('launchctl',['bootstrap',`gui/${process.getuid!()}`,plist],{encoding:'utf8'});if(loaded.status!==0){save(file,{...state,enabled:false,status:'install-failed'});throw Error('Could not install automatic restart: '+loaded.stderr);}
                return {status:'started',host,restart:'macOS launch agent',state_path:file};
            }
            if(process.platform==='linux') {
                const unit='cogumi-kanban-'+project.id+'.service';const unitDir=path.join(process.env.HOME!,'.config','systemd','user');fs.mkdirSync(unitDir,{recursive:true});
                const quote=(v:string)=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%')+'"';
                fs.writeFileSync(path.join(unitDir,unit),`[Unit]\nDescription=Cogumi Kanban persistent worker\n[Service]\nWorkingDirectory=${quote(observed.root)}\nExecStart=${[process.execPath,...argv].map(quote).join(' ')}\nEnvironment=${quote('PATH='+process.env.PATH)}\nEnvironment=${quote('COGUMI_KANBAN_HOME='+dataHome())}\nRestart=on-failure\nRestartSec=30\n[Install]\nWantedBy=default.target\n`,{mode:0o600});
                const reload=spawnSync('systemctl',['--user','daemon-reload']);const start=reload.status===0?spawnSync('systemctl',['--user','enable','--now',unit]):reload;
                if(start.status!==0){save(file,{...state,enabled:false,status:'install-failed'});throw Error('A working systemd user session is required for automatic restart');}
                return {status:'started',host,restart:'systemd user service',state_path:file};
            }
            const log=fs.openSync(path.join(dir,'supervisor.log'),'a',0o600);const child=spawn(process.execPath,argv,{cwd:observed.root,detached:true,stdio:['ignore',log,log]});child.unref();fs.closeSync(log);
            return {status:'started',host,restart:'worker process only; install an OS service for supervisor/reboot recovery',state_path:file};
        }
        if(action!=='run')throw Error('Usage: worker start [--host codex|claude] | status | stop');
        const lock=path.join(dir,'supervisor.lock');try{fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}catch{const pid=Number(fs.readFileSync(lock,'utf8'));if(alive(pid))return {status:'already-running'};fs.unlinkSync(lock);fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});}
        let child:any;let stopping=false;
        const terminate=()=>{if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}};
        const stop=()=>{stopping=true;terminate();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
        try {
            while(!stopping) {
                state=JSON.parse(fs.readFileSync(file,'utf8'));if(!state.enabled)break;
                if(state.child_pid&&alive(state.child_pid)){state.status='waiting-existing-process';save(file,{...state,pid:process.pid});await new Promise(r=>setTimeout(r,5000));continue;}
                const board=await service.call('get_board',{project_id:project.id});
                const fingerprint=workerFingerprint(board);const waiting=board.stories.some((s:any)=>s.claim&&Date.parse(s.claim.expires)>Date.now()&&s.claim.worker!==`persistent:${project.id}`);
                const control=await service.call('delivery_tasks',{project_id:project.id,worker:`persistent:${project.id}`});
                if(state.assessed_fingerprint!==fingerprint){await updateBoard(service,project.id);state.assessed_fingerprint=fingerprint;}
                state.delivery_control=control;
                const remaining=board.stories.some((s:any)=>s.status!=='Shipped'&&!s.exclusion);
                if(board.workflow.delivery_mode!=='auto'||waiting||!remaining||(state.last_fingerprint===fingerprint&&Date.now()<(state.retry_at||0))) {
                    state.status=board.workflow.delivery_mode!=='auto'?'paused-approval':waiting?'waiting-other-worker':!remaining?'complete':state.no_progress_turns>=3?'paused-no-progress':'waiting-blocker';save(file,{...state,pid:process.pid});await new Promise(r=>setTimeout(r,5000));continue;
                }
                await updateBoard(service,project.id);
                const prompt=`Use the Cogumi Kanban workflow skill at ${path.join(pluginRoot,'skills/cogumi-workflow/SKILL.md')}. Persistent worker identity: persistent:${project.id}. Project: ${project.id}. Read board and user/source requirements before acting. Execute these current corrective tasks in order: ${JSON.stringify(control.tasks)}. Finish existing claimed work before additional claims. Prepare missing plans using prepare_verification with actual current criteria, commands, assertions and evidence requirements; do not change criteria just to obtain Ready. All qualifying checks must use workflow test and releases must use workflow release. Auto mode authorizes owner decisions without separate approval; preserve explicit user constraints. Resolve plans and authorized phases/environments, implement eligible work across all epics, run tracked checks and real release checks before Shipped. Reconcile prior attempts and reports before resuming; never take over a live worker. Stop at a real blocker and record it. Do not launch another supervisor. Continue until eligible work is exhausted.`;
                const log=fs.openSync(path.join(dir,'worker.jsonl'),'a',0o600);
                child=spawn(state.executable,workerArgs(state.host,state.session),{cwd:observed.root,detached:true,stdio:['pipe','pipe',log],env:{...process.env,COGUMI_PERSISTENT_WORKER:'1'}});
                state={...state,pid:process.pid,child_pid:child.pid,status:'running',started_at:new Date().toISOString()};save(file,state);
                let buffer='';child.stdout.on('data',(chunk:Buffer)=>{fs.writeSync(log,chunk);buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop()!;for(const line of lines){try{const e=JSON.parse(line);const session=e.type==='thread.started'?e.thread_id:e.type==='system'&&e.subtype==='init'?e.session_id:null;if(session){state.session=session;state.enabled=JSON.parse(fs.readFileSync(file,'utf8')).enabled;save(file,state);}}catch{}}});
                child.stdin.on('error',()=>{});child.stdin.end(prompt);
                const monitor=setInterval(async()=>{try{const current=JSON.parse(fs.readFileSync(file,'utf8'));const b=await service.call('get_board',{project_id:project.id});if(!current.enabled||b.workflow.delivery_mode!=='auto')terminate();}catch{terminate();}},5000);
                const exit=await new Promise<number|null>(resolve=>{child.once('error',()=>resolve(-1));child.once('close',(code:number)=>resolve(code));});clearInterval(monitor);fs.closeSync(log);child=null;
                const after=workerFingerprint(await service.call('get_board',{project_id:project.id}));state.no_progress_turns=exit===0&&after===fingerprint?(state.no_progress_turns||0)+1:0;
                const latest=JSON.parse(fs.readFileSync(file,'utf8'));state={...state,enabled:latest.enabled,child_pid:null,last_exit:exit,failures:exit===0?0:(state.failures||0)+1,last_fingerprint:fingerprint,retry_at:state.no_progress_turns>=3?Number.MAX_SAFE_INTEGER:Date.now()+(exit===0?300000:Math.min(3600000,30000*2**Math.min(state.failures||0,7))),status:exit===0?'reconciling':'retry-backoff'};save(file,state);
            }
        } finally {fs.unlinkSync(lock);const latest=JSON.parse(fs.readFileSync(file,'utf8'));save(file,{...state,enabled:latest.enabled,pid:null,status:'stopped'});process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
        return {status:'stopped'};
    } finally {service.close();}
}
