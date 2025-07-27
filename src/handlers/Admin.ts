import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, TextChannel, APIEmbedField } from 'discord.js';
import logger from '../logger';
import { DecisionMeta } from '../types/Decision';
import { DiscordHandler } from './Discord';

/**
 * Class for admnin-related functionalities.
 * Handles commands like changing meta data and adding embeds.
 */

class AdminHandler extends DiscordHandler {

    // Function to insert,delete or update embed field
    async embed(interaction: ChatInputCommandInteraction) {

        const messageId = interaction.options.getString('message_id', true);
        const method = interaction.options.getString('method', true);
        const field = interaction.options.getString('field', true);
        const value = interaction.options.getString('value', true);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // 2) fetch the decision message
        let channel = await this.client.channels.fetch(this.decisionChannelId!) as TextChannel | null;
        if (!channel) {
            return interaction.editReply('⚠️ Kunne ikke finde #decisions-kanalen.');
        }

        let msg;
        try {
            msg = await channel.messages.fetch(messageId);
        } catch {
            return interaction.editReply(`⚠️ Kunne ikke finde besked med ID \`${messageId}\`.`);
        }

        const oldEmbed = msg.embeds[0];
        if (!oldEmbed) {
            return interaction.editReply('⚠️ Den målrettede besked indeholder ingen embeds.');
        }

        // Check method
        if (!['insert', 'update', 'delete'].includes(method)) {
            return interaction.editReply('⚠️ Ugyldig metode. Brug `insert`, `update` eller `delete`.');
        }

        const fields = [...oldEmbed.fields];

        if (method === 'delete') {

            const index = fields.findIndex(f => f.name === field);

            if (index === -1) {
                return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i embed.`);
            }

            fields.splice(index, 1);

            // convert the old embed into a new builder, swapping in our updated fields
            const api = oldEmbed.toJSON();
            api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
            const newEmbed = new EmbedBuilder(api);

            await msg.edit({ embeds: [newEmbed] });

            await interaction.editReply(`✅ Fjernet \`${field}\` fra beslutning ${messageId}.`);
        } else if (method === 'update') {
            const index = fields.findIndex(f => f.name === field);

            if (index === -1) {
                return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i embed.`);
            }
            fields[index].value = value;
            // convert the old embed into a new builder, swapping in our updated fields
            const api = oldEmbed.toJSON();
            api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
            const newEmbed = new EmbedBuilder(api);
            await msg.edit({ embeds: [newEmbed] });
            await interaction.editReply(`✅ Opdateret \`${field}\` i beslutning ${messageId}.`);

        } else if (method === 'insert') {

            const newField: APIEmbedField = {
                name: field,
                value: value,
                inline: false,
            };

            fields.push(newField);
            // convert the old embed into a new builder, swapping in our updated fields
            const api = oldEmbed.toJSON();
            api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
            const newEmbed = new EmbedBuilder(api);

            await msg.edit({ embeds: [newEmbed] });
            await interaction.editReply(`✅ Tilføjet \`${field}\` til beslutning ${messageId}.`);
        }
    }

    /**
     * Handle admin change meta command
     * @param interaction
     * @returns
     */
    async meta(interaction: ChatInputCommandInteraction) {

        const messageId = interaction.options.getString('message_id', true);
        const method = interaction.options.getString('method', true);
        const field = interaction.options.getString('field', true);
        const value = interaction.options.getString('value', true);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let channel = await this.client.channels.fetch(this.decisionChannelId!) as TextChannel | null;
        if (!channel) {
            return interaction.editReply('⚠️ Kunne ikke finde #decisions-kanalen.');
        }

        let msg;
        try {
            msg = await channel.messages.fetch(messageId);
        } catch {
            return interaction.editReply(`⚠️ Kunne ikke finde besked med ID \`${messageId}\`.`);
        }

        const oldEmbed = msg.embeds[0];
        if (!oldEmbed) {
            return interaction.editReply('⚠️ Den målrettede besked indeholder ingen embeds.');
        }

        // Check method
        if (!['insert', 'update', 'delete'].includes(method)) {
            return interaction.editReply('⚠️ Ugyldig metode. Brug `insert`, `update` eller `delete`.');
        }

        const fields = [...oldEmbed.fields];
        const metaIndex = fields.findIndex(f => f.name === 'meta_data');
        if (metaIndex < 0) {
            return interaction.editReply('⚠️ Embed mangler et `meta_data`-felt.');
        }

        let meta: DecisionMeta;
        try {
            meta = JSON.parse(fields[metaIndex].value) as DecisionMeta;
        } catch {
            return interaction.editReply('⚠️ Kunne ikke læse `meta_data` (ugyldig JSON).');
        }

        // Check method delete
        if (method === 'delete') {

            try {
                // If deleting, ensure the field exists
                if ((meta as any)[field] === undefined) {
                    return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i \`meta_data\`.`);
                }

                delete (meta as any)[field];

                fields[metaIndex].value = JSON.stringify(meta);
                // convert the old embed into a new builder, swapping in our updated fields
                const api = oldEmbed.toJSON();
                api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
                const newEmbed = new EmbedBuilder(api);
                await msg.edit({ embeds: [newEmbed] });
                await interaction.editReply(`✅ Fjernet \`${field}\` fra \`meta_data\` for beslutning ${messageId}.`);
            } catch (err) {
                logger.error('Error deleting field from meta_data', err);
                const errorMsg = typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : String(err);
                return interaction.editReply(`⚠️ Fejl under sletning af felt \`${field}\`: ${errorMsg}`);
            }

        } else if (method === 'insert') {

            try {
                // If inserting, ensure the field is not already present
                if ((meta as any)[field] !== undefined && (meta as any)[field] !== null && (meta as any)[field] !== '') {
                    logger.warn({ meta }, `Field ${field} already exists in meta_data for message ${messageId}`);
                    return interaction.editReply(`⚠️ Felt \`${field}\` findes allerede i \`meta_data\`.`);
                }

                // Insert field into meta_data
                (meta as any)[field] = value;
                // Update the meta_data field in the embed
                fields[metaIndex].value = JSON.stringify(meta);

                // convert the old embed into a new builder, swapping in our updated fields
                const api = oldEmbed.toJSON();
                api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
                const newEmbed = new EmbedBuilder(api);

                await msg.edit({ embeds: [newEmbed] });
                await interaction.editReply(`✅ Indsat \`${field}\` i \`meta_data\` for beslutning ${messageId}.`);
            } catch (err) {
                logger.error('Error inserting field into meta_data', err);
                const errorMsg = typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : String(err);
                return interaction.editReply(`⚠️ Fejl under indsættelse af felt \`${field}\`: ${errorMsg}`);
            }

        } else if (method === 'update') {

            try {
                // If updating, ensure the field exists
                if ((meta as any)[field] === undefined || (meta as any)[field] === null || (meta as any)[field] === '') {
                    return interaction.editReply(`⚠️ Felt \`${field}\` findes ikke i \`meta_data\`.`);
                }

                // Update the field in meta_data
                (meta as any)[field] = value;
                fields[metaIndex].value = JSON.stringify(meta);
                // convert the old embed into a new builder, swapping in our updated fields
                const api = oldEmbed.toJSON();
                api.fields = fields.map(f => ({ name: f.name, value: f.value, inline: f.inline }));
                const newEmbed = new EmbedBuilder(api);
                await msg.edit({ embeds: [newEmbed] });
                await interaction.editReply(`✅ Opdateret \`${field}\` i \`meta_data\` for beslutning ${messageId}.`);
            } catch (err) {
                logger.error('Error updating field in meta_data', err);
                const errorMsg = typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : String(err);
                return interaction.editReply(`⚠️ Fejl under opdatering af felt \`${field}\`: ${errorMsg}`);
            }

        }

        return;


    }

}

export { AdminHandler };
