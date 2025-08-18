const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

client.once("ready", () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);
});

client.on("messageCreate", msg => {
  if (msg.content === "!ping") {
    msg.reply("Pong! 🏓");
  }
});

client.login(process.env.DISCORD_TOKEN);
