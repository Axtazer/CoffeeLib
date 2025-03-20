const { Events, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { BAN_ROLES, SUSPECT_ROLES } = require('../config/permissions');
const ThreadCreator = require('../utils/thread-creator');
const VRChatDataService = require('../utils/vrchat-data-service');

class VRChatLinkDetector {
    constructor(playersDB) {
        this.playersDB = playersDB;
        this.dataService = new VRChatDataService(playersDB);
        
        // Configuration
        this.DEBUG = process.env.DEBUG;
        this.ABANDON_TIMEOUT = 30000; // 30s avant de cloturer l'intéraction
        this.pendingMessages = new Map();
        
        // IDs de canaux et forums
        this.VRCHAT_LINK_CHANNEL_ID = process.env.VRCHAT_LINK_CHANNEL_ID;
        this.FORUM_BANNIS_ID = process.env.FORUM_BANNIS_ID;
        this.FORUM_SUSPECTS_ID = process.env.FORUM_SUSPECTS_ID;
    }

    debug(...args) {
        if (this.DEBUG) console.log(...args);
    }

    /**
     * Vérifie si un membre a les permissions pour un type donné
     * @param {GuildMember} member - Membre Discord
     * @param {string} type - Type de dossier ('ban' ou 'suspect')
     * @returns {boolean}
     */
    hasPermission(member, type) {
        if (type === 'ban' || type === 'banned') {
            return member.roles.cache.some(role => BAN_ROLES.includes(role.id));
        }
        return member.roles.cache.some(role => SUSPECT_ROLES.includes(role.id));
    }

    /**
     * Crée les boutons adaptés aux permissions du membre
     * @param {GuildMember} member - Membre Discord
     * @param {string} vrchatID - ID VRChat
     * @returns {ActionRowBuilder|null}
     */
    createActionButtons(member, vrchatID) {
        const buttons = [];
        const canSuspect = this.hasPermission(member, 'suspect');
        const canBan = this.hasPermission(member, 'ban');

        if (canSuspect) {
            buttons.push(new ButtonBuilder()
                .setCustomId(`suspect_${vrchatID}`)
                .setLabel('Créer dossier Suspect')
                .setEmoji('⚠️')
                .setStyle(ButtonStyle.Secondary));
        }
        
        if (canBan) {
            buttons.push(new ButtonBuilder()
                .setCustomId(`ban_${vrchatID}`)
                .setLabel('Créer dossier Banni')
                .setEmoji('🔨')
                .setStyle(ButtonStyle.Danger));
        }

        return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
    }

    /**
     * Gère un joueur existant dans la base de données
     * @param {Message} message - Message Discord
     * @param {Object} existingPlayer - Données du joueur existant
     * @param {Object} vrchatInfo - Informations VRChat
     * @param {GuildMember} member - Membre Discord
     */
    async handleExistingPlayer(message, existingPlayer, vrchatInfo, member) {
        const canBan = this.hasPermission(member, 'ban');
        const status = existingPlayer.type === 'suspect' ? '⚠️ Suspect' : '🚫 Banni';

        // Vérifie les permissions pour le type de dossier existant
        if (existingPlayer.type === 'banned' && !canBan) {
            await message.reply({ 
                content: "Vous n'avez pas les permissions pour gérer les dossiers bannis.\nVa voir le salon <#1343718631833473106>",
                flags: MessageFlags.Ephemeral 
            });
            return;
        }

        // Nettoyer les threads invalides
        const { player: updatedPlayer, validThreads } = 
            await this.dataService.cleanInvalidThreads(existingPlayer, message.guild);

        // Si tous les threads ont été supprimés, permettre d'en créer un nouveau
        if (validThreads.length === 0) {
            const row = this.createActionButtons(member, vrchatInfo.vrchatID);
            
            if (row) {
                await message.reply({
                    content: `${status}\n**ID VRChat:** \`${vrchatInfo.vrchatID}\`\n\n⚠️ Les anciens threads ont été supprimés, vous pouvez en créer un nouveau.`,
                    components: [row],
                    allowedMentions: { parse: [] }
                });
            } else {
                await message.reply({
                    content: `${status}\n**ID VRChat:** \`${vrchatInfo.vrchatID}\`\n\n⚠️ Les anciens threads ont été supprimés, mais vous n'avez pas les permissions pour en créer un nouveau.`,
                    allowedMentions: { parse: [] }
                });
            }
            return;
        }

        // Afficher les threads existants
        await message.reply({
            content: `# ${status}\n## Profil VRChat : \`${vrchatInfo.vrchatName}\`\n### Thread: ${validThreads.join('\n')}\n-# ID VRC : \`${vrchatInfo.vrchatID}\``,
            allowedMentions: { parse: [] }
        });
    }

    /**
     * Traite un message contenant un lien VRChat
     * @param {Message} message - Message Discord
     */
    async handleMessage(message) {
        // Filtres rapides pour éviter les traitements inutiles
        if (message.channel.id !== this.VRCHAT_LINK_CHANNEL_ID || message.author.bot) return;

        try {
            // Extraire les informations VRChat
            const vrchatInfo = await this.dataService.extractVRChatInfo(message, {
                debug: this.DEBUG
            });
            
            if (!vrchatInfo) return;
            this.debug('Informations VRChat extraites:', vrchatInfo);

            // Récupérer le membre et vérifier ses permissions
            const member = await message.guild.members.fetch(message.author.id);
            const canSuspect = this.hasPermission(member, 'suspect');
            const canBan = this.hasPermission(member, 'ban');

            if (!canSuspect && !canBan) {
                await message.reply({ 
                    content: "Vous n'avez pas les permissions nécessaires pour créer des signalements.",
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }

            // Vérifier si le joueur existe déjà
            const existingPlayer = this.dataService.getPlayerInfo(vrchatInfo.vrchatID);
            if (existingPlayer) {
                await this.handleExistingPlayer(message, existingPlayer, vrchatInfo, member);
                return;
            }

            // Traiter un nouveau joueur
            const row = this.createActionButtons(member, vrchatInfo.vrchatID);
            if (!row) {
                await message.reply({
                    content: "Vous n'avez pas les permissions nécessaires pour créer des signalements.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            const botMessage = await message.reply({
                content: `# Profil VRChat : \`${vrchatInfo.vrchatName}\`\nVeuillez choisir le type de dossier à créer.`,
                components: [row]
            });

            // Ajouter le message aux messages en attente
            this.pendingMessages.set(botMessage.id, {
                timestamp: Date.now(),
                messageId: botMessage.id,
                channelId: botMessage.channelId,
                vrchatInfo: vrchatInfo
            });

            // Planifier la vérification d'abandon
            setTimeout(() => this.checkMessageAbandonment(botMessage), this.ABANDON_TIMEOUT);
        } catch (error) {
            console.error('Erreur lors du traitement du message:', error);
            await message.reply({ 
                content: 'Une erreur est survenue lors du traitement de votre message.',
                flags: MessageFlags.Ephemeral 
            });
        }
    }

    /**
     * Gère l'interaction avec les boutons
     * @param {ButtonInteraction} interaction - Interaction avec un bouton
     */
    async handleInteraction(interaction) {
        if (!interaction.isButton()) return;

        const [action, vrchatID] = interaction.customId.split('_');
        if (!['suspect', 'ban', 'banned'].includes(action)) return;

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            // Extraction efficace du nom VRChat depuis le message d'origine
            const originalMessage = await interaction.channel.messages.fetch(interaction.message.id);
            const nameMatch = originalMessage.content.match(/`([^`]+)`/);
            const vrchatName = nameMatch ? nameMatch[1] : vrchatID;

            const vrchatInfo = { vrchatID, vrchatName };
            
            // Sélection du forum approprié
            const forumId = (action === 'ban' || action === 'banned') 
                ? this.FORUM_BANNIS_ID 
                : this.FORUM_SUSPECTS_ID;
                
            const forum = interaction.guild.channels.cache.get(forumId);
            if (!forum) {
                await interaction.editReply({ content: 'Forum introuvable.' });
                return;
            }

            // Créer le thread
            const threadCreator = await ThreadCreator.createSignalementThread({
                forum,
                vrchatID: vrchatInfo.vrchatID,
                vrchatName: vrchatInfo.vrchatName,
                signaleur: interaction.user,
                type: (action === 'ban' || action === 'banned') ? 'banned' : 'suspect',
                playersDB: this.playersDB,
                dataService: this.dataService // Passer le service de données
            });

            await interaction.editReply({
                content: threadCreator.content,
                components: threadCreator.components
            });

            // Mettre à jour le message d'origine
            await this.updateMessageAfterFolderCreation(
                interaction.message, 
                (action === 'ban' || action === 'banned') ? 'banned' : 'suspect', 
                vrchatInfo
            );

            // Attendre la sélection des tags avec un timeout
            try {
                const tagInteraction = await interaction.channel.awaitMessageComponent({
                    filter: i => i.customId === 'select_tags' && i.user.id === interaction.user.id,
                    time: 60000
                });

                // Créer le thread avec les tags sélectionnés
                const thread = await threadCreator.createThread(tagInteraction.values);

                await tagInteraction.update({
                    content: `✅ Thread créé : <#${thread.id}>`,
                    components: []
                });
            } catch (timeoutError) {
                await interaction.editReply({
                    content: '⏰ Le temps de sélection des tags est écoulé.',
                    components: []
                });
            }
        } catch (error) {
            console.error('Erreur lors de la création du thread:', error);
            await interaction.editReply({
                content: 'Une erreur est survenue lors de la création du thread.',
                components: []
            }).catch(() => {});
        }
    }

    /**
     * Vérifie si un message a été abandonné
     * @param {Message} message - Message Discord à vérifier
     */
    async checkMessageAbandonment(message) {
        const pendingMessage = this.pendingMessages.get(message.id);
        if (!pendingMessage) return;

        const now = Date.now();
        if (now - pendingMessage.timestamp >= this.ABANDON_TIMEOUT) {
            try {
                const channel = await message.client.channels.fetch(pendingMessage.channelId);
                const msg = await channel.messages.fetch(pendingMessage.messageId);
                
                await msg.edit({
                    content: `~~${msg.content}~~\n## T'as oublié de me répondre <:PIKACHUcrysadpokemon:1345046089228750902>`,
                    components: []
                });

                this.pendingMessages.delete(message.id);
            } catch (error) {
                console.error('Erreur lors de la mise à jour du message abandonné:', error);
                this.pendingMessages.delete(message.id);
            }
        }
    }

    /**
     * Met à jour le message après la création d'un dossier
     * @param {Message} message - Message à mettre à jour
     * @param {string} type - Type de dossier ('banned' ou 'suspect')
     * @param {Object} vrchatInfo - Informations VRChat
     */
    async updateMessageAfterFolderCreation(message, type, vrchatInfo) {
        try {
            await message.edit({
                content: `# Profil VRChat : \`${vrchatInfo.vrchatName}\`\nDossier ${type === 'banned' ? 'banni' : 'suspect'} créé avec succès.`,
                components: []
            });
            this.pendingMessages.delete(message.id);
        } catch (error) {
            console.error('Erreur lors de la mise à jour du message:', error);
            this.pendingMessages.delete(message.id);
        }
    }

    /**
     * Initialise le détecteur de liens
     * @param {Client} client - Client Discord
     */
    initialize(client) {
        // Écouter les nouveaux messages
        client.on(Events.MessageCreate, message => this.handleMessage(message));
        
        // Écouter les interactions
        client.on(Events.InteractionCreate, interaction => this.handleInteraction(interaction));
        
        console.log('VRChat Link Detector initialisé');
    }
}

module.exports = VRChatLinkDetector;