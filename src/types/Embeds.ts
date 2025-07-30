import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

export interface FollowUpEmbedData {
    circle: string;
    originalAuthorMention: string;
    author: string;
    agendaType: string;
    title: string;
    description: string;
    lastOutcome: string;
    color: number;
    timestamp?: Date;
}

export const FollowUpLabels = {
    timestamp: 'Dato',
    embedTitle: 'Opfølgningspunkt til husmøde',
    circle: 'Cirkel',
    author: 'Forfatter',
    originalAuthorMention: 'Original forfatter',
    agendaType: 'Agenda-type',
    headline: 'Overskrift',
    description: 'Beskrivelse',
    lastOutcome: 'Sidste udfald',
    saveButton: 'Gem i beslutninger',
    footer: 'Automatisk opfølgning på beslutning',
};

export interface BacklogMessage {
    embed: EmbedBuilder;
    components: ActionRowBuilder<ButtonBuilder>[];
}

export const BacklogLabels = {
    timestamp: 'Dato',
    embedTitle: 'Nyt punkt til husmøde',
    circle: 'Cirkel',
    author: 'Forfatter',
    agendaType: 'Agenda-type',
    headline: 'Overskrift',
    description: 'Beskrivelse',
    saveButton: 'Gem i beslutninger',
};

export interface BacklogEmbedData {
    circle: string;
    author: string;
    authorMention: string;
    agendaType: string;
    title: string;
    description: string;
    color: number;
    timestamp: Date;
}

export const DecisionLabels = {
    timestamp: 'Dato',
    embedTitle: 'Beslutning',
    circle: 'Cirkel',
    author: 'Forfatter',
    authorMention: 'Forfatter',
    participantsMentions: 'Deltagere',
    agendaType: 'Agenda type',
    headline: 'Original Overskrift',
    description: 'Original Beskrivelse',
    outcome: 'Udfald',
    meta_data: 'meta_data',
    nextDate: 'Opfølgningsdato',
    responsible: 'Ansvarlig',
};

export interface DecisionEmbedData {
    circle: string;
    author: string;
    authorMention: string;
    participantsMentions: string;
    agendaType: string;
    title: string;
    description: string;
    outcome: string;
    color: number;
    timestamp: Date;
    nextDate?: string;
    responsible?: string;
    meta_data: string;
}
