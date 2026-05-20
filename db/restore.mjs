#!/usr/bin/env node
// Restaura os JSONs deste diretório em um Postgres novo.
// Uso:
//   DATABASE_URL=postgres://user:pwd@host:5432/db node restore.mjs
//
// Ordem segue dependências de FK. Para cada tabela tenta INSERT ... ON CONFLICT (id) DO UPDATE
// (todas as tabelas usam "id" uuid como PK).
//
// Pré-requisito: schema já criado (via `drizzle push` ou `schema.sql`).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

const ORDER = [
  "customers",
  "microsoft_tenants",
  "scans",
  "findings",
  "firewall_devices",
  "server_devices",
  "external_assets",
  "device_scans",
  "device_findings",
  "tenant_inquiries",
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não está definida.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

for (const table of ORDER) {
  const file = path.join(here, `${table}.json`);
  if (!fs.existsSync(file)) {
    console.log(`(skip) ${table}: arquivo não encontrado`);
    continue;
  }
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (rows.length === 0) {
    console.log(`(vazio) ${table}`);
    continue;
  }
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(",");
  const updateSet = cols
    .filter((c) => c !== "id")
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");

  let ok = 0;
  for (const row of rows) {
    const values = cols.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return null;
      if (typeof v === "object") return JSON.stringify(v); // jsonb
      return v;
    });
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})
                 ON CONFLICT (id) DO UPDATE SET ${updateSet}`;
    try {
      await client.query(sql, values);
      ok++;
    } catch (e) {
      console.error(`  ! ${table} id=${row.id}: ${e.message}`);
    }
  }
  console.log(`${table}: ${ok}/${rows.length} linhas`);
}

await client.end();
console.log("Restore concluído.");
