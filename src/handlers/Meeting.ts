// import {
//     ChatInputCommandInteraction,
//     UserSelectMenuBuilder,
//     MessageFlags,
//     ActionRowBuilder,
//     ButtonInteraction,
//     ModalBuilder,
//     TextInputBuilder,
//     TextInputStyle,
// } from 'discord.js';
// import { Discord } from './Discord';
// import { backlogChannelToCircle } from '../index';
// import { MeetingState } from '../types/Meeting';
// import { DECISION_EMBED_ORIGINAL_AGENDA_TYPE } from '../types/DecisionMeta';

// /**
//  * Class for meeting-related functionalities.
//  * Handles commands like starting a meeting and picking participants.
//  */
// class Meeting extends Discord {

//     private meetings: Record<string, MeetingState | undefined> = {};
//     private MEETING_DURATION_MS = 60 * 60 * 1000 * 3; // 3  hours

//     public async start(i: ChatInputCommandInteraction) {

//         const circleName = backlogChannelToCircle(i.channelId);

//         if (!circleName) {
//             return i.reply({ content: '⚠️  Denne kommando skal bruges i en backlog-kanal.', flags: MessageFlags.Ephemeral });
//         }

//         const picker = new UserSelectMenuBuilder()
//             .setCustomId(`pickParticipants|${circleName}`)
//             .setPlaceholder('Vælg mødedeltagere…')
//             .setMinValues(1)
//             .setMaxValues(12);

//         const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker);
//         await i.reply({ content: 'Hvem deltager i mødet?', components: [row], flags: MessageFlags.Ephemeral });

//     }

//     public parseDuration(duration: string): number {
//         const num = parseInt(duration, 10);
//         if (isNaN(num) || num <= 0) {
//             throw new Error(`Invalid meeting duration: ${duration}`);
//         }
//         return num * 1000; // convert seconds to milliseconds
//     }

//     private getMeeting(circle: string): MeetingState | undefined {
//         const m = this.meetings[circle];
//         if (m && m.expires > Date.now()) return m;
//         delete this.meetings[circle];
//         return undefined;
//     }

//     public async updateParticipants(interaction: any) {

//         const [, circleName] = interaction.customId.split('|');
//         const ids = interaction.values as string[];

//         if (!circleName) {
//             return interaction.reply({ content: '⚠️ Denne kommando skal bruges i en backlog-kanal.', flags: MessageFlags.Ephemeral });
//         }

//         const meeting = this.getMeeting(circleName);
//         if (!meeting) {
//             return interaction.reply({
//                 content: '🚫 Ingen igangværende møde at ændre deltagere på.',
//                 flags: MessageFlags.Ephemeral,
//             });
//         }

//         // Update the stored meeting participants and reset the timer if you like
//         this.meetings[circleName] = {
//             participants: ids,
//             expires: Date.now() + this.MEETING_DURATION_MS,
//         };

//         const mentions = ids.map(id => `<@${id}>`).join(', ');
//         await interaction.update({
//             content: `✅ Deltagere opdateret: ${mentions}`,
//             components: [],
//         });
//     }

//     public async pickParticipants(interaction: any) {

//         const [, circleName] = interaction.customId.split('|');
//         const ids = interaction.values as string[];

//         this.meetings[circleName] = {
//             participants: ids,
//             expires: Date.now() + this.MEETING_DURATION_MS,
//         };

//         const mentions = ids.map(id => `<@${id}>`).join(', ');
//         await interaction.update({
//             content: `🟢 Mødet er startet. Deltagere: ${mentions}`,
//             components: [],
//         });

//     }

//     public async outcome(inter: ButtonInteraction) {
//         if (inter.customId !== 'saveDecision') return;

//         const embed = inter.message.embeds[0];
//         const circleName = embed?.fields.find(f => f.name === 'Cirkel')?.value;

//         if (!circleName) {
//             return inter.reply({ content: '⚠️  Mangler cirkel på embed.', flags: MessageFlags.Ephemeral });
//         }

//         const meeting = this.getMeeting(circleName);
//         if (!meeting) {
//             // No meeting: ask user to run /start
//             return inter.reply({
//                 content: 'Ingen møde i gang – kør `/møde start` for at starte et nyt møde.',
//                 flags: MessageFlags.Ephemeral,
//             });
//         }

//         // Meeting is running → show outcome-modal immediately
//         const backlogMsgId = inter.message.id;
//         const participantCsv = meeting.participants.join(',');
//         const modal = new ModalBuilder()
//             .setCustomId(`meetingOutcomeModal|${circleName}|${backlogMsgId}|${participantCsv}`)
//             .setTitle('Møde – Udfald og Opfølgning');

//         // your four fields (udfald, agendaType, ansvarlig, opfoelgningsDato) …
//         const udfaldInput = new TextInputBuilder()
//             .setCustomId('udfald')
//             .setLabel('Udfald')
//             .setStyle(TextInputStyle.Paragraph)
//             .setRequired(true);

//         // get original agendaType and prefill it
//         const originalAgendaType = embed.fields.find(f => f.name === DECISION_EMBED_ORIGINAL_AGENDA_TYPE)?.value || 'beslutning';
//         const agendaTypeInput = new TextInputBuilder()
//             .setCustomId('agendaType')
//             .setLabel('Agenda-type')
//             .setStyle(TextInputStyle.Short)
//             .setRequired(true)
//             .setValue(originalAgendaType);
//         const ansvarligInput = new TextInputBuilder()
//             .setCustomId('ansvarlig')
//             .setLabel('Ansvarlig (valgfri)')
//             .setStyle(TextInputStyle.Short)
//             .setRequired(false);
//         const opfoelgningsDatumInput = new TextInputBuilder()
//             .setCustomId('opfoelgningsDato')
//             .setLabel('Næste opfølgningsdato (valgfri)')
//             .setStyle(TextInputStyle.Short)
//             .setRequired(false);
//         const assistInput = new TextInputBuilder()
//             .setCustomId('assist')
//             .setLabel('Lad botten hjælpe (ja/nej)')
//             .setStyle(TextInputStyle.Short)
//             .setPlaceholder('ja eller nej—lad stå tomt for nej')
//             .setValue('ja')
//             .setRequired(false);

//         modal.addComponents(
//             new ActionRowBuilder<TextInputBuilder>().addComponents(udfaldInput),
//             new ActionRowBuilder<TextInputBuilder>().addComponents(agendaTypeInput),
//             new ActionRowBuilder<TextInputBuilder>().addComponents(ansvarligInput),
//             new ActionRowBuilder<TextInputBuilder>().addComponents(opfoelgningsDatumInput),
//             new ActionRowBuilder<TextInputBuilder>().addComponents(assistInput),
//         );

//         await inter.showModal(modal);
//     }


//     public async changeMembers(i: ChatInputCommandInteraction) {

//         const circleName = backlogChannelToCircle(i.channelId);

//         if (!circleName) {
//             return i.reply({ content: '⚠️ Denne kommando skal bruges i en backlog-kanal.', flags: MessageFlags.Ephemeral });
//         }
//         const meeting = this.getMeeting(circleName);
//         if (!meeting) {
//             return i.reply({ content: '🚫 Ingen igangværende møde at ændre deltagere på.', flags: MessageFlags.Ephemeral });
//         }

//         const picker = new UserSelectMenuBuilder()
//             .setCustomId(`updateParticipants|${circleName}`)
//             .setPlaceholder('Vælg nye mødedeltagere…')
//             .setMinValues(1)
//             .setMaxValues(12);

//         const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker);
//         await i.reply({
//             content: 'Hvem skal deltage i det igangværende møde nu?',
//             components: [row],
//             flags: MessageFlags.Ephemeral,
//         });
//     }

// }

// // export as singleton instance
// const meetingHandler = new Meeting(client, decisionChannelId);
// export { meetingHandler };
