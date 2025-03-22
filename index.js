// Importation des modules nécessaires
const fs = require('fs');
const path = require('path');
const { Client, Collection, Events, GatewayIntentBits, ActivityType } = require('discord.js');
require('dotenv').config();

// Importation des services personnalisés
const PlayersDB = require('./utils/players-db');
const VRChatLinkDetector = require('./events/vrchat-link-detector');
const ForumScanner = require('./utils/forum-scanner');

// Création du client Discord avec les intents nécessaires
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialisation de la base de données des joueurs
const playersDB = new PlayersDB();

// Initialisation du détecteur de liens VRChat
const vrchatLinkDetector = new VRChatLinkDetector(playersDB);

// Initialisation du scanner de forums
let forumScanner;

// Collection pour stocker les commandes
client.commands = new Collection();

// Chargement des commandes depuis le dossier commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Chargement dynamique des commandes
console.log('🔄 Chargement des commandes...');
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    // Vérification que la commande a les propriétés requises
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        console.log(`✅ Commande chargée: ${command.data.name}`);
    } else {
        console.log(`⚠️ La commande ${file} n'a pas les propriétés requises 'data' ou 'execute'`);
    }
}

// Gestionnaire d'erreurs global pour éviter les crashs
process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non gérée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
});

// Événement déclenché lorsque le client est prêt
client.once(Events.ClientReady, async () => {
    console.log(`🚀 Bot connecté en tant que ${client.user.tag}`);
    
    // Définir le statut du bot
    client.user.setActivity('boire du café ☕', { type: ActivityType.Playing });
    
    try {
        // Initialiser le scanner de forums une fois le client prêt
        forumScanner = new ForumScanner(client, playersDB);
        
        // Récupérer le canal de rapport pour le scanner
        const reportChannelId = process.env.FORUM_REPORT_CHANNEL_ID;
        if (reportChannelId) {
            const reportChannel = await client.channels.fetch(reportChannelId).catch(() => null);
            if (reportChannel) {
                console.log(`📊 Canal de rapport trouvé: #${reportChannel.name}`);
                
                // Exécuter un scan initial des forums
                console.log('🔍 Exécution du scan initial des forums...');
                await forumScanner.scanForums(reportChannel);
                console.log('✅ Scan initial terminé');
                
                // Planifier des scans périodiques (toutes les 12 heures)
                const SCAN_INTERVAL = 12 * 60 * 60 * 1000; // 12 heures en millisecondes
                setInterval(async () => {
                    console.log('🔄 Exécution du scan périodique des forums...');
                    try {
                        await forumScanner.scanForums(reportChannel);
                        console.log('✅ Scan périodique terminé');
                    } catch (error) {
                        console.error('❌ Erreur lors du scan périodique:', error);
                    }
                }, SCAN_INTERVAL);
                console.log(`⏰ Scans périodiques programmés toutes les 12 heures`);
            } else {
                console.warn('⚠️ Canal de rapport non trouvé. Les scans automatiques sont désactivés.');
            }
        } else {
            console.warn('⚠️ ID du canal de rapport non configuré. Les scans automatiques sont désactivés.');
        }
    } catch (error) {
        console.error('❌ Erreur lors de l\'initialisation du scanner de forums:', error);
    }
});

// Gestionnaire d'événements pour les commandes slash
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`❌ Aucune commande correspondant à ${interaction.commandName} n'a été trouvée.`);
        return;
    }
    
    try {
        await command.execute(interaction, playersDB);
    } catch (error) {
        console.error(`❌ Erreur lors de l'exécution de la commande ${interaction.commandName}:`, error);
        
        // Répondre à l'utilisateur en cas d'erreur
        const errorResponse = {
            content: '❌ Une erreur est survenue lors de l\'exécution de cette commande.',
            ephemeral: true
        };
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorResponse);
        } else {
            await interaction.reply(errorResponse);
        }
    }
});

// Gestionnaire pour les messages (détection de liens VRChat)
client.on(Events.MessageCreate, async message => {
    try {
        await vrchatLinkDetector.handleMessage(message);
    } catch (error) {
        console.error('❌ Erreur lors du traitement du message:', error);
    }
});

// Gestionnaire pour les interactions avec les boutons
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isButton()) {
            await vrchatLinkDetector.handleInteraction(interaction);
        }
    } catch (error) {
        console.error('❌ Erreur lors du traitement de l\'interaction:', error);
    }
});

// Connexion à Discord avec le token
client.login(process.env.DISCORD_TOKEN);
