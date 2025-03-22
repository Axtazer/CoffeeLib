const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const DEBUG = process.env.DEBUG === 'true';

function debug(...args) {
    if (DEBUG) console.log(...args);
}

class ThreadCreator {
    /**
     * Crée un nouveau thread de signalement
     * @param {Object} options - Options de création
     * @returns {Promise<Object>} - Objet contenant le menu de tags et une fonction pour créer le thread
     */
    static async createSignalementThread(options) {
        const {
            forum,
            vrchatID,
            vrchatName,
            signaleur,
            type,
            playersDB,
            dataService,
            verifiedPermissions // Nouveau paramètre pour les permissions pré-vérifiées
        } = options;

        debug('Thread Creator - Options reçues:', {
            vrchatID,
            vrchatName,
            type,
            signaleurId: signaleur.id,
            hasVerifiedPermissions: !!verifiedPermissions
        });

        // Si les permissions ont déjà été vérifiées, utiliser ces informations
        if (verifiedPermissions) {
            debug(`Utilisation des permissions pré-vérifiées pour ${signaleur.tag}`);
            const hasPermission = (type === 'ban') 
                ? verifiedPermissions.canBan || verifiedPermissions.isAdmin
                : verifiedPermissions.canSuspect || verifiedPermissions.isAdmin;
                
            if (!hasPermission) {
                throw new Error(`L'utilisateur n'a pas les permissions pour créer un dossier de type ${type}`);
            }
        } else {
            // Sinon, vérifier les permissions normalement
            try {
                // Récupérer le membre complet
                const guild = forum.guild;
                const member = await guild.members.fetch({ user: signaleur.id, force: true });
                
                // Vérifier les rôles directement
                const memberRoles = Array.from(member.roles.cache.keys());
                debug(`Rôles de l'utilisateur ${member.user.tag} dans thread-creator:`, memberRoles);
                
                const { BAN_ROLES, SUSPECT_ROLES, ADMIN_USERS } = require('../config/permissions');
                
                const isAdmin = ADMIN_USERS.includes(member.id);
                const hasPermission = isAdmin || 
                    (type === 'ban' && memberRoles.some(roleId => BAN_ROLES.includes(roleId))) ||
                    (type === 'suspect' && memberRoles.some(roleId => SUSPECT_ROLES.includes(roleId)));
                    
                if (!hasPermission) {
                    throw new Error(`L'utilisateur n'a pas les permissions pour créer un dossier de type ${type}`);
                }
            } catch (error) {
                console.error('Erreur lors de la vérification des permissions:', error);
                throw error;
            }
        }

        // Le reste du code reste inchangé...
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
                const threadMessage = `# Joueur: ${vrchatName}\n` +
                    `## Profil VRChat: https://vrchat.com/home/user/${vrchatID}\n` +
                    `-# ID: \`${vrchatID}\`\n` +
                    `## Signalé par: <@${signaleur.id}>\n\n` +
                    `**Merci d'ajouter :**\n` +
                    `- Une description du comportement et de votre démarche\n` +
                    `- Des preuves de son comportement\n` +
                    `- Toute information pertinente`;

                    debug('Thread Creator - Message à créer:', {
                    title: vrchatName,
                    message: threadMessage,
                    vrchatID: vrchatID // Assurer que l'ID est enregistré ici
                });

                // Créer le thread avec le nom du joueur comme titre
                const thread = await forum.threads.create({
                    name: vrchatName,
                    message: {
                        content: threadMessage
                    },
                    appliedTags: selectedTags
                });

                debug('Thread Creator - Thread créé:', {
                    threadId: thread.id,
                    threadName: thread.name,
                    messageContent: thread.messages.cache.first()?.content
                });

                // Ajouter/mettre à jour le joueur dans la base de données
                const newPlayer = {
                    vrchatID,
                    vrchatName,
                    type: type === 'ban' ? 'ban' : 'suspect',
                    forumThreads: [{
                        threadId: thread.id,
                        tags: selectedTags,
                        createdAt: new Date().toISOString()
                    }]
                };

                // Utiliser le dataService si disponible, sinon utiliser directement playersDB
                if (dataService) {
                    debug('Utilisation du dataService pour sauvegarder le joueur:', vrchatID);
                    dataService.savePlayerInfo(newPlayer);
                } else {
                    debug('Utilisation directe de playersDB pour sauvegarder le joueur:', vrchatID);
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

module.exports = { createSignalementThread: ThreadCreator.createSignalementThread };