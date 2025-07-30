import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { FollowUpEmbedData, FollowUpLabels, BacklogMessage, BacklogLabels, BacklogEmbedData, DecisionLabels, DecisionEmbedData } from '../types';

export function createFollowUpMessage(data: FollowUpEmbedData): BacklogMessage {

    const timestamp = data.timestamp || new Date();

    const embed = new EmbedBuilder()
        .setTitle(FollowUpLabels.embedTitle)
        .setColor(data.color)
        .setTimestamp(timestamp)
        .setAuthor({ name: data.author })
        .setFooter({ text: FollowUpLabels.footer });

    embed.addFields(
        { name: FollowUpLabels.circle, value: data.circle, inline: true },
        { name: FollowUpLabels.originalAuthorMention, value: data.originalAuthorMention, inline: true },
        { name: FollowUpLabels.agendaType, value: data.agendaType, inline: true },
        { name: FollowUpLabels.headline, value: data.title, inline: true },
        { name: FollowUpLabels.timestamp, value: timestamp.toISOString().slice(0, 10) ?? '', inline: true },
        { name: FollowUpLabels.description, value: data.description, inline: false },
        { name: FollowUpLabels.lastOutcome, value: data.lastOutcome, inline: false },
    );

    const saveBtn = new ButtonBuilder()
        .setCustomId('saveDecision')
        .setLabel(FollowUpLabels.saveButton)
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(saveBtn);

    return { embed, components: [row] };
}


export function createBacklogMessage(data: BacklogEmbedData): BacklogMessage {

    const timestamp = data.timestamp || new Date();

    const embed = new EmbedBuilder()
        .setTitle(BacklogLabels.embedTitle)
        .setColor(data.color)
        .setTimestamp(timestamp)
        .setAuthor({ name: data.author })

    embed.addFields(
        { name: BacklogLabels.circle, value: data.circle, inline: true },
        { name: BacklogLabels.author, value: data.authorMention, inline: true },
        { name: BacklogLabels.agendaType, value: data.agendaType, inline: true },
        { name: BacklogLabels.headline, value: data.title, inline: true },
        { name: BacklogLabels.timestamp, value: timestamp.toISOString().slice(0, 10) ?? '', inline: true },
        { name: BacklogLabels.description, value: data.description, inline: false },
    );

    const saveBtn = new ButtonBuilder()
        .setCustomId('saveDecision')
        .setLabel(BacklogLabels.saveButton)
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(saveBtn);

    return { embed, components: [row] };
}

export function createDecisionMessage(data: DecisionEmbedData): BacklogMessage {

    const timestamp = data.timestamp || new Date();

    const embed = new EmbedBuilder()
        .setTitle(DecisionLabels.embedTitle)
        .setColor(data.color)
        .setTimestamp(timestamp)
        .setAuthor({ name: data.author });


    embed.addFields(
        { name: DecisionLabels.circle, value: data.circle, inline: true },
        { name: DecisionLabels.authorMention, value: data.authorMention, inline: true },
        { name: DecisionLabels.participantsMentions, value: data.participantsMentions, inline: true },
        { name: DecisionLabels.agendaType, value: data.agendaType, inline: true },
        { name: DecisionLabels.headline, value: data.title, inline: true },
        { name: DecisionLabels.description, value: data.description, inline: false },
        { name: DecisionLabels.outcome, value: data.outcome, inline: false },

    );

    if (data.nextDate && data.nextDate !== null && data.nextDate !== undefined && data.nextDate !== '') {
        embed.addFields(
            { name: DecisionLabels.nextDate, value: data.nextDate ?? '', inline: true },
            { name: DecisionLabels.responsible, value: data.responsible || 'Ingen', inline: true }
        );
    }

    embed.addFields(
        { name: DecisionLabels.timestamp, value: timestamp.toISOString().slice(0, 10) ?? '', inline: true },
        { name: DecisionLabels.meta_data, value: data.meta_data || '{}', inline: false }
    );

    const row = new ActionRowBuilder<ButtonBuilder>();

    return { embed, components: [row] };
}
