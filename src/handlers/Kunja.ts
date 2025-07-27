import { ChatInputCommandInteraction, MessageFlags, TextChannel } from 'discord.js';
import { DiscordHandler } from './Discord';
import logger from '../logger';
import { KUNJA_ASK_PROMPT } from '../types/Decision';

class KunjaHandler extends DiscordHandler {

    // Function to handle Kunja specific logic
    public async ask(interaction: ChatInputCommandInteraction) {

        const question = interaction.options.getString('spørgsmål', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const visionMessages = await this.getMessagesAsArchive(this.visionChannelId!);
        const handbookMessages = await this.getMessagesAsArchive(this.handbookChannelId!);

        const texts = [...visionMessages, ...handbookMessages];

        if (texts.length === 0) {
            await interaction.editReply('No decisions found to search.');
            return;
        }

        try {
            const archive = texts.join('\n\n---\n\n');
            const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
                { role: 'system', content: KUNJA_ASK_PROMPT },
                { role: 'user', content: `Archive:\n${archive}` },
                { role: 'user', content: question },
            ];

            logger.info({ question, chars: archive.length }, '🤖 Sending Vision/Handbook question to OpenAI');
            await interaction.editReply(await this.openai.chat(messages, 0.2, 500));
        } catch (err: any) {
            logger.error('OpenAI error', err);
            await interaction.editReply(`OpenAI error: ${err.message ?? err}`);
        }
    }

    public async getMessagesAsArchive(channelId: string): Promise<string[]> {

        const channel = (await this.client.channels.fetch(channelId!)) as TextChannel | null;
        if (!channel) {
            throw new Error('Channel not found');
        }

        const texts: string[] = [];
        let lastId: string | undefined;
        const charBudget = 64_000;

        // Go through handbook channel messages
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

        return texts;
    }

}

export { KunjaHandler };
