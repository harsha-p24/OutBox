export async function notifySlackRateLimit(
  userId: string,
  senderEmail: string,
  hourlyLimit: number
): Promise<void> {
  console.log(
    `[Slack] Rate limit reached for ${senderEmail}. ` +
      `Hourly limit: ${hourlyLimit}. User: ${userId}`
  );
}
