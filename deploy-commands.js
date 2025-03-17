const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  
  if ('data' in command) {
    commands.push(command.data.toJSON());
  } else {
    console.log(`[AVERTISSEMENT] La commande à ${filePath} manque la propriété "data".`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    // Étape 1 : Supprimer toutes les commandes globales
    console.log('Suppression des commandes globales...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    );
    console.log('Commandes globales supprimées.');

    // Étape 2 : Supprimer toutes les commandes du serveur
    console.log('Suppression des commandes du serveur...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );
    console.log('Commandes du serveur supprimées.');

    // Attendre un peu pour s'assurer que les suppressions sont prises en compte
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Étape 3 : Déployer les nouvelles commandes sur le serveur
    console.log(`Déploiement de ${commands.length} commandes sur le serveur...`);
    const data = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log(`${data.length} commandes déployées avec succès!`);
  } catch (error) {
    console.error(error);
  }
})();