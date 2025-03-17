const { Events, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { BAN_ROLES, SUSPECT_ROLES } = require('../config/permissions');
const { createSignalementThread } = require('../utils/thread-creator');

class VRChatLinkDetector {
    constructor(playersDB) {
        this.playersDB = playersDB;
        this.EMBED_WAIT_TIME = 500; // Temps d'attente plus long pour l'embed
        this.MAX_RETRIES = 3; // Nombre maximum de tentatives
        this.RETRY_DELAY = 200; // Délai entre les tentatives en ms
        this.DEBUG = process.env.DEBUG === 'true';
    }

    debug(...args) {
        if (this.DEBUG) {
            console.log(...args);
        }
    }

    async extractVRChatInfo(message) {
        const vrchatLinkRegex = /(?:https?:\/\/)?vrchat\.com\/home\/user\/([a-zA-Z0-9-_]+)/;
        const match = message.content.match(vrchatLinkRegex);
        if (!match) return null;

        const vrchatID = match[1];
        if (!vrchatID) return null;

        let vrchatName = null;
        let attempt = 0;

        while (attempt < this.MAX_RETRIES) {
            try {
                await new Promise(resolve => setTimeout(resolve, this.EMBED_WAIT_TIME));
                const updatedMessage = await message.fetch();
                
                this.debug('Embed reçu:', updatedMessage.embeds[0]);
                
                if (updatedMessage.embeds.length > 0) {
                    const embed = updatedMessage.embeds[0];
                    this.debug('Structure de l\'embed:', {
                        data: embed.data,
                        title: embed.title,
                        description: embed.description,
                        fields: embed.fields,
                        url: embed.url
                    });
                    
                    // Extraire le nom depuis le titre de l'embed
                    if (embed.data && embed.data.title) {
                        vrchatName = embed.data.title;
                        this.debug('Nom extrait depuis embed.data.title:', vrchatName);
                        break;
                    } else if (embed.title) {
                        vrchatName = embed.title;
                        this.debug('Nom extrait depuis embed.title:', vrchatName);
                        break;
                    }
                }
                attempt++;
                this.debug(`Tentative ${attempt}/${this.MAX_RETRIES}`);
            } catch (error) {
                console.error(`Tentative ${attempt + 1}/${this.MAX_RETRIES} échouée:`, error);
                attempt++;
            }
        }

        // Si on n'a pas réussi à récupérer le nom, utiliser l'ID sans le préfixe usr_
        if (!vrchatName) {
            vrchatName = vrchatID.replace(/^usr_/, '');
            this.debug('Aucun nom trouvé, utilisation de l\'ID comme fallback:', vrchatName);
        }

        const result = { vrchatID, vrchatName };
        this.debug('Informations VRChat extraites:', result);
        return result;
    }

    async handleMessage(message) {
        if (message.channel.id !== process.env.VRCHAT_LINK_CHANNEL_ID) return;
        if (message.author.bot) return;

        const vrchatInfo = await this.extractVRChatInfo(message);
        if (!vrchatInfo) return;

        // Vérifier les permissions de l'auteur du message
        const member = await message.guild.members.fetch(message.author.id);
        const canSuspect = member.roles.cache.some(role => SUSPECT_ROLES.includes(role.id));
        const canBan = member.roles.cache.some(role => BAN_ROLES.includes(role.id));

        if (!canSuspect && !canBan) return;

        try {
            // Vérifier si le joueur existe déjà dans la base de données
            const existingPlayer = this.playersDB.findPlayer(vrchatInfo.vrchatID);
            if (existingPlayer) {
                const status = existingPlayer.type === 'suspect' ? '⚠️ Suspect' : '🚫 Banni';

                // Vérifier si les threads existent toujours
                const threadLinks = [];
                const threadsToRemove = [];
                
                for (const threadInfo of existingPlayer.forumThreads) {
                    try {
                        const thread = await message.guild.channels.fetch(threadInfo.threadId);
                        if (thread) {
                            threadLinks.push(`<#${threadInfo.threadId}>`);
                        } else {
                            this.debug(`Thread ${threadInfo.threadId} introuvable, sera supprimé`);
                            threadsToRemove.push(threadInfo.threadId);
                        }
                    } catch (error) {
                        this.debug(`Thread ${threadInfo.threadId} introuvable (erreur), sera supprimé:`, error);
                        threadsToRemove.push(threadInfo.threadId);
                    }
                }

                // Supprimer les threads qui n'existent plus
                if (threadsToRemove.length > 0) {
                    const updatedPlayer = {
                        ...existingPlayer,
                        forumThreads: existingPlayer.forumThreads.filter(
                            t => !threadsToRemove.includes(t.threadId)
                        )
                    };
                    await this.playersDB.updatePlayer(existingPlayer, updatedPlayer);
                    this.debug(`${threadsToRemove.length} thread(s) supprimé(s) de la base de données`);
                }

                // Si tous les threads ont été supprimés, permettre d'en créer un nouveau
                if (threadLinks.length === 0) {
                    this.debug('Tous les threads ont été supprimés, permettre d\'en créer un nouveau');
                    // Créer les boutons
                    const buttons = [];
                    if (canSuspect) {
                        const suspectButton = new ButtonBuilder()
                            .setCustomId(`suspect_${message.id}`)
                            .setLabel('Créer un thread Suspect')
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji('⚠️');
                        buttons.push(suspectButton);
                    }
                    if (canBan) {
                        const banButton = new ButtonBuilder()
                            .setCustomId(`banned_${message.id}`)
                            .setLabel('Créer un thread Ban')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🚫');
                        buttons.push(banButton);
                    }

                    const row = new ActionRowBuilder().addComponents(buttons);

                    // Envoyer le message avec les boutons
                    await message.reply({
                        content: `${status}\n**ID VRChat:** \`${vrchatInfo.vrchatID}\`\n\n⚠️ Les anciens threads ont été supprimés, vous pouvez en créer un nouveau.`,
                        components: [row],
                        allowedMentions: { parse: [] }
                    });
                    return;
                }

                // Sinon, afficher les threads existants
                await message.reply({
                    content: `${status}\n**ID VRChat:** \`${vrchatInfo.vrchatID}\`\n\n**Threads:**\n${threadLinks.join('\n')}`,
                    allowedMentions: { parse: [] }
                });
                return;
            }

            // Créer les boutons
            const buttons = [];
            if (canSuspect) {
                const suspectButton = new ButtonBuilder()
                    .setCustomId(`suspect_${message.id}`)
                    .setLabel('Créer un thread Suspect')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚠️');
                buttons.push(suspectButton);
            }
            if (canBan) {
                const banButton = new ButtonBuilder()
                    .setCustomId(`banned_${message.id}`)
                    .setLabel('Créer un thread Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🚫');
                buttons.push(banButton);
            }

            const row = new ActionRowBuilder().addComponents(buttons);

            // Envoyer le message avec les boutons
            const reply = await message.reply({
                content: `Lien VRChat détecté pour **${vrchatInfo.vrchatName}**`,
                components: [row]
            });

            this.debug('Message de réponse créé:', {
                messageId: message.id,
                replyId: reply.id,
                vrchatInfo
            });

        } catch (error) {
            console.error('Erreur lors de la création des boutons:', error);
        }
    }

    async handleInteraction(interaction) {
        if (!interaction.isButton()) return;

        const [action, messageId] = interaction.customId.split('_');
        if (!['suspect', 'banned'].includes(action)) return;

        try {
            // Récupérer le message original qui contient le lien VRChat
            const originalMessage = await interaction.channel.messages.fetch(messageId);
            this.debug('Message original récupéré:', originalMessage.id);
            
            const vrchatInfo = await this.extractVRChatInfo(originalMessage);
            this.debug('Informations VRChat extraites dans handleInteraction:', vrchatInfo);

            if (!vrchatInfo) {
                await interaction.reply({ content: 'Impossible de récupérer les informations VRChat.', ephemeral: true });
                return;
            }

            const forum = interaction.guild.channels.cache.get(
                action === 'banned' ? process.env.FORUM_BANNIS_ID : process.env.FORUM_SUSPECTS_ID
            );

            if (!forum) {
                await interaction.reply({ content: 'Forum introuvable.', ephemeral: true });
                return;
            }

            this.debug('Création du thread avec les infos:', {
                vrchatID: vrchatInfo.vrchatID,
                vrchatName: vrchatInfo.vrchatName,
                type: action
            });

            // Créer le thread avec les informations exactes de l'embed
            const threadCreator = await createSignalementThread({
                forum,
                vrchatID: vrchatInfo.vrchatID,
                vrchatName: vrchatInfo.vrchatName,
                signaleur: interaction.user,
                type: action,
                playersDB: this.playersDB
            });

            await interaction.reply({
                content: threadCreator.content,
                components: threadCreator.components,
                ephemeral: true
            });

            // Attendre la sélection des tags
            const tagInteraction = await interaction.channel.awaitMessageComponent({
                filter: i => i.customId === 'select_tags' && i.user.id === interaction.user.id,
                time: 60000
            });

            // Créer le thread avec les tags sélectionnés
            const thread = await threadCreator.createThread(tagInteraction.values);

            await tagInteraction.update({
                content: `✅ Thread créé : <#${thread.id}>`,
                components: [],
                ephemeral: true
            });

        } catch (error) {
            console.error('Erreur lors de la création du thread:', error);
            if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                await interaction.editReply({
                    content: '⏰ Le temps de sélection des tags est écoulé.',
                    components: [],
                    ephemeral: true
                }).catch(() => {});
            } else {
                await interaction.editReply({
                    content: 'Une erreur est survenue lors de la création du thread.',
                    components: [],
                    ephemeral: true
                }).catch(() => {});
            }
        }
    }
}

module.exports = VRChatLinkDetector;
