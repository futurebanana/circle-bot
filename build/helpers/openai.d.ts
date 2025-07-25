import { Message, APIEmbedField } from 'discord.js';
import { NormalizedEmbedData } from '../types/DecisionMeta';
/**
 * Given a list of embed fields, normalize the data using OpenAI's API.
 * The system prompt is used to guide the model on how to process the embed fields.
 * Returns the normalized data as a string, or null if normalization fails.
 */
export declare function normalizeEmbedDataWithOpenAI(embedFields: APIEmbedField[]): Promise<NormalizedEmbedData>;
/**
 * Edit a decision embed message, swapping ALL of the embed field/value pairs
 * with the normalized data provided.
 */
export declare function applyNormalization(message: Message, normalized: string, postProcessChanges?: string, postProcessedError?: boolean): Promise<void>;
