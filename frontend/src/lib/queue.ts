/// <reference path="../types/redis.d.ts" />
import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not defined in environment variables");
}

const client = createClient({ url: redisUrl });

client.connect().catch((err: Error) => console.error("Redis connection error:", err));

export interface JobData {
  id: string;
  recordId: string;
  fileKey: string;
  type: string;
}

export async function addJob(queue: string, data: JobData) {
  // Add job data to the Redis list corresponding to the given queue name
  await client.lPush(queue, JSON.stringify(data));
  return data.id;
}
