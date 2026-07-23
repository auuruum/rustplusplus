const Test = require('node:test');
const Assert = require('node:assert/strict');

const TeamDetectorBridge = require('../src/util/teamDetectorBridge.js');

Test('reports an execFile timeout without dumping the whole command as the reason', () => {
    const error = Object.assign(new Error('Command failed: uv run python team_detector.py --many arguments'), {
        killed: true,
        signal: 'SIGTERM',
        code: null
    });

    const message = TeamDetectorBridge._test.summarizeProcessFailure(error, '', '', 180000);

    Assert.match(message, /timed out after 180s/);
    Assert.match(message, /SIGTERM/);
    Assert.doesNotMatch(message, /--many arguments/);
});

Test('preserves concise stderr for a normal detector failure', () => {
    const error = Object.assign(new Error('Command failed'), { killed: false, signal: null, code: 2 });

    const message = TeamDetectorBridge._test.summarizeProcessFailure(error, '', 'bad roster JSON', 180000);

    Assert.match(message, /exit code 2/);
    Assert.match(message, /stderr: bad roster JSON/);
});