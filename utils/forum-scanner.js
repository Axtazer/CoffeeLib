const fs = require('fs');
const path = require('path');
const { Events, EmbedBuilder } = require('discord.js');
const VRChatDataService = require('./vrchat-data-service');

// Constantes de configuration
const MESSAGES_PER_THREAD = 10;     // Nombre de messages à scanner par thread (1ère tentative)
const MESSAGES_DEEP_SCAN = 50;      // Nombre de messages à scanner par thread (2ème tentative)
const BATCH_SIZE = 5;               // Nombre de threads à traiter simultanément
const BATCH_DELAY = 500;            // Délai entre les lots (en ms)
const DISCORD_MESSAGE_LIMIT = 2000; // Limite de caractères par message Discord

// Fonction utilitaire pour calculer la similarité entre deux chaînes
function calculateSimilarity(s1, s2) {
    if (s1 === s2) return 1.0;
    
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

// Algorithme de distance de Levenshtein
function levenshteinDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

class ForumScanner {
    constructor(client, playersDB) {
        this.client = client;
        this.playersDB = playersDB;
        this.dataService = new VRChatDataService(playersDB);
        this.scannedThreads = new Map();
        this.duplicates = new Map();
        this.reportMessages = [];
        
        // Charger les messages de rapport
        this.loadReportMessages();
        
        // Vérifier si la base de données est vide
        if (this.playersDB.getAllPlayers().length === 0) {
            console.log('💭 Base de données vide, suppression du cache des threads...');
            try {
                if (fs.existsSync(this.scanCachePath)) {
                    fs.unlinkSync(this.scanCachePath);
                    console.log('🗑️ Cache des threads supprimé');
                }
            } catch (error) {
                console.error('Erreur lors de la suppression du cache des threads:', error);
            }
        } else {
            this.loadScannedThreads();
        }
    }

    get scanCachePath() {
        return path.join(__dirname, '..', 'data', 'scanned_threads.json');
    }

    get reportMessagePath() {
        return path.join(__dirname, '..', 'data', 'last_report_message.json');
    }

    get reportMessagesPath() {
        return path.join(__dirname, '..', 'data', 'report_messages.json');
    }

    loadLastReportMessage() {
        try {
            if (fs.existsSync(this.reportMessagePath)) {
                const data = fs.readFileSync(this.reportMessagePath, 'utf8');
                const parsed = JSON.parse(data);
                this.lastReportMessageId = parsed.messageId;
                this.lastReportChannelId = parsed.channelId;
                console.log('📂 Dernier message de rapport chargé');
            }
        } catch (error) {
            console.error('Erreur lors du chargement du dernier message de rapport:', error);
        }
    }

    saveLastReportMessage(messageId, channelId) {
        try {
            const dir = path.dirname(this.reportMessagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = JSON.stringify({
                messageId,
                channelId
            }, null, 2);
            fs.writeFileSync(this.reportMessagePath, data);
            console.log('💾 Dernier message de rapport sauvegardé');
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du dernier message de rapport:', error);
        }
    }

    loadReportMessages() {
        try {
            if (fs.existsSync(this.reportMessagesPath)) {
                const data = fs.readFileSync(this.reportMessagesPath, 'utf8');
                this.reportMessages = JSON.parse(data);
                console.log(`📂 Messages de rapport chargés: ${this.reportMessages.length} messages`);
            } else {
                this.reportMessages = [];
            }
        } catch (error) {
            console.error('Erreur lors du chargement des messages de rapport:', error);
            this.reportMessages = [];
        }
    }

    saveReportMessages() {
        try {
            const dir = path.dirname(this.reportMessagesPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.reportMessagesPath, JSON.stringify(this.reportMessages, null, 2));
            console.log(`💾 Messages de rapport sauvegardés: ${this.reportMessages.length} messages`);
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des messages de rapport:', error);
        }
    }

    addReportMessage(messageId, channelId, type) {
        this.reportMessages.push({
            messageId,
            channelId,
            type, // 'main', 'duplicates', etc.
            timestamp: Date.now()
        });
        this.saveReportMessages();
    }

    removeReportMessage(messageId) {
        this.reportMessages = this.reportMessages.filter(msg => msg.messageId !== messageId);
        this.saveReportMessages();
    }

    async cleanReportMessages(guild) {
        if (!this.reportMessages || this.reportMessages.length === 0) return;
        
        const messagesToRemove = [];
        
        for (const reportMsg of this.reportMessages) {
            try {
                const channel = await guild.channels.fetch(reportMsg.channelId);
                if (!channel) {
                    messagesToRemove.push(reportMsg.messageId);
                    continue;
                }
                
                try {
                    await channel.messages.fetch(reportMsg.messageId);
                    // Si on arrive ici, le message existe toujours
                } catch (error) {
                    // Message introuvable
                    messagesToRemove.push(reportMsg.messageId);
                }
            } catch (error) {
                // Canal introuvable
                messagesToRemove.push(reportMsg.messageId);
            }
        }
        
        // Supprimer les messages qui n'existent plus
        if (messagesToRemove.length > 0) {
            console.log(`🧹 Nettoyage de ${messagesToRemove.length} messages de rapport supprimés`);
            this.reportMessages = this.reportMessages.filter(msg => !messagesToRemove.includes(msg.messageId));
            this.saveReportMessages();
        }
    }

    getReportMessagesByType(channelId, type) {
        return this.reportMessages.filter(msg => 
            msg.channelId === channelId && msg.type === type
        );
    }

    loadScannedThreads() {
        try {
            if (fs.existsSync(this.scanCachePath)) {
                const data = fs.readFileSync(this.scanCachePath, 'utf8');
                this.scannedThreads = new Map(JSON.parse(data).map(item => [item.threadId, item.hasVRChat]));
                console.log('📂 Cache des threads chargé');
                console.log(`📊 Nombre de threads en cache: ${this.scannedThreads.size}`);
            }
        } catch (error) {
            console.error('Erreur lors du chargement des threads scannés:', error);
        }
    }

    saveScannedThreads() {
        try {
            const dir = path.dirname(this.scanCachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = Array.from(this.scannedThreads.entries()).map(([threadId, hasVRChat]) => ({
                threadId,
                hasVRChat
            }));
            fs.writeFileSync(this.scanCachePath, JSON.stringify(data, null, 2));
            console.log('💾 Cache des threads sauvegardé');
            console.log(`📊 Nombre de threads en cache: ${this.scannedThreads.size}`);
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des threads scannés:', error);
        }
    }

    async extractVRChatInfo(message) {
        return this.dataService.extractVRChatInfo(message);
    }

    // Nouvelle méthode pour détecter les doublons potentiels basés sur la similarité des noms
    findPotentialNameDuplicates() {
        const potentialDuplicates = [];
        const players = this.playersDB.getAllPlayers();
        
        for (let i = 0; i < players.length; i++) {
            for (let j = i + 1; j < players.length; j++) {
                const similarity = calculateSimilarity(
                    players[i].vrchatName.toLowerCase(),
                    players[j].vrchatName.toLowerCase()
                );
                
                if (similarity > 0.8) { // 80% de similarité
                    potentialDuplicates.push({
                        player1: players[i],
                        player2: players[j],
                        similarity: similarity
                    });
                }
            }
        }
        
        return potentialDuplicates;
    }

    async scanForums(reportChannel, forceRescan = false) {
        console.log('\n🔍 Début du scan des forums...');
        
        // Nettoyer les messages de rapport qui n'existent plus
        if (reportChannel) {
            await this.cleanReportMessages(reportChannel.guild);
        }
        
        // Créer un embed initial pour le rapport
        const statusEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('📊 Scan des forums en cours')
            .setDescription('Initialisation du scan...')
            .setTimestamp()
            .setFooter({ text: 'CoffeeLib - Scanner de forums' });
        
        // Essayer de récupérer le dernier message de rapport
        let statusMessage;
        if (reportChannel) {
            const mainReportMessages = this.getReportMessagesByType(reportChannel.id, 'main');
            
            if (mainReportMessages.length > 0) {
                try {
                    // Tenter de récupérer le dernier message principal
                    statusMessage = await reportChannel.messages.fetch(mainReportMessages[0].messageId);
                    await statusMessage.edit({ embeds: [statusEmbed] });
                } catch (error) {
                    // Si le message n'existe plus, le supprimer de notre liste et en créer un nouveau
                    this.removeReportMessage(mainReportMessages[0].messageId);
                    statusMessage = await reportChannel.send({ embeds: [statusEmbed] });
                    this.addReportMessage(statusMessage.id, reportChannel.id, 'main');
                }
            } else {
                // Créer un nouveau message principal
                statusMessage = await reportChannel.send({ embeds: [statusEmbed] });
                this.addReportMessage(statusMessage.id, reportChannel.id, 'main');
            }
        }
        
        // Récupérer les forums
        const forumSuspects = await this.client.channels.fetch(process.env.FORUM_SUSPECTS_ID);
        const forumBannis = await this.client.channels.fetch(process.env.FORUM_BANNIS_ID);

        if (!forumSuspects || !forumBannis) {
            const errorMessage = !forumSuspects ? '❌ Forum des suspects non trouvé' : '❌ Forum des bannis non trouvé';
            console.error(errorMessage);
            
            if (statusMessage) {
                statusEmbed.setColor(0xFF0000)
                    .setTitle('❌ Erreur lors du scan')
                    .setDescription(errorMessage);
                await statusMessage.edit({ embeds: [statusEmbed] });
            }
            return;
        }

        // Si forceRescan est activé, vider le cache des threads scannés
        if (forceRescan) {
            console.log('🔄 Rescan forcé, vidage du cache des threads...');
            this.scannedThreads.clear();
        }

        // Mettre à jour l'embed avec les informations initiales
        if (statusMessage) {
            statusEmbed.setDescription(
                `🔍 Scan en cours...\n\n` +
                `📊 Forum des suspects: ${forumSuspects.threads.cache.size} threads\n` +
                `📊 Forum des bannis: ${forumBannis.threads.cache.size} threads\n\n` +
                `⏳ Scan du forum des suspects...`
            );
            await statusMessage.edit({ embeds: [statusEmbed] });
        }

        console.log(`📊 Forum des suspects: ${forumSuspects.threads.cache.size} threads`);
        console.log(`📊 Forum des bannis: ${forumBannis.threads.cache.size} threads`);

        // Scanner le forum des suspects
        const suspectsResult = await this.scanForum(forumSuspects, 'suspect');
        
        // Mettre à jour l'embed après le scan des suspects
        if (statusMessage) {
            statusEmbed.setDescription(
                `🔍 Scan en cours...\n\n` +
                `📊 Forum des suspects: ${forumSuspects.threads.cache.size} threads\n` +
                `📊 Forum des bannis: ${forumBannis.threads.cache.size} threads\n\n` +
                `✅ Scan du forum des suspects terminé\n` +
                `⏳ Scan du forum des bannis...`
            );
            await statusMessage.edit({ embeds: [statusEmbed] });
        }

        // Scanner le forum des bannis
        const bannisResult = await this.scanForum(forumBannis, 'banned');

        const threadsWithoutVRC = [...suspectsResult.threadsWithoutVRC, ...bannisResult.threadsWithoutVRC];
        const deletedThreads = [...suspectsResult.deletedThreads, ...bannisResult.deletedThreads];

        // Mettre à jour l'embed après le scan des bannis
        if (statusMessage) {
            statusEmbed.setDescription(
                `🔍 Scan en cours...\n\n` +
                `📊 Forum des suspects: ${forumSuspects.threads.cache.size} threads\n` +
                `📊 Forum des bannis: ${forumBannis.threads.cache.size} threads\n\n` +
                `✅ Scan du forum des suspects terminé\n` +
                `✅ Scan du forum des bannis terminé\n` +
                `⏳ Vérification des doublons...`
            );
            await statusMessage.edit({ embeds: [statusEmbed] });
        }

        // Vérifier les doublons
        const playersWithMultipleThreads = new Map();
        this.checkForDuplicates(forumSuspects, 'suspect', playersWithMultipleThreads);
        this.checkForDuplicates(forumBannis, 'banned', playersWithMultipleThreads);

        // Mettre à jour l'embed avant de générer le rapport
        if (statusMessage) {
            statusEmbed.setDescription(
                `🔍 Scan en cours...\n\n` +
                `📊 Forum des suspects: ${forumSuspects.threads.cache.size} threads\n` +
                `📊 Forum des bannis: ${forumBannis.threads.cache.size} threads\n\n` +
                `✅ Scan du forum des suspects terminé\n` +
                `✅ Scan du forum des bannis terminé\n` +
                `✅ Vérification des doublons terminée\n` +
                `⏳ Génération du rapport...`
            );
            await statusMessage.edit({ embeds: [statusEmbed] });
        }
        
        // Générer le rapport final
        const hasIssues = threadsWithoutVRC.length > 0 || deletedThreads.length > 0 || playersWithMultipleThreads.size > 0;

        // Créer l'embed du rapport final
        const reportEmbed = new EmbedBuilder()
            .setColor(hasIssues ? 0xFFAA00 : 0x00FF00)
            .setTitle('📊 Rapport du scan des forums')
            .setTimestamp()
            .setFooter({ text: 'CoffeeLib - Scanner de forums' });

        let description = '';

        if (!hasIssues) {
            description = '## ✅ Aucun problème détecté\n';
        } else {
            if (threadsWithoutVRC.length > 0) {
                description += '## ❌ Threads sans lien VRChat\n';
                // Afficher tous les threads sans VRChat
                for (const thread of threadsWithoutVRC) {
                    const forumType = thread.type === 'banned' ? 'bannis' : 'suspects';
                    description += `• <#${thread.threadId}> (${forumType})\n`;
                }
                description += '\n';
            }
            
            if (deletedThreads.length > 0) {
                description += '## 🗑️ Threads supprimés ou inaccessibles\n';
                // Afficher les IDs des threads supprimés (max 15 pour éviter les messages trop longs)
                const displayCount = Math.min(deletedThreads.length, 15);
                for (let i = 0; i < displayCount; i++) {
                    description += `• ${deletedThreads[i].threadId}\n`;
                }
                if (deletedThreads.length > 15) {
                    description += `• ... et ${deletedThreads.length - 15} autres threads supprimés\n`;
                }
                description += '\n';
            }
        }

        // Si la description est trop longue, la tronquer pour l'embed principal
        if (description.length > 4000) {
            const truncatedDescription = description.substring(0, 3900) + '...\n\n*Le rapport est trop long et a été tronqué.*';
            reportEmbed.setDescription(truncatedDescription);
        } else {
            reportEmbed.setDescription(description);
        }

        // Ajouter des statistiques
        reportEmbed.addFields(
            { 
                name: '📈 Statistiques', 
                value: `Threads sans VRChat: ${threadsWithoutVRC.length}\nThreads supprimés: ${deletedThreads.length}\nJoueurs avec doublons: ${playersWithMultipleThreads.size}` 
            }
        );

        // Mettre à jour le message avec le rapport final
        if (statusMessage) {
            await statusMessage.edit({ embeds: [reportEmbed] });
            
            // MODIFICATION: Rechercher et afficher d'abord les doublons potentiels basés sur la similarité des noms
            // Supprimer les anciens messages de doublons potentiels
            const nameDuplicateMessages = this.getReportMessagesByType(reportChannel.id, 'name_duplicates');
            for (const msgData of nameDuplicateMessages) {
                try {
                    const msg = await reportChannel.messages.fetch(msgData.messageId);
                    await msg.delete();
                } catch (error) {
                    // Ignorer les erreurs si le message n'existe plus
                }
                this.removeReportMessage(msgData.messageId);
            }
            
            // Rechercher les doublons potentiels
            const potentialDuplicates = this.findPotentialNameDuplicates();
            
            if (potentialDuplicates.length > 0) {
                // Créer un embed pour les doublons potentiels
                const duplicatesEmbed = new EmbedBuilder()
                    .setTitle('🔍 Doublons potentiels détectés')
                    .setDescription(`${potentialDuplicates.length} joueur(s) avec des noms similaires trouvés`)
                    .setColor('#FFA500')
                    .setTimestamp()
                    .setFooter({ text: 'CoffeeLib - Scanner de forums' });
                
                // Ajouter les 10 premiers doublons potentiels à l'embed
                potentialDuplicates.slice(0, 10).forEach((dup, index) => {
                    duplicatesEmbed.addFields({
                        name: `Doublon #${index + 1} (${Math.round(dup.similarity * 100)}% similaire)`,
                        value: `1: ${dup.player1.vrchatName} (ID: \`${dup.player1.vrchatID}\`)\n2: ${dup.player2.vrchatName} (ID: \`${dup.player2.vrchatID}\`)`
                    });
                });
                
                // Si plus de 10 doublons, ajouter une note
                if (potentialDuplicates.length > 10) {
                    duplicatesEmbed.addFields({
                        name: 'Note',
                        value: `${potentialDuplicates.length - 10} autres doublons potentiels non affichés.`
                    });
                }
                
                // Envoyer l'embed
                const duplicatesMsg = await reportChannel.send({ embeds: [duplicatesEmbed] });
                this.addReportMessage(duplicatesMsg.id, reportChannel.id, 'name_duplicates');
                
                // Si plus de 10 doublons, envoyer des messages supplémentaires avec les détails
                if (potentialDuplicates.length > 10) {
                    let currentMessage = '## 🔍 Doublons potentiels supplémentaires\n\n';
                    
                    for (let i = 10; i < potentialDuplicates.length; i++) {
                        const dup = potentialDuplicates[i];
                        const dupText = `### Doublon #${i + 1} (${Math.round(dup.similarity * 100)}% similaire)\n` +
                                       `1: ${dup.player1.vrchatName} (ID: \`${dup.player1.vrchatID}\`)\n` +
                                       `2: ${dup.player2.vrchatName} (ID: \`${dup.player2.vrchatID}\`)\n\n`;
                        
                        // Si le message devient trop long, l'envoyer et en commencer un nouveau
                        if ((currentMessage + dupText).length > 1800) {
                            const newMsg = await reportChannel.send(currentMessage);
                            this.addReportMessage(newMsg.id, reportChannel.id, 'name_duplicates_extra');
                            currentMessage = '## 🔍 Doublons potentiels supplémentaires (suite)\n\n';
                        }
                        
                        currentMessage += dupText;
                    }
                    
                    // Envoyer le reste du message s'il y en a
                    if (currentMessage.length > 50) { // Vérifier qu'il y a plus que juste le titre
                        const newMsg = await reportChannel.send(currentMessage);
                        this.addReportMessage(newMsg.id, reportChannel.id, 'name_duplicates_extra');
                    }
                }
            }
            
            // ENSUITE: Si nous avons des joueurs avec plusieurs threads, envoyer un message séparé
            if (playersWithMultipleThreads.size > 0) {
                // Supprimer les anciens messages de doublons
                const duplicateMessages = this.getReportMessagesByType(reportChannel.id, 'duplicates');
                for (const msgData of duplicateMessages) {
                    try {
                        const msg = await reportChannel.messages.fetch(msgData.messageId);
                        await msg.delete();
                    } catch (error) {
                        // Ignorer les erreurs si le message n'existe plus
                    }
                    this.removeReportMessage(msgData.messageId);
                }
                
                let duplicatesMessage = '## ⚠️ Joueurs avec plusieurs threads\n\n';
                
                for (const [vrchatID, player] of playersWithMultipleThreads) {
                    duplicatesMessage += `### \`${player.vrchatName}\` - **${player.type === 'suspect' ? 'Suspect' : 'Banni'}**\n-# \`${vrchatID}\`\n`;
                    
                    // Inclure tous les liens vers les threads
                    for (const thread of player.threads) {
                        duplicatesMessage += `- <#${thread.threadId}>\n`;
                    }
                    duplicatesMessage += '\n';
                    
                    // Si le message devient trop long, l'envoyer et en commencer un nouveau
                    if (duplicatesMessage.length > 1800) {
                        const newMsg = await reportChannel.send(duplicatesMessage);
                        this.addReportMessage(newMsg.id, reportChannel.id, 'duplicates');
                        duplicatesMessage = '';
                    }
                }
                
                // Envoyer le reste du message s'il y en a
                if (duplicatesMessage.length > 0) {
                    const newMsg = await reportChannel.send(duplicatesMessage);
                    this.addReportMessage(newMsg.id, reportChannel.id, 'duplicates');
                }
            }
        }
        
        // Sauvegarder l'état des threads scannés
        this.saveScannedThreads();
    }

    checkForDuplicates(forum, type, playersWithMultipleThreads) {
        if (!forum) return;

        // Ne chercher que les joueurs du type spécifié (suspect ou banni)
        const players = this.playersDB.getAllPlayers().filter(p => p.type === type);
        for (const player of players) {
            // Ne compter que les threads du forum actuel
            const threads = player.forumThreads.filter(t => {
                const thread = forum.threads.cache.get(t.threadId);
                return thread && thread.parentId === forum.id;
            });
            
            // Signaler uniquement s'il y a plusieurs threads dans le même forum
            if (threads.length > 1) {
                playersWithMultipleThreads.set(player.vrchatID, {
                    vrchatID: player.vrchatID,
                    vrchatName: player.vrchatName,
                    type: type,
                    threads: threads
                });
            }
        }
    }

    async scanForum(forum, type) {
        if (!forum) return { threadsWithoutVRC: [], deletedThreads: [] };
        
        console.log(`\n📊 Nombre de threads dans ${type === 'banned' ? 'bannis' : 'suspects'}: ${forum.threads.cache.size}`);
        
        const threadsWithoutVRC = [];
        const deletedThreads = [];
        const threads = [...forum.threads.cache.values()];
        
        // Compter les threads déjà scannés
        const alreadyScannedCount = threads.filter(thread => 
            this.scannedThreads.get(thread.id) === true
        ).length;
        
        console.log(`📊 Threads déjà scannés: ${alreadyScannedCount}/${threads.length}`);
        
        // Filtrer les threads non scannés
        const threadsToScan = threads.filter(thread => 
            this.scannedThreads.get(thread.id) !== true
        );
        
        console.log(`📊 Threads à scanner: ${threadsToScan.length}`);
        
        // Traiter les threads par lots
        for (let i = 0; i < threadsToScan.length; i += BATCH_SIZE) {
            const batch = threadsToScan.slice(i, i + BATCH_SIZE);
            console.log(`🔍 Traitement du lot ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(threadsToScan.length/BATCH_SIZE)}`);
            
            await Promise.all(batch.map(async (thread) => {
                try {
                    const threadId = thread.id;
                    
                    // Vérification supplémentaire pour éviter de scanner à nouveau
                    if (this.scannedThreads.get(threadId) === true) {
                        console.log(`⏩ Thread déjà scanné, ignoré: ${thread.name}`);
                        return;
                    }

                    console.log(`🔍 Scan du thread : ${thread.name}`);

                    // Première tentative avec un nombre limité de messages
                    let messages = await thread.messages.fetch({ limit: MESSAGES_PER_THREAD });
                    let hasVRChatLink = false;
                    let vrchatInfo = null;

                    for (const message of messages.values()) {
                        vrchatInfo = await this.extractVRChatInfo(message);
                        if (vrchatInfo) {
                            hasVRChatLink = true;
                            break;
                        }
                    }

                    // Si aucun lien n'est trouvé, faire une seconde tentative avec plus de messages
                    if (!hasVRChatLink) {
                        console.log(`⚠️ Pas de lien VRChat trouvé dans les ${MESSAGES_PER_THREAD} premiers messages, scan approfondi...`);
                        
                        // Récupérer plus de messages
                        messages = await thread.messages.fetch({ limit: MESSAGES_DEEP_SCAN });
                        
                        // Parcourir tous les messages (en évitant de re-scanner les premiers)
                        const messagesToCheck = [...messages.values()].slice(MESSAGES_PER_THREAD);
                        for (const message of messagesToCheck) {
                            vrchatInfo = await this.extractVRChatInfo(message);
                            if (vrchatInfo) {
                                hasVRChatLink = true;
                                console.log(`✅ Lien VRChat trouvé lors du scan approfondi!`);
                                break;
                            }
                        }
                    }

                    if (!hasVRChatLink) {
                        console.log(`❌ Pas d'ID VRChat trouvé dans : ${thread.name} (après scan approfondi)`);
                        threadsWithoutVRC.push({
                            threadId: thread.id,
                            threadName: thread.name,
                            type: type
                        });
                        // Marquer comme scanné mais sans VRChat
                        this.scannedThreads.set(threadId, false);
                        return;
                    }

                    const { vrchatID, vrchatName } = vrchatInfo;

                    // Mettre à jour la base de données
                    const existingPlayer = this.playersDB.findPlayer(vrchatID);
                    if (existingPlayer) {
                        const threadInfo = {
                            threadId: thread.id,
                            tags: thread.appliedTags,
                            createdAt: thread.createdAt.toISOString()
                        };

                        if (!existingPlayer.forumThreads.some(t => t.threadId === thread.id)) {
                            existingPlayer.forumThreads.push(threadInfo);
                            this.playersDB.updatePlayer(existingPlayer, existingPlayer);
                        }
                    } else {
                        const newPlayer = {
                            vrchatID,
                            vrchatName,
                            type,
                            forumThreads: [{
                                threadId: thread.id,
                                tags: thread.appliedTags,
                                createdAt: thread.createdAt.toISOString()
                            }]
                        };
                        this.playersDB.addPlayer(newPlayer);
                    }

                    // Marquer comme scanné avec VRChat
                    this.scannedThreads.set(threadId, true);
                    console.log(`✅ Thread scanné avec succès: ${thread.name}`);

                } catch (error) {
                    if (error.code === 10003 || error.code === 50001) {
                        console.log(`🗑️ Thread supprimé ou inaccessible : ${thread.id}`);
                        deletedThreads.push({ threadId: thread.id });
                        this.scannedThreads.delete(thread.id);
                    } else {
                        console.error(`Erreur lors du scan du thread ${thread.name}:`, error);
                    }
                }
            }));
            
            // Petite pause entre les lots pour éviter de surcharger l'API
            if (i + BATCH_SIZE < threadsToScan.length) {
                console.log(`⏳ Pause de ${BATCH_DELAY}ms avant le prochain lot...`);
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }

        return { threadsWithoutVRC, deletedThreads };
    }
}

module.exports = ForumScanner;
