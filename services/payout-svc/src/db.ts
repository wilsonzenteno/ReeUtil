import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db;

export async function getDb(): Promise<Db> {
  if (!client) {
    const uri = process.env.MONGODB_URI!;
    if (!uri) {
      throw new Error("MONGODB_URI is not set");
    }
    client = new MongoClient(uri);
    await client.connect();

    // Toma el nombre de DB del path de la URI: ...mongodb.net/<DB>?...
    const dbName = (new URL(uri).pathname.replace("/", "")) || "payout";
    db = client.db(dbName);
  }
  return db;
}
