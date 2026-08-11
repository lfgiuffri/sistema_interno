import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { SANDBOX } from '../config/sandbox.config.js';

const execFileP = promisify(execFile);

export const dockerAvailable = async () => {
    try {
        await execFileP(SANDBOX.dockerBin, ['version', '--format', '{{.Server.Version}}'], { timeout: 8000 });
        return true;
    } catch {
        return false;
    }
};

/**
 * Corre un comando en un contenedor efímero bajo gVisor con perfil blindado.
 * opts: { image, workDir, cmd, network: 'none'|'default', timeoutMs, name }
 * @returns { exitCode, stdout, stderr, timedOut, durationMs }
 */
export const runContainer = ({ image, workDir, cmd, network = 'none', timeoutMs = SANDBOX.runTimeoutMs, name }) => {
    return new Promise((resolve) => {
        const argv = [
            'run', '--rm', '--name', name,
            '--runtime', SANDBOX.runtime,
            '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges',
            '--memory', SANDBOX.memory, '--memory-swap', SANDBOX.memory,
            '--cpus', SANDBOX.cpus, '--pids-limit', String(SANDBOX.pidsLimit),
            '-v', `${workDir}:/work`, '-w', '/work',
            '-e', 'HOME=/work', '-e', 'CI=true', '-e', 'NODE_ENV=production',
        ];
        if (network === 'none') argv.push('--network', 'none');
        argv.push(image, 'sh', '-lc', cmd);

        const started = Date.now();
        const child = spawn(SANDBOX.dockerBin, argv, { env: process.env });
        let out = '', err = '', killed = false, finished = false;
        const cap = SANDBOX.maxLogChars;
        child.stdout.on('data', (d) => { if (out.length < cap) out += d.toString(); });
        child.stderr.on('data', (d) => { if (err.length < cap) err += d.toString(); });

        const timer = setTimeout(() => {
            killed = true;
            execFile(SANDBOX.dockerBin, ['kill', name], () => {});
        }, timeoutMs);

        const done = (code) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve({ exitCode: code, stdout: out.slice(0, cap), stderr: err.slice(0, cap), timedOut: killed, durationMs: Date.now() - started });
        };
        child.on('close', (code) => done(code));
        child.on('error', (e) => { err += `\n${e.message}`; done(-1); });
    });
};

/** Build de la imagen propia del repo (Dockerfile) — red habilitada, runtime default. */
export const buildImage = async (workDir, tag) => {
    try {
        const { stdout, stderr } = await execFileP(SANDBOX.dockerBin, ['build', '-t', tag, workDir], { timeout: SANDBOX.buildTimeoutMs, maxBuffer: 8 * 1024 * 1024 });
        return { ok: true, log: (stdout + stderr).slice(-SANDBOX.maxLogChars) };
    } catch (e) {
        return { ok: false, log: (e.stdout || '') + (e.stderr || e.message || '') };
    }
};

/** Corre una imagen ya construida bajo gVisor, --network none, con timeout. */
export const runImage = ({ tag, timeoutMs = SANDBOX.runTimeoutMs, name }) => {
    return new Promise((resolve) => {
        const argv = [
            'run', '--rm', '--name', name, '--runtime', SANDBOX.runtime,
            '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--memory', SANDBOX.memory, '--memory-swap', SANDBOX.memory, '--cpus', SANDBOX.cpus,
            '--pids-limit', String(SANDBOX.pidsLimit), tag,
        ];
        const started = Date.now();
        const child = spawn(SANDBOX.dockerBin, argv, { env: process.env });
        let out = '', err = '', killed = false, finished = false;
        const cap = SANDBOX.maxLogChars;
        child.stdout.on('data', (d) => { if (out.length < cap) out += d.toString(); });
        child.stderr.on('data', (d) => { if (err.length < cap) err += d.toString(); });
        const timer = setTimeout(() => { killed = true; execFile(SANDBOX.dockerBin, ['kill', name], () => {}); }, timeoutMs);
        const done = (code) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ exitCode: code, stdout: out, stderr: err, timedOut: killed, durationMs: Date.now() - started }); };
        child.on('close', done);
        child.on('error', (e) => { err += `\n${e.message}`; done(-1); });
    });
};

export const forceCleanup = async (name) => {
    try { await execFileP(SANDBOX.dockerBin, ['rm', '-f', name], { timeout: 10000 }); } catch { /* ya no existe */ }
};

export const removeImage = async (tag) => {
    try { await execFileP(SANDBOX.dockerBin, ['rmi', '-f', tag], { timeout: 30000 }); } catch { /* noop */ }
};
