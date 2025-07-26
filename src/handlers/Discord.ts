import { Client } from 'discord.js';
import { OpenAIInteractions } from '../helpers/openai';

export class Discord {

    public static client: Client;
    private static decisionChannelId: string;
    private static visionChannelId: string;
    private static handbookChannelId: string;
    public static openai: OpenAIInteractions;

    constructor() {
        if (!Discord.client) {
            throw new Error('Discord client not initialized');
        }
        if (!Discord.decisionChannelId) {
            throw new Error('Decision channel ID not set');
        }
        if (!Discord.visionChannelId) {
            throw new Error('Vision channel ID not set');
        }
        if (!Discord.handbookChannelId) {
            throw new Error('Handbook channel ID not set');
        }
        if (!Discord.openai) {
            throw new Error('OpenAI client not initialized');
        }
    }

    protected get client() {
        return Discord.client;
    }

    protected get decisionChannelId() {
        return Discord.decisionChannelId;
    }

    protected get visionChannelId() {
        return Discord.visionChannelId;
    }

    protected get handbookChannelId() {
        return Discord.handbookChannelId;
    }

    protected get openai() {
        return Discord.openai;
    }

    static init(client: Client, decisionChannelId: string, visionChannelId: string, handbookChannelId: string, openai: OpenAIInteractions) {
        this.client = client;
        this.decisionChannelId = decisionChannelId;
        this.visionChannelId = visionChannelId;
        this.handbookChannelId = handbookChannelId;
        this.openai = openai;
    }
}
