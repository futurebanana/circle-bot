// ─── snowflake.ts ────────────────────────────────────────────────────────────
/**
 * Convert a millisecond timestamp into a Discord snowflake ID.
 * https://discord.com/developers/docs/reference#snowflakes
 * @param msTimestamp – JavaScript timestamp in milliseconds
 * @returns Snowflake string that you can use with `after` or `before`
 */
export function timestampToSnowflake(msTimestamp: number): string {
  const DISCORD_EPOCH = 1420070400000n;                // Jan 1, 2015 UTC in ms
  const tsBigInt     = BigInt(msTimestamp);
  const delta        = tsBigInt - DISCORD_EPOCH;       // milliseconds since epoch
  const snowflake    = (delta << 22n).toString();      // shift into high bits
  return snowflake;
}
