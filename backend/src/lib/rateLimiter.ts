import { connection } from "./redis";

function hourKey(senderId: string, date = new Date()) {
  const bucket = `${date.getUTCFullYear()}${date.getUTCMonth()}${date.getUTCDate()}${date.getUTCHours()}`;
  return `ratelimit:${senderId}:${bucket}`;
}

/**
 * Atomically increments the sender's hourly counter.
 */
export async function tryConsume(
  senderId: string,
  limit: number
): Promise<boolean> {
  const key = hourKey(senderId);

  const count = await connection.incr(key);

  if (count === 1) {
    await connection.expire(key, 3600);
  }

  return count <= limit;
}

/**
 * Returns milliseconds until the next UTC hour.
 */
export function msUntilNextHour(): number {
  const now = new Date();

  const next = new Date(now);
  next.setUTCMinutes(60, 0, 0);

  return next.getTime() - now.getTime();
}

/**
 * Redis-backed distributed minimum-delay throttle.
 *
 * This prevents multiple workers from sending emails
 * at the same time for the same sender.
 */
export async function waitForSendSlot(
  senderId: string,
  minimumDelayMs: number
): Promise<void> {
  const key = `send-throttle:${senderId}`;

  while (true) {
    const now = Date.now();

    const result = await connection.set(
      key,
      String(now + minimumDelayMs),
      "PX",
      minimumDelayMs,
      "NX"
    );

    if (result === "OK") {
      return;
    }

    const nextAllowed = await connection.get(key);

    if (!nextAllowed) {
      continue;
    }

    const waitMs = Math.max(
      Number(nextAllowed) - Date.now(),
      10
    );

    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
