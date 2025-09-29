import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db;

export async function getDb() {
  if (!client) {
    const uri = process.env.MONGODB_URI!;
    client = new MongoClient(uri);
    await client.connect();
    // Toma el nombre de DB del path de la URI: ...mongodb.net/<DB>?...
    const dbName = (new URL(uri).pathname.replace("/","")) || "default";
    db = client.db(dbName);
  }
  return db;
}
