"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const discord_js_1 = require("discord.js");
const openai_1 = __importDefault(require("openai"));
const index_1 = __importDefault(require("./logger/index"));
const openai_2 = require("./helpers/openai");
const capitalize_1 = require("./helpers/capitalize");
const DecisionMeta_1 = require("./types/DecisionMeta");
const snowFlake_1 = require("./helpers/snowFlake");
/**
 * Kunja bot – /hello, /ask, /new, /circles list (multi‑circle backlog) in TypeScript.
 *
 * Required .env keys
 *   BOT_TOKEN                – Discord bot token
 *   OPENAI_API_KEY           – OpenAI key
 *   DECISION_CHANNEL_ID      – Channel that stores decision embeds (shared)
 *   CIRCLES=economy:111111111111111111,main:222222222222222222
 *       ↳ comma‑separated list of slug:backlogChannelId pairs
 * Optional
 *   TEST_GUILD_ID            – Guild ID for instant slash‑command updates
 */
// ────────────────────────────────────────────────────────────────────────────
// Environment checks
// ────────────────────────────────────────────────────────────────────────────
const token = process.env.BOT_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;
const decisionChannelId = process.env.DECISION_CHANNEL_ID;
const circlesEnv = process.env.CIRCLES; // e.g. "economy:111,main:222"
const testGuildId = process.env.TEST_GUILD_ID;
const meetingDurationSec = process.env.MEETING_DURATION_SEC || '10800'; // default 3 hours
const messageHistoryLimitSec = parseInt(process.env.MESSAGE_HISTORY_LIMIT_SEC || '604800', 10); // default 7 days
const postProcessIntervalSec = parseInt(process.env.POST_PROCESS_INTERVAL_SEC || '60', 10); // default 60 seconds
const queueNextActionIntervalSec = parseInt(process.env.QUEUE_NEXT_ACTION_INTERVAL_SEC || '60', 10); // default 60 seconds
const visionChannelId = process.env.VISION_CHANNEL_ID;
const handbookChannelId = process.env.HANDBOOK_CHANNEL_ID;
// Convert to type ColorMap
const colorMap = {
    økonomi: 0x27ae60, // green
    kunja: 0x3498db, // blue
};
if (!token)
    throw new Error('BOT_TOKEN missing in .env');
if (!openaiKey)
    throw new Error('OPENAI_API_KEY missing in .env');
if (!decisionChannelId)
    throw new Error('DECISION_CHANNEL_ID missing in .env');
if (!circlesEnv)
    throw new Error('CIRCLES missing in .env');
if (!meetingDurationSec)
    throw new Error('MEETING_DURATION_SEC missing in .env');
if (!visionChannelId)
    throw new Error('VISION_CHANNEL_ID missing in .env');
if (!handbookChannelId)
    throw new Error('HANDBOOK_CHANNEL_ID missing in .env');
function parseDuration(duration) {
    const num = parseInt(duration, 10);
    if (isNaN(num) || num <= 0) {
        throw new Error(`Invalid meeting duration: ${duration}`);
    }
    return num * 1000; // convert seconds to milliseconds
}
const meetings = {};
const MEETING_DURATION_MS = parseDuration(meetingDurationSec);
// Queue with messages to follow up on when next_action_date is reached
const nextActionQueue = [];
function getMeeting(circle) {
    const m = meetings[circle];
    if (m && m.expires > Date.now())
        return m;
    delete meetings[circle];
    return undefined;
}
const circles = circlesEnv.split(',').reduce((acc, entry) => {
    const [alias, chanId, roles] = entry.split(':');
    if (!alias || !chanId || !roles) {
        throw new Error(`Invalid CIRCLES entry "${entry}". Expected slug:channelId:roleId[…].`);
    }
    // Take color from colorMap
    acc[alias.trim()] = {
        backlogChannelId: chanId.trim(),
        writerRoleIds: roles.split('+').map(r => r.trim()),
        circleAlias: alias.trim(),
        color: colorMap[alias.trim()] || 0x999999, // default to gray if not found
    };
    return acc;
}, {});
const backlogChannelIds = new Set(Object.values(circles).map(c => c.backlogChannelId));
// Helper: map channelId → circle slug (or undefined)
function channelToCircle(channelId) {
    return Object.entries(circles).find(([, cfg]) => cfg.backlogChannelId === channelId)?.[0];
}
/**
 * Returns true if the invoking member has ANY of the roleIds.
 * Adds verbose logging so you can see what’s happening.
 */
function memberHasAnyRole(interaction, roleIds) {
    const member = interaction.member;
    if (!member) {
        index_1.default.warn({
            user: interaction.user.id,
            where: interaction.channelId,
        }, 'member object is null -- did you enable GUILD_MEMBERS intent?');
        return false;
    }
    const memberRoles = new Set(
    // .roles is a GuildMemberRoleManager
    member.roles.cache.map((r) => r.id));
    index_1.default.info({
        user: interaction.user.id,
        needed: roleIds,
        has: Array.from(memberRoles),
    }, 'Doing role check');
    return roleIds.some((id) => memberRoles.has(id));
}
// ────────────────────────────────────────────────────────────────────────────
// External clients
// ────────────────────────────────────────────────────────────────────────────
const openai = new openai_1.default({ apiKey: openaiKey });
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
    ]
});
// ────────────────────────────────────────────────────────────────────────────
// Slash‑command registration data
// ────────────────────────────────────────────────────────────────────────────
const commands = [
    // new admin commands for updating meta tags in decision embeds
    new discord_js_1.SlashCommandBuilder()
        .setName('admin')
        .setDescription('Administrative commands')
        .addSubcommand(sub => sub
        // /admin change_meta <messageId> <method:insert|update|delete> <field> <value>
        .setName('change_meta')
        .setDescription('Change a meta field in a decision embed')
        .addStringOption(opt => opt
        .setName('message_id')
        .setDescription('The message ID of the decision embed to change')
        .setRequired(true))
        .addStringOption(opt => opt
        .setName('method')
        .setDescription('Insert, update or delete a field')
        .setRequired(true))
        .addStringOption(opt => opt
        .setName('field')
        .setDescription('The meta field to change')
        .setRequired(true))
        .addStringOption(opt => opt
        .setName('value')
        .setDescription('The new value for the field')
        .setRequired(true)))
        .addSubcommand(sub => sub
        // /admin change_embed <messageId> <method:insert|update|delete> <field> <value>
        .setName('change_embed')
        .setDescription('Change a meta field in a decision embed')
        .addStringOption(opt => opt
        .setName('message_id')
        .setDescription('The message ID of the decision embed to change')
        .setRequired(true))
        .addStringOption(opt => opt
        .setName('method')
        .setDescription('Insert, update or delete a field')
        .setRequired(true))
        .addStringOption(opt => opt
        .setName('field')
        .setDescription('The meta field to change')
        .setRequired(true))
        .addStringOption(opt => opt
        .setName('value')
        .setDescription('The new value for the field')
        .setRequired(true))),
    // New Command for searching through the Vision and Handbook channels
    new discord_js_1.SlashCommandBuilder()
        .setName('kunja')
        .setDescription('Søg igennem Kunjas Vision og Håndbog')
        .addStringOption(opt => opt
        .setName('spørgsmål')
        .setDescription('Dit søge-spørgsmål')
        .setRequired(true)),
    new discord_js_1.SlashCommandBuilder()
        .setName('hjælp')
        .setDescription('Vis en oversigt over, hvordan du bruger cirkel botten'),
    new discord_js_1.SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows an overview of how to use the circle bot'),
    new discord_js_1.SlashCommandBuilder()
        .setName('møde')
        .setDescription('Mødeforløb-kommandoer')
        .addSubcommand(sub => sub
        .setName('start')
        .setDescription('Start et nyt møde og vælg deltagere'))
        .addSubcommand(sub => sub
        .setName('deltagere')
        .setDescription('Ændre deltagere for det igangværende møde')),
    new discord_js_1.SlashCommandBuilder()
        .setName('ny')
        .setDescription('Opret et nyt mødepunkt i cirklens backlog')
        .addStringOption(opt => opt
        .setName('type')
        .setDescription('Backlog type')
        .setRequired(true)
        .addChoices({ name: 'beslutning', value: 'beslutning' }, { name: 'undersøgelse', value: 'undersøgelse' }, { name: 'orientering', value: 'orientering' })),
    new discord_js_1.SlashCommandBuilder()
        .setName('cirkler')
        .setDescription('cirkel kommandoer')
        .addSubcommand(sub => sub.setName('vis').setDescription('Vis cirkler og deres medlemmer')),
    new discord_js_1.SlashCommandBuilder()
        .setName('beslutninger')
        .setDescription('Beslutnings-kommandoer')
        .addSubcommand(sub => sub
        .setName('søg')
        .setDescription('Søg i beslutnings-arkivet')
        .addStringOption(opt => opt
        .setName('spørgsmål')
        .setDescription('Dit søge-spørgsmål')
        .setRequired(true)))
        .addSubcommand(sub => sub
        .setName('opfølgning')
        .setDescription('Vis alle beslutninger med ubehandlede opfølgningsdatoer')),
    // … evt. andre single commands du stadig beholder …
].map(cmd => cmd.toJSON());
// ────────────────────────────────────────────────────────────────────────────
// /kø implementation: list queued next‐action decisions
// ────────────────────────────────────────────────────────────────────────────
async function handleQueueList(i) {
    const channel = await client.channels.fetch(decisionChannelId);
    const historyLimitMs = messageHistoryLimitSec * 1000;
    const afterSF = (0, snowFlake_1.timestampToSnowflake)(Date.now() - historyLimitMs);
    // fetch recent decisions
    const all = await channel.messages.fetch({ limit: 100, after: afterSF });
    const queued = all.filter(msg => {
        if (!msg.embeds.length)
            return false;
        const md = msg.embeds[0].fields.find(f => f.name === 'meta_data');
        if (!md)
            return false;
        try {
            const meta = JSON.parse(md.value);
            return !!meta.next_action_date && (meta.next_action_date_handled === false || meta.next_action_date_handled === 'false');
        }
        catch {
            return false;
        }
    });
    if (!queued.size) {
        return i.reply({ content: '✅ Ingen beslutninger i køen lige nu.', flags: discord_js_1.MessageFlags.Ephemeral });
    }
    // build lines
    const guildId = i.guildId;
    const lines = Array.from(queued.values()).map((msg, idx) => {
        const embed = msg.embeds[0];
        const dateField = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_NEXT_ACTION_DATE);
        const respField = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE);
        const titleField = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_ORIGINAL_TITLE);
        const date = dateField?.value ?? '–';
        const resp = respField?.value ? ` (Ansvarlig: ${respField.value})` : '';
        const title = titleField?.value ?? 'Uden titel';
        const url = `https://discord.com/channels/${guildId}/${decisionChannelId}/${msg.id}`;
        return `**${idx + 1}.** [${title}](${url}) – ${date}${resp}`;
    });
    // paginate if needed
    const chunk = lines.slice(0, 10).join('\n');
    const more = lines.length > 10 ? `\n…og ${lines.length - 10} mere` : '';
    await i.reply({
        embeds: [
            new discord_js_1.EmbedBuilder()
                .setTitle('🗓️ Beslutninger i opfølgnings-kø')
                .setColor(0xFFA500)
                .setDescription(chunk + more)
        ],
        flags: discord_js_1.MessageFlags.Ephemeral
    });
}
// ────────────────────────────────────────────────────────────────────────────
// plug into the dispatcher
// ────────────────────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    if (interaction.commandName === 'kø') {
        await handleQueueList(interaction);
    }
});
// ────────────────────────────────────────────────────────────────────────────
// Interaction dispatcher
// ────────────────────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        if (commandName === 'møde') {
            const sub = interaction.options.getSubcommand();
            switch (sub) {
                case 'start':
                    return handleStart(interaction);
                case 'deltagere':
                    return handleChangeMembers(interaction);
            }
        }
        if (commandName === 'beslutninger') {
            const sub = interaction.options.getSubcommand();
            switch (sub) {
                case 'søg':
                    return handleAsk(interaction);
                case 'opfølgning':
                    return handleQueueList(interaction);
            }
        }
        if (commandName === 'admin') {
            const sub = interaction.options.getSubcommand();
            switch (sub) {
                case 'change_meta':
                    return handleAdminMeta(interaction);
                case 'add_embed':
                    return handleAdminEmbed(interaction);
            }
        }
        switch (interaction.commandName) {
            case 'kunja':
                await handleAskKunja(interaction);
                break;
            case 'hjælp':
            case 'help':
                await handleHelp(interaction);
                break;
            case 'ny':
                await handleNew(interaction);
                break;
            case 'cirkler':
                if (interaction.options.getSubcommand() === 'vis') {
                    await handleCircleList(interaction);
                }
                break;
        }
    }
    if (interaction.isButton()) {
        await handleButton(interaction);
    }
});
// Function to insert,delete or update embed field
async function handleAdminEmbed(interaction) {
    const messageId = interaction.options.getString('message_id', true);
    const method = interaction.options.getString('method', true);
    const field = interaction.options.getString('field', true);
    const value = interaction.options.getString('value', true);
    await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
    // 2) fetch the decision message
    let channel = await client.channels.fetch(decisionChannelId);
    if (!channel) {
        return interaction.editReply('⚠️ Kunne ikke finde #decisions-kanalen.');
    }
    let msg;
    try {
        msg = await channel.messages.fetch(messageId);
    }
    catch {
        return interaction.editReply(`⚠️ Kunne ikke finde besked med ID \`${messageId}\`.`);
    }
    const oldEmbed = msg.embeds[0];
    if (!oldEmbed) {
        return interaction.editReply('⚠️ Den målrettede besked indeholder ingen embeds.');
    }
    // Check method
    if (!['insert', 'update', 'delete'].includes(method)) {
        return interaction.editReply('⚠️ Ugyldig metode. Brug `insert`, `update` eller `delete`.');
    }
    const fields = [...oldEmbed.fields];
    if (method === 'delete') {
        const index = fields.findIndex(f => f.name === field);
        if (index === -1) {
            return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i embed.`);
        }
        fields.splice(index, 1);
        // convert the old embed into a new builder, swapping in our updated fields
        const api = oldEmbed.toJSON();
        api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
        const newEmbed = new discord_js_1.EmbedBuilder(api);
        await msg.edit({ embeds: [newEmbed] });
        await interaction.editReply(`✅ Fjernet \`${field}\` fra beslutning ${messageId}.`);
    }
    else if (method === 'update') {
        const index = fields.findIndex(f => f.name === field);
        if (index === -1) {
            return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i embed.`);
        }
        fields[index].value = value;
        // convert the old embed into a new builder, swapping in our updated fields
        const api = oldEmbed.toJSON();
        api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
        const newEmbed = new discord_js_1.EmbedBuilder(api);
        await msg.edit({ embeds: [newEmbed] });
        await interaction.editReply(`✅ Opdateret \`${field}\` i beslutning ${messageId}.`);
    }
    else if (method === 'insert') {
        const newField = {
            name: field,
            value: value,
            inline: false,
        };
        fields.push(newField);
        // convert the old embed into a new builder, swapping in our updated fields
        const api = oldEmbed.toJSON();
        api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
        const newEmbed = new discord_js_1.EmbedBuilder(api);
        await msg.edit({ embeds: [newEmbed] });
        await interaction.editReply(`✅ Tilføjet \`${field}\` til beslutning ${messageId}.`);
    }
}
/**
 * Handle admin change meta command
 * @param interaction
 * @returns
 */
async function handleAdminMeta(interaction) {
    const messageId = interaction.options.getString('message_id', true);
    const method = interaction.options.getString('method', true);
    const field = interaction.options.getString('field', true);
    const value = interaction.options.getString('value', true);
    await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
    let channel = await client.channels.fetch(decisionChannelId);
    if (!channel) {
        return interaction.editReply('⚠️ Kunne ikke finde #decisions-kanalen.');
    }
    let msg;
    try {
        msg = await channel.messages.fetch(messageId);
    }
    catch {
        return interaction.editReply(`⚠️ Kunne ikke finde besked med ID \`${messageId}\`.`);
    }
    const oldEmbed = msg.embeds[0];
    if (!oldEmbed) {
        return interaction.editReply('⚠️ Den målrettede besked indeholder ingen embeds.');
    }
    // Check method
    if (!['insert', 'update', 'delete'].includes(method)) {
        return interaction.editReply('⚠️ Ugyldig metode. Brug `insert`, `update` eller `delete`.');
    }
    const fields = [...oldEmbed.fields];
    const metaIndex = fields.findIndex(f => f.name === 'meta_data');
    if (metaIndex < 0) {
        return interaction.editReply('⚠️ Embed mangler et `meta_data`-felt.');
    }
    let meta;
    try {
        meta = JSON.parse(fields[metaIndex].value);
    }
    catch {
        return interaction.editReply('⚠️ Kunne ikke læse `meta_data` (ugyldig JSON).');
    }
    // Check method delete
    if (method === 'delete') {
        try {
            // If deleting, ensure the field exists
            if (meta[field] === undefined) {
                return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i \`meta_data\`.`);
            }
            delete meta[field];
            fields[metaIndex].value = JSON.stringify(meta);
            // convert the old embed into a new builder, swapping in our updated fields
            const api = oldEmbed.toJSON();
            api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
            const newEmbed = new discord_js_1.EmbedBuilder(api);
            await msg.edit({ embeds: [newEmbed] });
            await interaction.editReply(`✅ Fjernet \`${field}\` fra \`meta_data\` for beslutning ${messageId}.`);
        }
        catch (err) {
            index_1.default.error('Error deleting field from meta_data', err);
            const errorMsg = typeof err === 'object' && err !== null && 'message' in err ? err.message : String(err);
            return interaction.editReply(`⚠️ Fejl under sletning af felt \`${field}\`: ${errorMsg}`);
        }
    }
    else if (method === 'insert') {
        try {
            // If inserting, ensure the field is not already present
            if (meta[field] !== undefined && meta[field] !== null && meta[field] !== '') {
                index_1.default.warn({ meta }, `Field ${field} already exists in meta_data for message ${messageId}`);
                return interaction.editReply(`⚠️ Felt \`${field}\` findes allerede i \`meta_data\`.`);
            }
            // Insert field into meta_data
            meta[field] = value;
            // Update the meta_data field in the embed
            fields[metaIndex].value = JSON.stringify(meta);
            // convert the old embed into a new builder, swapping in our updated fields
            const api = oldEmbed.toJSON();
            api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
            const newEmbed = new discord_js_1.EmbedBuilder(api);
            await msg.edit({ embeds: [newEmbed] });
            await interaction.editReply(`✅ Indsat \`${field}\` i \`meta_data\` for beslutning ${messageId}.`);
        }
        catch (err) {
            index_1.default.error('Error inserting field into meta_data', err);
            const errorMsg = typeof err === 'object' && err !== null && 'message' in err ? err.message : String(err);
            return interaction.editReply(`⚠️ Fejl under indsættelse af felt \`${field}\`: ${errorMsg}`);
        }
    }
    else if (method === 'update') {
        try {
            // If updating, ensure the field exists
            if (meta[field] === undefined || meta[field] === null || meta[field] === '') {
                return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i \`meta_data\`.`);
            }
            // Update the field in meta_data
            meta[field] = value;
            fields[metaIndex].value = JSON.stringify(meta);
            // convert the old embed into a new builder, swapping in our updated fields
            const api = oldEmbed.toJSON();
            api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
            const newEmbed = new discord_js_1.EmbedBuilder(api);
            await msg.edit({ embeds: [newEmbed] });
            await interaction.editReply(`✅ Opdateret \`${field}\` i \`meta_data\` for beslutning ${messageId}.`);
        }
        catch (err) {
            index_1.default.error('Error updating field in meta_data', err);
            const errorMsg = typeof err === 'object' && err !== null && 'message' in err ? err.message : String(err);
            return interaction.editReply(`⚠️ Fejl under opdatering af felt \`${field}\`: ${errorMsg}`);
        }
    }
    return;
}
async function handleAskKunja(interaction) {
    const question = interaction.options.getString('spørgsmål', true);
    await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
    const visionMessages = await getMessagesAsArchive(visionChannelId);
    const handbookMessages = await getMessagesAsArchive(handbookChannelId);
    const texts = [...visionMessages, ...handbookMessages];
    if (texts.length === 0) {
        await interaction.editReply('No decisions found to search.');
        return;
    }
    const archive = texts.join('\n\n---\n\n');
    const messages = [
        { role: 'system', content: DecisionMeta_1.KUNJA_ASK_PROMPT },
        { role: 'user', content: `Archive:\n${archive}` },
        { role: 'user', content: question },
    ];
    try {
        index_1.default.info({ question, chars: archive.length }, '🤖 Sending Vision/Handbook question to OpenAI');
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.2,
            max_tokens: 500,
        });
        const answer = completion.choices[0].message?.content?.trim() || 'No answer generated.';
        await interaction.editReply(answer);
    }
    catch (err) {
        index_1.default.error('OpenAI error', err);
        await interaction.editReply(`OpenAI error: ${err.message ?? err}`);
    }
}
// Function to extract archive messages
async function getMessagesAsArchive(channelId) {
    const channel = (await client.channels.fetch(channelId));
    if (!channel) {
        throw new Error('Channel not found');
    }
    const texts = [];
    let lastId;
    const charBudget = 64000;
    // Go through handbook channel messages
    while (texts.join('\n').length < charBudget) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
        if (batch.size === 0)
            break;
        const sorted = Array.from(batch.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        for (const msg of sorted) {
            if (msg.embeds.length) {
                for (const e of msg.embeds) {
                    const parts = [];
                    if (e.title)
                        parts.push(`**${e.title}**`);
                    for (const field of e.fields) {
                        if (field.name.toLowerCase() !== 'meta_data')
                            parts.push(`${field.name}: ${field.value}`);
                    }
                    texts.push(parts.join('\n'));
                }
            }
            else if (msg.content) {
                texts.push(msg.content);
            }
        }
        lastId = batch.last()?.id;
        if (batch.size < 100)
            break;
    }
    return texts;
}
async function handleChangeMembers(i) {
    const circleSlug = channelToCircle(i.channelId);
    if (!circleSlug) {
        return i.reply({ content: '⚠️ Denne kommando skal bruges i en backlog-kanal.', flags: discord_js_1.MessageFlags.Ephemeral });
    }
    const meeting = getMeeting(circleSlug);
    if (!meeting) {
        return i.reply({ content: '🚫 Ingen igangværende møde at ændre deltagere på.', flags: discord_js_1.MessageFlags.Ephemeral });
    }
    const picker = new discord_js_1.UserSelectMenuBuilder()
        .setCustomId(`updateParticipants|${circleSlug}`)
        .setPlaceholder('Vælg nye mødedeltagere…')
        .setMinValues(1)
        .setMaxValues(12);
    const row = new discord_js_1.ActionRowBuilder().addComponents(picker);
    await i.reply({
        content: 'Hvem skal deltage i det igangværende møde nu?',
        components: [row],
        flags: discord_js_1.MessageFlags.Ephemeral,
    });
}
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserSelectMenu())
        return;
    if (!interaction.customId.startsWith('updateParticipants|'))
        return;
    const [, circleSlug] = interaction.customId.split('|');
    const ids = interaction.values;
    const meeting = getMeeting(circleSlug);
    if (!meeting) {
        return interaction.reply({
            content: '🚫 Ingen igangværende møde at ændre deltagere på.',
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
    }
    // Update the stored meeting participants and reset the timer if you like
    meetings[circleSlug] = {
        participants: ids,
        expires: Date.now() + MEETING_DURATION_MS,
    };
    const mentions = ids.map(id => `<@${id}>`).join(', ');
    await interaction.update({
        content: `✅ Deltagere opdateret: ${mentions}`,
        components: [],
    });
});
async function handleStart(i) {
    const circleSlug = channelToCircle(i.channelId);
    if (!circleSlug) {
        return i.reply({ content: '⚠️  Denne kommando skal bruges i en backlog-kanal.', flags: discord_js_1.MessageFlags.Ephemeral });
    }
    const picker = new discord_js_1.UserSelectMenuBuilder()
        .setCustomId(`pickParticipants|${circleSlug}`)
        .setPlaceholder('Vælg mødedeltagere…')
        .setMinValues(1)
        .setMaxValues(12);
    const row = new discord_js_1.ActionRowBuilder().addComponents(picker);
    await i.reply({ content: 'Hvem deltager i mødet?', components: [row], flags: discord_js_1.MessageFlags.Ephemeral });
}
async function handleHelp(i) {
    const helpText = `
🧀 **Kunja Hasselmus-bot – Hjælp**

Hej! Jeg er husmusen, der holder styr på møder, backlog, beslutninger og opfølgning. Her er hvad jeg kan:

### Søg i vores Vision/Håndbog med naturligt sprog.
\`\`\`
/kunja <spørgsmål>
\`\`\`
Spørg mig om vores vision, håndbog som feks hvor vaskeriet er, eller hvordan vi håndterer beslutninger. Jeg vil søge i vores Vision og Håndbog kanaler og give dig svar.
### Start et nyt møde
\`\`\`
/møde start
\`\`\`
Start et nyt møde i cirklens backlog-kanal og vælg deltagere.
### Ændre deltagerlisten for det igangværende møde.
\`\`\`
/møde deltagere
\`\`\`
### Opret et nyt mødepunkt
\`\`\`
/ny type:<beslutning|undersøgelse|orientering>
\`\`\`
Du udfylder titel og beskrivelse, og jeg poster et embed med knappen **“Gem i beslutninger”**.

### 💾 Knappen “Gem i beslutninger”
➡️ Hvis intet møde er startet, beder jeg dig køre \`/møde start\`.
➡️ Når mødet kører, kan du udfylde udfald og gemme punktet som en beslutning.

### Søg i beslutnings-arkivet med naturligt sprog.
\`\`\`
/beslutninger søg <spørgsmål>
\`\`\`
### Vis alle beslutninger med ubehandlede opfølgningsdatoer.
\`\`\`
/beslutninger opfølgning
\`\`\`
### Vis cirkler, deres backlog-kanaler, skrive-roller og aktuelle medlemmer.
\`\`\`
/cirkler vis
\`\`\`
### 🔐 Roller & rettigheder
- Kun brugere med skrive rettigheder til cirklens backlog kan oprette nye punkter.
- Alle kan læse beslutninger og følge op.
`;
    await i.reply({ content: helpText, flags: discord_js_1.MessageFlags.Ephemeral });
}
// ────────────────────────────────────────────────────────────────────────────
// /ask implementation
// ────────────────────────────────────────────────────────────────────────────
async function handleAsk(interaction) {
    const question = interaction.options.getString('spørgsmål', true);
    await interaction.deferReply({ flags: discord_js_1.MessageFlags.Ephemeral });
    const channel = (await client.channels.fetch(decisionChannelId));
    if (!channel) {
        await interaction.editReply('⚠️  Could not access the #decisions channel.');
        return;
    }
    const texts = [];
    let lastId;
    const charBudget = 12000;
    while (texts.join('\n').length < charBudget) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
        if (batch.size === 0)
            break;
        const sorted = Array.from(batch.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        for (const msg of sorted) {
            if (msg.embeds.length) {
                for (const e of msg.embeds) {
                    const parts = [];
                    if (e.title)
                        parts.push(`**${e.title}**`);
                    for (const field of e.fields) {
                        if (field.name.toLowerCase() !== 'meta_data')
                            parts.push(`${field.name}: ${field.value}`);
                    }
                    texts.push(parts.join('\n'));
                }
            }
            else if (msg.content) {
                texts.push(msg.content);
            }
        }
        lastId = batch.last()?.id;
        if (batch.size < 100)
            break;
    }
    if (texts.length === 0) {
        await interaction.editReply('No decisions found to search.');
        return;
    }
    const archive = texts.join('\n\n---\n\n');
    const messages = [
        { role: 'system', content: DecisionMeta_1.DECISION_PROMPT },
        { role: 'user', content: `Archive:\n${archive}` },
        { role: 'user', content: question },
    ];
    try {
        index_1.default.info({ question, chars: archive.length }, '🤖 Sending question to OpenAI');
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages,
            temperature: 0.2,
            max_tokens: 500,
        });
        const answer = completion.choices[0].message?.content?.trim() || 'No answer generated.';
        await interaction.editReply(answer);
    }
    catch (err) {
        index_1.default.error('OpenAI error', err);
        await interaction.editReply(`OpenAI error: ${err.message ?? err}`);
    }
}
// ────────────────────────────────────────────────────────────────────────────
// /circles list implementation
// ────────────────────────────────────────────────────────────────────────────
async function handleCircleList(i) {
    const guild = i.guild;
    if (!guild) {
        return i.reply({ content: '⚠️  Command must be used inside a guild.', flags: discord_js_1.MessageFlags.Ephemeral });
    }
    // Make sure role & member caches are fresh
    await guild.roles.fetch();
    await guild.members.fetch();
    const blocks = [];
    for (const [slug, cfg] of Object.entries(circles)) {
        /* ✏️  Roles (as mentions) */
        const roleMentions = cfg.writerRoleIds
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean)
            .map(r => `<@&${r.id}>`)
            .join(', ') || '—';
        /* 👤  Members who hold ANY of those roles */
        const writers = guild.members.cache
            .filter(m => m.roles.cache.hasAny(...cfg.writerRoleIds))
            .map(m => `${m.user.username} (<@${m.user.id}>)`) // name + clickable mention
            .slice(0, 25); // avoid giant walls of text
        const writerLine = writers.length ? writers.join(', ') : '—';
        blocks.push(`• **${slug}** – <#${cfg.backlogChannelId}>\n` +
            `   ✏️ Roller: ${roleMentions}\n` +
            `   👤 Medlemmer (${writers.length}): ${writerLine}`);
    }
    await i.reply({ content: blocks.join('\n\n'), flags: discord_js_1.MessageFlags.Ephemeral });
}
async function handleNew(interaction) {
    const circleSlug = channelToCircle(interaction.channelId);
    if (!circleSlug) {
        await interaction.reply({
            content: `⚠️  This command only works inside a backlog channel (circles: ${Object.keys(circles).join(', ')}).`,
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
        return;
    }
    const circleCfg = circles[circleSlug];
    if (!memberHasAnyRole(interaction, circleCfg.writerRoleIds)) {
        await interaction.reply({
            content: '🚫 Du har kun læse-adgang til denne cirkel. Kontakt en admin for skrivetilladelse.',
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
        return;
    }
    const agendaType = interaction.options.getString('type', true);
    const modal = new discord_js_1.ModalBuilder().setTitle(`Nyt mødepunkt til ${circleSlug}`).setCustomId(`backlogModal|${circleSlug}|${agendaType}`);
    const headline = new discord_js_1.TextInputBuilder()
        .setCustomId('headline')
        .setLabel('Overskrift')
        .setPlaceholder('Kort titel…')
        .setMinLength(5)
        .setRequired(true)
        .setStyle(discord_js_1.TextInputStyle.Short);
    const agenda = new discord_js_1.TextInputBuilder()
        .setCustomId('agenda')
        .setLabel('Beskrivelse')
        .setPlaceholder('Beskriv dit forslag konkret og tydeligt…')
        .setRequired(true)
        .setMaxLength(1500)
        .setMinLength(10)
        .setStyle(discord_js_1.TextInputStyle.Paragraph);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(headline), new discord_js_1.ActionRowBuilder().addComponents(agenda));
    await interaction.showModal(modal);
}
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit())
        return;
    const [prefix, circleSlug, agendaType] = interaction.customId.split('|');
    if (prefix !== 'backlogModal')
        return;
    const circleCfg = circles[circleSlug];
    if (!circleCfg) {
        await interaction.reply({ content: '⚠️  Unknown circle in modal.', flags: discord_js_1.MessageFlags.Ephemeral });
        return;
    }
    const channel = (await client.channels.fetch(circleCfg.backlogChannelId));
    if (!channel) {
        await interaction.reply({ content: '⚠️  Backlog channel not found.', flags: discord_js_1.MessageFlags.Ephemeral });
        return;
    }
    const headline = interaction.fields.getTextInputValue('headline');
    const agenda = interaction.fields.getTextInputValue('agenda');
    const color = colorMap[circleSlug] || 0x95a5a6; // default gray if not found
    const embed = new discord_js_1.EmbedBuilder()
        .setTitle('Nyt punkt til husmøde')
        .setColor(color)
        .setTimestamp(new Date())
        .setAuthor({ name: interaction.member?.user.username ?? 'Anon' })
        .setThumbnail(interaction.user.displayAvatarURL() ?? '')
        .addFields({ name: 'Cirkel', value: circleSlug, inline: true }, { name: 'Forfatter', value: `<@${interaction.user.id}>`, inline: true }, { name: DecisionMeta_1.DECISION_EMBED_ORIGINAL_AGENDA_TYPE, value: agendaType, inline: true }, { name: 'Overskrift', value: headline, inline: false }, { name: 'Beskrivelse', value: agenda, inline: false });
    const saveBtn = new discord_js_1.ButtonBuilder()
        .setCustomId('saveDecision')
        .setLabel('Gem i beslutninger')
        .setStyle(discord_js_1.ButtonStyle.Primary);
    const row = new discord_js_1.ActionRowBuilder().addComponents(saveBtn);
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `Piv! Dit mødepunkt er gemt i <#${circleCfg.backlogChannelId}>`, flags: discord_js_1.MessageFlags.Ephemeral });
    index_1.default.info({ id: msg.id, circle: circleSlug }, '📌 New backlog item posted');
});
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserSelectMenu() || !interaction.customId.startsWith('pickParticipants|'))
        return;
    const [, circleSlug] = interaction.customId.split('|');
    const ids = interaction.values;
    meetings[circleSlug] = {
        participants: ids,
        expires: Date.now() + MEETING_DURATION_MS,
    };
    const mentions = ids.map(id => `<@${id}>`).join(', ');
    await interaction.update({
        content: `🟢 Mødet er startet. Deltagere: ${mentions}`,
        components: [],
    });
});
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('meetingOutcomeModal|'))
        return;
    const [, circleSlug, backlogMsgId, rawParticipants] = interaction.customId.split('|');
    const participantIds = rawParticipants.split(',');
    const udfald = interaction.fields.getTextInputValue('udfald');
    const agendaType = interaction.fields.getTextInputValue('agendaType');
    const ansvarlig = interaction.fields.getTextInputValue('ansvarlig');
    const nextDate = interaction.fields.getTextInputValue('opfoelgningsDato');
    const assist = interaction.fields.getTextInputValue('assist').toLowerCase() === 'ja';
    // 2) Fetch original backlog embed to get its title+description
    const circleCfg = circles[circleSlug];
    index_1.default.info({ circleCfg, backlogMsgId }, 'Kunja: Fetching original backlog embed');
    const backlogChannel = await client.channels.fetch(circleCfg.backlogChannelId);
    let originalHeadline = '–';
    let originalDesc = '–';
    try {
        const backlogMsg = await backlogChannel.messages.fetch(backlogMsgId);
        const origEmbed = backlogMsg.embeds[0];
        originalHeadline = origEmbed.fields.find(f => f.name === 'Overskrift')?.value ?? originalHeadline;
        originalDesc = origEmbed.fields.find(f => f.name === 'Beskrivelse')?.value ?? originalDesc;
    }
    catch (err) {
        index_1.default.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke hente backlog-embed');
    }
    // 4) Build decision embed
    const authorMention = `<@${interaction.user.id}>`;
    const participantsMentions = participantIds.map(id => `<@${id}>`).join(', ');
    let meta_data = {
        post_process: assist,
        post_processed_error: false,
        backlog_channelId: backlogChannel.id,
    };
    const embed = new discord_js_1.EmbedBuilder()
        .setTitle((0, capitalize_1.capitalize)(agendaType))
        .setColor(colorMap[circleSlug])
        .setTimestamp(new Date())
        .addFields({ name: 'Cirkel', value: circleSlug, inline: true }, { name: DecisionMeta_1.DECISION_EMBED_AUTHOR, value: authorMention, inline: true }, { name: DecisionMeta_1.DECISION_EMBED_ORIGINAL_AGENDA_TYPE, value: agendaType, inline: true }, { name: DecisionMeta_1.DECISION_EMBED_ORIGINAL_TITLE, value: originalHeadline, inline: false }, { name: DecisionMeta_1.DECISION_EMBED_ORIGINAL_DESCRIPTION, value: originalDesc, inline: false }, { name: DecisionMeta_1.DECISION_EMBED_OUTCOME, value: udfald, inline: false }, { name: DecisionMeta_1.DECISION_EMBED_PARTICIPANTS, value: participantsMentions, inline: false }, ...(nextDate
        ? [{ name: DecisionMeta_1.DECISION_EMBED_NEXT_ACTION_DATE, value: nextDate, inline: true }]
        : []), ...(ansvarlig
        ? [{ name: DecisionMeta_1.DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE, value: ansvarlig, inline: true }]
        : []), {
        name: 'meta_data',
        value: JSON.stringify(meta_data),
        inline: false
    });
    // 5) Send & cleanup
    const decisionsChannel = await client.channels.fetch(decisionChannelId);
    await decisionsChannel.send({ embeds: [embed] });
    // Delete original backlog message
    try {
        await backlogChannel.messages.delete(backlogMsgId);
    }
    catch (err) {
        index_1.default.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke slette backlog-embed');
    }
    await interaction.reply({ content: 'Beslutning gemt og punkt fjernet ✅', flags: discord_js_1.MessageFlags.Ephemeral });
});
// ────────────────────────────────────────────────────────────────────────────
// Button handler placeholder
// ────────────────────────────────────────────────────────────────────────────
async function handleButton(inter) {
    if (inter.customId !== 'saveDecision')
        return;
    const embed = inter.message.embeds[0];
    const circleSlug = embed?.fields.find(f => f.name === 'Circle')?.value;
    if (!circleSlug) {
        return inter.reply({ content: '⚠️  Mangler cirkel på embed.', flags: discord_js_1.MessageFlags.Ephemeral });
    }
    const meeting = getMeeting(circleSlug);
    if (!meeting) {
        // No meeting: ask user to run /start
        return inter.reply({
            content: 'Ingen møde i gang – kør `/møde start` for at starte et nyt møde.',
            flags: discord_js_1.MessageFlags.Ephemeral,
        });
    }
    // Meeting is running → show outcome-modal immediately
    const backlogMsgId = inter.message.id;
    const participantCsv = meeting.participants.join(',');
    const modal = new discord_js_1.ModalBuilder()
        .setCustomId(`meetingOutcomeModal|${circleSlug}|${backlogMsgId}|${participantCsv}`)
        .setTitle('Møde – Udfald og Opfølgning');
    // your four fields (udfald, agendaType, ansvarlig, opfoelgningsDato) …
    const udfaldInput = new discord_js_1.TextInputBuilder()
        .setCustomId('udfald')
        .setLabel('Udfald')
        .setStyle(discord_js_1.TextInputStyle.Paragraph)
        .setRequired(true);
    // get original agendaType and prefill it
    const originalAgendaType = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_ORIGINAL_AGENDA_TYPE)?.value || 'beslutning';
    const agendaTypeInput = new discord_js_1.TextInputBuilder()
        .setCustomId('agendaType')
        .setLabel('Agenda-type')
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(true)
        .setValue(originalAgendaType);
    const ansvarligInput = new discord_js_1.TextInputBuilder()
        .setCustomId('ansvarlig')
        .setLabel('Ansvarlig (valgfri)')
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(false);
    const opfoelgningsDatumInput = new discord_js_1.TextInputBuilder()
        .setCustomId('opfoelgningsDato')
        .setLabel('Næste opfølgningsdato (valgfri)')
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setRequired(false);
    const assistInput = new discord_js_1.TextInputBuilder()
        .setCustomId('assist')
        .setLabel('Lad botten hjælpe (ja/nej)')
        .setStyle(discord_js_1.TextInputStyle.Short)
        .setPlaceholder('ja eller nej—lad stå tomt for nej')
        .setValue('ja')
        .setRequired(false);
    modal.addComponents(new discord_js_1.ActionRowBuilder().addComponents(udfaldInput), new discord_js_1.ActionRowBuilder().addComponents(agendaTypeInput), new discord_js_1.ActionRowBuilder().addComponents(ansvarligInput), new discord_js_1.ActionRowBuilder().addComponents(opfoelgningsDatumInput), new discord_js_1.ActionRowBuilder().addComponents(assistInput));
    await inter.showModal(modal);
}
// ────────────────────────────────────────────────────────────────────────────
// Once the bot is ready, register (or update) commands
// ────────────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
    index_1.default.info(`🤖 Logged in as ${client.user?.tag}`);
    const rest = new discord_js_1.REST({ version: '10' }).setToken(token);
    try {
        if (testGuildId) {
            await rest.put(discord_js_1.Routes.applicationGuildCommands(client.application.id, testGuildId), { body: commands });
            index_1.default.info('✅ Guild‑scoped commands registered');
        }
        // // fetch all global commands
        // const existing = await rest.get(Routes.applicationCommands(client.application!.id)) as any[];
        // for (const cmd of existing) {
        //     logger.info(`Found global command: ${cmd.name} (${cmd.id})`);
        //     logger.info(`Deleting old global command: ${cmd.name}`);
        //     await rest.delete(Routes.applicationCommand(client.application!.id, cmd.id));
        // }
    }
    catch (err) {
        index_1.default.error('❌ Failed to register slash‑commands', err);
    }
    /**
     * Load all messages from decision channel that has a meta_data field next_action_date and next_action_date_handled = false and add them to a global queue to be processed.
     */
    setInterval(async () => {
        try {
            index_1.default.info('Checking for decision messages with next_action_date to put in queue');
            let channel;
            try {
                channel = await client.channels.fetch(decisionChannelId);
            }
            catch (err) {
                index_1.default.error({ err }, '❌ Could not fetch decision channel');
                return false;
            }
            const historyLimitMs = messageHistoryLimitSec * 1000;
            const searchStamp = Date.now() - historyLimitMs;
            const snowflake = (0, snowFlake_1.timestampToSnowflake)(searchStamp);
            // Get all messages the past week using Discords snowflake timestamp
            // https://discord.com/developers/docs/reference#snowflakes
            // Fetch messages older than messageHistoryLimitSec
            let allMessages;
            try {
                allMessages = await channel.messages.fetch({ limit: 100, after: snowflake });
            }
            catch (err) {
                index_1.default.error({ err }, '❌ Could not fetch messages');
                return false;
            }
            // Get all messages that has the next_action_date_handled field is not set
            const decisionMessages = allMessages.filter(m => m.embeds.length > 0 &&
                m.embeds[0].fields.some(f => f.name === 'meta_data')
                && (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data').value).next_action_date_handled === false ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data').value).next_action_date_handled === 'false'));
            index_1.default.info(`Found ${decisionMessages.size} decision messages with meta_data the past ${messageHistoryLimitSec} seconds and next_action_date_handled to put in queue`);
            for (const msg of Array.from(decisionMessages.values())) {
                // Check if message is already in the queue
                if (nextActionQueue.some(item => item.messageId === msg.id)) {
                    index_1.default.info(`Message ${msg.id} is already in the queue, skipping`);
                    continue;
                }
                // get the meta_data field backlog_channelId
                const metaField = msg.embeds[0].fields.find(f => f.name === 'meta_data');
                if (!metaField) {
                    index_1.default.warn(`Message ${msg.id} has no meta_data field, skipping`);
                    continue;
                }
                const backlog_channelId = JSON.parse(metaField.value).backlog_channelId;
                if (!backlog_channelId) {
                    index_1.default.warn(`Message ${msg.id} has no backlog_channelId in meta_data, skipping`);
                    continue;
                }
                index_1.default.info(`Message ${msg.id} has backlog_channelId ${backlog_channelId}, adding to queue`);
                // Add the message to the queue for processing
                nextActionQueue.push({ messageId: msg.id, backlogChannelId: backlog_channelId });
            }
        }
        catch (error) {
            index_1.default.error({ error }, '❌ Failed to set up message handler');
        }
    }, 1000 * queueNextActionIntervalSec);
    /**
     * Periodically check and normalize decision messages
     */
    setInterval(async () => {
        try {
            index_1.default.info('Checking for decision messages to normalize…');
            let channel;
            try {
                channel = await client.channels.fetch(decisionChannelId);
            }
            catch (err) {
                index_1.default.error({ err }, '❌ Could not fetch decision channel');
                return false;
            }
            const historyLimitMs = messageHistoryLimitSec * 1000;
            const searchStamp = Date.now() - historyLimitMs;
            const snowflake = (0, snowFlake_1.timestampToSnowflake)(searchStamp);
            // Get alle messages the past week using Discords snowflake timestamp
            // https://discord.com/developers/docs/reference#snowflakes
            // Fetch messages older than messageHistoryLimitSec
            let allMessages;
            try {
                allMessages = await channel.messages.fetch({ limit: 100, after: snowflake });
            }
            catch (err) {
                index_1.default.error({ err }, '❌ Could not fetch messages');
                return false;
            }
            // Get all messages that has the meta_data field post_processed_time != null
            const decisionMessages = allMessages.filter(m => m.embeds.length > 0 &&
                m.embeds[0].fields.some(f => f.name === 'meta_data') &&
                JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data').value).post_process === true &&
                (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data').value).post_processed_time == '' ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data').value).post_processed_time == null ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data').value).post_processed_time === undefined));
            index_1.default.info(`Found ${decisionMessages.size} decision messages with meta_data the past ${messageHistoryLimitSec} seconds to check for normalization`);
            for (const msg of Array.from(decisionMessages.values())) {
                await normalizeMessage(msg);
            }
        }
        catch (error) {
            index_1.default.error({ error }, '❌ Failed to set up message handler');
        }
    }, 1000 * postProcessIntervalSec);
});
async function normalizeMessage(msg) {
    const embed = msg.embeds[0];
    const metaField = embed.fields.find(f => f.name === 'meta_data');
    let meta;
    try {
        meta = JSON.parse(metaField.value);
    }
    catch (err) {
        index_1.default.warn({ err, msgId: msg.id, raw: metaField.value }, 'Invalid JSON in meta_data');
        return false;
    }
    // Check processed flag from meta_data
    if (meta.post_process && (meta.post_processed_time == '' || meta.post_processed_time == null || meta.post_processed_time === undefined)) {
        // Get all embed fields name/value pairs to a JSON array
        const embedFields = msg.embeds[0].fields.map((f) => ({
            name: f.name,
            value: f.value,
        }));
        // Removed the meta_data field from embedFields. AI should not change this.
        embedFields.splice(embedFields.findIndex(f => f.name === 'meta_data'), 1);
        let normalizedEmbedData = await (0, openai_2.normalizeEmbedDataWithOpenAI)(embedFields);
        // Check JSON diff between normalizedEmbedData and original embedFields
        index_1.default.info({ normalizedEmbedData, embedFields }, `Checking if normalization is needed for message ${msg.id}`);
        if (!normalizedEmbedData.post_processed_error && JSON.stringify(normalizedEmbedData) !== JSON.stringify(embedFields)) {
            // Try/catch to apply normalization.
            try {
                index_1.default.info(`Auto-normalized decision ${msg.id} → ${JSON.stringify(normalizedEmbedData)}`);
                await (0, openai_2.applyNormalization)(msg, JSON.stringify(normalizedEmbedData), normalizedEmbedData.post_process_changes, normalizedEmbedData.post_processed_error);
                index_1.default.info(`✅ Applied normalization to message ${msg.id}`);
            }
            catch (err) {
                index_1.default.error({ err, msgId: msg.id }, '❌ Failed to apply normalization');
                // Set meta_data to mark as processed
                meta.post_process = true;
                meta.post_processed_time = new Date().toISOString();
                metaField.value = JSON.stringify(meta);
                await msg.edit({ embeds: [embed] });
            }
        }
        return embedFields;
    }
    return false;
}
setInterval(async () => {
    index_1.default.info('Checking next action queue for due decisions…');
    const now = Date.now();
    const decisionsChannel = await client.channels.fetch(decisionChannelId);
    // drain backwards so splice() is safe
    for (let idx = nextActionQueue.length - 1; idx >= 0; idx--) {
        index_1.default.info(`Checking decision ${nextActionQueue[idx].messageId} in backlog channel ${nextActionQueue[idx].backlogChannelId}`);
        const { messageId, backlogChannelId } = nextActionQueue[idx];
        let decisionMsg;
        try {
            decisionMsg = await decisionsChannel.messages.fetch(messageId);
        }
        catch {
            index_1.default.warn(`Could not fetch decision ${messageId}, dropping from queue`);
            nextActionQueue.splice(idx, 1);
            continue;
        }
        const embed = decisionMsg.embeds[0];
        const metaField = embed.fields.find(f => f.name === 'meta_data');
        if (!metaField) {
            index_1.default.warn(`Decision ${messageId} missing meta_data, dropping`);
            nextActionQueue.splice(idx, 1);
            continue;
        }
        let meta;
        try {
            index_1.default.info(`Parsing meta_data for decision ${messageId} with meta_field.value: ${metaField.value}`);
            meta = JSON.parse(metaField.value);
        }
        catch (err) {
            index_1.default.warn({ err, raw: metaField.value }, `Bad JSON in meta_data for ${messageId}`);
            nextActionQueue.splice(idx, 1);
            continue;
        }
        index_1.default.info({ messageId, meta }, `Checking next action date for decision ${messageId}`);
        if (!meta.next_action_date || (meta.next_action_date_handled === true || meta.next_action_date_handled === 'true')) {
            // either no date or already done
            index_1.default.info(`Decision ${messageId} has no next action date or already handled, removing from queue`);
            nextActionQueue.splice(idx, 1);
            continue;
        }
        const due = new Date(meta.next_action_date).getTime();
        index_1.default.info(`Decision ${messageId} next action date is ${new Date(due).toISOString()} (now: ${new Date(now).toISOString()})`);
        if (now < due)
            continue;
        const circleSlug = embed.fields.find(f => f.name === 'Cirkel')?.value || '–';
        const headline = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_ORIGINAL_TITLE)?.value || '–';
        const agenda = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_ORIGINAL_DESCRIPTION)?.value || '–';
        const agendaType = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_ORIGINAL_AGENDA_TYPE)?.value || 'beslutning';
        const authorMention = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_AUTHOR)?.value || `<@${client.user?.id}>`;
        const outcome = embed.fields.find(f => f.name === DecisionMeta_1.DECISION_EMBED_OUTCOME)?.value || '–';
        // 1) Post a new backlog item to the circle's backlog channel
        const backlogChannel = await client.channels.fetch(backlogChannelId);
        const followUpEmbed = new discord_js_1.EmbedBuilder()
            .setTitle('Opfølgningspunkt til husmøde')
            .setColor(colorMap[circleSlug])
            .setTimestamp(new Date())
            // Set bot as author
            .setAuthor({ name: client.user?.username ?? 'Kunja Hasselmus' })
            .setFooter({ text: 'Automatisk opfølgning på beslutning' })
            .setThumbnail(client.user?.displayAvatarURL() ?? '')
            // Get fields from original embed
            .addFields({ name: 'Cirkel', value: circleSlug, inline: true }, { name: 'Forfatter', value: authorMention, inline: true }, { name: DecisionMeta_1.DECISION_EMBED_ORIGINAL_AGENDA_TYPE, value: agendaType, inline: true }, { name: 'Overskrift', value: headline, inline: false }, { name: 'Beskrivelse', value: agenda, inline: false }, { name: 'Sidste udfald', value: outcome, inline: false });
        const saveBtn = new discord_js_1.ButtonBuilder()
            .setCustomId('saveDecision')
            .setLabel('Gem i beslutninger')
            .setStyle(discord_js_1.ButtonStyle.Primary);
        const row = new discord_js_1.ActionRowBuilder().addComponents(saveBtn);
        try {
            // Always mark as handled so if error occurs we dont spam the backlog channel
            meta.next_action_date_handled = true;
            metaField.value = JSON.stringify(meta);
            await decisionMsg.edit({ embeds: [embed] });
            index_1.default.info(`Marked next_action_date_handled=true for ${messageId}`);
            await backlogChannel.send({ embeds: [followUpEmbed], components: [row] });
            index_1.default.info(`Posted follow-up for ${messageId} to ${backlogChannelId}`);
        }
        catch (err) {
            index_1.default.error({ err, messageId }, 'Failed to post or mark follow-up');
        }
        // remove from queue
        nextActionQueue.splice(idx, 1);
    }
}, 1000 * queueNextActionIntervalSec);
// ────────────────────────────────────────────────────────────────────────────
client.login(token);
// ────────────────────────────────────────────────────────────────────────────
