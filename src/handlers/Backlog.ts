
import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    TextChannel,
    InteractionResponse,
    GuildMember,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonInteraction,
} from 'discord.js';
import {
    DecisionMeta,
    DECISION_EMBED_NEXT_ACTION_DATE,
    DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE,
    DECISION_EMBED_ORIGINAL_TITLE,
} from '../types/Decision';
import { DiscordHandler } from './Discord';
import { DECISION_EMBED_ORIGINAL_AGENDA_TYPE } from '../types/Decision';
import { MeetingHandler } from './Meeting';
import { CircleService } from '../services';
import { timestampToSnowflake } from '../helpers/snowFlake';
import logger from '../logger';
import crypto from 'node:crypto';

/**
 * Class for admin-related functionalities.
 * Handles commands like changing meta data and adding embeds.
 */

class BacklogHandler extends DiscordHandler {

    private static outcomeState = new Map<string, {
        circleName: string;
        backlogMsgId: string;
        participants: string[];
    }>();

    private static makeStateId() {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }

    private static saveOutcomeState(stateId: string, data: {
        circleName: string; backlogMsgId: string; participants: string[];
    }) {
        BacklogHandler.outcomeState.set(stateId, data);
        setTimeout(() => BacklogHandler.outcomeState.delete(stateId), 15 * 60 * 1000).unref?.();
    }

    public static takeOutcomeState(stateId: string) {
        const d = BacklogHandler.outcomeState.get(stateId);
        if (d) BacklogHandler.outcomeState.delete(stateId);
        return d;
    }

    /**
     *
     * @param i Interaction object from Discord
     * @description Lists decisions that are in the backlog, i.e., those that have a next action date set but not handled.
     * It fetches the last 100 messages from the backlog channel, filters them to find decisions with a next action date that has not been handled,
     * and formats them into a list of clickable links.
     * If no decisions are found, it informs the user that there are no decisions in the
     * @returns
     */
    public async queueList(i: ChatInputCommandInteraction, messageHistoryLimitSec: number): Promise<InteractionResponse> {

        const channel = await this.client.channels.fetch(this.decisionChannelId!) as TextChannel;
        const historyLimitMs = messageHistoryLimitSec * 1000;
        const afterSF = timestampToSnowflake(Date.now() - historyLimitMs);

        // fetch recent decisions
        const all = await channel.messages.fetch({ limit: 100, after: afterSF });
        const queued = all.filter(msg => {
            if (!msg.embeds.length) return false;
            const md = msg.embeds[0].fields.find(f => f.name === 'meta_data');
            if (!md) return false;
            try {
                const meta: DecisionMeta = JSON.parse(md.value);
                return !!meta.next_action_date && (meta.next_action_date_handled === false || meta.next_action_date_handled === 'false');
            } catch {
                return false;
            }
        });

        if (!queued.size) {
            return i.reply({ content: '✅ Ingen beslutninger i køen lige nu.', flags: MessageFlags.Ephemeral });
        }

        // build lines
        const guildId = i.guildId;
        const lines = Array.from(queued.values()).map((msg, idx) => {
            const embed = msg.embeds[0];
            const dateField = embed.fields.find(f => f.name === DECISION_EMBED_NEXT_ACTION_DATE);
            const respField = embed.fields.find(f => f.name === DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE);
            const titleField = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_TITLE);
            const date = dateField?.value ?? '–';
            const resp = respField?.value ? ` (Ansvarlig: ${respField.value})` : '';
            const title = titleField?.value ?? 'Uden titel';
            const url = `https://discord.com/channels/${guildId}/${this.decisionChannelId}/${msg.id}`;
            return `**${idx + 1}.** [${title}](${url}) – ${date}${resp}`;
        });

        // paginate if needed
        const chunk = lines.slice(0, 10).join('\n');
        const more = lines.length > 10 ? `\n…og ${lines.length - 10} mere` : '';

        return await i.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🗓️ Beslutninger i opfølgnings-kø')
                    .setColor(0xFFA500)
                    .setDescription(chunk + more)
            ],
            flags: MessageFlags.Ephemeral
        });
    }

    /**
     * Returns true if the invoking member has ANY of the roleIds.
     * Adds verbose logging so you can see what’s happening.
     */
    private memberHasAnyRole(interaction: ChatInputCommandInteraction, roleIds: string[]): boolean {

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

    public async new(interaction: ChatInputCommandInteraction) {

        const circleService = new CircleService(DiscordHandler.circleConfig);
        const circleName = circleService.backlogChannelToCircle(interaction.channelId);

        if (!circleName) {
            await interaction.reply({
                content: `⚠️  This command only works inside a backlog channel (circles: ${Object.keys(DiscordHandler.circleConfig).join(', ')}).`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const circleCfg = DiscordHandler.circleConfig[circleName];
        if (!this.memberHasAnyRole(interaction, circleCfg.writerRoleIds)) {
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

    // ────────────────────────────────────────────────────────────────────────────
    // Button handler placeholder
    // ────────────────────────────────────────────────────────────────────────────
    public async save(inter: ButtonInteraction) {
        if (inter.customId !== 'saveDecision') return;

        const embed = inter.message.embeds[0];
        const circleName = embed?.fields.find(f => f.name === 'Cirkel')?.value;

        if (!circleName) {
            return inter.reply({ content: '⚠️  Mangler cirkel på embed.', flags: MessageFlags.Ephemeral });
        }

        const meeting = MeetingHandler.get(circleName);
        if (!meeting) {
            // No meeting: ask user to run /start
            return inter.reply({
                content: 'Ingen møde i gang – kør `/møde start` for at starte et nyt møde.',
                flags: MessageFlags.Ephemeral,
            });
        }

        // Meeting is running → show outcome-modal immediately
        const backlogMsgId = inter.message.id;

        const stateId = BacklogHandler.makeStateId();
        BacklogHandler.saveOutcomeState(stateId, {
            circleName,
            backlogMsgId,
            participants: meeting.participants,
        });

        const modal = new ModalBuilder()
            .setCustomId(`meetingOutcomeModal|${stateId}`)
            .setTitle('Møde – Udfald og Opfølgning');

        const udfaldInput = new TextInputBuilder()
            .setCustomId('udfald')
            .setLabel('Udfald')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

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
            .setLabel('Lad botten hjælpe med dato/stavekontrol (ja/nej)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('ja eller nej—lad stå tomt for nej')
            .setValue('ja')
            .setRequired(false);
        const alignmentInput = new TextInputBuilder()
            .setCustomId('alignment')
            .setLabel('Lad botten hjælpe med håndbog/vision forslag (ja/nej)')
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
            new ActionRowBuilder<TextInputBuilder>().addComponents(alignmentInput),
        );

        await inter.showModal(modal);
    }

}

export {
    BacklogHandler
};
