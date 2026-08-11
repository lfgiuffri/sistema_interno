import { readFile, access } from 'fs/promises';
import path from 'path';
import { SANDBOX } from '../config/sandbox.config.js';

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const readJson = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

/**
 * Detecta el stack del repo y propone una estrategia de ejecución.
 * No ejecuta nada (solo lee archivos).
 */
export const detectStack = async (dir) => {
    if (await exists(path.join(dir, 'Dockerfile'))) {
        return { type: 'docker', image: null, install: null, run: null };
    }

    const pkg = await readJson(path.join(dir, 'package.json'));
    if (pkg) {
        const pm = (await exists(path.join(dir, 'pnpm-lock.yaml'))) ? 'pnpm'
            : (await exists(path.join(dir, 'yarn.lock'))) ? 'yarn' : 'npm';
        const installCmd = pm === 'npm' ? 'npm install --ignore-scripts --no-audit --no-fund'
            : pm === 'yarn' ? 'yarn install --ignore-scripts' : 'pnpm install --ignore-scripts';
        const start = pkg.scripts?.start
            ? 'npm start'
            : `node ${pkg.main || 'index.js'}`;
        const build = pkg.scripts?.build ? 'npm run build' : null;
        return { type: 'node', image: SANDBOX.nodeImage, install: installCmd, build, run: start };
    }

    if (await exists(path.join(dir, 'requirements.txt')) || await exists(path.join(dir, 'pyproject.toml')) || await exists(path.join(dir, 'Pipfile'))) {
        const install = (await exists(path.join(dir, 'requirements.txt')))
            ? 'pip install --no-input -r requirements.txt' : 'pip install --no-input .';
        let entry = 'main.py';
        for (const f of ['main.py', 'app.py', 'bot.py', 'run.py', 'manage.py', '__main__.py']) {
            if (await exists(path.join(dir, f))) { entry = f; break; }
        }
        return { type: 'python', image: SANDBOX.pythonImage, install, build: null, run: `python ${entry}` };
    }

    if (await exists(path.join(dir, 'go.mod'))) {
        return { type: 'go', image: SANDBOX.goImage, install: 'go mod download', build: 'go build -o /tmp/app ./...', run: '/tmp/app' };
    }

    return { type: 'unsupported', image: null, install: null, run: null };
};
