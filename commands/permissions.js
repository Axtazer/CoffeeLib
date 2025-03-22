const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { BAN_ROLES, SUSPECT_ROLES, ADMIN_USERS } = require('../config/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('permissions')
        .setDescription('Gestion des permissions')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type d\'affichage des permissions')
                .setRequired(true)
                .addChoices(
                    { name: 'Liste des rôles', value: 'list' },
                    { name: 'Permissions d\'un utilisateur', value: 'user' }
                ))
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur dont vous voulez voir les permissions')
                .setRequired(false)),

    async execute(interaction) {
        const type = interaction.options.getString('type');
        
        if (type === 'list') {
            await this.handleListCommand(interaction);
        } else if (type === 'user') {
            const user = interaction.options.getUser('utilisateur');
            if (!user) {
                return interaction.reply({
                    content: 'Vous devez spécifier un utilisateur pour voir ses permissions.',
                    flags: MessageFlags.Ephemeral
                });
            }
            await this.handleUserCommand(interaction, user);
        }
    },

    async handleListCommand(interaction) {
        await interaction.deferReply();

        try {
            const guild = interaction.guild;
            
            // Récupérer les rôles du serveur
            const banRoles = [];
            const suspectRoles = [];
            
            for (const roleId of BAN_ROLES) {
                try {
                    const role = await guild.roles.fetch(roleId);
                    if (role) banRoles.push(role);
                } catch (error) {
                    console.error(`Erreur lors de la récupération du rôle ban ${roleId}:`, error);
                }
            }
            
            for (const roleId of SUSPECT_ROLES) {
                if (!BAN_ROLES.includes(roleId)) {
                    try {
                        const role = await guild.roles.fetch(roleId);
                        if (role) suspectRoles.push(role);
                    } catch (error) {
                        console.error(`Erreur lors de la récupération du rôle suspect ${roleId}:`, error);
                    }
                }
            }
            
            // Créer l'embed
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('Permissions des rôles')
                .setDescription('Liste des rôles et leurs permissions pour la gestion des signalements')
                .addFields(
                    { 
                        name: '🔨 Rôles pouvant créer des dossiers bannis', 
                        value: banRoles.length > 0 
                            ? banRoles.map(r => `<@&${r.id}>`).join('\n') 
                            : 'Aucun rôle configuré'
                    },
                    { 
                        name: '⚠️ Rôles pouvant créer uniquement des dossiers suspects', 
                        value: suspectRoles.length > 0 
                            ? suspectRoles.map(r => `<@&${r.id}>`).join('\n') 
                            : 'Aucun rôle configuré'
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'CoffeeLib - Système de permissions' });
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors de l\'affichage des permissions:', error);
            await interaction.editReply({ 
                content: 'Une erreur est survenue lors de l\'affichage des permissions.',
                ephemeral: true 
            });
        }
    },

    async handleUserCommand(interaction, user) {
        await interaction.deferReply();

        try {
            const member = await interaction.guild.members.fetch(user.id);
            
            // Vérifier les permissions de l'utilisateur
            const canBan = member.roles.cache.some(role => BAN_ROLES.includes(role.id));
            const canSuspect = member.roles.cache.some(role => SUSPECT_ROLES.includes(role.id));
            const isAdmin = ADMIN_USERS.includes(user.id);
            
            // Récupérer les rôles pertinents de l'utilisateur
            const relevantRoles = member.roles.cache
                .filter(role => BAN_ROLES.includes(role.id) || SUSPECT_ROLES.includes(role.id))
                .map(role => `<@&${role.id}>`)
                .join(', ');
            
            // Créer l'embed
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`Permissions de ${user.username}`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { 
                        name: '👤 Utilisateur', 
                        value: `<@${user.id}> (${user.username})`
                    },
                    { 
                        name: '🛡️ Rôles pertinents', 
                        value: relevantRoles || 'Aucun rôle avec des permissions spéciales'
                    },
                    { 
                        name: '🔑 Permissions', 
                        value: 
                            `**Créer des dossiers bannis:** ${canBan ? '✅' : '❌'}\n` +
                            `**Créer des dossiers suspects:** ${canSuspect ? '✅' : '❌'}\n` +
                            `**Administrateur système:** ${isAdmin ? '✅' : '❌'}`
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'CoffeeLib - Système de permissions' });
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Erreur lors de l\'affichage des permissions utilisateur:', error);
            await interaction.editReply({ 
                content: 'Une erreur est survenue lors de l\'affichage des permissions utilisateur.',
                ephemeral: true 
            });
        }
    }
};