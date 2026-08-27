import { Queue } from "bullmq";
import { connection } from "./redis";

export const emailQueue = new Queue("emails", { connection });
