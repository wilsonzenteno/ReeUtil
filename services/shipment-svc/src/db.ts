import { MongoClient, Db } from "mongodb";

let client: MongoClient | null = null;
let db: Db;

export async function getDb() {
  if (!client) {
    const uri = process.env.MONGODB_URI!;
    client = new MongoClient(uri);
    await client.connect();

    // Toma el nombre de DB del path de la URI: ...mongodb.net/<DB>?...
    const dbName = (new URL(uri).pathname.replace("/", "")) || "shipment";
    db = client.db(dbName);

    // Log al conectarse (una sola vez)
    try {
      const safeUri = (() => {
        try {
          const u = new URL(uri);
          // ocultar usuario/contraseña si existen
          if (u.username || u.password) {
            u.username = "****";
            u.password = "****";
          }
          return u.toString();
        } catch {
          return "<invalid-uri>";
        }
      })();
      console.log("[shipment-svc] Mongo connected. databaseName:", db.databaseName, " uri:", safeUri);
    } catch {
      console.log("[shipment-svc] Mongo connected. databaseName:", db.databaseName);
    }
  }
  return db;
}
