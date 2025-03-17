const fs = require('fs');
const path = require('path');

class PlayersDB {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'database', 'players.json');
        this.players = this.loadDatabase();
    }

    loadDatabase() {
        try {
            if (fs.existsSync(this.dbPath)) {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('Erreur lors du chargement de la base de données:', error);
        }
        return [];
    }

    saveDatabase() {
        try {
            const dir = path.dirname(this.dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.dbPath, JSON.stringify(this.players, null, 2));
        } catch (error) {
            console.error('Erreur lors de la sauvegarde de la base de données:', error);
        }
    }

    clearDatabase() {
        // Supprimer le fichier de la base de données
        try {
            if (fs.existsSync(this.dbPath)) {
                fs.unlinkSync(this.dbPath);
                console.log(' Fichier de la base de données supprimé');
            }
        } catch (error) {
            console.error('Erreur lors de la suppression du fichier de la base de données:', error);
        }

        this.players = [];
        this.saveDatabase();
        console.log(' Base de données vidée');
    }

    addPlayer(player) {
        if (!player.vrchatID) {
            throw new Error('ID VRChat manquant');
        }

        // Vérifier si le joueur existe déjà
        const existingPlayer = this.findPlayer(player.vrchatID);
        if (existingPlayer) {
            throw new Error('Ce joueur existe déjà dans la base de données');
        }

        // Ajouter le joueur
        this.players.push(player);
        this.saveDatabase();
        console.log(` Joueur ajouté : ${player.vrchatName} (${player.vrchatID})`);
        return player;
    }

    updatePlayer(oldPlayer, newPlayer) {
        if (!oldPlayer || !newPlayer) {
            throw new Error('Joueur manquant pour la mise à jour');
        }

        const index = this.players.findIndex(p => p.vrchatID === oldPlayer.vrchatID);
        if (index === -1) {
            throw new Error('Joueur non trouvé dans la base de données');
        }

        // Mettre à jour le joueur
        this.players[index] = newPlayer;
        this.saveDatabase();
        console.log(` Joueur mis à jour : ${newPlayer.vrchatName} (${newPlayer.vrchatID})`);
        return newPlayer;
    }

    findPlayer(vrchatID) {
        return this.players.find(p => p.vrchatID === vrchatID);
    }

    getAllPlayers() {
        return this.players;
    }

    removePlayer(vrchatID) {
        const index = this.players.findIndex(p => p.vrchatID === vrchatID);
        if (index === -1) {
            throw new Error('Joueur non trouvé dans la base de données');
        }

        // Supprimer le joueur
        const player = this.players[index];
        this.players.splice(index, 1);
        this.saveDatabase();
        console.log(` Joueur supprimé : ${player.vrchatName} (${player.vrchatID})`);
    }

    // Méthodes utilitaires
    getPlayersByType(type) {
        return this.players.filter(p => p.type === type);
    }

    getPlayersByTag(tag) {
        return this.players.filter(p => 
            p.forumThreads && 
            p.forumThreads.some(thread => thread.tags && thread.tags.includes(tag))
        );
    }

    getPlayersByThread(threadId) {
        return this.players.filter(p => 
            p.forumThreads && 
            p.forumThreads.some(thread => thread.threadId === threadId)
        );
    }
}

module.exports = PlayersDB;
