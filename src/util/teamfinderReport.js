function clean(value) {
    return `${value === null || value === undefined ? '' : value}`.replace(/[\r\n\t]+/g, ' ').trim();
}

function buildText(result) {
    const candidates = Array.isArray(result && result.candidates) ? result.candidates : [];
    const crawl = result && result.crawl ? result.crawl : {};
    const fetch = result && result.fetch_stats ? result.fetch_stats : {};
    const lines = [
        'Team Finder full report',
        `Server: ${clean(result && result.server_id)}`,
        `Inspected profiles: ${Array.isArray(result && result.inspected_profiles) ? result.inspected_profiles.length : 0}`,
        `Candidates: ${candidates.length}`,
        `Comments: ${crawl.comments_enabled ? 'on' : 'off'}; pages: ${clean(crawl.comment_pages)}; comment profiles: ${clean(crawl.comment_profiles)}`,
        `Depth: ${clean(crawl.recursive_depth)}; min score: ${clean(crawl.min_score)}; max profiles: ${clean(crawl.max_profiles)}`,
        `Runtime: ${clean(crawl.elapsed_seconds)}s / ${clean(crawl.max_runtime_seconds)}s; ` +
            `truncated: ${crawl.truncated ? 'yes' : 'no'}; stop reason: ${clean(crawl.stop_reason)}; ` +
            `frontier remaining: ${clean(crawl.frontier_remaining)}`,
        `Cache fresh: ${fetch.cache || 0}; stale: ${fetch.stale || 0}; network: ${fetch.network || 0}; failed: ${fetch.failed || 0}`,
        '',
        'Score | Online evidence | SteamID | Name | Sources | Connections'
    ];

    for (const candidate of candidates) {
        const sources = Array.isArray(candidate.sources) ? candidate.sources.join(',') : '';
        const connections = Array.isArray(candidate.connection_profile_names) ?
            candidate.connection_profile_names.join(',') : '';
        lines.push([
            clean(candidate.score),
            candidate.online ? clean(candidate.online_confidence || 'yes') : 'unknown',
            clean(candidate.steam_id),
            clean(candidate.name),
            clean(sources),
            clean(connections)
        ].join(' | '));
    }
    return `${lines.join('\n')}\n`;
}

module.exports = { buildText };
