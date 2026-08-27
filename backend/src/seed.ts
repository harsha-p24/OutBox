import "dotenv/config";
import { prisma } from "./lib/prisma";

async function main() {
  const user = await prisma.user.create({
    data: {
      id: "57b65b78-18bb-41ac-8726-0892a630e139",
      googleId: "temp-google-id",
      name: "Test User",
      email: "test@example.com",
    },
  });
  console.log("Created user:", user);

  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      email: "sender@example.com",
      smtpUser: "testuser",
      smtpPass: "testpass",
    },
  });
  console.log("Created sender:", sender);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
