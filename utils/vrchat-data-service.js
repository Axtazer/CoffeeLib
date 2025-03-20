const { Events } = require('discord.js');

class VRChatDataService {
    constructor(playersDB) {
        this.playersDB = playersDB;
        this.EMBED_WAIT_TIME = 450; // Temps avant de récup l'embed
        this.MAX_RETRIES = 2; // Nombre de tentatives pour l'embed
        this.RETRY_DELAY = 150; // Delais entre les tentatives
        this.VRCHAT_LINK_REGEX = /(?:https?:\/\/)?vrchat\.com\/home\/user\/([a-zA-Z0-9-_]+)/;
    }

    /**
     * Extrait les informations VRChat d'un message
     * @param {Message} message - Message Discord
     * @param {Object} options - Options d'extraction
     * @returns {Promise<Object|null>} - Informations VRChat ou null
     */
    async extractVRChatInfo(message, options = {}) {
        const { debug = false } = options;
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
                            if (debug) console.log('Nom extrait depuis embed.data.title:', vrchatName);
                            resolve(true);
                        } else if (embed.title) {
                            vrchatName = embed.title;
                            if (debug) console.log('Nom extrait depuis embed.title:', vrchatName);
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
                
                if (debug) console.log(`Tentative ${attempt + 1}/${this.MAX_RETRIES}`);
            } catch (error) {
                if (debug) console.log(`Tentative ${attempt + 1}/${this.MAX_RETRIES} échouée:`, error);
            }
        }

        // Fallback si aucun nom n'est trouvé
        vrchatName = vrchatName || vrchatID.replace(/^usr_/, '');
        
        return { vrchatID, vrchatName };
    }

    /**
     * Récupère les informations d'un joueur
     * @param {string} vrchatID - ID VRChat
     * @returns {Object|null} - Informations du joueur ou null
     */
    getPlayerInfo(vrchatID) {
        return this.playersDB.findPlayer(vrchatID);
    }

    /**
     * Sauvegarde les informations d'un joueur
     * @param {Object} playerInfo - Informations du joueur
     */
    savePlayerInfo(playerInfo) {
        const existingPlayer = this.playersDB.findPlayer(playerInfo.vrchatID);
        if (existingPlayer) {
            this.playersDB.updatePlayer(existingPlayer, playerInfo);
        } else {
            this.playersDB.addPlayer(playerInfo);
        }
    }

    /**
     * Nettoie les threads invalides d'un joueur
     * @param {Object} player - Informations du joueur
     * @param {Guild} guild - Serveur Discord
     * @returns {Promise<Object>} - Joueur mis à jour et threads valides
     */
    async cleanInvalidThreads(player, guild) {
        // Filtrer les threads valides
        const threadLinks = [];
        const threadsToRemove = [];
        
        await Promise.all(player.forumThreads.map(async threadInfo => {
            try {
                const thread = await guild.channels.fetch(threadInfo.threadId);
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
                ...player,
                forumThreads: player.forumThreads.filter(
                    t => !threadsToRemove.includes(t.threadId)
                )
            };
            await this.playersDB.updatePlayer(player, updatedPlayer);
            return { player: updatedPlayer, validThreads: threadLinks };
        }

        return { player, validThreads: threadLinks };
    }
}

module.exports = VRChatDataService;