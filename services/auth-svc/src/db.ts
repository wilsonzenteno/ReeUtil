// services/auth-svc/src/db.ts
import { MongoClient } from "mongodb";

let client: MongoClient;

export async function getDb() {
  if (!client) {
    const uri = process.env.MONGODB_URI!;
    client = new MongoClient(uri);
    await client.connect();
  }
  // Toma el nombre de la DB del path de la URI (…/auth)
  const dbName = (new URL(process.env.MONGODB_URI!).pathname.replace("/", "")) || "auth";
  return client.db(dbName);
}
