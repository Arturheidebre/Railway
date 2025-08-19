const fs = require("fs");
const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} = require("discord.js");
const { google } = require("googleapis");

// Tokens aus Environment Variablen
const TOKEN = process.env.DISCORD_TOKEN;
const YT_API_KEY = process.env.YT_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Discord Client
const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions
]});

// YouTube API
const youtube = google.youtube({ version: "v3", auth: YT_API_KEY });

// --- Lokaler Speicher für Kanäle ---
const DATA_FILE = "channels.json";
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "{}");
let registeredChannels = JSON.parse(fs.readFileSync(DATA_FILE));

// --- Helper zum Speichern ---
function saveChannels() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(registeredChannels, null, 2));
}

// --- Slash Commands ---
const commands = [
  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Überwacht einen YouTube-Kanal und postet neue Videos hier")
    .addStringOption(option =>
      option.setName("url")
        .setDescription("YouTube Kanal URL (z.B. https://youtube.com/@ArtendoYT)")
        .setRequired(true)
    ),
  // deine anderen Commands (setuproles, clear) bleiben
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Slash-Commands registriert!");
  } catch (err) {
    console.error(err);
  }
})();

// ------------------- Bot Ready -------------------
client.once("ready", () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
});

// ------------------- Slash-Command Handler -------------------
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === "channel") {
    const url = interaction.options.getString("url");
    await interaction.reply(`🔎 Suche Kanal für: ${url} ...`);

    const channelId = await getChannelIdFromUrl(url);
    if (!channelId) return interaction.followUp("❌ Konnte keine Kanal-ID finden!");

    // Hier merken: Discord-Channel-ID + YouTube-Kanal-ID
    registeredChannels[channelId] = {
      discordChannelId: interaction.channel.id,
      lastVideo: null
    };
    saveChannels();

    interaction.followUp(`✅ Kanal gespeichert! Neue Videos von **${url}** werden hier gepostet.`);
  }
});

// --- YouTube Helper ---
async function getChannelIdFromUrl(url) {
  if (url.includes("/channel/")) return url.split("/channel/")[1];
  if (url.includes("/@")) {
    const username = url.split("/@")[1];
    const res = await youtube.search.list({ part: "snippet", type: "channel", q: username, maxResults: 1 });
    return res.data.items[0]?.snippet.channelId || null;
  }
  return null;
}

async function getLatestVideo(channelId) {
  const res = await youtube.search.list({ part: "snippet", channelId, order: "date", maxResults: 1 });
  if (res.data.items.length === 0) return null;
  const video = res.data.items[0];
  return { id: video.id.videoId, title: video.snippet.title, url: "https://youtu.be/" + video.id.videoId };
}

// --- Check Funktion ---
async function checkYouTube() {
  for (const [ytChannelId, info] of Object.entries(registeredChannels)) {
    const latest = await getLatestVideo(ytChannelId);
    if (!latest) continue;

    if (info.lastVideo !== latest.id) {
      const discordChannel = client.channels.cache.get(info.discordChannelId);
      if (discordChannel) {
        discordChannel.send(`📢 Neues Video: **${latest.title}**\n${latest.url}`);
        registeredChannels[ytChannelId].lastVideo = latest.id;
        saveChannels();
      }
    }
  }
}

// alle 30 Sekunden prüfen
setInterval(checkYouTube, 30 * 1000);

// ------------------- Bot Login -------------------
client.login(TOKEN);
