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
} from 'discord.js';
import OpenAI from 'openai';
import logger from './logger/index';

/**
 * Kunja bot – /hello, /ask, /new, /circles list (multi‑circle backlog) in TypeScript.
 *
 * Required .env keys
 *   BOT_TOKEN                – Discord bot token
 *   OPENAI_API_KEY           – OpenAI key
 *   DECISION_CHANNEL_ID      – Channel that stores decision embeds (shared)
 *   CIRCLES=economy:111111111111111111,main:222222222222222222
 *       ↳ comma‑separated list of slug:backlogChannelId pairs
 *   DECISION_PROMPT          – System prompt for OpenAI
 * Optional
 *   TEST_GUILD_ID            – Guild ID for instant slash‑command updates
 */

// ────────────────────────────────────────────────────────────────────────────
// Environment checks
// ────────────────────────────────────────────────────────────────────────────
const token               = process.env.BOT_TOKEN;
const openaiKey           = process.env.OPENAI_API_KEY;
const decisionChannelId   = process.env.DECISION_CHANNEL_ID;
const circlesEnv          = process.env.CIRCLES; // e.g. "economy:111,main:222"
const decisionPrompt      = process.env.DECISION_PROMPT;
const testGuildId         = process.env.TEST_GUILD_ID;
const meetingDurationSec  = process.env.MEETING_DURATION_SEC || '10800'; // default 3 hours

if (!token)             throw new Error('BOT_TOKEN missing in .env');
if (!openaiKey)         throw new Error('OPENAI_API_KEY missing in .env');
if (!decisionChannelId) throw new Error('DECISION_CHANNEL_ID missing in .env');
if (!circlesEnv)        throw new Error('CIRCLES missing in .env');
if (!decisionPrompt)    throw new Error('DECISION_PROMPT missing in .env');
if (!meetingDurationSec) throw new Error('MEETING_DURATION_SEC missing in .env');

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

function getMeeting(circle: string): MeetingState | undefined {
  const m = meetings[circle];
  if (m && m.expires > Date.now()) return m;
  delete meetings[circle];
  return undefined;
}

type CircleCfg = { backlogChannelId: string; writerRoleIds: string[] };

const circles = circlesEnv.split(',').reduce<Record<string, CircleCfg>>((acc, entry) => {
  const [slug, chanId, roles] = entry.split(':');
  if (!slug || !chanId || !roles) {
    throw new Error(`Invalid CIRCLES entry "${entry}". Expected slug:channelId:roleId[…].`);
  }
  acc[slug.trim()] = {
    backlogChannelId: chanId.trim(),
    writerRoleIds: roles.split('+').map(r => r.trim()),
  };
  return acc;
}, {});

const backlogChannelIds = new Set(Object.values(circles).map(c => c.backlogChannelId));

// Helper: map channelId → circle slug (or undefined)
function channelToCircle(channelId: string): string | undefined {
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
const openai = new OpenAI({ apiKey: openaiKey });
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ]
});

// ────────────────────────────────────────────────────────────────────────────
// Slash‑command registration data
// ────────────────────────────────────────────────────────────────────────────
const commands = [


  new SlashCommandBuilder()
  .setName('hjælp')
  .setDescription('Vis en oversigt over, hvordan du bruger cirkel botten'),

  new SlashCommandBuilder()
  .setName('help')
  .setDescription('Shows an overview of how to use the circle bot'),

  new SlashCommandBuilder()
    .setName('beslutninger')
    .setDescription('Spørg hasselmusen om hjælp til at lede i beslutninger')
    .addStringOption(opt =>
      opt.setName('question').setDescription('Your question about decisions').setRequired(true)
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
          { name: 'beslutning',   value: 'beslutning'   },
          { name: 'undersøgelse', value: 'undersøgelse' },
          { name: 'orientering',  value: 'orientering'  },
        )
    ),

  // ── NEW ── /cirkler list
  new SlashCommandBuilder()
    .setName('cirkler')
    .setDescription('cirkel kommandoer')
    .addSubcommand(sub => sub.setName('vis').setDescription('Vis cirkler og deres medlemmer')),

].map(c => c.toJSON());

// ────────────────────────────────────────────────────────────────────────────
// Once the bot is ready, register (or update) commands
// ────────────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  logger.info(`🤖 Logged in as ${client.user?.tag}`);
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (testGuildId) {
      await rest.put(
        Routes.applicationGuildCommands(client.application!.id, testGuildId),
        { body: commands }
      );
      logger.info('✅ Guild‑scoped commands registered');
    } else {
      await rest.put(Routes.applicationCommands(client.application!.id), {
        body: commands,
      });
      logger.info('🌍 Global commands registered (may take up to 1 h)');
    }
  } catch (err) {
    logger.error('❌ Failed to register slash‑commands', err);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Interaction dispatcher
// ────────────────────────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case 'hjælp':
      case 'help':
      await handleHelp(interaction);
      break;

      case 'beslutninger':
        await handleAsk(interaction);
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

async function handleHelp(i: ChatInputCommandInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('🧀 Kunja Hasselmus-bot – Hjælp')
    .setColor(0xad7aff)
    .setTimestamp(new Date())
    .setDescription(
      'Hej! Jeg er husmusen, der holder styr på backlog, beslutninger og spørgsmål. ' +
      'Her er hvad jeg kan:'
    )
    .addFields(
      {
        name: '/ny type:<beslutning|undersøgelse|orientering>',
        value:
          'Bruges **inde i en cirkels backlog-kanal** for at oprette et nyt mødepunkt.\n' +
          '• Du udfylder titel og beskrivelse.\n' +
          '• Jeg poster et blåt embed med knappen **“Gem i beslutninger”.**',
      },
      {
        name: 'Knappen “Gem i beslutninger”',
        value:
          '➡️ Starter et *mødeforløb*.\n' +
          '1. Hvis intet møde er i gang, beder jeg dig starte et og vælge deltagere.\n' +
          '2. Mødet varer 3 timer; herefter kan du gemme udfaldet.',
      },
      {
        name: '/beslutninger question:<spørgsmål>',
        value:
          'Stil et naturligt sprog-spørgsmål om tidligere beslutninger.\n' +
          'Jeg svarer som hasselmusen – først en kvik sætning, derefter et formelt svar.',
      },
      {
        name: '/cirkler vis',
        value:
          'Viser alle cirkler, deres backlog-kanaler, skrive-roller **og** aktuelle medlemmer.',
      },
      {
        name: 'Roller & rettigheder',
        value:
          '• Kun brugere med cirklens *writer-rolle* kan oprette nye punkter.\n' +
          '• Alle kan læse beslutninger og stille spørgsmål.',
      },
      {
        name: 'Har du spørgsmål?',
        value: 'Tag fat i en admin eller skriv direkte til mig!',
      },
    );

  await i.reply({ embeds: [embed], ephemeral: true });
}

// ────────────────────────────────────────────────────────────────────────────
// /ask implementation (unchanged)
// ────────────────────────────────────────────────────────────────────────────
async function handleAsk(interaction: ChatInputCommandInteraction) {
    const question = interaction.options.getString('question', true);
    await interaction.deferReply({ ephemeral: true });

    const channel = (await client.channels.fetch(decisionChannelId!)) as TextChannel | null;
    if (!channel) {
        await interaction.editReply('⚠️  Could not access the #decisions channel.');
        return;
    }

    const texts: string[] = [];
    let lastId: string | undefined;
    const charBudget = 12_000;

    while (texts.join('\n').length < charBudget) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
        if (batch.size === 0) break;

        const sorted = Array.from(batch.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of sorted) {
            if (msg.embeds.length) {
                for (const e of msg.embeds) {
                    const parts: string[] = [];
                    if (e.title) parts.push(`**${e.title}**`);
                    for (const field of e.fields) {
                        if (field.name.toLowerCase() !== 'meta_data') parts.push(`${field.name}: ${field.value}`);
                    }
                    texts.push(parts.join('\n'));
                }
            } else if (msg.content) {
                texts.push(msg.content);
            }
        }

        lastId = batch.last()?.id;
        if (batch.size < 100) break;
    }

    if (texts.length === 0) {
        await interaction.editReply('No decisions found to search.');
        return;
    }

    const archive = texts.join('\n\n---\n\n');
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: decisionPrompt! },
        { role: 'user', content: `Archive:\n${archive}` },
        { role: 'user', content: question },
    ];

    try {
        logger.info({ question, chars: archive.length }, '🤖 Sending question to OpenAI');

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: messages as any,
            temperature: 0.2,
            max_tokens: 500,
        });

        const answer = completion.choices[0].message?.content?.trim() || 'No answer generated.';
        await interaction.editReply(answer);
    } catch (err: any) {
        logger.error('OpenAI error', err);
        await interaction.editReply(`OpenAI error: ${err.message ?? err}`);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// /circles list implementation
// ────────────────────────────────────────────────────────────────────────────
async function handleCircleList(i: ChatInputCommandInteraction) {
  const guild = i.guild;
  if (!guild) {
    return i.reply({ content: '⚠️  Command must be used inside a guild.', ephemeral: true });
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

  await i.reply({ content: blocks.join('\n\n'), ephemeral: true });
}

async function handleNew(interaction: ChatInputCommandInteraction) {
  const circleSlug = channelToCircle(interaction.channelId);
  if (!circleSlug) {
    await interaction.reply({
      content: `⚠️  This command only works inside a backlog channel (circles: ${Object.keys(circles).join(', ')}).`,
      ephemeral: true,
    });
    return;
  }

  const circleCfg = circles[circleSlug];
  if (!memberHasAnyRole(interaction, circleCfg.writerRoleIds)) {
    await interaction.reply({
      content: '🚫 Du har kun læse-adgang til denne cirkel. Kontakt en admin for skrivetilladelse.',
      ephemeral: true,
    });
    return;
  }

  const agendaType = interaction.options.getString('type', true);

  const modal = new ModalBuilder().setTitle(`Nyt mødepunkt til ${circleSlug}`).setCustomId(`backlogModal|${circleSlug}|${agendaType}`);

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

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isModalSubmit()) return;

  const [prefix, circleSlug, agendaType] = interaction.customId.split('|');
  if (prefix !== 'backlogModal') return;

  const circleCfg = circles[circleSlug];
  if (!circleCfg) {
    await interaction.reply({ content: '⚠️  Unknown circle in modal.', ephemeral: true });
    return;
  }

  const channel = (await client.channels.fetch(circleCfg.backlogChannelId)) as TextChannel | null;
  if (!channel) {
    await interaction.reply({ content: '⚠️  Backlog channel not found.', ephemeral: true });
    return;
  }

  const headline = interaction.fields.getTextInputValue('headline');
  const agenda  = interaction.fields.getTextInputValue('agenda');

  const embed = new EmbedBuilder()
    .setTitle('Nyt mødepunkt til husmøde')
    .setColor(0x3498db)
    .setTimestamp(new Date())
    .setAuthor({ name: interaction.member?.user.username ?? 'Anon' })
    .addFields(
      { name: 'Circle',      value: circleSlug,                 inline: true },
      { name: 'Forfatter',   value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Agenda type', value: agendaType,                  inline: true },
      { name: 'Overskrift',  value: headline,                    inline: false },
      { name: 'Beskrivelse', value: agenda,                      inline: false },
    );

  const saveBtn = new ButtonBuilder()
    .setCustomId('saveDecision')
    .setLabel('Gem i beslutninger')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(saveBtn);

  const msg = await channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: `Piv! Dit mødepunkt er gemt i <#${circleCfg.backlogChannelId}>`, ephemeral: true });
  logger.info({ id: msg.id, circle: circleSlug }, '📌 New backlog item posted');
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isUserSelectMenu() || !interaction.customId.startsWith('pickParticipants|')) return;

  const [, circleSlug, backlogMsgId] = interaction.customId.split('|');
  const participantIds = interaction.values as string[];

  // (re-store your meeting state if you want to keep expires logic)
  meetings[circleSlug] = {
    participants: participantIds,
    expires: Date.now() + MEETING_DURATION_MS,
  };

  const modal = new ModalBuilder()
    .setCustomId(`meetingOutcomeModal|${circleSlug}|${backlogMsgId}|${participantIds.join(',')}`)
    .setTitle('Møde – Udfald og Opfølgning');

  const udfaldInput = new TextInputBuilder()
    .setCustomId('udfald')
    .setLabel('Udfald')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Hvad blev beslutningen/konklusionen?')
    .setRequired(true);

  const agendaTypeInput = new TextInputBuilder()
    .setCustomId('agendaType')
    .setLabel('Agenda-type')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('beslutning / undersøgelse / orientering')
    .setRequired(true);

  const ansvarligInput = new TextInputBuilder()
    .setCustomId('ansvarlig')
    .setLabel('Ansvarlig (valgfri)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const opfoelgningsDatumInput = new TextInputBuilder()
    .setCustomId('opfoelgningsDato')
    .setLabel('Næste opfølgningsdato (valgfri)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('f.eks. “næste uge” eller “2025-08-01”')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(udfaldInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(agendaTypeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(ansvarligInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(opfoelgningsDatumInput),
  );

  await interaction.showModal(modal);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('meetingOutcomeModal|'))
    return;

  const [, circleSlug, backlogMsgId, rawParticipants] = interaction.customId.split('|');
  const participantIds = rawParticipants.split(',');

  // 1) Pull modal values
  const udfald       = interaction.fields.getTextInputValue('udfald');
  const agendaType   = interaction.fields.getTextInputValue('agendaType');
  const ansvarlig    = interaction.fields.getTextInputValue('ansvarlig');
  const nextDate     = interaction.fields.getTextInputValue('opfoelgningsDato');

  // 2) Fetch original backlog embed to get its title+description
  const circleCfg      = circles[circleSlug];
  const backlogChannel = await client.channels.fetch(circleCfg.backlogChannelId) as TextChannel;
  let originalHeadline = '–';
  let originalDesc     = '–';
  try {
    const backlogMsg   = await backlogChannel.messages.fetch(backlogMsgId);
    const origEmbed    = backlogMsg.embeds[0];
    originalHeadline   = origEmbed.fields.find(f => f.name === 'Overskrift')?.value ?? originalHeadline;
    originalDesc       = origEmbed.fields.find(f => f.name === 'Beskrivelse')?.value ?? originalDesc;
  } catch (err) {
    logger.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke hente backlog-embed');
  }

  // 3) Normalize nextDate into ISO if provided
  let nextIso: string | null = null;
  if (nextDate) {
    const d = new Date(nextDate);
    nextIso = isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  // 4) Build decision embed
  const authorMention          = `<@${interaction.user.id}>`;
  const participantsMentions   = participantIds.map(id => `<@${id}>`).join(', ');
  const colorMap: Record<string, number> = {
    economy: 0x00ff00,
    main:    0x3498db,
  };

  const embed = new EmbedBuilder()
    .setTitle('📌 Møde-beslutning')
    .setColor(colorMap[circleSlug] ?? 0x95a5a6)
    .setTimestamp(new Date())
    .addFields(
      { name: 'Forfatter',               value: authorMention,            inline: true  },
      { name: 'Agenda-type',             value: agendaType,               inline: true  },
      { name: 'Overskrift',              value: originalHeadline,         inline: false },
      { name: 'Beskrivelse',             value: originalDesc,             inline: false },
      { name: 'Udfald',                  value: udfald,                   inline: false },
      { name: 'Mødedeltagere',           value: participantsMentions,     inline: false },
      ...(nextIso
        ? [{ name: 'Næste opfølgningsdato', value: nextIso, inline: true }]
        : []),
      ...(ansvarlig
        ? [{ name: 'Ansvarlig',           value: ansvarlig,                inline: true }]
        : []),
      { name: 'meta_data',
        value: JSON.stringify({
          next_action_date:         nextIso,
          next_action_date_handled: false,
        }),
        inline: false
      },
    );

  // 5) Send & cleanup
  const decisionsChannel = await client.channels.fetch(decisionChannelId!) as TextChannel;
  await decisionsChannel.send({ embeds: [embed] });

  // Delete original backlog message
  try {
    await backlogChannel.messages.delete(backlogMsgId);
  } catch (err) {
    logger.warn({ err, backlogMsgId }, 'Kunja: Kunne ikke slette backlog-embed');
  }

  await interaction.reply({ content: 'Beslutning gemt og punkt fjernet ✅', ephemeral: true });
});

// ────────────────────────────────────────────────────────────────────────────
// Button handler placeholder
// ────────────────────────────────────────────────────────────────────────────
async function handleButton(inter: ButtonInteraction) {
  if (inter.customId === 'saveDecision') {
    const embed = inter.message.embeds[0];
    const circleSlug = embed?.fields.find(f => f.name === 'Circle')?.value;
    if (!circleSlug) return inter.reply({ content: '⚠️ Circle mangler på embed.', ephemeral: true });
    if (getMeeting(circleSlug)) {
      return inter.reply({ content: '🟢 Mødet kører allerede – mangler kun udfalds-flowet.', ephemeral: true });
    }

    const backlogMsgId = inter.message.id;          // ← grab it here
    const startBtn = new ButtonBuilder()
      .setCustomId(`startMeeting|${circleSlug}|${backlogMsgId}`)
      .setLabel('Start nyt møde')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(startBtn);
    return inter.reply({
      content: 'Skal vi starte et nyt møde? Tryk på knappen herunder.',
      components: [row],
      ephemeral: true,
    });
  }

  if (inter.customId.startsWith('startMeeting|')) {
    const [, circleSlug, backlogMsgId] = inter.customId.split('|');

    const picker = new UserSelectMenuBuilder()
      .setCustomId(`pickParticipants|${circleSlug}|${backlogMsgId}`)
      .setPlaceholder('Vælg mødedeltagere…')
      .setMinValues(1)
      .setMaxValues(12);

    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker);
    return inter.update({
      content: 'Vælg deltagerne til mødet:',
      components: [row],
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────
client.login(token);
// ────────────────────────────────────────────────────────────────────────────
