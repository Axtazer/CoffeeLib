const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

class ThreadCreator {
    /**
     * Crée un nouveau thread de signalement
     * @param {Object} options - Options de création
     * @returns {Promise<Object>} - Objet contenant le menu de tags et une fonction pour créer le thread
     */
    static async createSignalementThread(options) {
        const {
            forum,          // Le forum où créer le thread (suspects ou bannis)
            vrchatID,       // L'ID VRChat du joueur
            vrchatName,     // Le nom d'utilisateur VRChat
            signaleur,      // L'utilisateur Discord qui signale
            type,           // 'suspect' ou 'banned'
            playersDB,      // Instance de la base de données
            dataService     // Service de données VRChat (optionnel)
        } = options;

        console.log('Thread Creator - Options reçues:', {
            vrchatID,
            vrchatName,
            type,
            signaleurId: signaleur.id
        });

        // Créer le menu de sélection des tags
        const tagMenu = new StringSelectMenuBuilder()
            .setCustomId('select_tags')
            .setPlaceholder('Sélectionnez les tags (max 5)')
            .setMinValues(1)
            .setMaxValues(5);

        // Ajouter les options de tags
        const tagOptions = forum.availableTags.map(tag => ({
            label: tag.name,
            value: tag.id
        }));
        
        tagMenu.addOptions(tagOptions);

        const row = new ActionRowBuilder().addComponents(tagMenu);

        // Retourner le menu pour la sélection des tags
        return {
            content: 'Sélectionnez les tags appropriés pour ce signalement :',
            components: [row],
            
            /**
             * Crée le thread après sélection des tags
             * @param {string[]} selectedTags - IDs des tags sélectionnés
             * @returns {Promise<ThreadChannel>} - Le thread créé
             */
            async createThread(selectedTags) {
                // Créer le message du thread
                const threadMessage = `**Nouveau signalement ${type === 'banned' ? 'banni' : 'suspect'}**\n\n` +
                    `**Joueur:** ${vrchatName}\n` +
                    `**Profil VRChat:** https://vrchat.com/home/user/${vrchatID}\n` +
                    `**ID:** \`${vrchatID}\`\n` +
                    `**Signalé par:** <@${signaleur.id}>\n\n` +
                    `**Merci d'ajouter :**\n` +
                    `• Une description du comportement et de votre démarche\n` +
                    `• Des preuves de son comportement\n` +
                    `• Toute information pertinente`;

                console.log('Thread Creator - Message à créer:', {
                    title: vrchatName,
                    message: threadMessage
                });

                // Créer le thread avec le nom du joueur comme titre
                const thread = await forum.threads.create({
                    name: vrchatName,
                    message: {
                        content: threadMessage
                    },
                    appliedTags: selectedTags
                });

                console.log('Thread Creator - Thread créé:', {
                    threadId: thread.id,
                    threadName: thread.name,
                    messageContent: thread.messages.cache.first()?.content
                });

                // Ajouter/mettre à jour le joueur dans la base de données
                const newPlayer = {
                    vrchatID,
                    vrchatName,
                    type: type === 'banned' ? 'banned' : 'suspect',
                    forumThreads: [{
                        threadId: thread.id,
                        tags: selectedTags,
                        createdAt: new Date().toISOString()
                    }]
                };

                // Utiliser le dataService si disponible, sinon utiliser directement playersDB
                if (dataService) {
                    dataService.savePlayerInfo(newPlayer);
                } else {
                    const existingPlayer = playersDB.findPlayer(vrchatID);
                    if (existingPlayer) {
                        playersDB.updatePlayer(existingPlayer, newPlayer);
                    } else {
                        playersDB.addPlayer(newPlayer);
                    }
                }

                return thread;
            }
        };
    }
}

module.exports = ThreadCreator;