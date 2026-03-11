import http from 'http';
import "dotenv/config";
import { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  EmbedBuilder,
  Events
} from "discord.js";

// --- Global Error Handlers ---
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// --- Startup Logging ---
console.log("=== Bot Starting ===");
console.log("DISCORD_TOKEN exists:", !!process.env.DISCORD_TOKEN);
console.log("CLIENT_ID exists:", !!process.env.CLIENT_ID);
console.log("PORT:", process.env.PORT || 8080);

// --- Web Server for Render (Prevents Port Timeout) ---
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write('Bot is alive');
  res.end();
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// --- Fuzzy Search Logic ---
function getSimilarity(s1, s2) {
    let longer = s1.length < s2.length ? s2 : s1;
    let shorter = s1.length < s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;

    const editDistance = (a, b) => {
        const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
        for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= a.length; i++) {
            for (let j = 1; j <= b.length; j++) {
                matrix[i][j] = a[i - 1] === b[j - 1] 
                    ? matrix[i - 1][j - 1] 
                    : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
            }
        }
        return matrix[a.length][b.length];
    };
    return (longer.length - editDistance(longer, shorter)) / parseFloat(longer.length);
}

// --- Dictionary Fetcher ---
async function fetchWordDefinition(searchWord) {
  try {
    const response = await fetch("https://edoamalang.github.io/dictionary/dictionary-en.json");
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const dictionaryData = await response.json();

    const normalize = (str) => 
      str.toLowerCase()
         .normalize("NFD")
         .replace(/[\u0300-\u036f]/g, "")
         .replace(/[ķǩ]/g, 'k').replace(/ż/g, 'z')
         .replace(/ģ/g, 'g').replace(/ž/g, 'z')
         .replace(/â/g, 'a');

    const query = normalize(searchWord.trim());
    let bestMatchKey = null;
    let highestScore = 0;

    for (const key of Object.keys(dictionaryData)) {
      const score = getSimilarity(query, normalize(key));
      if (score > highestScore) {
        highestScore = score;
        bestMatchKey = key;
      }
    }

    if (bestMatchKey && highestScore > 0.6) {
      const entry = dictionaryData[bestMatchKey];
      return {
        displayWord: bestMatchKey,
        ipa: entry.ipa || "N/A",
        pos: entry.pos || "N/A",
        definition: entry.meaning
      };
    }
    return null;
  } catch (error) {
    console.error("Dictionary fetch error:", error);
    return null;
  }
}

// --- Command Registration ---
const commands = [
  new SlashCommandBuilder()
    .setName("dict")
    .setDescription("Search for a word in the Edôâma dictionary")
    .addStringOption(option =>
      option.setName("word")
        .setDescription("The word to look up")
        .setRequired(true)
    )
    .setContexts([0, 1, 2]) // Contexts: Guilds, DMs, Group DMs
    .setIntegrationTypes([0, 1]), // Install types: Guild (Server) and User
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// --- Discord Client Events ---
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot Logged in as ${client.user.tag}`);
  
  // Register commands after bot is ready
  try {
    console.log("Registering slash commands...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registered successfully.");
  } catch (error) {
    console.error("❌ Failed to register commands:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "dict") {
    const word = interaction.options.getString("word");
    console.log(`Looking up word: ${word}`);
    
    await interaction.deferReply();
    
    const entry = await fetchWordDefinition(word);
    
    if (entry) {
      const embed = new EmbedBuilder()
        .setColor(0x2563eb)
        .setTitle(entry.displayWord)
        .setDescription(`*${entry.pos}*\n**IPA:** ${entry.ipa}\n\n${entry.definition}\n\n**[View Full Dictionary](https://edoamalang.github.io/dictionary/dictionary-en.json)**`);
      
      await interaction.editReply({ embeds: [embed] });
      console.log(`✅ Sent definition for: ${entry.displayWord}`);
    } else {
      await interaction.editReply(`Word "${word}" not found.`);
      console.log(`❌ Word not found: ${word}`);
    }
  }
});

// --- Additional Client Events for Debugging ---
client.on('error', error => {
  console.error('Discord client error:', error);
});

client.on('warn', info => {
  console.warn('Discord client warning:', info);
});

client.on('debug', info => {
  console.log('Discord debug:', info);
});

// --- Login ---
console.log("Attempting to login to Discord...");
console.log("Token length:", process.env.DISCORD_TOKEN?.length || 0);
console.log("Token starts with:", process.env.DISCORD_TOKEN?.substring(0, 10) || 'MISSING');

client.login(process.env.DISCORD_TOKEN)
  .then(() => {
    console.log("✅ Login promise resolved, waiting for ready event...");
  })
  .catch(error => {
    console.error("❌ Failed to login:", error);
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    process.exit(1);
  });
