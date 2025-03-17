require('dotenv').config();
const { Client, GatewayIntentBits, Events, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const PlayersDB = require('./database/players-db');
const VRChatLinkDetector = require('./events/vrchat-link-detector');
const ForumScanner = require('./utils/forum-scanner');

// Créer le client Discord avec les intents nécessaires
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Créer une instance unique de la base de données
const playersDB = new PlayersDB();

// Créer une instance du détecteur de liens
const vrchatLinkDetector = new VRChatLinkDetector(playersDB);

// Collection pour stocker les commandes
client.commands = new Collection();

// Charger les commandes
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    }
}

// Gérer les commandes slash
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, playersDB);
    } catch (error) {
        console.error(error);
        const errorMessage = {
            content: '❌ Une erreur est survenue lors de l\'exécution de la commande.',
            ephemeral: true
        };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

// Enregistrer les événements du détecteur de liens
client.on(Events.MessageCreate, message => vrchatLinkDetector.handleMessage(message));
client.on(Events.InteractionCreate, interaction => vrchatLinkDetector.handleInteraction(interaction));

// Scanner les forums au démarrage
client.once(Events.ClientReady, async () => {
    console.log('Bot prêt !');
    client.user.setPresence({
        status: 'online', // 'online', 'idle', 'dnd' (ne pas déranger), ou 'invisible'
        activities: [{
            name: 'boire du café ☕', // Texte affiché
            type: 0 // 0 = "Joue à", 1 = "Stream", 2 = "Écoute", 3 = "Regarde", 5 = "Compétition"
        }]
    });

    try {
        const scanner = new ForumScanner(client, playersDB);
        const reportChannel = await client.channels.fetch(process.env.SCAN_REPORT_CHANNEL_ID);
        if (!reportChannel) {
            console.error('❌ Canal de rapport non trouvé');
            return;
        }
        await scanner.scanForums(reportChannel);
    } catch (error) {
        console.error('Erreur lors du scan des forums:', error);
    }
});

// Connexion à Discord
client.login(process.env.DISCORD_TOKEN);