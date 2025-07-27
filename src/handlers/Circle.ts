import { CircleService } from "../services/CircleService";
import { ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { DiscordHandler } from "./Discord";

class CircleHandler extends DiscordHandler {

    protected service = new CircleService(DiscordHandler.circleConfig);

    // ────────────────────────────────────────────────────────────────────────────
    // /circles list implementation
    // ────────────────────────────────────────────────────────────────────────────
    public async list(i: ChatInputCommandInteraction) {
        const guild = i.guild;
        if (!guild) {
            return i.reply({ content: '⚠️  Command must be used inside a guild.', flags: MessageFlags.Ephemeral });
        }

        // Make sure role & member caches are fresh
        await guild.roles.fetch();
        await guild.members.fetch();

        const blocks: string[] = [];

        for (const [slug, cfg] of Object.entries(DiscordHandler.circleConfig)) {
            /* ✏️  Roles (as mentions) */
            const roleMentions = cfg.writerRoleIds
                .map(id => guild.roles.cache.get(id))
                .filter(Boolean)
                .map(r => `<@&${r!.id}>`)
                .join(', ') || '—';

            /* 👤  Members who hold ANY of those roles */
            const writers = guild.members.cache
                .filter(m => m.roles.cache.hasAny(...cfg.writerRoleIds))
                .map(m => `${m.user.username} (<@${m.user.id}>)`)     // name + clickable mention
                .slice(0, 25);                                       // avoid giant walls of text

            const writerLine = writers.length ? writers.join(', ') : '—';

            blocks.push(
                `• **${slug}** – <#${cfg.backlogChannelId}>\n` +
                `   ✏️ Roller: ${roleMentions}\n` +
                `   👤 Medlemmer (${writers.length}): ${writerLine}`,
            );
        }

        await i.reply({ content: blocks.join('\n\n'), flags: MessageFlags.Ephemeral });
    }

}

export { CircleHandler };
