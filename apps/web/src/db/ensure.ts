import { sql } from "drizzle-orm";

import { db } from "./client";

let ensured = false;
let annotationsEnsured = false;

export async function ensureBooksTable() {
  if (ensured) return;

  await db.execute(sql`
    create extension if not exists pgcrypto;
  `);

  await db.execute(sql`
    create table if not exists books (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      original_filename text not null,
      mime_type text not null,
      size_bytes integer not null,
      storage_key text not null unique,
      storage_bucket text not null,
      object_etag text,
      created_at timestamptz not null default now()
    );
  `);

  ensured = true;
}

export async function ensureBookAnnotationsTable() {
  if (annotationsEnsured) return;

  await ensureBooksTable();

  await db.execute(sql`
    create table if not exists book_annotations (
      book_id uuid primary key references books(id) on delete cascade,
      payload jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);

  annotationsEnsured = true;
}
