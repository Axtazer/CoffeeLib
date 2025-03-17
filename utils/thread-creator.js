const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

async function createSignalementThread(options) {
    const {
        forum,          // Le forum où créer le thread (suspects ou bannis)
        vrchatID,       // L'ID VRChat du joueur
        vrchatName,     // Le nom d'utilisateur VRChat
        signaleur,      // L'utilisateur Discord qui signale
        type,          // 'suspect' ou 'banned'
        playersDB      // Instance de la base de données
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

    // Ajouter les options de tags en gérant correctement les emojis
    const tagOptions = forum.availableTags.map(tag => {
        const tagOption = {
            label: tag.name,
            value: tag.id
        };
        
        // N'ajouter l'emoji que s'il existe
        if (tag.emoji) {
            if (typeof tag.emoji === 'string') {
                // Emoji Unicode
                tagOption.emoji = tag.emoji;
            } else if (tag.emoji.id) {
                // Emoji personnalisé
                tagOption.emoji = {
                    id: tag.emoji.id,
                    name: tag.emoji.name || undefined,
                    animated: tag.emoji.animated || false
                };
            }
        }
        
        return tagOption;
    });
    
    tagMenu.addOptions(tagOptions);

    const row = new ActionRowBuilder().addComponents(tagMenu);

    // Retourner le menu pour la sélection des tags
    return {
        content: 'Sélectionnez les tags appropriés pour ce signalement :',
        components: [row],
        async createThread(selectedTags) {
            // Créer le message du thread
            const threadMessage = `**Nouveau signalement ${type === 'banned' ? 'banni' : 'suspect'}**\n\n` +
                `**Joueur:** ${vrchatName}\n` +
                `**Profil VRChat:** https://vrchat.com/home/user/${vrchatID}\n` +
                `**ID:** \`${vrchatID}\`\n` +
                `**Signalé par:** <@${signaleur.id}>\n\n` +
                `**Merci d'ajouter :**\n` +
                `• Une description détaillée du comportement\n` +
                `• Des captures d'écran du joueur\n` +
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

            const existingPlayer = playersDB.findPlayer(vrchatID);
            if (existingPlayer) {
                playersDB.updatePlayer(existingPlayer, newPlayer);
            } else {
                playersDB.addPlayer(newPlayer);
            }

            return thread;
        }
    };
}

module.exports = { createSignalementThread };
