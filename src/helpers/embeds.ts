import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { FollowUpEmbedData, FollowUpLabels, BacklogMessage, BacklogLabels, BacklogEmbedData } from '../types';

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
