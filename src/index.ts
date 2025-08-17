import 'dotenv/config';
import {
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    Interaction,
    REST,
    Routes,
    TextChannel,
    Message,
    Collection,
    MessageFlags,
} from 'discord.js';
import logger from './logger/index';
import {
    DECISION_EMBED_AUTHOR,
    DECISION_EMBED_ORIGINAL_AGENDA_TYPE,
    DECISION_EMBED_ORIGINAL_TITLE,
    DECISION_EMBED_ORIGINAL_DESCRIPTION,
    DECISION_EMBED_OUTCOME,
    DecisionMeta,
} from './types';
import { timestampToSnowflake, OpenAIInteractions, createFollowUpMessage, createBacklogMessage, createDecisionMessage } from './helpers';
import { CircleHandler, MeetingHandler, AdminHandler, BacklogHandler, HelpHandler, KunjaHandler, DecisionHandler, DiscordHandler } from './handlers';
import { CircleService, DecisionService } from './services';
import { commands } from './commands';

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
const configFilePath = process.env.CONFIG_FILE_PATH || "../config/circles.yaml";

if (!token) throw new Error('BOT_TOKEN missing in .env');
if (!openaiKey) throw new Error('OPENAI_API_KEY missing in .env');
if (!decisionChannelId) throw new Error('DECISION_CHANNEL_ID missing in .env');
if (!meetingDurationSec) throw new Error('MEETING_DURATION_SEC missing in .env');
if (!visionChannelId) throw new Error('VISION_CHANNEL_ID missing in .env');
if (!handbookChannelId) throw new Error('HANDBOOK_CHANNEL_ID missing in .env');
if (!postDaysBeforeDueDate) throw new Error('POST_DAYS_BEFORE_DUE_DATE missing in .env');

// Queue with messages to follow up on when next_action_date is reached
const nextActionQueue: Array<{ messageId: string; backlogChannelId: string }> = [];

// ────────────────────────────────────────────────────────────────────────────
// External clients
// ────────────────────────────────────────────────────────────────────────────
DiscordHandler.init(
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
    new OpenAIInteractions(openaiKey!),
    configFilePath,
);
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Interaction dispatcher
// ────────────────────────────────────────────────────────────────────────────
DiscordHandler.client.on('interactionCreate', async (interaction: Interaction) => {

    if (interaction.isChatInputCommand()) {

        const { commandName } = interaction;

        if (commandName === 'møde') {
            const sub = interaction.options.getSubcommand();
            const meetingHandler = new MeetingHandler();
            switch (sub) {
                case 'start':
                    return meetingHandler.start(interaction);
                case 'deltagere':
                    return meetingHandler.changeMembers(interaction);
            }
        }

        if (commandName === 'beslutninger') {
            const sub = interaction.options.getSubcommand();
            switch (sub) {
                case 'søg':
                    const decisionHandler = new DecisionHandler();
                    return await decisionHandler.ask(interaction);
                case 'opfølgning':
                    const backlog = new BacklogHandler();
                    return await backlog.queueList(interaction, messageHistoryLimitSec);
            }
        }

        if (commandName === 'admin') {
            const sub = interaction.options.getSubcommand();
            const adminHandler = new AdminHandler();
            switch (sub) {
                case 'change_meta':
                    return await adminHandler.meta(interaction);
                case 'change_embed':
                    return await adminHandler.embed(interaction);
            }
        }

        switch (interaction.commandName) {
            case 'kunja':
                const kunja = new KunjaHandler();
                return await kunja.ask(interaction);
                break;
            case 'hjælp':
            case 'help':
                const help = new HelpHandler();
                await help.help(interaction);
                break;
            case 'ny':
                const backlogHandler = new BacklogHandler();
                await backlogHandler.new(interaction);
                break;
            case 'cirkler':
                if (interaction.options.getSubcommand() === 'vis') {
                    const circleHandler = new CircleHandler();
                    await circleHandler.list(interaction);
                }
                break;

        }
    }

    if (interaction.isButton()) {
        const backlogHandler = new BacklogHandler();
        await backlogHandler.save(interaction);
    }
});

DiscordHandler.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserSelectMenu()) return;
    if (!interaction.customId.startsWith('updateParticipants|')) return;

    const [, circleName] = interaction.customId.split('|');
    const ids = interaction.values as string[];

    const meeting = MeetingHandler.get(circleName);
    if (!meeting) {
        return interaction.reply({
            content: '🚫 Ingen igangværende møde at ændre deltagere på.',
            flags: MessageFlags.Ephemeral,
        });
    }

    MeetingHandler.set(circleName, ids);

    const mentions = ids.map(id => `<@${id}>`).join(', ');
    await interaction.update({
        content: `✅ Deltagere opdateret: ${mentions}`,
        components: [],
    });
});

DiscordHandler.client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isModalSubmit()) return;

    const [prefix, circleName, agendaType] = interaction.customId.split('|');
    if (prefix !== 'backlogModal') return;

    logger.info({ prefix, agendaType, circleName }, 'Handling backlog modal submission');

    const circleService = new CircleService(DiscordHandler.circleConfig);
    // Check if the modal is being used in a backlog channel
    if (circleService.backlogChannelToCircle(interaction.channelId || '') !== circleName) {
        await interaction.reply({ content: '⚠️  This modal can only be used in a backlog channel.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (!circleName) {
        await interaction.reply({ content: '⚠️  This modal can only be used in a backlog channel.', flags: MessageFlags.Ephemeral });
        return;
    }
    const circleCfg = DiscordHandler.circleConfig[circleName];

    if (!circleCfg) {
        await interaction.reply({ content: '⚠️  Unknown circle in modal.', flags: MessageFlags.Ephemeral });
        return;
    }

    const channel = (await DiscordHandler.client.channels.fetch(circleCfg.backlogChannelId)) as TextChannel | null;
    if (!channel) {
        await interaction.reply({ content: '⚠️  Backlog channel not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    const headline = interaction.fields.getTextInputValue('headline');
    const agenda = interaction.fields.getTextInputValue('agenda');

    try {
        const { embed: backlogEmbed, components } = createBacklogMessage({
            circle: circleName,
            author: interaction.member?.user.username ?? 'Anon',
            authorMention: `<@${interaction.user.id}>`,
            agendaType: agendaType,
            title: headline,
            description: agenda,
            color: circleCfg.embedColor || 0x3498db,
            timestamp: new Date(),
        });

        const msg = await channel.send({ embeds: [backlogEmbed], components });

        await interaction.reply({ content: `Piv! Dit mødepunkt er gemt i <#${circleCfg.backlogChannelId}>`, flags: MessageFlags.Ephemeral });
        logger.info({ id: msg.id, circle: circleName }, '📌 New backlog item posted');
    } catch (error) {
        logger.error({ error }, '❌ Failed to post backlog item');
        await interaction.reply({ content: '⚠️  Failed to post backlog item.', flags: MessageFlags.Ephemeral });
        return;
    }

});

DiscordHandler.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isUserSelectMenu() || !interaction.customId.startsWith('pickParticipants|'))
        return;

    const [, circleName] = interaction.customId.split('|');
    const ids = interaction.values as string[];

    MeetingHandler.set(circleName, ids);

    const mentions = ids.map(id => `<@${id}>`).join(', ');
    await interaction.update({
        content: `🟢 Mødet er startet. Deltagere: ${mentions}`,
        components: [],
    });
});

DiscordHandler.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('meetingOutcomeModal|'))
        return;

    const stateId = interaction.customId.split('|')[1];
    const state = BacklogHandler.takeOutcomeState(stateId);

    if (!state) {
        await interaction.reply({
            content: '⚠️  Formularen udløb eller kunne ikke findes. Prøv igen.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }


    const { circleName, backlogMsgId, participants } = state;

    const outcome = interaction.fields.getTextInputValue('udfald');
    const agendaType = interaction.fields.getTextInputValue('agendaType');
    const ansvarlig = interaction.fields.getTextInputValue('ansvarlig');
    const nextDate = interaction.fields.getTextInputValue('opfoelgningsDato');
    const assist = interaction.fields.getTextInputValue('assist').toLowerCase() === 'ja';

    const circleCfg = DiscordHandler.circleConfig[circleName];

    if (!circleCfg) {
        await interaction.reply({ content: '⚠️  Unknown circle in modal.', flags: MessageFlags.Ephemeral });
        return;
    }

    logger.debug({ circleCfg, backlogMsgId }, 'Kunja: Fetching original backlog embed');
    const backlogChannel = await DiscordHandler.client.channels.fetch(circleCfg.backlogChannelId) as TextChannel;
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
    const participantsMentions = participants.map(id => `<@${id}>`).join(', ');

    let meta_data: DecisionMeta = {
        post_process: assist,
        post_processed_error: false,
        backlog_channelId: backlogChannel.id,
    };

    const { embed: decisionEmbed, components } = createDecisionMessage({
        circle: circleName,
        author: DiscordHandler.client.user?.username ?? 'Kunja Hasselmus',
        authorMention: authorMention,
        participantsMentions: participantsMentions,
        agendaType: agendaType,
        title: originalHeadline,
        description: originalDesc,
        outcome: outcome,
        color: circleCfg.embedColor || 0x3498db,
        meta_data: JSON.stringify(meta_data),
        timestamp: new Date(),
        nextDate: nextDate,
        responsible: ansvarlig,
    });

    // Delete original backlog message
    try {
        const decisionsChannel = await DiscordHandler.client.channels.fetch(decisionChannelId!) as TextChannel;
        await decisionsChannel.send({ embeds: [decisionEmbed] });
        await backlogChannel.messages.delete(backlogMsgId);
    } catch (err) {
        logger.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke slette backlog-embed');
    }

    await interaction.reply({ content: 'Beslutning gemt og punkt fjernet ✅', flags: MessageFlags.Ephemeral });
});

// ────────────────────────────────────────────────────────────────────────────
// Once the bot is ready, register (or update) commands
// ────────────────────────────────────────────────────────────────────────────
DiscordHandler.client.once('ready', async () => {

    logger.info(`🤖 Logged in as ${DiscordHandler.client.user?.tag}`);
    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (testGuildId) {
            await rest.put(
                Routes.applicationGuildCommands(DiscordHandler.client.application!.id, testGuildId),
                { body: commands }
            );
            logger.info('✅ Guild‑scoped commands registered');
        }

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
                channel = await DiscordHandler.client.channels.fetch(decisionChannelId!) as TextChannel;
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
                channel = await DiscordHandler.client.channels.fetch(decisionChannelId!) as TextChannel;
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
            const decisionService = new DecisionService();
            for (const msg of Array.from(decisionMessages.values())) {
                await decisionService.normalize(msg);
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
                channel = await DiscordHandler.client.channels.fetch(decisionChannelId!) as TextChannel;
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
                (JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment === true || JSON.parse(m.embeds[0].fields.find(f => f.name === 'meta_data')!.value).post_alignment === 'true')
            );

            logger.info(`Found ${decisionMessages.size} decision messages to check for alignment`);

            const decisionService = new DecisionService();
            for (const msg of Array.from(decisionMessages.values())) {
                await decisionService.align(msg, visionChannelId, handbookChannelId);
            }
        } catch (error) {
            logger.error({ error }, '❌ Failed to set up message handler');
        }
    }, 1000 * postProcessIntervalSec);

});

setInterval(async () => {

    logger.info('Checking next action queue for due decisions…');
    const now = Date.now();

    const decisionsChannel = await DiscordHandler.client.channels.fetch(decisionChannelId!) as TextChannel;

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

        // Extract fields from embed
        const headline = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_TITLE)?.value || '–';
        const agenda = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_DESCRIPTION)?.value || '–';
        const agendaType = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_AGENDA_TYPE)?.value || 'beslutning';
        const authorMention = embed.fields.find(f => f.name === DECISION_EMBED_AUTHOR)?.value || `Ingen forfatter`;
        const outcome = embed.fields.find(f => f.name === DECISION_EMBED_OUTCOME)?.value || '–';

        const circleService = new CircleService(DiscordHandler.circleConfig);
        const circleName = circleService.backlogChannelToCircle(backlogChannelId);
        if (!circleName) {
            logger.warn(`No circle found for backlog channel ${backlogChannelId}, skipping follow-up`);
            nextActionQueue.splice(idx, 1);
            continue;
        }
        const circleCfg = DiscordHandler.circleConfig[circleName];
        if (!circleCfg) {
            logger.warn(`No circle config found for ${circleName}, skipping follow-up`);
            nextActionQueue.splice(idx, 1);
            continue;
        }

        try {

            const backlogChannel = await DiscordHandler.client.channels.fetch(backlogChannelId) as TextChannel;
            const { embed: followUpEmbed, components } = createFollowUpMessage({
                circle: circleName,
                author: DiscordHandler.client.user?.username ?? 'Kunja Hasselmus',
                originalAuthorMention: authorMention,
                agendaType: agendaType,
                title: headline,
                description: agenda,
                lastOutcome: outcome,
                color: circleCfg.embedColor || 0x3498db,
                // timestamp: new Date(),  // optional, defaults to now
            });

            // Always mark as handled so if error occurs we dont spam the backlog channel
            meta.next_action_date_handled = true;
            metaField.value = JSON.stringify(meta);

            await decisionMsg.edit({ embeds: [embed] });
            logger.info(`Marked next_action_date_handled=true for ${messageId}`);

            await backlogChannel.send({ embeds: [followUpEmbed], components: components });
            logger.info(`Posted follow-up for ${messageId} to ${backlogChannelId}`);

        } catch (err) {
            logger.error({ err, messageId }, 'Failed to post or mark follow-up');
            // mark as handled so we don't retry
            meta.next_action_date_handled = true;
            metaField.value = JSON.stringify(meta);
            await decisionMsg.edit({ embeds: [embed] });
            logger.info(`Marked next_action_date_handled=true for ${messageId} after error`);
        }

        // remove from queue
        nextActionQueue.splice(idx, 1);
    }
}, 1000 * queueNextActionIntervalSec);

// ────────────────────────────────────────────────────────────────────────────
DiscordHandler.client.login(token);
// ────────────────────────────────────────────────────────────────────────────
