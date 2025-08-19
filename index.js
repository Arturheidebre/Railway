const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { google } = require("googleapis");

// Tokens aus Environment Variablen
const TOKEN = process.env.DISCORD_TOKEN;
const YT_API_KEY = process.env.YT_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID; // deine Bot-Application-ID

// Discord Client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// YouTube API
const youtube = google.youtube({
  version: "v3",
  auth: YT_API_KEY,
});

// --- Slash Command registrieren ---
const commands = [
  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Überwacht einen YouTube-Kanal und zeigt die neuesten Videos an")
    .addStringOption(option =>
      option.setName("url")
        .setDescription("YouTube Kanal URL (z.B. https://youtube.com/@ArtendoYT)")
        .setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Slash-Commands werden registriert...");
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Slash-Commands registriert!");
  } catch (err) {
    console.error(err);
  }
})();

// --- Helper: Kanal-ID holen ---
async function getChannelIdFromUrl(url) {
  if (url.includes("/channel/")) {
    return url.split("/channel/")[1];
  } else if (url.includes("/@")) {
    const username = url.split("/@")[1];
    const res = await youtube.search.list({
      part: "snippet",
      type: "channel",
      q: username,
      maxResults: 1,
    });
    return res.data.items[0]?.snippet.channelId || null;
  }
  return null;
}

// --- Helper: neuestes Video holen ---
async function getLatestVideo(channelId) {
  const res = await youtube.search.list({
    part: "snippet",
    channelId: channelId,
    order: "date",
    maxResults: 1,
  });

  if (res.data.items.length > 0) {
    const video = res.data.items[0];
    return {
      title: video.snippet.title,
      url: "https://youtu.be/" + video.id.videoId,
    };
  }
  return null;
}

// --- Bot Ready ---
client.once("ready", () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
});

// --- Slash-Command Handler ---
client.on("interactionCreate", async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === "channel") {
    const url = interaction.options.getString("url");

    await interaction.reply(`🔎 Suche Kanal für: ${url} ...`);

    const channelId = await getChannelIdFromUrl(url);
    if (!channelId) return interaction.followUp("❌ Konnte keine Kanal-ID finden!");

    const video = await getLatestVideo(channelId);
    if (video) {
      interaction.followUp(`📺 Neuestes Video: **${video.title}**\n${video.url}`);
    } else {
      interaction.followUp("❌ Keine Videos gefunden.");
    }
  }
});

client.login(TOKEN);


