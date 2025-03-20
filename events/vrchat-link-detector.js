const { Events, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { BAN_ROLES, SUSPECT_ROLES } = require('../config/permissions');
const { createSignalementThread } = require('../utils/thread-creator');

class VRChatLinkDetector {
    constructor(playersDB) {
        this.playersDB = playersDB;
        this.EMBED_WAIT_TIME = 450; // Temps avant de récup l'embed
        this.MAX_RETRIES = 2; // Nombre de tentatives pour l'embed
        this.RETRY_DELAY = 150; // Delais entre les tentatives
        this.DEBUG = process.env.DEBUG === 'true';
        this.ABANDON_TIMEOUT = 30000; // 30s avant de cloturer l'intéraction
        this.pendingMessages = new Map();
        this.VRCHAT_LINK_REGEX = /(?:https?:\/\/)?vrchat\.com\/home\/user\/([a-zA-Z0-9-_]+)/;
        this.VRCHAT_LINK_CHANNEL_ID = process.env.VRCHAT_LINK_CHANNEL_ID;
        this.FORUM_BANNIS_ID = process.env.FORUM_BANNIS_ID;
        this.FORUM_SUSPECTS_ID = process.env.FORUM_SUSPECTS_ID;
    }

    debug(...args) {
        if (this.DEBUG) console.log(...args);
    }

    async extractVRChatInfo(message) {
        const match = message.content.match(this.VRCHAT_LINK_REGEX);
        if (!match || !match[1]) return null;

        const vrchatID = match[1];
        let vrchatName = null;

        // Utilisation d'une seule boucle avec Promise.race pour timeout
        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                const fetchPromise = new Promise(async resolve => {
                    await new Promise(r => setTimeout(r, this.EMBED_WAIT_TIME));
                    const updatedMessage = await message.fetch();
                    
                    if (updatedMessage.embeds.length > 0) {
                        const embed = updatedMessage.embeds[0];
                        
                        if (embed.data?.title) {
                            vrchatName = embed.data.title;
                            this.debug('Nom extrait depuis embed.data.title:', vrchatName);
                            resolve(true);
                        } else if (embed.title) {
                            vrchatName = embed.title;
                            this.debug('Nom extrait depuis embed.title:', vrchatName);
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    } else {
                        resolve(false);
                    }
                });

                const timeoutPromise = new Promise(resolve => 
                    setTimeout(() => resolve(false), this.EMBED_WAIT_TIME * 1.5));

                const result = await Promise.race([fetchPromise, timeoutPromise]);
                if (result) break;
                
                this.debug(`Tentative ${attempt + 1}/${this.MAX_RETRIES}`);
            } catch (error) {
                this.debug(`Tentative ${attempt + 1}/${this.MAX_RETRIES} échouée:`, error);
            }
        }

        // Fallback si aucun nom n'est trouvé
        vrchatName = vrchatName || vrchatID.replace(/^usr_/, '');
        
        return { vrchatID, vrchatName };
    }

    async checkPermissions(member, type) {
        // Vérifie si un membre a les permissions pour un type donné
        if (type === 'ban' || type === 'banned') {
            return member.roles.cache.some(role => BAN_ROLES.includes(role.id));
        }
        return member.roles.cache.some(role => SUSPECT_ROLES.includes(role.id));
    }

    async createButtons(member, vrchatID) {
        // Crée les boutons adaptés aux permissions du membre
        const buttons = [];
        const canSuspect = await this.checkPermissions(member, 'suspect');
        const canBan = await this.checkPermissions(member, 'ban');

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

    async handleExistingPlayer(message, existingPlayer, vrchatInfo, member) {
        const canBan = await this.checkPermissions(member, 'ban');
        const status = existingPlayer.type === 'suspect' ? '⚠️ Suspect' : '🚫 Banni';

        // Vérifie les permissions pour le type de dossier existant
        if (existingPlayer.type === 'ban' && !canBan) {
            await message.reply({ 
                content: "Vous n'avez pas les permissions pour gérer les dossiers bannis.\nVa voir le salon <#1343718631833473106>",
                flags: MessageFlags.Ephemeral 
            });
            return;
        }

        // Filtrer les threads valides
        const threadLinks = [];
        const threadsToRemove = [];
        
        await Promise.all(existingPlayer.forumThreads.map(async threadInfo => {
            try {
                const thread = await message.guild.channels.fetch(threadInfo.threadId);
                if (thread) {
                    threadLinks.push(`<#${threadInfo.threadId}>`);
                } else {
                    threadsToRemove.push(threadInfo.threadId);
                }
            } catch (error) {
                threadsToRemove.push(threadInfo.threadId);
            }
        }));

        // Nettoyer les threads invalides de la base de données
        if (threadsToRemove.length > 0) {
            const updatedPlayer = {
                ...existingPlayer,
                forumThreads: existingPlayer.forumThreads.filter(
                    t => !threadsToRemove.includes(t.threadId)
                )
            };
            await this.playersDB.updatePlayer(existingPlayer, updatedPlayer);
        }

        // Si tous les threads ont été supprimés, permettre d'en créer un nouveau
        if (threadLinks.length === 0) {
            const row = await this.createButtons(member, vrchatInfo.vrchatID);
            
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
            content: `# ${status}\n## Profil VRChat : \`${vrchatInfo.vrchatName}\`\n### Thread: ${threadLinks.join('\n')}\n-# ID VRC : \`${vrchatInfo.vrchatID}\``,
            allowedMentions: { parse: [] }
        });
    }

    async handleMessage(message) {
        // Filtres rapides pour éviter les traitements inutiles
        if (message.channel.id !== this.VRCHAT_LINK_CHANNEL_ID || message.author.bot) return;

        const vrchatInfo = await this.extractVRChatInfo(message);
        if (!vrchatInfo) return;

        try {
            // Récupérer le membre et vérifier ses permissions
            const member = await message.guild.members.fetch(message.author.id);
            const canSuspect = await this.checkPermissions(member, 'suspect');
            const canBan = await this.checkPermissions(member, 'ban');

            if (!canSuspect && !canBan) {
                await message.reply({ 
                    content: "Vous n'avez pas les permissions nécessaires pour créer des signalements.",
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }

            // Vérifier si le joueur existe déjà
            const existingPlayer = this.playersDB.findPlayer(vrchatInfo.vrchatID);
            if (existingPlayer) {
                await this.handleExistingPlayer(message, existingPlayer, vrchatInfo, member);
                return;
            }

            // Traiter un nouveau joueur
            const row = await this.createButtons(member, vrchatInfo.vrchatID);
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

    async handleInteraction(interaction) {
        if (!interaction.isButton()) return;

        const [action, vrchatID] = interaction.customId.split('_');
        if (!['suspect', 'ban', 'banned'].includes(action)) return;

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            
            // Extraction efficace du nom VRChat
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
            const threadCreator = await createSignalementThread({
                forum,
                vrchatID: vrchatInfo.vrchatID,
                vrchatName: vrchatInfo.vrchatName,
                signaleur: interaction.user,
                type: (action === 'ban' || action === 'banned') ? 'ban' : 'suspect',
                playersDB: this.playersDB
            });

            await interaction.editReply({
                content: threadCreator.content,
                components: threadCreator.components
            });

            // Mettre à jour le message d'origine
            await this.updateMessageAfterFolderCreation(
                interaction.message, 
                (action === 'ban' || action === 'banned') ? 'ban' : 'suspect', 
                vrchatInfo
            );

            // Attendre la sélection des tags avec un timeout clair
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

    async updateMessageAfterFolderCreation(message, type, vrchatInfo) {
        try {
            await message.edit({
                content: `# Profil VRChat : \`${vrchatInfo.vrchatName}\`\nDossier ${type === 'ban' ? 'banni' : 'suspect'} créé avec succès.`,
                components: []
            });
            this.pendingMessages.delete(message.id);
        } catch (error) {
            console.error('Erreur lors de la mise à jour du message:', error);
            this.pendingMessages.delete(message.id);
        }
    }
}

module.exports = VRChatLinkDetector;