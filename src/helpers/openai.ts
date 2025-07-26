import OpenAI from 'openai';
import { Message, EmbedBuilder, APIEmbedField } from 'discord.js';
import logger from '../logger';
import { DecisionMeta, NormalizedEmbedData, DecisionAlignmentData, DECISION_EMBED_NEXT_ACTION_DATE } from '../types/Decision';
import { SYSTEM_PROMPT, ALIGNMENT_PROMPT } from '../types/Prompts';


// Class for OpenAI API interaction
class OpenAIInteractions {

    private openai: OpenAI;
    private systemPrompt: string;
    private alignmentPrompt: string;
    private model = 'gpt-4o-mini';

    constructor(apiKey: string) {

        if (!apiKey) {
            throw new Error('OpenAI API key is required');
        }

        this.openai = new OpenAI({ apiKey });
        this.systemPrompt = SYSTEM_PROMPT;
        this.alignmentPrompt = ALIGNMENT_PROMPT;
    }

    public async chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, temperature: number, max_tokens: number): Promise<string> {

        const completion = await this.openai.chat.completions.create({
            model: this.model,
            messages: messages,
            temperature: temperature,
            max_tokens: max_tokens,
        });

        const answer = completion.choices[0].message?.content?.trim() || 'No answer generated.';

        return answer;

    }

    /**
     * Given a list of embed fields, normalize the data using OpenAI's API.
     * The system prompt is used to guide the model on how to process the embed fields.
     * Returns the normalized data as a string, or null if normalization fails.
     */
    public async normalizeEmbedDataWithOpenAI(embedFields: APIEmbedField[]): Promise<NormalizedEmbedData> {

        logger.info({ embedFields }, `Normalizing embed data with OpenAI`);
        try {
            // Check embedFields is valid JSON
            let embedFieldsJSON = JSON.stringify(embedFields);

            logger.info(`Using OpenAI system prompt for embed normalization`);
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: embedFieldsJSON },
                ]
            });

            const rawReturnMessage = completion.choices[0].message?.content?.trim() ?? '';
            const parsed = JSON.parse(rawReturnMessage);
            logger.info({ parsed }, `Parsed OpenAI response for embed normalization`);
            return parsed;

        } catch (err) {
            logger.warn({ err, embedFields }, 'normalizeEmbedDataWithOpenAI: Invalid embedFields JSON');
            // Return empty object if normalization fails
            return {
                embedFields: [],
                post_process_changes: 'No changes made',
                post_processed_error: true, // Indicate there was an error during post-processing
            };
        }
    }

    public async alignDecisionWithOpenAI(embedFields: APIEmbedField[], visionArchive: string[], handbookArchive: string[]): Promise<DecisionAlignmentData> {

        // Parse the embed fields into a JSON string
        const embedFieldsJSON = JSON.stringify(embedFields);
        const archives = JSON.stringify({ visionArchive, handbookArchive })
        const alignmentPromt = this.alignmentPrompt;

        try {

            logger.info({ alignmentPromt, embedFieldsJSON, archives }, `Using OpenAI system prompt for decision alignment`);
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.5,
                messages: [
                    { role: 'system', content: alignmentPromt },
                    { role: 'user', content: embedFieldsJSON },
                    { role: 'user', content: archives },
                ]
            });

            logger.info({ completion }, `Received OpenAI response for decision alignment`);

            /**
             * Returns a JSON object with the following structure:
             * {
                "should_raise_objection": true,
                "suggested_revision": "Update handbook section on cost-sharing to allow household-based splits when consented by all members."
                }

            */
            const rawReturnMessage = completion.choices[0].message?.content?.trim() ?? '';
            logger.info({ rawReturnMessage }, `Parsed OpenAI response for decision alignment`);

            // Convert rawReturnMessage to JSON
            const parsed = JSON.parse(rawReturnMessage);

            return {
                should_raise_objection: parsed.should_raise_objection || false,
                suggested_revision: parsed.suggested_revision || undefined
            };

        } catch (err) {
            logger.error({ err, embedFields }, 'alignDecisionWithOpenAI: Failed to align decision with OpenAI');
            return {
                should_raise_objection: false,
                suggested_revision: undefined,
            };
        }
    }

    /**
     * Edit a decision embed message, swapping ALL of the embed field/value pairs
     * with the normalized data provided.
     */
    public async applyNormalization(message: Message, normalized: string, postProcessChanges?: string, postProcessedError?: boolean): Promise<boolean> {

        try {

            if (!message.embeds.length) {
                logger.warn({ messageId: message.id }, 'applyNormalization: Message has no embeds');
                return false;
            }

            const originalEmbed = message.embeds[0];

            // 1) Parse the helper’s JSON payload
            let payload: { embedFields: Array<{ name: string; value: string }> };
            try {
                payload = JSON.parse(normalized);
            } catch {
                throw new Error('Invalid normalized JSON payload');
            }

            // 2) Extract and update the existing meta_data
            const metaField = originalEmbed.fields.find(f => f.name === 'meta_data');
            let meta: DecisionMeta = {
                post_process: false,
                post_processed_error: false,
                backlog_channelId: message.channel.id, // Use the current channel ID
            };
            if (metaField) {
                try {
                    meta = JSON.parse(metaField.value);
                } catch {
                    throw new Error('Invalid meta_data JSON in embed');
                }
            }
            // Add postProcessChanges to meta if provided
            if (postProcessChanges) {
                meta.post_process_changes = postProcessChanges;
            }
            if (postProcessedError !== undefined) {
                meta.post_processed_error = postProcessedError;
            } else {
                meta.post_processed_error = false;
            }
            meta.post_process = true;
            meta.post_processed_time = new Date().toISOString();

            // 3) Build the new fields array from payload.embedFields
            const newFields = payload.embedFields.map(f => ({
                name: f.name,
                value: f.value,
                inline: false,
            }));

            // Add meta.next_action_date if it exists in newFields name: Opfølgningsdato
            const nextActionDateField = newFields.find(f => f.name === DECISION_EMBED_NEXT_ACTION_DATE);
            if (nextActionDateField) {
                logger.info(`Found next action date field and adding to meta: ${nextActionDateField.value}`);
                // If next_action_date exists, set it in meta
                meta.next_action_date = nextActionDateField.value;
                meta.next_action_date_handled = false; // Set to false to indicate it needs handling
            }

            // 4) Append the updated meta_data field
            newFields.push({
                name: 'meta_data',
                value: JSON.stringify(meta),
                inline: false,
            });

            // 5) Create a new embed, preserving title/color/etc, but replacing fields
            const updatedEmbed = EmbedBuilder.from(originalEmbed)
                .setFields(newFields);

            // 6) Push the edit
            await message.edit({ embeds: [updatedEmbed] });
        } catch (err) {
            logger.error({ err, messageId: message.id }, 'applyNormalization: Failed to apply normalization');
            throw err; // Re-throw to handle upstream if needed
        }

        return true;
    }

}

export { OpenAIInteractions };
