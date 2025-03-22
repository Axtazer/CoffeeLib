const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verifier-doublons')
    .setDescription('Vérifie les doublons potentiels dans la base de données'),
    
  async execute(interaction, playersDB) {
    if (!interaction.member.permissions.has('MODERATE_MEMBERS')) {
      return interaction.reply({
        content: 'Vous n\'avez pas les permissions nécessaires pour utiliser cette commande.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Rechercher les doublons potentiels (noms similaires)
    const potentialDuplicates = [];
    const players = playersDB.players;
    
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
    
    if (potentialDuplicates.length === 0) {
      return interaction.reply({
        content: 'Aucun doublon trouvé dans la base de données.',
        flags: MessageFlags.Ephemeral
      });
    }
    
    // Créer un embed avec les résultats
    const embed = new EmbedBuilder()
      .setTitle('Doublons potentiels détectés')
      .setDescription(`${potentialDuplicates.length} doublon(s) potentiel(s) trouvé(s):`)
      .setColor('#FFA500')
      .setTimestamp();
    
    potentialDuplicates.slice(0, 10).forEach((dup, index) => {
      embed.addFields({
        name: `Doublon #${index + 1} (${Math.round(dup.similarity * 100)}% similaire)`,
        value: `1: ${dup.player1.vrchatName} (ID: ${dup.player1.vrchatID})\n2: ${dup.player2.vrchatName} (ID: ${dup.player2.vrchatID})`
      });
    });
    
    return interaction.reply({ embeds: [embed] });
  },
};

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
