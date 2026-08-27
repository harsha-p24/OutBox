import { connection } from "./redis";

function hourKey(senderId: string, date = new Date()) {
  const bucket = `${date.getUTCFullYear()}${date.getUTCMonth()}${date.getUTCDate()}${date.getUTCHours()}`;
  return `ratelimit:${senderId}:${bucket}`;
}

/** Atomically increments the sender's hourly counter. Returns true if still under the limit. */
export async function tryConsume(senderId: string, limit: number): Promise<boolean> {
  const key = hourKey(senderId);
  const count = await connection.incr(key);
  if (count === 1) {
    await connection.expire(key, 3600); // auto-cleanup after 1 hour
  }
  return count <= limit;
}

/** Milliseconds remaining until the next UTC hour boundary. */
export function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(60, 0, 0);
  return next.getTime() - now.getTime();
}
