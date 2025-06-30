import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'ec2-manager.db');

// Use default import with .verbose() for better ES module compatibility
const sqlite = sqlite3.verbose();
export const db = new sqlite.Database(dbPath);

// Promisify database methods
db.runAsync = promisify(db.run.bind(db));
db.getAsync = promisify(db.get.bind(db));
db.allAsync = promisify(db.all.bind(db));

export async function initializeDatabase() {
  try {
    // Create tables
    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        instance_type TEXT NOT NULL,
        state TEXT NOT NULL,
        region TEXT NOT NULL,
        availability_zone TEXT,
        public_ip TEXT,
        private_ip TEXT,
        key_pair_name TEXT,
        security_groups TEXT,
        volumes TEXT,
        is_spot_instance BOOLEAN DEFAULT 0,
        launch_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        tags TEXT,
        stack_name TEXT,
        aws_instance_id TEXT
      )
    `);

    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS security_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        region TEXT NOT NULL,
        rules TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS key_pairs (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT,
        fingerprint TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.runAsync(`
      CREATE TABLE IF NOT EXISTS volumes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        region TEXT NOT NULL,
        state TEXT NOT NULL,
        instance_id TEXT,
        device TEXT,
        encrypted BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize database:', error);
    throw error;
  }
}

export default db;