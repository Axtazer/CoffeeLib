const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ForumScanner } = require('../utils/forum-scanner');
const { ADMIN_USERS } = require('../config/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scanner-forums')
        .setDescription('Scanner les forums pour trouver les threads sans lien VRChat')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addBooleanOption(option =>
            option.setName('rescan')
                .setDescription('Forcer un nouveau scan de tous les threads')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('rebuild')
                .setDescription('Reconstruire la base de données à partir des forums BAN et SUSPECTS.')
                .setRequired(false)),

    async execute(interaction, playersDB) {
        try {
            // Vérifier les permissions pour rebuild et rescan
            const rebuildDB = interaction.options.getBoolean('rebuild') || false;
            const rescan = interaction.options.getBoolean('rescan') || false;

            if ((rebuildDB || rescan) && !ADMIN_USERS.includes(interaction.user.id)) {
                await interaction.reply({
                    content: '❌ Vous n\'avez pas la permission de reconstruire la base de données ou de forcer un rescan.',
                    ephemeral: true
                });
                return;
            }

            await interaction.deferReply();

            // Créer une nouvelle instance du scanner
            const forumScanner = new ForumScanner(interaction.client, playersDB);
            
            // Forcer le rescan si on reconstruit la DB
            const forceRescan = rebuildDB || rescan;
            
            // Si on reconstruit la DB, vider la base actuelle
            if (rebuildDB) {
                playersDB.clearDatabase();
                await interaction.editReply('🗑️ Base de données vidée, reconstruction en cours...');
            }
            
            // Lancer le scan
            await forumScanner.scanForums(forceRescan);
            
            // Message de succès
            let message = '✅ Scan des forums terminé !';
            if (rebuildDB) {
                const players = playersDB.getAllPlayers();
                message += `\n📊 Base de données reconstruite avec ${players.length} joueurs.`;
            }
            
            await interaction.editReply(message);
        } catch (error) {
            console.error('Erreur lors du scan des forums:', error);
            await interaction.editReply('❌ Une erreur est survenue lors du scan des forums.');
        }
    },
};
