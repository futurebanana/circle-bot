import { Client } from 'discord.js';
import { OpenAIInteractions } from '../helpers/openai';
import { MeetingState } from '../types';
import { MeetingService } from '../services/MeetingService';
import { MessageFlags } from 'discord.js';
import { CircleConfig } from '../types';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../logger';

export class DiscordHandler {

    public static client: Client;
    private static decisionChannelId: string;
    private static visionChannelId: string;
    private static handbookChannelId: string;
    public static openai: OpenAIInteractions;
    public static circleConfig: Record<string, CircleConfig>

    constructor() {
        if (!DiscordHandler.client) {
            throw new Error('Discord client not initialized');
        }
        if (!DiscordHandler.decisionChannelId) {
            throw new Error('Decision channel ID not set');
        }
        if (!DiscordHandler.visionChannelId) {
            throw new Error('Vision channel ID not set');
        }
        if (!DiscordHandler.handbookChannelId) {
            throw new Error('Handbook channel ID not set');
        }
        if (!DiscordHandler.openai) {
            throw new Error('OpenAI client not initialized');
        }
        if (!DiscordHandler.circleConfig) {
            throw new Error('Circle configuration not set');
        }

    }

    protected get client() {
        return DiscordHandler.client;
    }

    protected get decisionChannelId() {
        return DiscordHandler.decisionChannelId;
    }

    protected get visionChannelId() {
        return DiscordHandler.visionChannelId;
    }

    protected get handbookChannelId() {
        return DiscordHandler.handbookChannelId;
    }

    protected get openai() {
        return DiscordHandler.openai;
    }

    static init(client: Client, decisionChannelId: string, visionChannelId: string, handbookChannelId: string, openai: OpenAIInteractions, configPath: string) {
        this.client = client;
        this.decisionChannelId = decisionChannelId;
        this.visionChannelId = visionChannelId;
        this.handbookChannelId = handbookChannelId;
        this.openai = openai;
        try {
            // load config from environment or file
            this.circleConfig = yaml.load(
                fs.readFileSync(path.resolve(__dirname, configPath), "utf8")
            ) as Record<string, CircleConfig>;
        } catch (error) {
            logger.error({ error }, `Failed to load circle configuration`);
        }
    }
}
