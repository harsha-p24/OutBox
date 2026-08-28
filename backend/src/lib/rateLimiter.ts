import { connection } from "./redis";

function hourKey(senderId: string, date = new Date()) {
  const bucket =
    `${date.getUTCFullYear()}` +
    `${date.getUTCMonth()}` +
    `${date.getUTCDate()}` +
    `${date.getUTCHours()}`;

  return `ratelimit:${senderId}:${bucket}`;
}

/**
 * Atomically checks and consumes one email from the
 * sender's hourly rate limit.
 *
 * Redis Lua guarantees that the check and increment
 * happen as one atomic operation.
 */
export async function tryConsume(
  senderId: string,
  limit: number
): Promise<boolean> {
  const key = hourKey(senderId);

  const script = `
    local current = tonumber(redis.call("GET", KEYS[1]) or "0")
    local limit = tonumber(ARGV[1])

    if current >= limit then
      return 0
    end

    local newCount = redis.call("INCR", KEYS[1])

    if newCount == 1 then
      redis.call("EXPIRE", KEYS[1], 3600)
    end

    return 1
  `;

  const result = await connection.eval(
    script,
    1,
    key,
    String(limit)
  );

  return Number(result) === 1;
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
 * Multiple workers/instances use the same Redis key,
 * preventing them from sending from the same sender
 * at the same time.
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

    await new Promise((resolve) =>
      setTimeout(resolve, waitMs)
    );
  }
}
