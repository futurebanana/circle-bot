import OpenAI from 'openai';
import { Message, EmbedBuilder, APIEmbedField } from 'discord.js';
import logger from '../logger';
import { DecisionMeta, NormalizedEmbedData, DECISION_EMBED_NEXT_ACTION_DATE } from '../types/DecisionMeta';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Multiline system prompt for OpenAI
const SYSTEM_PROMPT = `
You are a helpful assistant that post-processes meeting-decision embeds.
You will receive as user content a JSON string of the form:
{
  "embedFields": [
    { "name": "...", "value": "..." },
    …
  ]
}

Today is ${new Date().toISOString().split('T')[0]}.

Your tasks:
1. **Spell-check & correct typos** in every "value" string.
2. **For any field whose "name" contains the substring "Dato"** (case-insensitive):
   - **If** the value already matches ISO "YYYY-MM-DD" **and** is a future date (>= today), **leave it unchanged**.
   - **Else** interpret its value as a Danish/free-form date expression (e.g. "om 2 uger”, "1. oktober”, "næste mandag”, "6 måneder”, "Januar 2026").
     - If you successfully parse it to a future date, convert it to "YYYY-MM-DD".
     - If you cannot parse unambiguously, **set it to exactly 14 days from today**.
3. **Do not** modify fields whose "name" does not include "Dato” except for typo-fixing.
4. **Return** a JSON object with the exact same structure. And post_process_changes if any.
5. **MUST** Only add ONE new field called "post_process_changes" with your changes as a string.
    - If you made no changes, set it to "No changes made".
    - If you made changes, describe them in a human-readable way.
6. **Do not** add any other fields or metadata.
`;

/**
 * Given a list of embed fields, normalize the data using OpenAI's API.
 * The system prompt is used to guide the model on how to process the embed fields.
 * Returns the normalized data as a string, or null if normalization fails.
 */
export async function normalizeEmbedDataWithOpenAI(embedFields: APIEmbedField[]): Promise<NormalizedEmbedData> {

    logger.info({ embedFields }, `Normalizing embed data with OpenAI`);
    try {
        // Check embedFields is valid JSON
        let embedFieldsJSON = JSON.stringify(embedFields);

        logger.info({ SYSTEM_PROMPT }, `Using OpenAI system prompt for embed normalization`);
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
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

/**
 * Edit a decision embed message, swapping ALL of the embed field/value pairs
 * with the normalized data provided.
 */
export async function applyNormalization(
    message: Message,
    normalized: string,
    postProcessChanges?: string,
    postProcessedError?: boolean
): Promise<void> {

    try {

        if (!message.embeds.length) return;
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
}
