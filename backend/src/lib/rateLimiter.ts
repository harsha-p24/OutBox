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
 * Redis-backed distributed minimum-delay scheduler.
 *
 * Redis atomically reserves the next available send time.
 *
 * Multiple workers can call this simultaneously without
 * sending emails from the same sender too close together.
 */
export async function waitForSendSlot(
  senderId: string,
  minimumDelayMs: number
): Promise<void> {
  const key = `send-throttle:${senderId}`;

  const script = `
    local now = tonumber(ARGV[1])
    local delay = tonumber(ARGV[2])

    local last = tonumber(redis.call("GET", KEYS[1]) or "0")

    local slot = math.max(now, last)

    local nextAvailable = slot + delay

    -- Keep the key alive long enough for the reserved
    -- queue of send slots to be consumed.
    local ttl = math.max(delay * 10, 60000)

    redis.call(
      "SET",
      KEYS[1],
      tostring(nextAvailable),
      "PX",
      ttl
    )

    return slot
  `;

  const slot = Number(
    await connection.eval(
      script,
      1,
      key,
      String(Date.now()),
      String(minimumDelayMs)
    )
  );

  const waitMs = Math.max(slot - Date.now(), 0);

  if (waitMs > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, waitMs)
    );
  }
}
