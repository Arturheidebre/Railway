const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, PermissionsBitField
} = require("discord.js");
const { google } = require("googleapis");

// Tokens aus Environment Variablen
const TOKEN = process.env.DISCORD_TOKEN;
const YT_API_KEY = process.env.YT_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;

// Discord Client
const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMessageReactions
]});

// YouTube API
const youtube = google.youtube({ version: "v3", auth: YT_API_KEY });

// --- Slash Command registrieren ---
const commands = [
  new SlashCommandBuilder()
    .setName("channel")
    .setDescription("Überwacht einen YouTube-Kanal und zeigt die neuesten Videos an")
    .addStringOption(option =>
      option.setName("url")
        .setDescription("YouTube Kanal URL")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("setuproles")
    .setDescription("Erstellt Reaction Roles GUI für Admins"),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Löscht eine bestimmte Anzahl Nachrichten (nur für Admins)")
    .addIntegerOption(option =>
      option.setName("anzahl")
        .setDescription("Wie viele Nachrichten sollen gelöscht werden?")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Slash-Commands werden registriert...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash-Commands registriert!");
  } catch (err) {
    console.error(err);
  }
})();

// ------------------- Reaction Roles Speicher -------------------
const reactionRoles = {}; // messageId -> { emoji: roleId }

// ------------------- Bot Ready -------------------
client.once("ready", async () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);
  setInterval(checkAllChannels, 30000); // alle 30 Sekunden
});

// ------------------- Kanal-Registrierung -------------------
const registeredChannels = {}; 
// Format: { youtubeChannelId: { textChannelId: string, lastVideoId: string } }

// ------------------- Slash-Command Handler -------------------
client.on("interactionCreate", async interaction => {
  if (interaction.isCommand()) {
    // YouTube-Command
    if (interaction.commandName === "channel") {
      const url = interaction.options.getString("url");
      const textChannelId = interaction.channel.id; // automatisch aktueller Channel
      await interaction.reply({ content: `🔎 Suche Kanal für: ${url} ...`, ephemeral: true });

      const channelId = await getChannelIdFromUrl(url);
      if (!channelId) return interaction.followUp("❌ Konnte keine Kanal-ID finden!");

      const video = await getLatestVideo(channelId);
      if (video) {
        registeredChannels[channelId] = {
          textChannelId,
          lastVideoId: video.url
        };
        const channel = await client.channels.fetch(textChannelId);
        channel.send(`@Benachrichtigungen 📺 Neuestes Video: **${video.title}**\n${video.url}`);
        interaction.followUp(`✅ Kanal registriert und Video gepostet in <#${textChannelId}>`);
      } else {
        interaction.followUp("❌ Keine Videos gefunden.");
      }
    }

    // Reaction Roles Setup
    if (interaction.commandName === "setuproles") {
      const modal = new ModalBuilder()
        .setCustomId("roleSetupModal")
        .setTitle("Reaction Roles Setup");

      const input = new TextInputBuilder()
        .setCustomId("roleCount")
        .setLabel("Wie viele Rollen willst du vergeben?")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Zahl eingeben")
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
    }

    // Clear Command
    if (interaction.commandName === "clear") {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return interaction.reply({ content: "❌ Du hast keine Rechte, Nachrichten zu löschen!", ephemeral: true });
      }

      const anzahl = interaction.options.getInteger("anzahl");
      if (anzahl < 1 || anzahl > 100) {
        return interaction.reply({ content: "❌ Bitte eine Zahl zwischen 1 und 100 eingeben.", ephemeral: true });
      }

      try {
        const deleted = await interaction.channel.bulkDelete(anzahl, true);
        await interaction.reply({ content: `✅ ${deleted.size} Nachrichten wurden gelöscht.`, ephemeral: true });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: "❌ Fehler beim Löschen der Nachrichten.", ephemeral: true });
      }
    }
  }

  // Modal Submit
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "roleSetupModal") {
    const count = parseInt(interaction.fields.getTextInputValue("roleCount"));
    if (isNaN(count) || count < 1) return interaction.reply({ content: "Ungültige Zahl!", ephemeral: true });

    const roles = interaction.guild.roles.cache
      .filter(r => !r.managed && r.name !== "@everyone")
      .map(r => ({ label: r.name, value: r.id }))
      .slice(0, 25);

    const rows = [];
    for (let i = 0; i < count; i++) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`roleSelect_${i}_${interaction.user.id}`)
        .setPlaceholder(`Rolle ${i + 1} auswählen`)
        .addOptions(roles);
      rows.push(new ActionRowBuilder().addComponents(menu));
    }

    await interaction.reply({ content: "Wähle Rollen aus:", components: rows, ephemeral: true });
  }

  // Select Menu Handler
  if (interaction.isStringSelectMenu()) {
    const [prefix, index, adminId] = interaction.customId.split("_");
    if (prefix !== "roleSelect") return;

    const roleId = interaction.values[0];
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role || !member) return;

    member.roles.add(role).catch(console.error);
    await interaction.reply({ content: `✅ Rolle ${role.name} vergeben!`, ephemeral: true });
  }
});

// ------------------- YouTube Helper Funktionen -------------------
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
  return { title: video.snippet.title, url: "https://youtu.be/" + video.id.videoId };
}

// ------------------- Überprüfung aller registrierten Kanäle -------------------
async function checkAllChannels() {
  for (const channelId in registeredChannels) {
    const { textChannelId, lastVideoId } = registeredChannels[channelId];
    const newVideo = await getLatestVideo(channelId);
    if (!newVideo) continue;
    if (newVideo.url !== lastVideoId) {
      registeredChannels[channelId].lastVideoId = newVideo.url;
      const channel = await client.channels.fetch(textChannelId);
      channel.send(`@Benachrichtigungen 📺 Neues Video/Stream/Short: **${newVideo.title}**\n${newVideo.url}`);
    }
  }
}

// ------------------- Bot Login -------------------
client.login(TOKEN);
