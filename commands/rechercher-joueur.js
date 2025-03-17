const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rechercher-joueur')
        .setDescription('Recherche un joueur dans la base de données')
        .addStringOption(option =>
            option.setName('terme')
                .setDescription('Nom, ID VRChat ou lien VRChat à rechercher')
                .setRequired(true)),

    async execute(interaction, playersDB) {
        try {
            await interaction.deferReply();
            let searchTerm = interaction.options.getString('terme');

            // Extraire l'ID VRChat si c'est un lien
            const vrchatLinkRegex = /vrchat\.com\/home\/user\/(usr_[a-zA-Z0-9_-]+)/;
            const linkMatch = searchTerm.match(vrchatLinkRegex);
            if (linkMatch) {
                searchTerm = linkMatch[1];
            }

            // Nettoyer le terme de recherche
            const cleanSearchTerm = searchTerm.toLowerCase().trim();

            // Rechercher par ID exact d'abord
            let results = playersDB.getAllPlayers().filter(player => 
                player.vrchatID.toLowerCase() === cleanSearchTerm
            );

            // Si aucun résultat par ID exact, chercher par correspondance partielle
            if (results.length === 0) {
                results = playersDB.getAllPlayers().filter(player => {
                    // Vérifier que le joueur et ses propriétés existent
                    if (!player || !player.vrchatID || !player.vrchatName) return false;

                    // Vérifier l'ID VRChat
                    if (player.vrchatID.toLowerCase().includes(cleanSearchTerm)) {
                        return true;
                    }

                    // Vérifier le nom VRChat
                    const playerWords = player.vrchatName.toLowerCase().split(/[\s_-]+/);
                    const searchWords = cleanSearchTerm.split(/[\s_-]+/);

                    // Recherche par début de mot
                    return searchWords.every(searchWord =>
                        playerWords.some(playerWord =>
                            playerWord.startsWith(searchWord)
                        )
                    );
                });
            }

            if (results.length === 0) {
                return await interaction.editReply({
                    content: `Aucun joueur trouvé pour "${searchTerm}".`,
                    ephemeral: true
                });
            }

            // Trier les résultats : correspondances exactes d'abord, puis par date de création
            results.sort((a, b) => {
                // Priorité aux correspondances exactes d'ID
                const aExactId = a.vrchatID.toLowerCase() === cleanSearchTerm;
                const bExactId = b.vrchatID.toLowerCase() === cleanSearchTerm;
                if (aExactId && !bExactId) return -1;
                if (!aExactId && bExactId) return 1;

                // Priorité aux correspondances exactes de nom
                const aExactName = a.vrchatName.toLowerCase() === cleanSearchTerm;
                const bExactName = b.vrchatName.toLowerCase() === cleanSearchTerm;
                if (aExactName && !bExactName) return -1;
                if (!aExactName && bExactName) return 1;

                // Par défaut, trier par date de création du thread le plus récent
                const aLatestThread = Math.max(...(a.forumThreads?.map(t => new Date(t.createdAt)) || [0]));
                const bLatestThread = Math.max(...(b.forumThreads?.map(t => new Date(t.createdAt)) || [0]));
                return bLatestThread - aLatestThread;
            });

            // Limiter les résultats
            const limitedResults = results.slice(0, 10);

            const embed = new EmbedBuilder()
                .setTitle(`Résultats de recherche pour "${searchTerm}"`)
                .setDescription(`${results.length} joueur(s) trouvé(s)${results.length > 10 ? ' (affichage des 10 premiers)' : ''}:`)
                .setColor('#5865F2')
                .setTimestamp();

            for (const [index, player] of limitedResults.entries()) {
                const threadInfo = [];
                
                if (player.forumThreads && player.forumThreads.length > 0) {
                    // Regrouper les threads par type (suspect/banni)
                    const threadsByType = new Map();
                    player.forumThreads.forEach(thread => {
                        const type = thread.tags?.includes('banni') ? 'banni' : 'suspect';
                        if (!threadsByType.has(type)) {
                            threadsByType.set(type, []);
                        }
                        threadsByType.get(type).push(thread);
                    });

                    // Afficher les threads par type
                    for (const [type, threads] of threadsByType) {
                        const threadList = threads.map(t => {
                            const date = t.createdAt ? ` (${new Date(t.createdAt).toLocaleDateString()})` : '';
                            return `• <#${t.threadId}>${date}`;
                        }).join('\n');
                        threadInfo.push(`**${type.charAt(0).toUpperCase() + type.slice(1)}:**\n${threadList}`);
                    }
                }

                embed.addFields({
                    name: `${index + 1}. ${player.vrchatName}`,
                    value: `**ID:** \`${player.vrchatID}\`\n` +
                           `**Profil:** <https://vrchat.com/home/user/${player.vrchatID}>\n` +
                           (threadInfo.length > 0 ? `\n${threadInfo.join('\n\n')}` : '*Aucun thread associé*')
                });
            }

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors de la recherche:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Une erreur est survenue lors de la recherche.',
                    ephemeral: true
                });
            } else {
                await interaction.editReply({
                    content: 'Une erreur est survenue lors de la recherche.',
                    ephemeral: true
                });
            }
        }
    },
};
