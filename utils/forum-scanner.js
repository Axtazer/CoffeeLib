const fs = require('fs');
const path = require('path');
const { Events } = require('discord.js');

class ForumScanner {
    constructor(client, playersDB) {
        this.client = client;
        this.playersDB = playersDB;
        this.scannedThreads = new Map();
        this.duplicates = new Map();
        
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

    loadScannedThreads() {
        try {
            if (fs.existsSync(this.scanCachePath)) {
                const data = fs.readFileSync(this.scanCachePath, 'utf8');
                this.scannedThreads = new Map(JSON.parse(data).map(item => [item.threadId, item.hasVRChat]));
                console.log('📂 Cache des threads chargé');
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
        } catch (error) {
            console.error('Erreur lors de la sauvegarde des threads scannés:', error);
        }
    }

    async extractVRChatInfo(message) {
        // Détecter les liens VRChat avec une regex plus précise
        const vrchatLinkRegex = /(?:https?:\/\/)?vrchat\.com\/home\/user\/(usr_[a-zA-Z0-9-_]+)/;
        const match = message.content.match(vrchatLinkRegex);
        if (!match) return null;

        const vrchatID = match[1];
        if (!vrchatID) return null;

        // Récupérer le nom d'utilisateur depuis l'embed
        let vrchatName = vrchatID;
        if (message.embeds.length > 0) {
            const embed = message.embeds[0];
            vrchatName = embed.title || vrchatID;
        }

        return { vrchatID, vrchatName };
    }

    async scanForums(reportChannel) {
        console.log('\n🔍 Début du scan des forums...');

        const forumSuspects = await this.client.channels.fetch(process.env.FORUM_SUSPECTS_ID);
        const forumBannis = await this.client.channels.fetch(process.env.FORUM_BANNIS_ID);

        if (!forumSuspects) {
            console.error('❌ Forum des suspects non trouvé');
            return;
        }
        if (!forumBannis) {
            console.error('❌ Forum des bannis non trouvé');
            return;
        }

        console.log(`📊 Forum des suspects: ${forumSuspects.threads.cache.size} threads`);
        console.log(`📊 Forum des bannis: ${forumBannis.threads.cache.size} threads`);

        const suspectsResult = await this.scanForum(forumSuspects, 'suspect');
        const bannisResult = await this.scanForum(forumBannis, 'banned');

        const threadsWithoutVRC = [...suspectsResult.threadsWithoutVRC, ...bannisResult.threadsWithoutVRC];
        const deletedThreads = [...suspectsResult.deletedThreads, ...bannisResult.deletedThreads];

        // Vérifier les doublons
        const playersWithMultipleThreads = new Map();
        this.checkForDuplicates(forumSuspects, 'suspect', playersWithMultipleThreads);
        this.checkForDuplicates(forumBannis, 'banned', playersWithMultipleThreads);

        // Générer et envoyer le rapport
        const report = await this.generateReport(threadsWithoutVRC, deletedThreads, playersWithMultipleThreads);
        if (reportChannel && report) {
            await this.sendReport(reportChannel, report);
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

        for (const [threadId, thread] of forum.threads.cache) {
            try {
                const previousStatus = this.scannedThreads.get(threadId);
                if (previousStatus === true) {
                    continue;
                }

                console.log(`🔍 Scan du thread : ${thread.name}`);

                // Récupérer tous les messages du thread
                const messages = await thread.messages.fetch({ limit: 10 });
                let hasVRChatLink = false;
                let vrchatInfo = null;

                for (const message of messages.values()) {
                    vrchatInfo = await this.extractVRChatInfo(message);
                    if (vrchatInfo) {
                        hasVRChatLink = true;
                        break;
                    }
                }

                if (!hasVRChatLink) {
                    console.log(`❌ Pas d'ID VRChat trouvé dans : ${thread.name}`);
                    threadsWithoutVRC.push({
                        threadId: thread.id,
                        threadName: thread.name,
                        type: type
                    });
                    continue;
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

                // Mettre à jour le statut du thread
                this.scannedThreads.set(threadId, true);

            } catch (error) {
                if (error.code === 10003 || error.code === 50001) {
                    console.log(`🗑️ Thread supprimé ou inaccessible : ${threadId}`);
                    deletedThreads.push({ threadId });
                    this.scannedThreads.delete(threadId);
                } else {
                    console.error(`Erreur lors du scan du thread ${thread.name}:`, error);
                }
            }
        }

        return { threadsWithoutVRC, deletedThreads };
    }

    async generateReport(threadsWithoutVRC, deletedThreads, playersWithMultipleThreads) {
        let report = '# 📊 Rapport du scan des forums\n\n';

        if (threadsWithoutVRC.length > 0) {
            report += '## ❌ Threads sans lien VRChat\n';
            for (const thread of threadsWithoutVRC) {
                const forumType = thread.type === 'banned' ? 'bannis' : 'suspects';
                report += `• <#${thread.threadId}> (${forumType})\n`;
            }
            report += '\n';
        }

        if (deletedThreads.length > 0) {
            report += '## 🗑️ Threads supprimés ou inaccessibles\n';
            for (const thread of deletedThreads) {
                report += `• ${thread.threadId}\n`;
            }
            report += '\n';
        }

        if (playersWithMultipleThreads.size > 0) {
            report += '## ⚠️ Joueurs avec plusieurs threads\n';
            for (const [vrchatID, player] of playersWithMultipleThreads) {
                report += `### \`${player.vrchatName}\` - **${player.type === 'suspect' ? 'Suspect' : 'Banni'}**\n-# \`${vrchatID}\`\n`;
                for (const thread of player.threads) {
                    const threadLink = `<#${thread.threadId}>`;
                    report += `- ${threadLink}\n`;
                }
            }
        }

        if (threadsWithoutVRC.length === 0 && deletedThreads.length === 0 && playersWithMultipleThreads.size === 0) {
            report += '## ✅ Aucun problème détecté\n';
        }

        return report;
    }

    async sendReport(channel, report) {
        if (!report || typeof report !== 'string') {
            console.error('Rapport invalide:', report);
            return;
        }

        const DISCORD_MESSAGE_LIMIT = 2000;
        
        if (report.length <= DISCORD_MESSAGE_LIMIT) {
            await channel.send(report);
            return;
        }

        // Diviser le rapport en sections
        const sections = report.split('\n\n');
        let currentMessage = '';

        // Envoyer le titre dans le premier message
        await channel.send('# 📊 Rapport du scan des forums');

        for (const section of sections) {
            if (section === '# 📊 Rapport du scan des forums') continue;

            const sectionWithNewline = section + '\n\n';
            
            if ((currentMessage + sectionWithNewline).length > DISCORD_MESSAGE_LIMIT) {
                if (currentMessage) {
                    await channel.send(currentMessage);
                    currentMessage = '';
                }
                
                if (sectionWithNewline.length > DISCORD_MESSAGE_LIMIT) {
                    const lines = sectionWithNewline.split('\n');
                    let partialMessage = '';
                    
                    for (const line of lines) {
                        if ((partialMessage + line + '\n').length > DISCORD_MESSAGE_LIMIT) {
                            await channel.send(partialMessage);
                            partialMessage = line + '\n';
                        } else {
                            partialMessage += line + '\n';
                        }
                    }
                    
                    if (partialMessage) {
                        await channel.send(partialMessage);
                    }
                } else {
                    currentMessage = sectionWithNewline;
                }
            } else {
                currentMessage += sectionWithNewline;
            }
        }

        if (currentMessage) {
            await channel.send(currentMessage);
        }
    }
}

module.exports = ForumScanner;
