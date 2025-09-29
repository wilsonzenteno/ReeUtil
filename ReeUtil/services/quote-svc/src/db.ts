import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;

function getDbNameFromUri(uri: string): string {
  try {
    const u = new URL(uri);
    const name = u.pathname?.replace("/", "");
    return name || "quote";
  } catch {
    // Fallback si no parsea como URL estándar
    const tail = uri.split("/").pop() || "";
    const clean = tail.split("?")[0];
    return clean || "quote";
  }
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quote";
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  const dbName = getDbNameFromUri(uri);
  return client.db(dbName);
}
