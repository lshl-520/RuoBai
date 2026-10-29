import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import { LOCAL_DATA_MIGRATIONS, LOCAL_DATA_SCHEMA_VERSION } from "./local-data-schema.mjs";

const DATABASE_NAME = "ruobai_local";
let openPromise;

function migrationStatements() {
  return Object.entries(LOCAL_DATA_MIGRATIONS).map(([version, statements]) => ({
    toVersion: Number(version),
    statements: [...statements],
  }));
}

export function isNativeLocalStorageAvailable() {
  return Capacitor.isNativePlatform();
}

export async function openNativeLocalDatabase() {
  if (!isNativeLocalStorageAvailable()) return null;
  if (!openPromise) {
    openPromise = (async () => {
      const sqlite = new SQLiteConnection(CapacitorSQLite);
      await sqlite.addUpgradeStatement(DATABASE_NAME, migrationStatements());
      const db = await sqlite.createConnection(DATABASE_NAME, false, "no-encryption", LOCAL_DATA_SCHEMA_VERSION, false);
      await db.open();
      await db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", ["schema_ready", String(LOCAL_DATA_SCHEMA_VERSION)]);
      return { sqlite, db, databaseName: DATABASE_NAME, version: LOCAL_DATA_SCHEMA_VERSION };
    })().catch((error) => {
      openPromise = null;
      throw error;
    });
  }
  return openPromise;
}

export async function closeNativeLocalDatabase() {
  if (!openPromise) return;
  const opened = await openPromise;
  await opened.db.close();
  await opened.sqlite.closeConnection(DATABASE_NAME, false);
  openPromise = null;
}
