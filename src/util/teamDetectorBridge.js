/*
    Copyright (C) 2026 FaiThiX

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/faithix/rustplusplus

*/

const ChildProcess = require('child_process');
const Fs = require('fs');
const Path = require('path');

const Config = require('../../config');

let queueTail = Promise.resolve();

function enqueue(task) {
    const run = queueTail.catch(() => {}).then(task);
    queueTail = run.catch(() => {});
    return run;
}

function splitCommand(command) {
    return command.trim().split(/\s+/).filter(part => part !== '');
}

function appendNumberArg(args, name, value) {
    if (value === null || value === undefined) return;
    args.push(name, `${value}`);
}

function detectorSupportsResilientFetching() {
    try {
        const detectorFile = Path.join(Config.teamDetector.path, 'team_detector.py');
        return Fs.readFileSync(detectorFile, 'utf8').includes("'--cache-path'");
    }
    catch (e) {
        return false;
    }
}

function detectorSupportsPlayerRoster() {
    try {
        const detectorFile = Path.join(Config.teamDetector.path, 'team_detector.py');
        return Fs.readFileSync(detectorFile, 'utf8').includes("'--player-roster-file'");
    }
    catch (e) {
        return false;
    }
}

function getPlayerRosterPath(roster) {
    if (!roster || typeof roster !== 'object') return null;

    const outputDirectory = Path.join(__dirname, '..', '..', 'data', 'teamfinder');
    Fs.mkdirSync(outputDirectory, { recursive: true });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const snapshotPath = Path.join(outputDirectory, `player_roster_${suffix}.json`);
    Fs.writeFileSync(snapshotPath, JSON.stringify(roster), { encoding: 'utf8', mode: 0o600 });
    return snapshotPath;
}

function getLegacyPlayersPath(roster) {
    if (!roster || !roster.available || !Array.isArray(roster.players) || roster.players.length === 0) return null;

    const outputDirectory = Path.join(__dirname, '..', '..', 'data', 'teamfinder');
    Fs.mkdirSync(outputDirectory, { recursive: true });
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const snapshotPath = Path.join(outputDirectory, `battlemetrics_players_${suffix}.json`);
    Fs.writeFileSync(snapshotPath, JSON.stringify(roster.players), { encoding: 'utf8', mode: 0o600 });
    return snapshotPath;
}

function buildDetectorArgs(options) {
    const args = [
        'team_detector.py',
        '--auto-discover',
        '--battlemetrics-id', options.battlemetricsId,
        '--steam-id', ...options.steamIds,
        '--json',
        '--no-config'
    ];

    if (options.playerRosterPath && detectorSupportsPlayerRoster()) {
        args.push('--player-roster-file', options.playerRosterPath);
    }
    else if (options.legacyPlayersPath && detectorSupportsResilientFetching()) {
        args.push('--battlemetrics-players-file', options.legacyPlayersPath);
    }

    if (options.networkOutputPath) {
        args.push('--network-output', options.networkOutputPath);
    }
    else {
        args.push('--no-network');
    }

    if (options.comments) args.push('--comments');

    appendNumberArg(args, '--recursive-depth', options.recursiveDepth);
    appendNumberArg(args, '--comment-pages', options.commentPages);
    appendNumberArg(args, '--auto-max-profiles', options.maxProfiles);
    appendNumberArg(args, '--auto-min-score', options.minScore);
    appendNumberArg(args, '--request-delay', options.requestDelay);
    if (detectorSupportsResilientFetching()) {
        args.push('--cache-path', Config.teamDetector.cachePath);
        appendNumberArg(args, '--request-retries', Config.teamDetector.requestRetries);
    }

    return args;
}

function summarizeProcessOutput(stdout, stderr) {
    const parts = [];
    if (stdout && stdout.trim() !== '') parts.push(`stdout: ${stdout.trim().slice(0, 800)}`);
    if (stderr && stderr.trim() !== '') parts.push(`stderr: ${stderr.trim().slice(0, 800)}`);
    return parts.join('\n');
}

function parseDetectorJson(stdout) {
    const trimmed = stdout.trim();
    if (trimmed === '') {
        throw new Error('team-detector produced empty stdout.');
    }

    try {
        return JSON.parse(trimmed);
    }
    catch (e) {
        const jsonLine = trimmed.split(/\r?\n/)
            .reverse()
            .find(line => line.trim().startsWith('{'));
        if (!jsonLine) throw e;
        return JSON.parse(jsonLine.trim());
    }
}

function getNetworkOutputPath() {
    const outputDirectory = Path.join(__dirname, '..', '..', 'data', 'teamfinder');
    Fs.mkdirSync(outputDirectory, { recursive: true });

    const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    return Path.join(outputDirectory, `team_network_${suffix}.html`);
}

module.exports = {
    runAutoDiscovery: function (options) {
        return enqueue(() => new Promise((resolve, reject) => {
            const detectorPath = Config.teamDetector.path;
            if (!Fs.existsSync(Path.join(detectorPath, 'team_detector.py'))) {
                reject(new Error(`team_detector.py not found in ${detectorPath}`));
                return;
            }

            const commandParts = splitCommand(Config.teamDetector.command);
            if (commandParts.length === 0) {
                reject(new Error('RPP_TEAM_DETECTOR_COMMAND is empty.'));
                return;
            }

            const executable = commandParts[0];
            const detectorOptions = Object.assign({}, options);
            if (detectorOptions.includeNetwork !== false && !detectorOptions.networkOutputPath) {
                detectorOptions.networkOutputPath = getNetworkOutputPath();
            }
            if (detectorSupportsPlayerRoster()) {
                detectorOptions.playerRosterPath = getPlayerRosterPath(detectorOptions.playerRoster);
            }
            else {
                detectorOptions.legacyPlayersPath = getLegacyPlayersPath(detectorOptions.playerRoster);
            }

            const args = commandParts.slice(1).concat(buildDetectorArgs(detectorOptions));

            ChildProcess.execFile(executable, args, {
                cwd: detectorPath,
                timeout: Config.teamDetector.timeoutMs,
                maxBuffer: 1024 * 1024 * 8,
                windowsHide: true,
                env: Object.assign({}, process.env, {
                    BATTLEMETRICS_TOKEN: Config.battlemetrics.token
                })
            }, (error, stdout, stderr) => {
                if (detectorOptions.playerRosterPath) {
                    Fs.rmSync(detectorOptions.playerRosterPath, { force: true });
                }
                if (detectorOptions.legacyPlayersPath) {
                    Fs.rmSync(detectorOptions.legacyPlayersPath, { force: true });
                }
                if (error) {
                    const output = summarizeProcessOutput(stdout, stderr);
                    reject(new Error(`${error.message}${output ? `\n${output}` : ''}`));
                    return;
                }

                try {
                    resolve(parseDetectorJson(stdout));
                }
                catch (e) {
                    const output = summarizeProcessOutput(stdout, stderr);
                    reject(new Error(`Failed to parse team-detector JSON. ${e.message}${output ? `\n${output}` : ''}`));
                }
            });
        }));
    }
};
