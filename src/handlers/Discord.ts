// Main Handler class that other classes extend
class Discord {

    protected client: any;
    protected decisionChannelId: string;

    constructor(client: any, decisionChannelId: string) {
        this.client = client;
        this.decisionChannelId = decisionChannelId;
    }
}

export { Discord };
