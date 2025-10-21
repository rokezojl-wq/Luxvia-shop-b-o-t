import fs from 'fs';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ADMIN_ROLES = ['Admin', 'Moderator'];

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Patikrinkite .env: TOKEN, CLIENT_ID ir GUILD_ID turi būti nustatyti');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const PRODUCTS_FILE = './products.json';
let products = [];

function loadProducts() {
  try {
    products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
  } catch {
    products = [];
  }
}

function saveProducts() {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

function isAdmin(member) {
  return member.roles.cache.some(r => ADMIN_ROLES.includes(r.name));
}

// Bot ready
client.once('ready', () => {
  loadProducts();
  console.log(`Prisijungta kaip ${client.user.tag}`);
});

// Register slash commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('addproduct')
      .setDescription('Pridėti naują produktą')
      .addStringOption(o => o.setName('name').setDescription('Produkto pavadinimas').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Aprašymas').setRequired(true))
      .addNumberOption(o => o.setName('price').setDescription('Kaina').setRequired(true))
      .addIntegerOption(o => o.setName('stock').setDescription('Kiekis').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Embed spalva HEX (pvz., #00FF00)').setRequired(false))
      .addAttachmentOption(o => o.setName('image').setDescription('Produkto nuotrauka').setRequired(false)),

    new SlashCommandBuilder()
      .setName('removeproduct')
      .setDescription('Ištrinti produktą pagal pavadinimą')
      .addStringOption(o => o.setName('name').setDescription('Produkto pavadinimas').setRequired(true)),

    new SlashCommandBuilder()
      .setName('stock')
      .setDescription('Administruoti sandėlį')
      .addSubcommand(sc => sc.setName('list').setDescription('Rodyti sandėlį'))
      .addSubcommand(sc => sc.setName('add').setDescription('Papildyti sandėlį')
        .addStringOption(o => o.setName('name').setDescription('Produkto pavadinimas').setRequired(true))
        .addIntegerOption(o => o.setName('qty').setDescription('Kiekis').setRequired(true)))
      .addSubcommand(sc => sc.setName('remove').setDescription('Sumažinti sandėlį')
        .addStringOption(o => o.setName('name').setDescription('Produkto pavadinimas').setRequired(true))
        .addIntegerOption(o => o.setName('qty').setDescription('Kiekis').setRequired(true))),

    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Gauti informacija apie produktą')
      .addStringOption(o => o.setName('name').setDescription('Produkto pavadinimas').setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash komandos užregistruotos guild');
  } catch (err) {
    console.error('Klaida registruojant komandas:', err);
  }
}

// Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const member = interaction.member;
  const commandName = interaction.commandName;

  if (!isAdmin(member)) {
    return interaction.reply({ content: 'Neturite teisių naudoti šį botą', ephemeral: true });
  }

  // ---------------- /addproduct ----------------
  if (commandName === 'addproduct') {
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');
    const price = interaction.options.getNumber('price');
    const stock = interaction.options.getInteger('stock');
    const color = interaction.options.getString('color');
    const attachment = interaction.options.getAttachment('image');
    const imageUrl = attachment ? attachment.url : null;

    const channel = await interaction.guild.channels.create({
      name: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      type: 0,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: ['SendMessages'] },
        ...member.roles.cache
          .filter(r => ADMIN_ROLES.includes(r.name))
          .map(r => ({ id: r.id, allow: ['SendMessages'] }))
      ]
    });

    const embedColor = color ? color : (stock > 0 ? 'Green' : 'Red');
    const embed = new EmbedBuilder()
      .setTitle(name)
      .setDescription(description)
      .addFields(
        { name: '💰 Kaina', value: `${price} EUR` },
        { name: '📦 Statusas', value: stock > 0 ? '✅ Yra sandėlyje' : '❌ Nebėra' }
      )
      .setColor(embedColor);

    if (imageUrl) embed.setImage(imageUrl);

    const msg = await channel.send({ embeds: [embed] });

    products.push({ name, description, price, stock, channelId: channel.id, messageId: msg.id, imageUrl, embedColor });
    saveProducts();

    await interaction.reply({ content: `Produktas pridėtas: ${name}`, ephemeral: true });
    return;
  }

  // ---------------- /removeproduct ----------------
  if (commandName === 'removeproduct') {
    const name = interaction.options.getString('name');
    const index = products.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
    if (index === -1) return interaction.reply({ content: 'Produktas nerastas', ephemeral: true });

    try { await interaction.guild.channels.fetch(products[index].channelId).then(c => c.delete()); } catch {}
    products.splice(index, 1);
    saveProducts();
    return interaction.reply({ content: `Produktas ${name} ištrintas`, ephemeral: true });
  }

  // ---------------- /stock ----------------
  if (commandName === 'stock') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const lines = products.map(p => `${p.name} — ${p.stock} vnt.`);
      return interaction.reply({ content: lines.join('\n') || 'Nėra produktų', ephemeral: true });
    }

    const name = interaction.options.getString('name');
    const qty = interaction.options.getInteger('qty');
    const prod = products.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!prod) return interaction.reply({ content: 'Produktas nerastas', ephemeral: true });

    if (sub === 'add') prod.stock += qty;
    if (sub === 'remove') prod.stock = Math.max(0, prod.stock - qty);
    saveProducts();

    try {
      const channel = await interaction.guild.channels.fetch(prod.channelId);
      const message = await channel.messages.fetch(prod.messageId);
      const embed = new EmbedBuilder()
        .setTitle(prod.name)
        .setDescription(prod.description)
        .addFields(
          { name: '💰 Kaina', value: `${prod.price} EUR` },
          { name: '📦 Statusas', value: prod.stock > 0 ? '✅ Yra sandėlyje' : '❌ Nebėra' }
        )
        .setColor(prod.embedColor || (prod.stock > 0 ? 'Green' : 'Red'));
      if (prod.imageUrl) embed.setImage(prod.imageUrl);
      await message.edit({ embeds: [embed] });
    } catch {}

    return interaction.reply({ content: `Stock atnaujintas: ${prod.name} — ${prod.stock} vnt.`, ephemeral: true });
  }

  // ---------------- /info ----------------
  if (commandName === 'info') {
    const name = interaction.options.getString('name');
    const prod = products.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!prod) return interaction.reply({ content: 'Produktas nerastas', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(prod.name)
      .setDescription(prod.description)
      .addFields(
        { name: '💰 Kaina', value: `${prod.price} EUR` },
        { name: '📦 Sandėlis', value: `${prod.stock} vnt.` }
      )
      .setColor(prod.embedColor || (prod.stock > 0 ? 'Green' : 'Red'));
    if (prod.imageUrl) embed.setImage(prod.imageUrl);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

registerCommands().then(() => client.login(TOKEN));
