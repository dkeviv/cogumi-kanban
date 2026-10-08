// Repository identity (PRD PRJ 01). One binding per repository, shared by every
// clone form (SSH/HTTPS) and every worktree; nothing is written into the checkout.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function normalizeOrigin(url: string): string {
    let u = url.trim();
    // scp-like SSH: git@host:owner/repo.git (also git@host:/owner/repo)
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):\/?(?!\/)(.+)$/.exec(u);
    if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${scp[1]}/${scp[2]}`;
    try {
        const parsed = new URL(u);
        if (!['http:', 'https:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(parsed.protocol)) return u.replace(/\/+$/, '').replace(/\.git$/, '');
        const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
        // A non-default web port names a different server; SSH ports do not change the repository.
        const port = parsed.port && ['http:', 'https:'].includes(parsed.protocol) ? `:${parsed.port}` : '';
        return `https://${parsed.hostname.toLowerCase()}${port}${pathname}`;
    } catch {
        return u.replace(/\/+$/, '').replace(/\.git$/, '');
    }
}

const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

export type Observed = { binding: string; root: string; origin: string | null };

export function observeBinding(cwd = process.cwd()): Observed {
    const top = git(cwd, ['rev-parse', '--show-toplevel']);
    if (top.status !== 0) throw Error('Not inside a Git repository');
    const root = top.stdout.trim();
    const origin = git(cwd, ['remote', 'get-url', 'origin']);
    if (origin.status === 0 && origin.stdout.trim())
        return { binding: normalizeOrigin(origin.stdout.trim()), root, origin: origin.stdout.trim() };
    const common = git(cwd, ['rev-parse', '--git-common-dir']);
    if (common.status !== 0) throw Error('Cannot determine Git common directory');
    const dir = path.resolve(cwd, common.stdout.trim());
    return { binding: `local:${fs.realpathSync(dir)}`, root, origin: null };
}
