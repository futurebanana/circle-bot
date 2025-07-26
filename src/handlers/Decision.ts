import { ChatInputCommandInteraction, MessageFlags, TextChannel } from 'discord.js';
import { Discord } from './Discord';
import { DECISION_PROMPT } from '../types';
import logger from '../logger';

class Decision extends Discord {

    public async ask(interaction: ChatInputCommandInteraction) {
        const question = interaction.options.getString('spørgsmål', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = (await Discord.client.channels.fetch(this.decisionChannelId!)) as TextChannel | null;
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
            { role: 'system', content: DECISION_PROMPT },
            { role: 'user', content: `Archive:\n${archive}` },
            { role: 'user', content: question },
        ];

        try {
            logger.info({ question, chars: archive.length }, '🤖 Sending question to OpenAI');
            await interaction.editReply(await this.openai.chat(messages, 0.2, 500));
        } catch (err: any) {
            logger.error('OpenAI error', err);
            await interaction.editReply(`OpenAI error: ${err.message ?? err}`);
        }
    }

}

export { Decision };
