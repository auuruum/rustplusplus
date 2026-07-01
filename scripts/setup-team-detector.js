const Config = require('../config');
const TeamDetectorSetup = require('../src/util/teamDetectorSetup');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: npm run setup:team-detector

Clones or updates ${Config.teamDetector.repo}
Target: ${Config.teamDetector.path}`);
    process.exit(0);
}

TeamDetectorSetup.ensureTeamDetectorSync({ update: true });
