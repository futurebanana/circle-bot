import { DiscordHandler } from "./Discord";
import { ChatInputCommandInteraction, MessageFlags, ActionRowBuilder, UserSelectMenuBuilder } from "discord.js";
import { MeetingState } from "../types/Meeting";
import { MeetingService, CircleService } from "../services";
import logger from "../logger";

/**
 * Class for handling meeting-related functionalities.
 * Manages meeting states and durations.
 */
class MeetingHandler extends DiscordHandler {

    private static service = new MeetingService();

    public async changeMembers(i: ChatInputCommandInteraction) {

        const circleService = new CircleService(DiscordHandler.circleConfig);
        const circleName = circleService.backlogChannelToCircle(i.channelId);

        if (!circleName) {
            return i.reply({ content: '⚠️ Denne kommando skal bruges i en backlog-kanal.', flags: MessageFlags.Ephemeral });
        }
        const meeting = MeetingHandler.service.get(circleName);
        if (!meeting) {
            return i.reply({ content: '🚫 Ingen igangværende møde at ændre deltagere på.', flags: MessageFlags.Ephemeral });
        }

        const picker = new UserSelectMenuBuilder()
            .setCustomId(`updateParticipants|${circleName}`)
            .setPlaceholder('Vælg nye mødedeltagere…')
            .setMinValues(1)
            .setMaxValues(12);

        const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(picker);
        await i.reply({
            content: 'Hvem skal deltage i det igangværende møde nu?',
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
    }

    public static getMeeting(circleName: string): MeetingState | undefined {
        return MeetingHandler.service.get(circleName);
    }

    public static setMeeting(circleName: string, ids: string[]): void {
        MeetingHandler.service.set(circleName, ids);
    }

}

export { MeetingHandler };
