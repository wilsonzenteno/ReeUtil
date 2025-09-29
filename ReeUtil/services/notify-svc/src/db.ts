// services/notify-svc/src/db.ts
import { MongoClient } from "mongodb";

let client: MongoClient;

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  const dbName = new URL(uri).pathname.replace("/", "") || "notify";
  return client.db(dbName);
}
