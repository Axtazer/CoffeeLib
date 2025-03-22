const { Events } = require('discord.js');

class VRChatDataService {
    constructor(playersDB) {
        this.playersDB = playersDB;
        this.VRCHAT_LINK_REGEX = /(?:https?:\/\/)?vrchat\.com\/home\/user\/([a-zA-Z0-9-_]+)/;
    }
      /**
     * Extrait les informations VRChat d'un message
     * @param {Message} message - Message Discord
     * @param {Object} options - Options d'extraction
     * @returns {Promise<Object|null>} - Informations VRChat ou null
     */
      async extractVRChatInfo(message, options = {}) {
          const { debug = false, maxWaitTime = 5000 } = options;
          const match = message.content.match(this.VRCHAT_LINK_REGEX);
          if (!match || !match[1]) return null;

          const vrchatID = match[1];
          let vrchatName = null;

          // Heure de début pour le timeout global
          const startTime = Date.now();
        
          // Continuer à vérifier jusqu'à ce qu'on trouve le nom ou qu'on atteigne le délai maximum
          while (Date.now() - startTime < maxWaitTime) {
              try {
                  if (debug) console.log(`Tentative de récupération du nom VRChat (temps écoulé: ${Date.now() - startTime}ms)`);
                
                  // Attendre un court instant entre chaque tentative
                  await new Promise(r => setTimeout(r, 200));
                
                  // Récupérer le message mis à jour
                  const updatedMessage = await message.fetch();
                
                  if (updatedMessage.embeds.length > 0) {
                      const embed = updatedMessage.embeds[0];
                    
                      if (embed.data?.title) {
                          vrchatName = embed.data.title;
                          if (debug) console.log('Nom extrait depuis embed.data.title:', vrchatName);
                          break; // Sortir de la boucle si on a trouvé le nom
                      } else if (embed.title) {
                          vrchatName = embed.title;
                          if (debug) console.log('Nom extrait depuis embed.title:', vrchatName);
                          break; // Sortir de la boucle si on a trouvé le nom
                      }
                  }
              } catch (error) {
                  if (debug) console.log('Erreur lors de la récupération du message:', error);
                  // Continuer malgré l'erreur
              }
          }

          // Fallback si aucun nom n'est trouvé
          vrchatName = vrchatName || vrchatID.replace(/^usr_/, '');
        
          if (debug) {
              if (vrchatName === vrchatID.replace(/^usr_/, '')) {
                  console.log(`⚠️ Impossible de récupérer le nom VRChat après ${maxWaitTime}ms, utilisation de l'ID comme fallback`);
              } else {
                  console.log(`✅ Nom VRChat récupéré en ${Date.now() - startTime}ms: ${vrchatName}`);
              }
          }
        
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