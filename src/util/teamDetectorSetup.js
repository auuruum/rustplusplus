const ChildProcess = require('child_process');
const Fs = require('fs');
const Path = require('path');

const Config = require('../../config');

function run(command, args, cwd, env = {}) {
    ChildProcess.execFileSync(command, args, {
        cwd,
        env: Object.assign({}, process.env, env),
        stdio: 'inherit',
        windowsHide: true
    });
}

function hasCommand(command) {
    try {
        ChildProcess.execFileSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
        return true;
    }
    catch (e) {
        return false;
    }
}

function uvEnv(target) {
    return {
        UV_CACHE_DIR: process.env.UV_CACHE_DIR || Path.join(target, '.uv-cache'),
        UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR || Path.join(target, '.uv-python')
    };
}

function assertTools() {
    if (!hasCommand('git')) throw new Error('git is required to clone team-detector.');
    if (!hasCommand('uv')) {
        throw new Error('uv is required. Install it first: https://docs.astral.sh/uv/getting-started/installation/');
    }
}

function ensureTeamDetectorSync(options = {}) {
    const repo = options.repo || Config.teamDetector.repo;
    const ref = options.ref === undefined ? Config.teamDetector.ref : options.ref;
    const target = options.path || Config.teamDetector.path;
    const update = options.update === true;

    assertTools();

    if (!Fs.existsSync(target)) {
        Fs.mkdirSync(Path.dirname(target), { recursive: true });
        const cloneArgs = ['clone'];
        if (ref) cloneArgs.push('--branch', ref);
        cloneArgs.push(repo, target);
        run('git', cloneArgs, process.cwd());
    }
    else if (!Fs.existsSync(Path.join(target, 'team_detector.py'))) {
        throw new Error(`${target} exists but team_detector.py was not found.`);
    }
    else {
        if (update) run('git', ['fetch', 'origin'], target);
        if (ref) run('git', ['checkout', ref], target);
        if (update) {
            run('git', ref ? ['pull', '--ff-only', 'origin', ref] : ['pull', '--ff-only'], target);
        }
    }

    if (!Fs.existsSync(Path.join(target, '.venv'))) {
        run('uv', ['sync', '--managed-python'], target, uvEnv(target));
    }

    return target;
}

module.exports = {
    ensureTeamDetectorSync
};
