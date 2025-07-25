/**
 * Convert a millisecond timestamp into a Discord snowflake ID.
 * https://discord.com/developers/docs/reference#snowflakes
 * @param msTimestamp – JavaScript timestamp in milliseconds
 * @returns Snowflake string that you can use with `after` or `before`
 */
export declare function timestampToSnowflake(msTimestamp: number): string;
