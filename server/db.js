import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'geturlink.db');

let db;

export async function initDB() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Create tables in sequence
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_premium INTEGER DEFAULT 0,
      premium_until INTEGER DEFAULT 0,
      stripe_connect_id TEXT,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT,
      bio TEXT,
      avatar_url TEXT,
      theme TEXT DEFAULT 'glass-dark',
      custom_css TEXT,
      layout_type TEXT DEFAULT 'grid',
      faq_context TEXT,
      custom_domain TEXT UNIQUE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      icon TEXT DEFAULT 'link',
      sort_order INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      file_url TEXT,
      sales_count INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'completed',
      customer_email TEXT,
      stripe_session_id TEXT,
      timestamp INTEGER NOT NULL,
      download_count INTEGER DEFAULT 0,
      FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_type TEXT NOT NULL, -- 'view', 'click', 'sale'
      target_id INTEGER, -- link_id, product_id, or NULL for profile view
      referrer TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migration to add stripe_session_id to existing databases
  try {
    await db.run('ALTER TABLE transactions ADD COLUMN stripe_session_id TEXT');
  } catch (err) {
    // Column already exists or table does not exist yet
  }

  // Migration for Advanced SaaS Columns
  try {
    await db.run('ALTER TABLE users ADD COLUMN stripe_connect_id TEXT');
  } catch (err) {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN stripe_customer_id TEXT');
  } catch (err) {}
  try {
    await db.run('ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT');
  } catch (err) {}
  try {
    await db.run('ALTER TABLE profiles ADD COLUMN custom_domain TEXT');
  } catch (err) {}
  try {
    await db.run('ALTER TABLE transactions ADD COLUMN download_count INTEGER DEFAULT 0');
  } catch (err) {}

  return db;
}

export function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}
