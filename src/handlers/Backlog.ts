
import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, TextChannel, InteractionResponse } from 'discord.js';
import {
    DecisionMeta,
    DECISION_EMBED_NEXT_ACTION_DATE,
    DECISION_EMBED_NEXT_ACTION_DATE_RESPONSIBLE,
    DECISION_EMBED_ORIGINAL_TITLE,
} from '../types/Decision';
import { DiscordHandler } from './Discord';
import { timestampToSnowflake } from '../helpers/snowFlake';

/**
 * Class for admnin-related functionalities.
 * Handles commands like changing meta data and adding embeds.
 */

class BacklogHandler extends DiscordHandler {

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

}

export {
    BacklogHandler
};
