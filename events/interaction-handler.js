class InteractionHandler {
    constructor(client, playersDB, forumScanner) {
        this.client = client;
        this.playersDB = playersDB;
        this.forumScanner = forumScanner;
    }

    async handleInteraction(interaction) {
        try {
            if (interaction.isCommand()) {
                await this.handleCommand(interaction);
            } else if (interaction.isButton()) {
                await this.handleButton(interaction);
            }
        } catch (error) {
            console.error('Erreur lors du traitement de l\'interaction:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'Une erreur est survenue lors du traitement de cette interaction.',
                    flags: 1 << 6
                });
            }
        }
    }

    async handleCommand(interaction) {
        const command = this.client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, this.playersDB, this.forumScanner);
        } catch (error) {
            console.error(error);
            const errorMessage = {
                content: 'Une erreur est survenue lors de l\'exécution de cette commande.',
                flags: 1 << 6
            };

            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else if (!interaction.replied) {
                await interaction.reply(errorMessage);
            }
        }
    }

    async handleButton(interaction) {
        const [action, vrchatID] = interaction.customId.split('_');

        if (!interaction.member.permissions.has('MODERATE_MEMBERS')) {
            await interaction.reply({
                content: 'Vous n\'avez pas les permissions nécessaires pour cette action.',
                flags: 1 << 6
            });
            return;
        }

        // Récupérer les informations du joueur depuis le message
        const messageContent = interaction.message.content;
        const nameMatch = messageContent.match(/Profil VRChat : (.+?) \(/);
        const idMatch = messageContent.match(/\((usr_[a-zA-Z0-9_-]+)\)/);
        const detectedID = idMatch?.[1] || vrchatID;
        
        // Exécuter la commande
        await command.execute(interaction, this.playersDB, this.forumScanner);
        
        // Supprimer le message original après l'action
        await interaction.message.delete();
    }
}

module.exports = InteractionHandler;
