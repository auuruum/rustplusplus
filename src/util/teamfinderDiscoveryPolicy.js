const DEFAULTS = Object.freeze({
    comments: true,
    commentPages: 2,
    maxProfiles: 75,
    minScore: 2,
    recursiveDepth: 5,
    requestDelay: 0.2
});

function fromInteraction(interaction) {
    return {
        comments: interaction.options.getBoolean('comments') ?? DEFAULTS.comments,
        commentPages: interaction.options.getInteger('commentpages') ?? DEFAULTS.commentPages,
        maxProfiles: interaction.options.getInteger('maxprofiles') ?? DEFAULTS.maxProfiles,
        minScore: interaction.options.getInteger('minscore') ?? DEFAULTS.minScore,
        recursiveDepth: interaction.options.getInteger('depth') ?? DEFAULTS.recursiveDepth,
        requestDelay: interaction.options.getNumber('delay') ?? DEFAULTS.requestDelay
    };
}

module.exports = { DEFAULTS, fromInteraction };
