import { readFile } from 'fs/promises';
import path from 'path';
import { SANDBOX } from '../config/sandbox.config.js';
import { cloneRepo, cleanup } from './cloner.service.js';
import { detectStack } from './detector.service.js';
import { dockerAvailable, runContainer, runImage, buildImage, forceCleanup, removeImage } from './dockerRunner.service.js';

const newId = () => `lsx-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Detecta env vars / servicios requeridos por el repo (estático + logs de crash)
const detectRequirements = async (dir, logs) => {
    const envVars = new Set();
    const services = new Set();
    for (const f of ['.env.example', '.env.sample', '.env.template']) {
        try {
            const txt = await readFile(path.join(dir, f), 'utf8');
            for (const line of txt.split('\n')) {
                const m = line.match(/^\s*([A-Z][A-Z0-9_]{2,})\s*=/);
                if (m) envVars.add(m[1]);
            }
        } catch { /* sin ejemplo */ }
    }
    const L = logs || '';
    if (/ECONNREFUSED[^\n]*:5432|postgres|psql|pg_/i.test(L)) services.add('postgres');
    if (/ECONNREFUSED[^\n]*:3306|mysql|mariadb/i.test(L)) services.add('mysql');
    if (/ECONNREFUSED[^\n]*:27017|mongo/i.test(L)) services.add('mongodb');
    if (/ECONNREFUSED[^\n]*:6379|redis/i.test(L)) services.add('redis');
    for (const m of L.matchAll(/([A-Z][A-Z0-9_]{2,})\s+(?:is required|is not defined|missing|no est[aá] definida)/gi)) envVars.add(m[1]);
    for (const m of L.matchAll(/(?:Missing|Invalid)\s+([A-Z][A-Z0-9_]{2,})/g)) envVars.add(m[1]);
    return { envVars: [...envVars].slice(0, 20), externalServices: [...services] };
};

const missingFromLogs = (logs, reqs) => {
    const L = logs || '';
    const missing = new Set();
    for (const v of reqs.envVars || []) {
        if (new RegExp(`${v}[^\\n]*(?:required|missing|undefined|not set|no est)`, 'i').test(L) || /api[_ ]?key|token|secret/i.test(v)) {
            missing.add(v);
        }
    }
    reqs.externalServices?.forEach((s) => missing.add(`servicio:${s}`));
    return [...missing].slice(0, 15);
};

/**
 * Ejecuta un repo de GitHub en sandbox (gVisor) y devuelve un veredicto.
 * NO toca la base de datos — devuelve el objeto resultado para que lo persista el backend.
 */
export const runSandbox = async (repoUrl) => {
    const result = {
        attempted: false, strategy: null, buildOk: false, startOk: false,
        verdict: 'skipped', detectedRequirements: {}, missingSecrets: [],
        logsSummary: '', ranAt: new Date().toISOString()
    };
    if (!SANDBOX.enabled) { result.skippedReason = 'disabled'; return result; }
    if (!(await dockerAvailable())) { result.skippedReason = 'docker-unavailable'; return result; }

    let clone;
    try {
        clone = await cloneRepo(repoUrl);
    } catch (e) {
        result.verdict = 'clone-failed';
        result.logsSummary = e.message;
        return result;
    }

    const id = newId();
    const tag = `${id}:img`;
    try {
        const stack = await detectStack(clone.dir);
        result.attempted = true;
        result.strategy = stack.type;

        if (stack.type === 'unsupported') {
            result.verdict = 'unsupported';
            result.logsSummary = 'No detecté un stack soportado (Dockerfile / package.json / requirements.txt / go.mod).';
            return result;
        }

        let buildLog = '';

        // ── Estrategia Dockerfile propio del repo ──
        if (stack.type === 'docker') {
            const b = await buildImage(clone.dir, tag);
            buildLog = b.log;
            result.buildOk = b.ok;
            if (b.ok) {
                const r = await runImage({ tag, name: `${id}-r`, timeoutMs: SANDBOX.runTimeoutMs });
                await forceCleanup(`${id}-r`);
                const runLog = r.stdout + r.stderr;
                result.startOk = r.timedOut || r.exitCode === 0;
                result.detectedRequirements = await detectRequirements(clone.dir, runLog);
                result.missingSecrets = missingFromLogs(runLog, result.detectedRequirements);
                result.verdict = result.startOk ? 'works' : (result.missingSecrets.length ? 'needs-config' : 'crashes');
                result.logsSummary = (runLog || buildLog).slice(-1500);
            } else {
                result.verdict = 'build-failed';
                result.logsSummary = buildLog.slice(-1500);
            }
            return result;
        }

        // ── Estrategia node / python / go: install → build → run ──
        if (stack.install) {
            const ins = await runContainer({ image: stack.image, workDir: clone.dir, cmd: stack.install, network: SANDBOX.allowDepFetch ? 'default' : 'none', timeoutMs: SANDBOX.buildTimeoutMs, name: `${id}-i` });
            await forceCleanup(`${id}-i`);
            buildLog += ins.stdout + ins.stderr;
            result.buildOk = ins.exitCode === 0;
        } else {
            result.buildOk = true;
        }

        if (stack.build && result.buildOk) {
            const bld = await runContainer({ image: stack.image, workDir: clone.dir, cmd: stack.build, network: 'none', timeoutMs: SANDBOX.buildTimeoutMs, name: `${id}-b` });
            await forceCleanup(`${id}-b`);
            buildLog += bld.stdout + bld.stderr;
            result.buildOk = bld.exitCode === 0;
        }

        const secs = Math.max(5, Math.floor(SANDBOX.runTimeoutMs / 1000));
        const run = await runContainer({
            image: stack.image, workDir: clone.dir,
            cmd: `timeout ${secs}s ${stack.run}`,
            network: 'none', timeoutMs: SANDBOX.runTimeoutMs + 8000, name: `${id}-r`
        });
        await forceCleanup(`${id}-r`);
        const runLog = run.stdout + run.stderr;

        // startOk: el proceso siguió vivo hasta el timeout (server) o salió 0; 124 = timeout(1) coreutils
        result.startOk = result.buildOk && (run.timedOut || run.exitCode === 0 || run.exitCode === 124);
        result.detectedRequirements = await detectRequirements(clone.dir, runLog);
        result.missingSecrets = missingFromLogs(runLog, result.detectedRequirements);
        result.logsSummary = `[build]\n${buildLog.slice(-700)}\n[run]\n${runLog.slice(-1000)}`.trim();
        result.verdict = !result.buildOk ? 'build-failed'
            : result.startOk ? 'works'
            : result.missingSecrets.length ? 'needs-config'
            : 'crashes';
        return result;
    } catch (e) {
        result.verdict = 'error';
        result.logsSummary = (e.message || '').slice(0, 1500);
        return result;
    } finally {
        await forceCleanup(`${id}-i`);
        await forceCleanup(`${id}-b`);
        await forceCleanup(`${id}-r`);
        await removeImage(tag);
        await cleanup(clone.dir);
    }
};
