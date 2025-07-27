import { MeetingState } from '../types/Meeting';
import logger from '../logger';

class MeetingService {

    protected meetings: Record<string, MeetingState | undefined> = {};
    protected meetingDurationSec: number = 60 * 60 * 3; // Default to 3 hour

    public get(circle: string): MeetingState | undefined {
        // Log amount of meetings started
        logger.info({ circle, meetingsCount: Object.keys(this.meetings).length }, 'Checking meeting state for circle');
        const m = this.meetings[circle];
        if (m && m.expires > Date.now()) return m;
        delete this.meetings[circle];
        return undefined;
    }

    public set(circleName: string, participants: string[]): void {
        // Update the stored meeting participants and reset the timer if you like
        this.meetings[circleName] = {
            participants: participants,
            expires: Date.now() + this.meetingDurationSec * 1000,
        };
    }

}

export { MeetingService };
