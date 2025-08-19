const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} = require("discord.js");
const { google } = require("googleapis");

// Tokens aus Environment Variablen
const TOKEN = process.env.DISCORD_TOKEN;
const YT_API_KEY = process.env.YT_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID; // deine Bot-Application-ID

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
        .setDescription("YouTube Kanal URL (z.B. https://youtube.com/@ArtendoYT)")
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

// ------------------- YouTube Watch Speicher -------------------
const watchedChannels = new Map(); // channelId -> lastVideoId

// ------------------- Bot Ready -------------------
client.once("ready", () => {
  console.log(`✅ Eingeloggt als ${client.user.tag}`);

  // Interval alle 30s checken
  setInterval(async () => {
    for (const [ytChannelId, data] of watchedChannels) {
      const latest = await getLatestVideo(ytChannelId);
      if (!latest) continue;

      if (latest.url !== data.lastUrl) {
        // Neues Video entdeckt
        const discordChannel = client.channels.cache.get(data.discordChannelId);
        if (discordChannel) {
          discordChannel.send(`📺 Neues Video von **${data.name}**: **${latest.title}**\n${latest.url}`);
        }
        watchedChannels.set(ytChannelId, {
          ...data,
          lastUrl: latest.url
        });
      }
    }
  }, 30_000); // 30 Sekunden
});

// ------------------- Slash-Command Handler -------------------
client.on("interactionCreate", async interaction => {
  if (interaction.isCommand()) {
    // YouTube-Command
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

      // Merken für Auto-Check
      watchedChannels.set(channelId, {
        name: url,
        discordChannelId: interaction.channel.id,
        lastUrl: video ? video.url : null
      });
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
      if (!interaction.member.permissions.has("MANAGE_MESSAGES")) {
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
      .slice(0, 25); // nur die ersten 25 Rollen nehmen

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

// --- YouTube Helper Funktionen ---
async function getChannelIdFromUrl(url) {
  if (url.includes("/channel/")) return url.split("/channel/")[1];
  if (url.includes("/@")) {
    const username = url.split("/@")[1]
