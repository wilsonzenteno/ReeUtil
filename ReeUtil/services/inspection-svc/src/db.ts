import { MongoClient } from "mongodb";

let client: MongoClient;

export async function getDb() {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is required");
    client = new MongoClient(uri);
    await client.connect();
  }
  // Usa el nombre de la DB del path de la URI o "inspection" por defecto
  const dbName =
    new URL(process.env.MONGODB_URI!).pathname.replace("/", "") || "inspection";
  return client.db(dbName);
}
