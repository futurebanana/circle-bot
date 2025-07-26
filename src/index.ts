import 'dotenv/config';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    Interaction,
    ModalBuilder,
    REST,
    Routes,
    SlashCommandBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    GuildMember,
    UserSelectMenuBuilder,
    Message,
    Collection,
    APIEmbedField,
    MessageFlags,
} from 'discord.js';
import logger from './logger/index';
import { capitalize } from './helpers/capitalize';
import {
    DECISION_EMBED_NEXT_ACTION_DATE,
    DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE,
    DECISION_EMBED_AUTHOR,
    DECISION_EMBED_ORIGINAL_AGENDA_TYPE,
    DECISION_EMBED_ORIGINAL_TITLE,
    DECISION_EMBED_ORIGINAL_DESCRIPTION,
    DECISION_EMBED_OUTCOME,
    DECISION_EMBED_PARTICIPANTS,
    DECISION_PROMPT,
    DecisionMeta,
    NormalizedEmbedData,
    DecisionAlignmentData,
    CircleConfig,
} from './types';
import { timestampToSnowflake } from './helpers/snowFlake';
import { Admin, Backlog, Help, Kunja, Decision } from './handlers';
import { Discord } from './handlers/Discord';
import { OpenAIInteractions } from './helpers/openai';
// for config.ts
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

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
const testGuildId = process.env.TEST_GUILD_ID;
const meetingDurationSec = process.env.MEETING_DURATION_SEC || '10800'; // default 3 hours
const messageHistoryLimitSec = parseInt(process.env.MESSAGE_HISTORY_LIMIT_SEC || '604800', 10); // default 7 days
const postProcessIntervalSec = parseInt(process.env.POST_PROCESS_INTERVAL_SEC || '60', 10); // default 60 seconds
const queueNextActionIntervalSec = parseInt(process.env.QUEUE_NEXT_ACTION_INTERVAL_SEC || '60', 10); // default 60 seconds
const visionChannelId = process.env.VISION_CHANNEL_ID;
const handbookChannelId = process.env.HANDBOOK_CHANNEL_ID;
const postDaysBeforeDueDate = parseInt(process.env.POST_DAYS_BEFORE_DUE_DATE || '7', 10); // default 7 days

if (!token) throw new Error('BOT_TOKEN missing in .env');
if (!openaiKey) throw new Error('OPENAI_API_KEY missing in .env');
if (!decisionChannelId) throw new Error('DECISION_CHANNEL_ID missing in .env');
if (!meetingDurationSec) throw new Error('MEETING_DURATION_SEC missing in .env');
if (!visionChannelId) throw new Error('VISION_CHANNEL_ID missing in .env');
if (!handbookChannelId) throw new Error('HANDBOOK_CHANNEL_ID missing in .env');
if (!postDaysBeforeDueDate) throw new Error('POST_DAYS_BEFORE_DUE_DATE missing in .env');

function parseDuration(duration: string): number {
    const num = parseInt(duration, 10);
    if (isNaN(num) || num <= 0) {
        throw new Error(`Invalid meeting duration: ${duration}`);
    }
    return num * 1000; // convert seconds to milliseconds
}

type MeetingState = { participants: string[]; expires: number };
const meetings: Record<string, MeetingState | undefined> = {};
const MEETING_DURATION_MS = parseDuration(meetingDurationSec);

// Queue with messages to follow up on when next_action_date is reached
const nextActionQueue: Array<{ messageId: string; backlogChannelId: string }> = [];

function getMeeting(circle: string): MeetingState | undefined {
    // Log amount of meetings started
    logger.info({ circle, meetingsCount: Object.keys(meetings).length }, 'Checking meeting state for circle');
    const m = meetings[circle];
    if (m && m.expires > Date.now()) return m;
    delete meetings[circle];
    return undefined;
}

export const circles: Record<string, CircleConfig> = yaml.load(
    fs.readFileSync(path.resolve(__dirname, process.env.CONFIG_FILE_PATH || "../src/config/circles.yaml"), "utf8")
) as Record<string, CircleConfig>;

const backlogChannelIds = new Set(Object.values(circles).map(c => c.backlogChannelId));

// Helper: map backlogChannelId → circle name (or undefined)
export function backlogChannelToCircle(channelId: string): string | undefined {
    return Object.entries(circles).find(([, cfg]) => cfg.backlogChannelId === channelId)?.[0];
}

/**
 * Returns true if the invoking member has ANY of the roleIds.
 * Adds verbose logging so you can see what’s happening.
 */
function memberHasAnyRole(
    interaction: ChatInputCommandInteraction,
    roleIds: string[],
): boolean {
    const member = interaction.member as GuildMember | null;
    if (!member) {
        logger.warn(
            {
                user: interaction.user.id,
                where: interaction.channelId,
            },
            'member object is null -- did you enable GUILD_MEMBERS intent?',
        );
        return false;
    }

    const memberRoles = new Set<string>(
        // .roles is a GuildMemberRoleManager
        member.roles.cache.map((r) => r.id),
    );

    logger.info(
        {
            user: interaction.user.id,
            needed: roleIds,
            has: Array.from(memberRoles),
        },
        'Doing role check',
    );

    return roleIds.some((id) => memberRoles.has(id));
}

// ────────────────────────────────────────────────────────────────────────────
// External clients
// ────────────────────────────────────────────────────────────────────────────
Discord.init(
    new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    }),
    decisionChannelId,
    visionChannelId,
    handbookChannelId,
    new OpenAIInteractions(openaiKey!)
);
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Slash‑command registration data
// ────────────────────────────────────────────────────────────────────────────
const commands = [

    // new admin commands for updating meta tags in decision embeds
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Administrative commands')
        .addSubcommand(sub =>
            sub
                // /admin change_meta <messageId> <method:insert|update|delete> <field> <value>
                .setName('change_meta')
                .setDescription('Change a meta field in a decision embed')
                .addStringOption(opt =>
                    opt
                        .setName('message_id')
                        .setDescription('The message ID of the decision embed to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('method')
                        .setDescription('Insert, update or delete a field')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('field')
                        .setDescription('The meta field to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('value')
                        .setDescription('The new value for the field')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                // /admin change_embed <messageId> <method:insert|update|delete> <field> <value>
                .setName('change_embed')
                .setDescription('Change a meta field in a decision embed')
                .addStringOption(opt =>
                    opt
                        .setName('message_id')
                        .setDescription('The message ID of the decision embed to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('method')
                        .setDescription('Insert, update or delete a field')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('field')
                        .setDescription('The meta field to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('value')
                        .setDescription('The new value for the field')
                        .setRequired(true)
                )
        ),

    // New Command for searching through the Vision and Handbook channels
    new SlashCommandBuilder()
        .setName('kunja')
        .setDescription('Søg igennem Kunjas Vision og Håndbog')
        .addStringOption(opt =>
            opt
                .setName('spørgsmål')
                .setDescription('Dit søge-spørgsmål')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('hjælp')
        .setDescription('Vis en oversigt over, hvordan du bruger cirkel botten'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows an overview of how to use the circle bot'),

    new SlashCommandBuilder()
        .setName('møde')
        .setDescription('Mødeforløb-kommandoer')
        .addSubcommand(sub =>
            sub
                .setName('start')
                .setDescription('Start et nyt møde og vælg deltagere')
        )
        .addSubcommand(sub =>
            sub
                .setName('deltagere')
                .setDescription('Ændre deltagere for det igangværende møde')
        ),

    new SlashCommandBuilder()
        .setName('ny')
        .setDescription('Opret et nyt mødepunkt i cirklens backlog')
        .addStringOption(opt =>
            opt
                .setName('type')
                .setDescription('Backlog type')
                .setRequired(true)
                .addChoices(
                    { name: 'beslutning', value: 'beslutning' },
                    { name: 'undersøgelse', value: 'undersøgelse' },
                    { name: 'orientering', value: 'orientering' },
                )
        ),

    new SlashCommandBuilder()
        .setName('cirkler')
        .setDescription('cirkel kommandoer')
        .addSubcommand(sub => sub.setName('vis').setDescription('Vis cirkler og deres medlemmer')),

    new SlashCommandBuilder()
        .setName('beslutninger')
        .setDescription('Beslutnings-kommandoer')
        .addSubcommand(sub =>
            sub
                .setName('søg')
                .setDescription('Søg i beslutnings-arkivet')
                .addStringOption(opt =>
                    opt
                        .setName('spørgsmål')
                        .setDescription('Dit søge-spørgsmål')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('opfølgning')
                .setDescription('Vis alle beslutninger med ubehandlede opfølgningsdatoer')
        ),

    // … evt. andre single commands du stadig beholder …
].map(cmd => cmd.toJSON());

// ────────────────────────────────────────────────────────────────────────────
// Interaction dispatcher
// ────────────────────────────────────────────────────────────────────────────
Discord.client.on('interactionCreate', async (interaction: Interaction) => {

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
                    const decisionHandler = new Decision();
                    return await decisionHandler.ask(interaction);
                case 'opfølgning':
                    const backlog = new Backlog();
                    return await backlog.queueList(interaction, messageHistoryLimitSec);
            }
        }

        if (commandName === 'admin') {
            const sub = interaction.options.getSubcommand();
            const adminHandler = new Admin();
            switch (sub) {
                case 'change_meta':
                    return await adminHandler.meta(interaction);
                case 'change_embed':
                    return await adminHandler.embed(interaction);
            }
        }

        switch (interaction.commandName) {
            case 'kunja':
                const kunja = new Kunja();
                return await kunja.ask(interaction);
                break;
            case 'hjælp':
            case 'help':
                const help = new Help();
                await help.help(interaction);
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

async function handleChangeMembers(i: ChatInputCommandInteraction) {

    const circleName = backlogChannelToCircle(i.channelId);

    if (!circleName) {
        return i.reply({ content: '⚠️ Denne kommando skal bruges i en backlog-kanal.', flags: MessageFlags.Ephemeral });
    }
    const meeting = getMeeting(circleName);
    if (!meeting) {
        return i.reply({ content: '🚫 Ingen igangværende møde at ændre deltagere på.', flags: MessageFlags.Ephemeral });
    }

    const picker = new UserSelectMenuBuilder()
        .setCustomId(`updateParticipants|${circleName}`)
        .setPlaceholder('Vælg nye mødedeltagere…')
        .setMinValues(1)
        .setMaxValues(12);

    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker);
    await i.reply({
        content: 'Hvem skal deltage i det igangværende møde nu?',
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

Discord.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserSelectMenu()) return;
    if (!interaction.customId.startsWith('updateParticipants|')) return;

    const [, circleName] = interaction.customId.split('|');
    const ids = interaction.values as string[];

    const meeting = getMeeting(circleName);
    if (!meeting) {
        return interaction.reply({
            content: '🚫 Ingen igangværende møde at ændre deltagere på.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // Update the stored meeting participants and reset the timer if you like
    meetings[circleName] = {
        participants: ids,
        expires: Date.now() + MEETING_DURATION_MS,
    };

    const mentions = ids.map(id => `<@${id}>`).join(', ');
    await interaction.update({
        content: `✅ Deltagere opdateret: ${mentions}`,
        components: [],
    });
});



// ────────────────────────────────────────────────────────────────────────────
// /circles list implementation
// ────────────────────────────────────────────────────────────────────────────
async function handleCircleList(i: ChatInputCommandInteraction) {
    const guild = i.guild;
    if (!guild) {
        return i.reply({ content: '⚠️  Command must be used inside a guild.', flags: MessageFlags.Ephemeral });
    }

    // Make sure role & member caches are fresh
    await guild.roles.fetch();
    await guild.members.fetch();

    const blocks: string[] = [];

    for (const [slug, cfg] of Object.entries(circles)) {
        /* ✏️  Roles (as mentions) */
        const roleMentions = cfg.writerRoleIds
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean)
            .map(r => `<@&${r!.id}>`)
            .join(', ') || '—';

        /* 👤  Members who hold ANY of those roles */
        const writers = guild.members.cache
            .filter(m => m.roles.cache.hasAny(...cfg.writerRoleIds))
            .map(m => `${m.user.username} (<@${m.user.id}>)`)     // name + clickable mention
            .slice(0, 25);                                       // avoid giant walls of text

        const writerLine = writers.length ? writers.join(', ') : '—';

        blocks.push(
            `• **${slug}** – <#${cfg.backlogChannelId}>\n` +
            `   ✏️ Roller: ${roleMentions}\n` +
            `   👤 Medlemmer (${writers.length}): ${writerLine}`,
        );
    }

    await i.reply({ content: blocks.join('\n\n'), flags: MessageFlags.Ephemeral });
}

async function handleNew(interaction: ChatInputCommandInteraction) {
    const circleName = backlogChannelToCircle(interaction.channelId);
    if (!circleName) {
        await interaction.reply({
            content: `⚠️  This command only works inside a backlog channel (circles: ${Object.keys(circles).join(', ')}).`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const circleCfg = circles[circleName];
    if (!memberHasAnyRole(interaction, circleCfg.writerRoleIds)) {
        await interaction.reply({
            content: '🚫 Du har kun læse-adgang til denne cirkel. Kontakt en admin for skrivetilladelse.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const agendaType = interaction.options.getString('type', true);

    const modal = new ModalBuilder().setTitle(`Nyt mødepunkt til ${circleName}`).setCustomId(`backlogModal|${circleName}|${agendaType}`);

    const headline = new TextInputBuilder()
        .setCustomId('headline')
        .setLabel('Overskrift')
        .setPlaceholder('Kort titel…')
        .setMinLength(5)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    const agenda = new TextInputBuilder()
        .setCustomId('agenda')
        .setLabel('Beskrivelse')
        .setPlaceholder('Beskriv dit forslag konkret og tydeligt…')
        .setRequired(true)
        .setMaxLength(1500)
        .setMinLength(10)
        .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(headline),
        new ActionRowBuilder<TextInputBuilder>().addComponents(agenda),
    );

    await interaction.showModal(modal);
}

Discord.client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isModalSubmit()) return;

    const [prefix, circleName, agendaType] = interaction.customId.split('|');
    if (prefix !== 'backlogModal') return;

    logger.info({ prefix, agendaType, circleName }, 'Handling backlog modal submission');

    // Check if the modal is being used in a backlog channel
    if (backlogChannelToCircle(interaction.channelId || '') !== circleName) {
        await interaction.reply({ content: '⚠️  This modal can only be used in a backlog channel.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (!circleName) {
        await interaction.reply({ content: '⚠️  This modal can only be used in a backlog channel.', flags: MessageFlags.Ephemeral });
        return;
    }
    const circleCfg = circles[circleName];

    if (!circleCfg) {
        await interaction.reply({ content: '⚠️  Unknown circle in modal.', flags: MessageFlags.Ephemeral });
        return;
    }

    const channel = (await Discord.client.channels.fetch(circleCfg.backlogChannelId)) as TextChannel | null;
    if (!channel) {
        await interaction.reply({ content: '⚠️  Backlog channel not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    const headline = interaction.fields.getTextInputValue('headline');
    const agenda = interaction.fields.getTextInputValue('agenda');

    const embed = new EmbedBuilder()
        .setTitle('Nyt punkt til husmøde')
        .setColor(circleCfg.embedColor)
        .setTimestamp(new Date())
        .setAuthor({ name: interaction.member?.user.username ?? 'Anon' })
        .setThumbnail(interaction.user.displayAvatarURL() ?? '')
        .addFields(
            { name: 'Cirkel', value: circleName, inline: true },
            { name: 'Forfatter', value: `<@${interaction.user.id}>`, inline: true },
            { name: DECISION_EMBED_ORIGINAL_AGENDA_TYPE, value: agendaType, inline: true },
            { name: 'Overskrift', value: headline, inline: false },
            { name: 'Beskrivelse', value: agenda, inline: false },
        );

    const saveBtn = new ButtonBuilder()
        .setCustomId('saveDecision')
        .setLabel('Gem i beslutninger')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(saveBtn);

    const msg = await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `Piv! Dit mødepunkt er gemt i <#${circleCfg.backlogChannelId}>`, flags: MessageFlags.Ephemeral });
    logger.info({ id: msg.id, circle: circleName }, '📌 New backlog item posted');
});

Discord.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserSelectMenu() || !interaction.customId.startsWith('pickParticipants|'))
        return;

    const [, circleName] = interaction.customId.split('|');
    const ids = interaction.values as string[];

    meetings[circleName] = {
        participants: ids,
        expires: Date.now() + MEETING_DURATION_MS,
    };

    const mentions = ids.map(id => `<@${id}>`).join(', ');
    await interaction.update({
        content: `🟢 Mødet er startet. Deltagere: ${mentions}`,
        components: [],
    });
});

Discord.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('meetingOutcomeModal|'))
        return;

    const [, circleName, backlogMsgId, rawParticipants] = interaction.customId.split('|');
    const participantIds = rawParticipants.split(',');

    const udfald = interaction.fields.getTextInputValue('udfald');
    const agendaType = interaction.fields.getTextInputValue('agendaType');
    const ansvarlig = interaction.fields.getTextInputValue('ansvarlig');
    const nextDate = interaction.fields.getTextInputValue('opfoelgningsDato');
    const assist = interaction.fields.getTextInputValue('assist').toLowerCase() === 'ja';

    const circleCfg = circles[circleName];

    if (!circleCfg) {
        await interaction.reply({ content: '⚠️  Unknown circle in modal.', flags: MessageFlags.Ephemeral });
        return;
    }

    logger.debug({ circleCfg, backlogMsgId }, 'Kunja: Fetching original backlog embed');
    const backlogChannel = await Discord.client.channels.fetch(circleCfg.backlogChannelId) as TextChannel;
    let originalHeadline = '–';
    let originalDesc = '–';
    try {
        const backlogMsg = await backlogChannel.messages.fetch(backlogMsgId);
        const origEmbed = backlogMsg.embeds[0];
        originalHeadline = origEmbed.fields.find(f => f.name === 'Overskrift')?.value ?? originalHeadline;
        originalDesc = origEmbed.fields.find(f => f.name === 'Beskrivelse')?.value ?? originalDesc;

    } catch (err) {
        logger.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke hente backlog-embed');
    }

    // 4) Build decision embed
    const authorMention = `<@${interaction.user.id}>`;
    const participantsMentions = participantIds.map(id => `<@${id}>`).join(', ');

    let meta_data: DecisionMeta = {
        post_process: assist,
        post_processed_error: false,
        backlog_channelId: backlogChannel.id,
    };

    const embed = new EmbedBuilder()
        .setTitle(capitalize(agendaType))
        .setColor(circleCfg.embedColor || 0x3498db)
        .setTimestamp(new Date())
        .addFields(
            { name: 'Cirkel', value: circleName, inline: true },
            { name: DECISION_EMBED_AUTHOR, value: authorMention, inline: true },
            { name: DECISION_EMBED_ORIGINAL_AGENDA_TYPE, value: agendaType, inline: true },
            { name: DECISION_EMBED_ORIGINAL_TITLE, value: originalHeadline, inline: false },
            { name: DECISION_EMBED_ORIGINAL_DESCRIPTION, value: originalDesc, inline: false },
            { name: DECISION_EMBED_OUTCOME, value: udfald, inline: false },
            { name: DECISION_EMBED_PARTICIPANTS, value: participantsMentions, inline: false },
            ...(nextDate
                ? [{ name: DECISION_EMBED_NEXT_ACTION_DATE, value: nextDate, inline: true }]
                : []),
            ...(ansvarlig
                ? [{ name: DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE, value: ansvarlig, inline: true }]
                : []),
            {
                name: 'meta_data',
                value: JSON.stringify(meta_data),
                inline: false
            },
        );

    // 5) Send & cleanup
    const decisionsChannel = await Discord.client.channels.fetch(decisionChannelId!) as TextChannel;
    await decisionsChannel.send({ embeds: [embed] });

    // Delete original backlog message
    try {
        await backlogChannel.messages.delete(backlogMsgId);
    } catch (err) {
        logger.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke slette backlog-embed');
    }

    await interaction.reply({ content: 'Beslutning gemt og punkt fjernet ✅', flags: MessageFlags.Ephemeral });
});

async function handleStart(i: ChatInputCommandInteraction) {
    const circleName = backlogChannelToCircle(i.channelId);
    if (!circleName) {
        return i.reply({ content: '⚠️  Denne kommando skal bruges i en backlog-kanal.', flags: MessageFlags.Ephemeral });
    }

    const picker = new UserSelectMenuBuilder()
        .setCustomId(`pickParticipants|${circleName}`)
        .setPlaceholder('Vælg mødedeltagere…')
        .setMinValues(1)
        .setMaxValues(12);

    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker);
    await i.reply({ content: 'Hvem deltager i mødet?', components: [row], flags: MessageFlags.Ephemeral });
}

// ────────────────────────────────────────────────────────────────────────────
// Button handler placeholder
// ────────────────────────────────────────────────────────────────────────────
async function handleButton(inter: ButtonInteraction) {
    if (inter.customId !== 'saveDecision') return;

    const embed = inter.message.embeds[0];
    const circleName = embed?.fields.find(f => f.name === 'Cirkel')?.value;

    if (!circleName) {
        return inter.reply({ content: '⚠️  Mangler cirkel på embed.', flags: MessageFlags.Ephemeral });
    }

    const meeting = getMeeting(circleName);
    if (!meeting) {
        // No meeting: ask user to run /start
        return inter.reply({
            content: 'Ingen møde i gang – kør `/møde start` for at starte et nyt møde.',
            flags: MessageFlags.Ephemeral,
        });
    }

    // Meeting is running → show outcome-modal immediately
    const backlogMsgId = inter.message.id;
    const participantCsv = meeting.participants.join(',');
    const modal = new ModalBuilder()
        .setCustomId(`meetingOutcomeModal|${circleName}|${backlogMsgId}|${participantCsv}`)
        .setTitle('Møde – Udfald og Opfølgning');

    // your four fields (udfald, agendaType, ansvarlig, opfoelgningsDato) …
    const udfaldInput = new TextInputBuilder()
        .setCustomId('udfald')
        .setLabel('Udfald')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    // get original agendaType and prefill it
    const originalAgendaType = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_AGENDA_TYPE)?.value || 'beslutning';
    const agendaTypeInput = new TextInputBuilder()
        .setCustomId('agendaType')
        .setLabel('Agenda-type')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(originalAgendaType);
    const ansvarligInput = new TextInputBuilder()
        .setCustomId('ansvarlig')
        .setLabel('Ansvarlig (valgfri)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
    const opfoelgningsDatumInput = new TextInputBuilder()
        .setCustomId('opfoelgningsDato')
        .setLabel('Næste opfølgningsdato (valgfri)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);
    const assistInput = new TextInputBuilder()
        .setCustomId('assist')
        .setLabel('Lad botten hjælpe (ja/nej)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ja eller nej—lad stå tomt for nej')
        .setValue('ja')
        .setRequired(false);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(udfaldInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(agendaTypeInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(ansvarligInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(opfoelgningsDatumInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(assistInput),
    );

    await inter.showModal(modal);
}

// ────────────────────────────────────────────────────────────────────────────
// Once the bot is ready, register (or update) commands
// ────────────────────────────────────────────────────────────────────────────
Discord.client.once('ready', async () => {

    logger.info(`🤖 Logged in as ${Discord.client.user?.tag}`);
    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (testGuildId) {
            await rest.put(
                Routes.applicationGuildCommands(Discord.client.application!.id, testGuildId),
                { body: commands }
            );
            logger.info('✅ Guild‑scoped commands registered');
        }

        // // fetch all global commands
        // const existing = await rest.get(Routes.applicationCommands(client.application!.id)) as any[];
        // for (const cmd of existing) {
        //     logger.info(`Found global command: ${cmd.name} (${cmd.id})`);

        //     logger.info(`Deleting old global command: ${cmd.name}`);
        //     await rest.delete(Routes.applicationCommand(client.application!.id, cmd.id));
        // }

    } catch (err) {
        logger.error('❌ Failed to register slash‑commands', err);
    }

    /**
     * Load all messages from decision channel that has a meta_data field next_action_date and next_action_date_handled = false and add them to a global queue to be processed.
     */
    setInterval(async () => {
        try {
            logger.info('Checking for decision messages with next_action_date to put in queue');
            let channel: TextChannel;
            try {
                channel = await Discord.client.channels.fetch(decisionChannelId!) as TextChannel;
            } catch (err) {
                logger.error({ err }, '❌ Could not fetch decision channel');
                return false;
            }
            const historyLimitMs = messageHistoryLimitSec * 1000;
            const searchStamp = Date.now() - historyLimitMs;
            const snowflake = timestampToSnowflake(searchStamp);

            // Get all messages the past week using Discords snowflake timestamp
            // https://discord.com/developers/docs/reference#snowflakes
            // Fetch messages older than messageHistoryLimitSec
            let allMessages: Collection<string, Message>;
            try {
                allMessages = await channel.messages.fetch({ limit: 100, after: snowflake });
            } catch (err) {
                logger.error({ err }, '❌ Could not fetch messages');
                return false;
            }


            // Get all messages that has the next_action_date_handled field is not set
            const decisionMessages = allMessages.filter(m =>
                m.embeds.length > 0 &&
                m.embeds[0].fields.some(f => f.name === 'meta_data')
                && (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).next_action_date_handled === false ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).next_action_date_handled === 'false')
            );

            logger.info(`Found ${decisionMessages.size} decision messages with meta_data the past ${messageHistoryLimitSec} seconds and next_action_date_handled to put in queue`);
            for (const msg of Array.from(decisionMessages.values())) {

                // Check if message is already in the queue
                if (nextActionQueue.some(item => item.messageId === msg.id)) {
                    logger.info(`Message ${msg.id} is already in the queue, skipping`);
                    continue;
                }

                // get the meta_data field backlog_channelId
                const metaField = msg.embeds[0].fields.find(f => f.name === 'meta_data');
                if (!metaField) {
                    logger.warn(`Message ${msg.id} has no meta_data field, skipping`);
                    continue;
                }
                const backlog_channelId = JSON.parse(metaField.value).backlog_channelId;
                if (!backlog_channelId) {
                    logger.warn(`Message ${msg.id} has no backlog_channelId in meta_data, skipping`);
                    continue;
                }
                logger.info(`Message ${msg.id} has backlog_channelId ${backlog_channelId}, adding to queue`);
                // Add the message to the queue for processing
                nextActionQueue.push({ messageId: msg.id, backlogChannelId: backlog_channelId });

            }
        } catch (error) {
            logger.error({ error }, '❌ Failed to set up message handler');
        }
    }, 1000 * queueNextActionIntervalSec);

    /**
     * Periodically check and normalize decision messages
     */
    setInterval(async () => {
        try {

            logger.info('Checking for decision messages to normalize…');

            let channel: TextChannel;
            try {
                channel = await Discord.client.channels.fetch(decisionChannelId!) as TextChannel;
            } catch (err) {
                logger.error({ err }, '❌ Could not fetch decision channel');
                return false;
            }

            const historyLimitMs = messageHistoryLimitSec * 1000;
            const searchStamp = Date.now() - historyLimitMs;
            const snowflake = timestampToSnowflake(searchStamp);

            // Get alle messages the past week using Discords snowflake timestamp
            // https://discord.com/developers/docs/reference#snowflakes
            // Fetch messages older than messageHistoryLimitSec
            let allMessages: Collection<string, Message>;
            try {
                allMessages = await channel.messages.fetch({ limit: 100, after: snowflake });
            } catch (err) {
                logger.error({ err }, '❌ Could not fetch messages');
                return false;
            }

            // Get all messages that has the meta_data field post_processed_time != null
            const decisionMessages = allMessages.filter(m =>
                m.embeds.length > 0 &&
                m.embeds[0].fields.some(f => f.name === 'meta_data') &&
                JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_process === true &&
                (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_processed_time == '' ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_processed_time == null ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_processed_time === undefined)
            );

            logger.info(`Found ${decisionMessages.size} decision messages with meta_data the past ${messageHistoryLimitSec} seconds to check for normalization`);

            for (const msg of Array.from(decisionMessages.values())) {
                await normalizeMessage(msg);
            }
        } catch (error) {
            logger.error({ error }, '❌ Failed to set up message handler');
        }
    }, 1000 * postProcessIntervalSec);

    /**
    * Periodically check decisions for post_alignment
    */
    setInterval(async () => {
        try {

            logger.info('Checking for decision messages to align…');

            let channel: TextChannel;
            try {
                channel = await Discord.client.channels.fetch(decisionChannelId!) as TextChannel;
            } catch (err) {
                logger.error({ err }, '❌ Could not fetch decision channel');
                return false;
            }

            const historyLimitMs = messageHistoryLimitSec * 1000;
            const searchStamp = Date.now() - historyLimitMs;
            const snowflake = timestampToSnowflake(searchStamp);

            // Get alle messages the past week using Discords snowflake timestamp
            // https://discord.com/developers/docs/reference#snowflakes
            // Fetch messages older than messageHistoryLimitSec
            let allMessages: Collection<string, Message>;
            try {
                allMessages = await channel.messages.fetch({ limit: 100, after: snowflake });
            } catch (err) {
                logger.error({ err }, '❌ Could not fetch messages');
                return false;
            }

            // Get all messages that has the meta_data field post_alignment = true and post_alignment_time == null
            const decisionMessages = allMessages.filter(m =>
                m.embeds.length > 0 &&
                m.embeds[0].fields.some(f => f.name === 'meta_data') &&
                (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment === true || JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment === 'true') &&
                (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment_time == '' ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment_time == null ||
                    JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment_time === undefined)
            );

            logger.info(`Found ${decisionMessages.size} decision messages to check for alignment`);

            for (const msg of Array.from(decisionMessages.values())) {
                await alignDecisionWithVisionAndHandbook(msg);
            }
        } catch (error) {
            logger.error({ error }, '❌ Failed to set up message handler');
        }
    }, 1000 * postProcessIntervalSec);

});

async function alignDecisionWithVisionAndHandbook(msg: Message): Promise<void> {

    const embed = msg.embeds[0];
    const metaField = embed.fields.find(f => f.name === 'meta_data')!;
    let meta: any;
    try {
        meta = JSON.parse(metaField.value);
    } catch (err) {
        logger.warn({ err, msgId: msg.id, raw: metaField.value }, 'Invalid JSON in meta_data');
        return;
    }

    // Check post_alignment flag from meta_data
    if (meta.post_alignment && (meta.post_alignment_time == '' || meta.post_alignment_time == null || meta.post_alignment_time === undefined)) {

        // Get all embed fields name/value pairs to a JSON array
        const embedFields: APIEmbedField[] = msg.embeds[0].fields.map((f: APIEmbedField) => ({
            name: f.name,
            value: f.value,
        }));

        // Removed the meta_data field from embedFields. AI should not change this.
        embedFields.splice(embedFields.findIndex(f => f.name === 'meta_data'), 1);

        // Get vision and handbook messages as archives for OpenAI
        const kunja = new Kunja();
        const visionArchive = await kunja.getMessagesAsArchive(visionChannelId!);
        const handbookArchive = await kunja.getMessagesAsArchive(handbookChannelId!);

        let alignmentData: DecisionAlignmentData = await Discord.openai.alignDecisionWithOpenAI(embedFields, visionArchive, handbookArchive);

        if (alignmentData.should_raise_objection) {
            // Try/catch to check for raising an objection.
            try {
                logger.info({ alignmentData }, `Auto-aligned decision ${msg.id} → ${JSON.stringify(alignmentData)}`);
                logger.info(`✅ Applied alignment to decision ${msg.id}`);
            } catch (err) {
                logger.error({ err, msgId: msg.id }, '❌ Failed to align decision');
                // Set meta_data to mark as processed
                meta.post_alignment_error = true;
                meta.post_alignment_time = new Date().toISOString();
                metaField.value = JSON.stringify(meta);
                await msg.edit({ embeds: [embed] });
            }

        } else {
            // Set meta_data to mark as processed
            meta.post_alignment_time = new Date().toISOString();
            metaField.value = JSON.stringify(meta);
            await msg.edit({ embeds: [embed] });
        }

        return;
    }

    return;
}

async function normalizeMessage(msg: Message): Promise<APIEmbedField[] | boolean> {

    const embed = msg.embeds[0];
    const metaField = embed.fields.find(f => f.name === 'meta_data')!;
    let meta: any;
    try {
        meta = JSON.parse(metaField.value);
    } catch (err) {
        logger.warn({ err, msgId: msg.id, raw: metaField.value }, 'Invalid JSON in meta_data');
        return false;
    }

    // Check processed flag from meta_data
    if (meta.post_process && (meta.post_processed_time == '' || meta.post_processed_time == null || meta.post_processed_time === undefined)) {

        // Get all embed fields name/value pairs to a JSON array
        const embedFields: APIEmbedField[] = msg.embeds[0].fields.map((f: APIEmbedField) => ({
            name: f.name,
            value: f.value,
        }));

        // Removed the meta_data field from embedFields. AI should not change this.
        embedFields.splice(embedFields.findIndex(f => f.name === 'meta_data'), 1);

        let normalizedEmbedData: NormalizedEmbedData = await Discord.openai.normalizeEmbedDataWithOpenAI(embedFields);

        // Check JSON diff between normalizedEmbedData and original embedFields
        logger.info({ normalizedEmbedData, embedFields }, `Checking if normalization is needed for message ${msg.id}`);
        if (!normalizedEmbedData.post_processed_error && JSON.stringify(normalizedEmbedData) !== JSON.stringify(embedFields)) {
            // Try/catch to apply normalization.
            try {
                logger.info(`Auto-normalized decision ${msg.id} → ${JSON.stringify(normalizedEmbedData)}`);
                await Discord.openai.applyNormalization(msg, JSON.stringify(normalizedEmbedData), normalizedEmbedData.post_process_changes, normalizedEmbedData.post_processed_error);
                logger.info(`✅ Applied normalization to message ${msg.id}`);
            } catch (err) {
                logger.error({ err, msgId: msg.id }, '❌ Failed to apply normalization');
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

    logger.info('Checking next action queue for due decisions…');
    const now = Date.now();

    const decisionsChannel = await Discord.client.channels.fetch(decisionChannelId!) as TextChannel;

    // drain backwards so splice() is safe
    for (let idx = nextActionQueue.length - 1; idx >= 0; idx--) {

        logger.info(`Checking decision ${nextActionQueue[idx].messageId} in backlog channel ${nextActionQueue[idx].backlogChannelId}`);
        const { messageId, backlogChannelId } = nextActionQueue[idx];

        let decisionMsg;
        try {
            decisionMsg = await decisionsChannel.messages.fetch(messageId);
        } catch {
            logger.warn(`Could not fetch decision ${messageId}, dropping from queue`);
            nextActionQueue.splice(idx, 1);
            continue;
        }

        const embed = decisionMsg.embeds[0];
        const metaField = embed.fields.find(f => f.name === 'meta_data');

        if (!metaField) {
            logger.warn(`Decision ${messageId} missing meta_data, dropping`);
            nextActionQueue.splice(idx, 1);
            continue;
        }

        let meta: DecisionMeta;
        try {
            logger.info(`Parsing meta_data for decision ${messageId} with meta_field.value: ${metaField.value}`);
            meta = JSON.parse(metaField.value);
        } catch (err) {
            logger.warn({ err, raw: metaField.value }, `Bad JSON in meta_data for ${messageId}`);
            nextActionQueue.splice(idx, 1);
            continue;
        }

        logger.debug({ messageId, meta }, `Checking next action date for decision ${messageId}`);

        if (!meta.next_action_date || (meta.next_action_date_handled === true || meta.next_action_date_handled === 'true')) {
            // either no date or already done
            logger.debug(`Decision ${messageId} has no next action date or already handled, removing from queue`);
            nextActionQueue.splice(idx, 1);
            continue;
        }

        const due = new Date(meta.next_action_date).getTime()
        const windowMs = 1000 * 60 * 60 * 24 * postDaysBeforeDueDate
        const threshold = due - windowMs  // “7 days before due”

        logger.info(
            `Decision ${messageId} is due at ${new Date(due).toISOString()}, ` +
            `processing once we pass ${new Date(threshold).toISOString()} ` +
            `(leeway of ${postDaysBeforeDueDate} days)`
        )

        if (now < threshold) {
            logger.debug(`…too far out, skipping until closer to due date.`);
            continue;
        }

        const headline = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_TITLE)?.value || '–';
        const agenda = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_DESCRIPTION)?.value || '–';
        const agendaType = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_AGENDA_TYPE)?.value || 'beslutning';
        const authorMention = embed.fields.find(f => f.name === DECISION_EMBED_AUTHOR)?.value || `<@${Discord.client.user?.id}>`;
        const outcome = embed.fields.find(f => f.name === DECISION_EMBED_OUTCOME)?.value || '–';

        const circleName = backlogChannelToCircle(backlogChannelId);
        if (!circleName) {
            logger.warn(`No circle found for backlog channel ${backlogChannelId}, skipping follow-up`);
            nextActionQueue.splice(idx, 1);
            continue;
        }
        const circleCfg = circles[circleName];
        if (!circleCfg) {
            logger.warn(`No circle config found for ${circleName}, skipping follow-up`);
            nextActionQueue.splice(idx, 1);
            continue;
        }

        // 1) Post a new backlog item to the circle's backlog channel
        const backlogChannel = await Discord.client.channels.fetch(backlogChannelId) as TextChannel;
        const followUpEmbed = new EmbedBuilder()
            .setTitle('Opfølgningspunkt til husmøde')
            .setColor(circleCfg.embedColor || 0x3498db)
            .setTimestamp(new Date())
            // Set bot as author
            .setAuthor({ name: Discord.client.user?.username ?? 'Kunja Hasselmus' })
            .setFooter({ text: 'Automatisk opfølgning på beslutning' })
            .setThumbnail(Discord.client.user?.displayAvatarURL() ?? '')
            // Get fields from original embed
            .addFields(
                { name: 'Cirkel', value: circleName, inline: true },
                { name: 'Forfatter', value: authorMention, inline: true },
                { name: DECISION_EMBED_ORIGINAL_AGENDA_TYPE, value: agendaType, inline: true },
                { name: 'Overskrift', value: headline, inline: false },
                { name: 'Beskrivelse', value: agenda, inline: false },
                { name: 'Sidste udfald', value: outcome, inline: false },
            );

        const saveBtn = new ButtonBuilder()
            .setCustomId('saveDecision')
            .setLabel('Gem i beslutninger')
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(saveBtn);

        try {

            // Always mark as handled so if error occurs we dont spam the backlog channel
            meta.next_action_date_handled = true;
            metaField.value = JSON.stringify(meta);

            await decisionMsg.edit({ embeds: [embed] });
            logger.info(`Marked next_action_date_handled=true for ${messageId}`);

            await backlogChannel.send({ embeds: [followUpEmbed], components: [row] });
            logger.info(`Posted follow-up for ${messageId} to ${backlogChannelId}`);

        } catch (err) {
            logger.error({ err, messageId }, 'Failed to post or mark follow-up');
        }

        // remove from queue
        nextActionQueue.splice(idx, 1);
    }
}, 1000 * queueNextActionIntervalSec);

// ────────────────────────────────────────────────────────────────────────────
Discord.client.login(token);
// ────────────────────────────────────────────────────────────────────────────
