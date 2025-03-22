const { Events, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { createSignalementThread } = require('../utils/thread-creator');
const VRChatDataService = require('../utils/vrchat-data-service');
const PermissionsManager = require('../utils/permissions-manager');

class VRChatLinkDetector {
    constructor(playersDB) {
        this.playersDB = playersDB;
        this.dataService = new VRChatDataService(playersDB);
        this.ABANDON_TIMEOUT = 30000; // 30s avant de cloturer l'intéraction
        this.ABANDON_TAG = 30000 // 30s avant de cloturer le choix des tags
        this.BUTTON_RESTORE_DELAY = 40000; // 40s avant de restaurer les boutons
        this.pendingMessages = new Map();
        this.VRCHAT_LINK_CHANNEL_ID = process.env.VRCHAT_LINK_CHANNEL_ID;
        this.FORUM_BANNIS_ID = process.env.FORUM_BANNIS_ID;
        this.FORUM_SUSPECTS_ID = process.env.FORUM_SUSPECTS_ID;
        this.DEBUG = process.env.DEBUG === 'true';
    }

    debug(...args) {
        if (this.DEBUG) console.log(...args);
    }

    async checkPermissions(member, type) {
        return PermissionsManager.checkPermission(member, type);
    }

    async createButtons(member, vrchatID) {
        const permissions = PermissionsManager.getPermissions(member);
        const buttons = [];

        if (permissions.canSuspect) {
            buttons.push(new ButtonBuilder()
                .setCustomId(`suspect_${vrchatID}`)
                .setLabel('Créer dossier Suspect')
                .setEmoji('⚠️')
                .setStyle(ButtonStyle.Secondary));
        }
    
        if (permissions.canBan) {
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

        // Nettoyer les threads invalides en utilisant le service de données
        const { player: updatedPlayer, validThreads } = 
            await this.dataService.cleanInvalidThreads(existingPlayer, message.guild);

        // Si tous les threads ont été supprimés, permettre d'en créer un nouveau
        if (validThreads.length === 0) {
            const row = await this.createButtons(member, vrchatInfo.vrchatID);
        
            if (row) {
                const botMessage = await message.reply({
                    content: `# ${status}\n## Profil VRChat : \`${vrchatInfo.vrchatName}\`\n⚠️ Ce joueur été déjà enregistré comme ${existingPlayer.type === 'ban' ? 'banni' : 'suspect'}, mais le thread semble avoir été supprimé.\nVeuillez choisir le type de dossier à créer.`,
                    components: [row],
                    allowedMentions: { parse: [] }
                });
            
                // Ajouter le message aux messages en attente pour gérer l'abandon
                this.pendingMessages.set(botMessage.id, {
                    timestamp: Date.now(),
                    messageId: botMessage.id,
                    channelId: botMessage.channelId,
                    vrchatInfo: vrchatInfo
                });

                // Planifier la vérification d'abandon
                setTimeout(() => this.checkMessageAbandonment(botMessage), this.ABANDON_TIMEOUT);
            } 
            return;
        }

        // Afficher les threads existants
        await message.reply({
            content: `# ${status}\n## Profil VRChat : \`${vrchatInfo.vrchatName}\`\n### Thread: ${validThreads.join('\n')}\n-# ID VRC : \`${vrchatInfo.vrchatID}\``,
            allowedMentions: { parse: [] }
        });
    }

    async handleMessage(message) {
        // Filtres rapides pour éviter les traitements inutiles
        if (message.channel.id !== this.VRCHAT_LINK_CHANNEL_ID || message.author.bot) return;

        try {
            // Utiliser le service de données pour extraire les infos VRChat
            const vrchatInfo = await this.dataService.extractVRChatInfo(message, {
                debug: this.DEBUG
            });
            
            if (!vrchatInfo) return;
            this.debug('Informations VRChat extraites:', vrchatInfo);

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

            // Vérifier si le joueur existe déjà dans la base de données via le service
            const existingPlayer = this.dataService ? this.dataService.getPlayerInfo(vrchatInfo.vrchatID) : null;
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

        // Extraire l'action et l'ID correctement
        const customId = interaction.customId;
        const firstUnderscoreIndex = customId.indexOf('_');
        const action = customId.substring(0, firstUnderscoreIndex);
        const vrchatID = customId.substring(firstUnderscoreIndex + 1);

        if (!['suspect', 'ban', 'banned'].includes(action)) return;

        // Au début de handleInteraction
        const originalButtons = [];
        if (interaction.message.components && interaction.message.components.length > 0 &&
            interaction.message.components[0].components) {
            // Extraire et stocker les boutons individuellement
            for (const button of interaction.message.components[0].components) {
                originalButtons.push({
                    customId: button.customId,
                    label: button.label,
                    style: button.style,
                    emoji: button.emoji
                });
            }
        }

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        
            // Récupérer le membre complet du serveur
            const member = await interaction.guild.members.fetch(interaction.user.id);
        
            // Vérifier les permissions pour cette action spécifique
            const hasPermission = await this.checkPermissions(member, action);
            if (!hasPermission) {
                await interaction.editReply({ 
                    content: `Vous n'avez pas les permissions nécessaires pour créer un dossier de type ${action}.`,
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
        
            // Supprimer ce message des messages en attente pour éviter l'abandon
            this.pendingMessages.delete(interaction.message.id);
        
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
            
                // Attendre le délai configuré avant de restaurer les boutons
                setTimeout(async () => {
                    try {
                        // Restaurer les boutons car aucun dossier n'a été créé
                        if (originalButtons.length > 0) {
                            const newButtons = originalButtons.map(btnData => {
                                return new ButtonBuilder()
                                    .setCustomId(btnData.customId)
                                    .setLabel(btnData.label)
                                    .setStyle(btnData.style)
                                    .setEmoji(btnData.emoji || null);
                            });
                            
                            const row = new ActionRowBuilder().addComponents(newButtons);
                            await interaction.message.edit({
                                content: interaction.message.content,
                                components: [row]
                            });
                        }
                    } catch (restoreError) {
                        console.error('Erreur lors de la restauration des boutons après forum introuvable:', restoreError);
                    }                   
                }, this.BUTTON_RESTORE_DELAY);
            
                return;
            }

            // Créer le thread
            const threadCreator = await createSignalementThread({
                forum,
                vrchatID: vrchatInfo.vrchatID,
                vrchatName: vrchatInfo.vrchatName,
                signaleur: interaction.user,
                type: (action === 'ban' || action === 'banned') ? 'ban' : 'suspect',
                playersDB: this.playersDB,
                dataService: this.dataService
            });

            await interaction.editReply({
                content: threadCreator.content,
                components: threadCreator.components
            });

            // Désactiver temporairement les boutons pendant la création
            await interaction.message.edit({
                content: interaction.message.content,
                components: []
            });

            // Attendre la sélection des tags avec un timeout clair
            try {
                const tagInteraction = await interaction.channel.awaitMessageComponent({
                    filter: i => i.customId === 'select_tags' && i.user.id === interaction.user.id,
                    time: this.ABANDON_TIMEOUT
                });

                // Créer le thread avec les tags sélectionnés
                const thread = await threadCreator.createThread(tagInteraction.values);

                // Mettre à jour le message d'origine APRÈS la création réussie du thread
                await this.updateMessageAfterFolderCreation(
                    interaction.message, 
                    (action === 'ban' || action === 'banned') ? 'ban' : 'suspect', 
                    vrchatInfo
                );

                await tagInteraction.update({
                    content: `✅ Thread créé : <#${thread.id}>`,
                    components: []
                });
            } catch (timeoutError) {
                await interaction.editReply({
                    content: '⏰ Le temps de sélection des tags est écoulé.',
                    components: []
                });
            
                // Attendre le délai configuré avant de restaurer les boutons
                setTimeout(async () => {
                    try {
                        if (originalButtons.length > 0) {
                            const newButtons = originalButtons.map(btnData => {
                                return new ButtonBuilder()
                                    .setCustomId(btnData.customId)
                                    .setLabel(btnData.label)
                                    .setStyle(btnData.style)
                                    .setEmoji(btnData.emoji || null);
                            });
                            
                            const row = new ActionRowBuilder().addComponents(newButtons);
                            await interaction.message.edit({
                                content: interaction.message.content,
                                components: [row]
                            });
                            console.log('Boutons restaurés avec succès après timeout');
                            
                            // Réajouter le message à la liste des messages en attente
                            this.pendingMessages.set(interaction.message.id, {
                                timestamp: Date.now(),
                                messageId: interaction.message.id,
                                channelId: interaction.message.channelId,
                                vrchatInfo: vrchatInfo
                            });
                            
                            // Planifier un nouveau timeout pour l'abandon
                            setTimeout(() => this.checkMessageAbandonment(interaction.message), this.ABANDON_TIMEOUT);
                        } else {
                            // Recréer les boutons si les originaux ne sont pas disponibles
                            const row = await this.createButtons(member, vrchatID);
                            if (row) {
                                await interaction.message.edit({
                                    content: interaction.message.content,
                                    components: [row]
                                });
                                console.log('Boutons recréés avec succès après timeout');
                                
                                // Réajouter le message à la liste des messages en attente
                                this.pendingMessages.set(interaction.message.id, {
                                    timestamp: Date.now(),
                                    messageId: interaction.message.id,
                                    channelId: interaction.message.channelId,
                                    vrchatInfo: vrchatInfo
                                });
                                
                                // Planifier un nouveau timeout pour l'abandon
                                setTimeout(() => this.checkMessageAbandonment(interaction.message), this.ABANDON_TIMEOUT);
                            } else {
                                console.log('Impossible de recréer les boutons: aucun bouton disponible');
                            }
                        }
                    } catch (restoreError) {
                        console.error('Erreur lors de la restauration des boutons après timeout:', restoreError);
                        
                        // Tentative de secours: recréer les boutons
                        try {
                            const row = await this.createButtons(member, vrchatID);
                            if (row) {
                                await interaction.message.edit({
                                    content: interaction.message.content,
                                    components: [row]
                                });
                                console.log('Boutons recréés avec succès (secours) après timeout');
                            }
                        } catch (fallbackError) {
                            console.error('Échec de la tentative de secours pour recréer les boutons:', fallbackError);
                        }
                    }
                }, this.BUTTON_RESTORE_DELAY);
            }
        } catch (error) {
            console.error('Erreur lors de la création du thread:', error);
            await interaction.editReply({
                content: 'Une erreur est survenue lors de la création du thread.',
                components: []
            }).catch(() => {});
        
            // Attendre le délai configuré avant de restaurer les boutons
            setTimeout(async () => {
                try {
                    // Vérifier si le message existe toujours
                    const messageToUpdate = await interaction.channel.messages.fetch(interaction.message.id);
                    if (messageToUpdate) {
                        // Procéder à la restauration des boutons
                        if (originalButtons.length > 0) {
                            const newButtons = originalButtons.map(btnData => {
                                return new ButtonBuilder()
                                    .setCustomId(btnData.customId)
                                    .setLabel(btnData.label)
                                    .setStyle(btnData.style)
                                    .setEmoji(btnData.emoji || null);
                            });
                            
                            const row = new ActionRowBuilder().addComponents(newButtons);
                            await messageToUpdate.edit({
                                content: messageToUpdate.content,
                                components: [row]
                            });
                        } else {
                            // Sinon, recréer les boutons
                            const member = await interaction.guild.members.fetch(interaction.user.id);
                            const row = await this.createButtons(member, vrchatID);
                            if (row) {
                                await messageToUpdate.edit({
                                    content: messageToUpdate.content,
                                    components: [row]
                                });
                            }
                        }
                    }
                } catch (fetchError) {
                    console.error('Le message n\'existe plus ou ne peut pas être récupéré:', fetchError);
                }
            }, this.BUTTON_RESTORE_DELAY);
        }
    }
    
    async checkMessageAbandonment(message) {
        const pendingMessage = this.pendingMessages.get(message.id);
        if (!pendingMessage) return;
    
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
    