import logger from '../logger';
import { CircleConfig } from '../types';

class CircleService {

    protected circles: Record<string, CircleConfig>;

    constructor(circles: Record<string, CircleConfig>) {
        this.circles = circles;
    }

    public backlogChannelToCircle(channelId: string): string | undefined {
        return Object.entries(this.circles).find(([, cfg]) => cfg.backlogChannelId === channelId)?.[0];
    }

}

export { CircleService };
