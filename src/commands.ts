import { SlashCommandBuilder } from 'discord.js';

// ────────────────────────────────────────────────────────────────────────────
// Slash‑command registration data
// ────────────────────────────────────────────────────────────────────────────
export const commands = [

    // new admin commands for updating meta tags in decision embeds
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Administrative commands')
        .addSubcommand(sub =>
            sub
                // /admin change_meta <messageId> <method:insert|update|delete> <field> <value>
                .setName('change_meta')
                .setDescription('Change a meta field in a decision embed')
                .addStringOption(opt =>
                    opt
                        .setName('message_id')
                        .setDescription('The message ID of the decision embed to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('method')
                        .setDescription('Insert, update or delete a field')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('field')
                        .setDescription('The meta field to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('value')
                        .setDescription('The new value for the field')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                // /admin change_embed <messageId> <method:insert|update|delete> <field> <value>
                .setName('change_embed')
                .setDescription('Change a meta field in a decision embed')
                .addStringOption(opt =>
                    opt
                        .setName('message_id')
                        .setDescription('The message ID of the decision embed to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('method')
                        .setDescription('Insert, update or delete a field')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('field')
                        .setDescription('The meta field to change')
                        .setRequired(true)
                )
                .addStringOption(opt =>
                    opt
                        .setName('value')
                        .setDescription('The new value for the field')
                        .setRequired(true)
                )
        ),

    // New Command for searching through the Vision and Handbook channels
    new SlashCommandBuilder()
        .setName('kunja')
        .setDescription('Søg igennem Kunjas Vision og Håndbog')
        .addStringOption(opt =>
            opt
                .setName('spørgsmål')
                .setDescription('Dit søge-spørgsmål')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('hjælp')
        .setDescription('Vis en oversigt over, hvordan du bruger cirkel botten'),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Shows an overview of how to use the circle bot'),

    new SlashCommandBuilder()
        .setName('møde')
        .setDescription('Mødeforløb-kommandoer')
        .addSubcommand(sub =>
            sub
                .setName('start')
                .setDescription('Start et nyt møde og vælg deltagere')
        )
        .addSubcommand(sub =>
            sub
                .setName('deltagere')
                .setDescription('Ændre deltagere for det igangværende møde')
        ),

    new SlashCommandBuilder()
        .setName('ny')
        .setDescription('Opret et nyt mødepunkt i cirklens backlog')
        .addStringOption(opt =>
            opt
                .setName('type')
                .setDescription('Backlog type')
                .setRequired(true)
                .addChoices(
                    { name: 'beslutning', value: 'beslutning' },
                    { name: 'undersøgelse', value: 'undersøgelse' },
                    { name: 'orientering', value: 'orientering' },
                )
        ),

    new SlashCommandBuilder()
        .setName('cirkler')
        .setDescription('cirkel kommandoer')
        .addSubcommand(sub => sub.setName('vis').setDescription('Vis cirkler og deres medlemmer')),

    new SlashCommandBuilder()
        .setName('beslutninger')
        .setDescription('Beslutnings-kommandoer')
        .addSubcommand(sub =>
            sub
                .setName('søg')
                .setDescription('Søg i beslutnings-arkivet')
                .addStringOption(opt =>
                    opt
                        .setName('spørgsmål')
                        .setDescription('Dit søge-spørgsmål')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('opfølgning')
                .setDescription('Vis alle beslutninger med ubehandlede opfølgningsdatoer')
        ),

    // … evt. andre single commands du stadig beholder …
].map(cmd => cmd.toJSON());
