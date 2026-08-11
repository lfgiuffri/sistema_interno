import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import path from 'path';
import { SANDBOX } from '../config/sandbox.config.js';

const exec = promisify(execFile);

/**
 * Clona un repo de GitHub (shallow) en un directorio efímero. Solo GitHub.
 * Devuelve el path del clon. Limpiar con cleanup().
 */
export const cloneRepo = async (repoUrl) => {
    const m = (repoUrl || '').match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
    if (!m) throw new Error('El sandbox solo ejecuta repos de GitHub');
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, '');

    await mkdir(SANDBOX.workRoot, { recursive: true });
    const dir = await mkdtemp(path.join(SANDBOX.workRoot, 'repo-'));

    await exec('git', [
        '-c', 'core.askpass=true',
        'clone', '--depth', '1', '--no-tags',
        `https://github.com/${owner}/${repo}.git`, dir
    ], { timeout: SANDBOX.cloneTimeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

    // Cap de tamaño (evita repos gigantes)
    try {
        const { stdout } = await exec('du', ['-sm', dir], { timeout: 15000 });
        const mb = parseInt(stdout, 10);
        if (Number.isFinite(mb) && mb > SANDBOX.maxRepoMb) {
            await cleanup(dir);
            throw new Error(`Repo demasiado grande (${mb}MB > ${SANDBOX.maxRepoMb}MB)`);
        }
    } catch { /* du opcional */ }

    return { dir, owner, repo };
};

export const cleanup = (dir) => rm(dir, { recursive: true, force: true }).catch(() => {});
