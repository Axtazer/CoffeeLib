const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('statistiques')
        .setDescription('Affiche les statistiques de la base de données')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addStringOption(option =>
            option.setName('période')
                .setDescription('Période pour les statistiques')
                .setRequired(false)
                .addChoices(
                    { name: 'Aujourd\'hui', value: 'today' },
                    { name: '7 derniers jours', value: 'week' },
                    { name: '30 derniers jours', value: 'month' },
                    { name: 'Tout', value: 'all' }
                )),

    async execute(interaction, playersDB) {
        await interaction.deferReply();

        try {
            const period = interaction.options.getString('période') || 'all';
            const now = new Date();
            let startDate;

            switch (period) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    break;
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startDate = new Date(0); // Depuis le début
            }

            const allPlayers = playersDB.getAllPlayers();
            const filteredPlayers = allPlayers.filter(player => {
                if (!player.forumThreads || player.forumThreads.length === 0) return false;
                const threadDate = new Date(player.forumThreads[0].createdAt);
                return threadDate >= startDate;
            });

            // Statistiques générales
            const totalPlayers = filteredPlayers.length;
            const suspects = filteredPlayers.filter(p => p.type === 'suspect').length;
            const banned = filteredPlayers.filter(p => p.type === 'banned').length;

            // Statistiques des tags
            const tagStats = new Map();
            for (const player of filteredPlayers) {
                if (player.forumThreads && player.forumThreads[0].tags) {
                    for (const tagId of player.forumThreads[0].tags) {
                        tagStats.set(tagId, (tagStats.get(tagId) || 0) + 1);
                    }
                }
            }

            // Récupérer les noms des tags
            const forum = await interaction.guild.channels.fetch(process.env.FORUM_SUSPECTS_ID);
            const tagNames = new Map(forum.availableTags.map(tag => [tag.id, tag.name]));

            // Trier les tags par fréquence
            const sortedTags = [...tagStats.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([tagId, count]) => ({
                    name: tagNames.get(tagId) || 'Tag inconnu',
                    count: count
                }));

            // Créer l'embed
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('Statistiques de la base de données')
                .setDescription(`Période : ${period === 'all' ? 'Depuis le début' :
                    period === 'today' ? 'Aujourd\'hui' :
                    period === 'week' ? '7 derniers jours' :
                    '30 derniers jours'}`)
                .addFields(
                    { name: '📊 Statistiques générales', value: 
                        `**Total des joueurs :** ${totalPlayers}\n` +
                        `**Suspects :** ${suspects}\n` +
                        `**Bannis :** ${banned}\n` +
                        `**Ratio bannis/suspects :** ${suspects > 0 ? Math.round(banned/suspects*100) : 0}%`
                    }
                );

            // Ajouter les tags les plus utilisés
            if (sortedTags.length > 0) {
                const tagsText = sortedTags
                    .map(tag => `${tag.name} : ${tag.count} fois`)
                    .join('\n');

                embed.addFields({
                    name: '🏷️ Tags les plus utilisés',
                    value: tagsText
                });
            }

            // Ajouter le timestamp
            embed.setTimestamp()
                .setFooter({ 
                    text: `Statistiques générées le ${new Date().toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}`
                });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Erreur lors de la génération des statistiques:', error);
            await interaction.editReply({
                content: 'Une erreur est survenue lors de la génération des statistiques.',
                ephemeral: true
            });
        }
    },
};
