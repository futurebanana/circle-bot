import { Message, EmbedBuilder, APIEmbedField } from 'discord.js';
import { KunjaHandler, DiscordHandler } from '../handlers';
import {
    DecisionAlignmentData,
    DECISION_EMBED_ORIGINAL_TITLE,
    NormalizedEmbedData
} from '../types';
import logger from '../logger';

class DecisionService {

    /**
     * @description Normalize a decision message using OpenAI.
     * This method checks if the message has been processed before and if not, it will normalize
     * the embed fields using OpenAI's normalization capabilities.
     * It will also handle the meta_data field to track processing status.
     * @param msg Message to normalize
     * @returns
     */
    public async normalize(msg: Message): Promise<APIEmbedField[] | boolean> {

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

            let normalizedEmbedData: NormalizedEmbedData = await DiscordHandler.openai.normalizeEmbedDataWithOpenAI(embedFields);

            // Check JSON diff between normalizedEmbedData and original embedFields
            logger.info({ normalizedEmbedData, embedFields }, `Checking if normalization is needed for message ${msg.id}`);
            if (!normalizedEmbedData.post_processed_error && JSON.stringify(normalizedEmbedData) !== JSON.stringify(embedFields)) {
                // Try/catch to apply normalization.
                try {
                    logger.info(`Auto-normalized decision ${msg.id} → ${JSON.stringify(normalizedEmbedData)}`);
                    await DiscordHandler.openai.applyNormalization(msg, JSON.stringify(normalizedEmbedData), normalizedEmbedData.post_process_changes, normalizedEmbedData.post_processed_error);
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

    /**
     *
     * @param msg Message to align
     * @description Align a decision message with vision and handbook channels.
     * This method checks if the message has been processed before and if not, it will align
     * the embed fields using OpenAI's alignment capabilities.
     * @param visionChannelId
     * @param handbookChannelId
     * @returns
     */
    public async align(msg: Message, visionChannelId: string, handbookChannelId: string): Promise<void> {

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
        if (meta.post_alignment === true || meta.post_alignment === 'true') {

            // Get all embed fields name/value pairs to a JSON array
            const embedFields: APIEmbedField[] = msg.embeds[0].fields.map((f: APIEmbedField) => ({
                name: f.name,
                value: f.value,
            }));

            // Removed the meta_data field from embedFields. AI should not change this.
            embedFields.splice(embedFields.findIndex(f => f.name === 'meta_data'), 1);

            // Get vision and handbook messages as archives for OpenAI
            const kunja = new KunjaHandler();
            const visionArchive = await kunja.getMessagesAsArchive(visionChannelId!);
            const handbookArchive = await kunja.getMessagesAsArchive(handbookChannelId!);

            let alignmentData: DecisionAlignmentData = await DiscordHandler.openai.alignDecisionWithOpenAI(embedFields, visionArchive, handbookArchive);

            if (alignmentData.should_raise_objection) {
                // Try/catch to check for raising an objection.
                try {
                    logger.info({ alignmentData }, `Got auto-aligned decision ${msg.id} → ${JSON.stringify(alignmentData)}`);

                    // Create thread from message
                    const thread = await msg.startThread({
                        name: `Kommentar: ${embedFields.find(f => f.name === DECISION_EMBED_ORIGINAL_TITLE)?.value}`,
                        autoArchiveDuration: 10080, // 1 week
                        reason: 'Kommentar fra Hasselmusen om beslutning',
                    });

                    // Send objection message in thread
                    const objectionEmbed = new EmbedBuilder()
                        .setTitle('Kommentar fra Hasselmusen')
                        .setColor(0xff0000) // Red color for objection
                        .setDescription(`Hasselmusen har en kommentar: ${embedFields.find(f => f.name === DECISION_EMBED_ORIGINAL_TITLE)?.value}`)
                        .addFields(
                            { name: 'Kommentar', value: alignmentData.suggested_revision || 'Ingen kommentar', inline: false },
                            { name: 'Beslutnings ID', value: msg.id, inline: true },
                            { name: 'Cirkel', value: embedFields.find(f => f.name === 'Cirkel')?.value || 'Ukendt', inline: true },
                        )
                        .setTimestamp(new Date())
                        .setFooter({ text: `Raised by AI at ${new Date().toISOString()}` });

                    await thread.send({ embeds: [objectionEmbed] });
                    // Set meta_data to mark as processed
                    meta.post_alignment = false; // Mark as processed
                    meta.post_alignment_time = new Date().toISOString();
                    metaField.value = JSON.stringify(meta);
                    await msg.edit({ embeds: [embed] });

                    logger.info(`✅ Applied alignment to decision ${msg.id}`);

                } catch (err) {
                    logger.error({ err, msgId: msg.id }, '❌ Failed to align decision');
                    // Set meta_data to mark as processed
                    meta.post_alignment = false; // Mark as processed
                    meta.post_alignment_error = true;
                    meta.post_alignment_time = new Date().toISOString();
                    metaField.value = JSON.stringify(meta);
                    await msg.edit({ embeds: [embed] });
                }

            } else {
                // Set meta_data to mark as processed
                meta.post_alignment = false; // Mark as processed
                meta.post_alignment_time = new Date().toISOString();
                metaField.value = JSON.stringify(meta);
                await msg.edit({ embeds: [embed] });
            }

            return;
        }

        return;
    }


}
export { DecisionService };
