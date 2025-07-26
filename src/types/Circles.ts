interface CircleConfig {
  alias?: { [key: string]: string }[]; // Optional aliases for the circle in different languages
  backlogChannelId: string;
  chatChannelId: string;
  embedColor: number;
  writerRoleIds: string[];
}

export { CircleConfig };
