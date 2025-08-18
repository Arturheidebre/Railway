const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const Parser = require('rss-parser');
const parser = new Parser();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// ------------------- Message-Command -------------------
client.on("messageCreate", msg => {
  if (msg.content === "!ping") {
    msg.reply("Pong! 🏓");
  }
});

// ------------------- Slash-Command Setup -------------------
const registeredChannels = {}; // UserID -> YouTube URL
const notifiedVideos = new Set();

const commands = [
  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Registriert einen YouTube-Kanal für Benachrichtigungen")
    .addStringOption(option =>
      option.setName("url")
        .setDescription("Gib die YouTube-Kanal-URL ein")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once("ready", async () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);

  // Commands registrieren
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash-Commands registriert!');
  } catch (error) {
    console.error(error);
  }
});

// ------------------- Slash-Command Handling -------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "channel") {
    const url = interaction.options.getString("url");
    
    // Speichern: UserID → { url, channelId }
    registeredChannels[interaction.user.id] = {
      url: url,
      channelId: interaction.channelId
    };

    await interaction.reply(`✅ Kanal gespeichert: ${url}\nDie Ankündigungen werden hier gepostet.`);
  }
});

// ------------------- YouTube Feed prüfen -------------------
async function checkYouTube() {
  for (const [userId, info] of Object.entries(registeredChannels)) {
    const channelId = info.url.split("/").pop(); // YouTube Channel ID
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    try {
      const feed = await parser.parseURL(feedUrl);
      const latestVideo = feed.items[0];

      if (!notifiedVideos.has(latestVideo.id)) {
        const discordChannel = client.channels.cache.get(info.channelId);
        if (discordChannel) {
          discordChannel.send(`@everyone ${client.users.cache.get(userId).username} hat ein neues Video hochgeladen: ${latestVideo.link}`);
          notifiedVideos.add(latestVideo.id);
        }
      }
    } catch (err) {
      console.error("Fehler beim Abrufen des Feeds:", err);
    }
  }
}

// Alle 5 Minuten prüfen
setInterval(checkYouTube, 5 * 60 * 1000);

client.login(process.env.DISCORD_TOKEN);

