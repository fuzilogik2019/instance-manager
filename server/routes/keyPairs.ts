import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import db from '../database/index.js';
import AWSService from '../services/awsService.js';
import { generateKeyPair } from '../utils/sshUtils.js';

const router = express.Router();

// Get all key pairs with intelligent merging
router.get('/', async (req, res) => {
  try {
    console.log('📋 Getting key pairs...');
    
    // Get all key pairs from database first (these may have private keys)
    const dbKeyPairs = await db.allAsync('SELECT * FROM key_pairs ORDER BY created_at DESC');
    console.log(`📊 Found ${dbKeyPairs.length} key pairs in database`);
    
    // Try to get key pairs from AWS
    let awsKeyPairs = [];
    try {
      const awsService = new AWSService();
      awsKeyPairs = await awsService.getKeyPairs();
      console.log(`📊 Found ${awsKeyPairs.length} key pairs in AWS`);
    } catch (awsError) {
      console.warn('⚠️ Failed to get key pairs from AWS:', awsError.message);
    }
    
    // Create a map to merge key pairs intelligently
    const mergedKeyPairs = new Map();
    
    // First, add all database key pairs (these have priority because they may have private keys)
    dbKeyPairs.forEach((dbKp: any) => {
      mergedKeyPairs.set(dbKp.name, {
        id: dbKp.id,
        name: dbKp.name,
        publicKey: dbKp.public_key,
        privateKey: dbKp.private_key,
        fingerprint: dbKp.fingerprint,
        createdAt: new Date(dbKp.created_at),
        source: 'database'
      });
    });
    
    // Then, add AWS key pairs that aren't already in database
    awsKeyPairs.forEach((awsKp: any) => {
      if (!mergedKeyPairs.has(awsKp.name)) {
        mergedKeyPairs.set(awsKp.name, {
          id: awsKp.id,
          name: awsKp.name,
          publicKey: awsKp.publicKey,
          fingerprint: awsKp.fingerprint,
          createdAt: awsKp.createdAt,
          source: 'aws'
        });
        
        // Also sync this AWS key pair to database for future use
        try {
          const id = uuidv4();
          db.runAsync(`
            INSERT INTO key_pairs (id, name, public_key, fingerprint, created_at)
            VALUES (?, ?, ?, ?, ?)
          `, [id, awsKp.name, awsKp.publicKey, awsKp.fingerprint, new Date().toISOString()]);
          console.log(`🔄 Synced AWS key pair to database: ${awsKp.name}`);
        } catch (syncError) {
          console.warn(`⚠️ Failed to sync key pair ${awsKp.name}:`, syncError.message);
        }
      }
    });
    
    const finalKeyPairs = Array.from(mergedKeyPairs.values());
    console.log(`📊 Returning ${finalKeyPairs.length} key pairs total`);
    
    res.json(finalKeyPairs);
  } catch (error) {
    console.error('❌ Failed to get key pairs:', error);
    res.status(500).json({ error: 'Failed to get key pairs' });
  }
});

// Create new key pair
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Key pair name is required' });
    }
    
    console.log(`🔑 Creating new key pair: ${name}`);
    
    // Check if name already exists in database OR AWS
    const existingInDb = await db.getAsync('SELECT id FROM key_pairs WHERE name = ?', [name]);
    if (existingInDb) {
      return res.status(409).json({ error: 'Key pair with this name already exists in database' });
    }
    
    // Check AWS too
    try {
      const awsService = new AWSService();
      const awsKeyPairs = await awsService.getKeyPairs();
      const existingInAws = awsKeyPairs.find(kp => kp.name === name);
      if (existingInAws) {
        return res.status(409).json({ error: 'Key pair with this name already exists in AWS' });
      }
    } catch (awsError) {
      console.warn('⚠️ Could not check AWS for existing key pairs:', awsError.message);
    }
    
    // Try to create in AWS first
    let awsKeyPair = null;
    try {
      const awsService = new AWSService();
      awsKeyPair = await awsService.createKeyPair(name);
      console.log(`✅ Created key pair in AWS: ${name}`);
    } catch (awsError) {
      console.warn('⚠️ Failed to create key pair in AWS, creating locally:', awsError.message);
    }
    
    let keyPairData;
    
    if (awsKeyPair) {
      // Use AWS-generated key pair
      keyPairData = {
        id: uuidv4(),
        name: awsKeyPair.name,
        publicKey: awsKeyPair.publicKey,
        privateKey: awsKeyPair.privateKey,
        fingerprint: awsKeyPair.fingerprint,
      };
    } else {
      // Fallback to local creation
      const id = uuidv4();
      const { publicKey, privateKey } = await generateKeyPair();
      
      // Generate fingerprint
      const fingerprint = crypto
        .createHash('md5')
        .update(publicKey)
        .digest('hex')
        .match(/.{2}/g)!
        .join(':');
      
      keyPairData = {
        id,
        name,
        publicKey,
        privateKey,
        fingerprint,
      };
    }
    
    // Store in database
    await db.runAsync(`
      INSERT INTO key_pairs (id, name, public_key, private_key, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `, [keyPairData.id, keyPairData.name, keyPairData.publicKey, keyPairData.privateKey, keyPairData.fingerprint]);
    
    const keyPair = await db.getAsync('SELECT * FROM key_pairs WHERE id = ?', [keyPairData.id]);
    const parsedKeyPair = {
      ...keyPair,
      createdAt: new Date(keyPair.created_at),
    };
    
    console.log(`✅ Key pair created successfully: ${name}`);
    res.status(201).json(parsedKeyPair);
  } catch (error) {
    console.error('❌ Failed to create key pair:', error);
    res.status(500).json({ error: 'Failed to create key pair' });
  }
});

// Upload existing key pair - IMPROVED LOGIC
router.post('/upload', async (req, res) => {
  try {
    const { name, publicKey, privateKey } = req.body;
    
    if (!name || !publicKey) {
      return res.status(400).json({ error: 'Name and public key are required' });
    }
    
    console.log(`📤 Uploading key pair: ${name} (Private key: ${privateKey ? 'YES' : 'NO'})`);
    
    // Strategy: Always allow upload to database, handle AWS conflicts gracefully
    
    // Check if name already exists in database
    const existingInDb = await db.getAsync('SELECT id FROM key_pairs WHERE name = ?', [name]);
    if (existingInDb) {
      console.log(`⚠️ Key pair ${name} already exists in database, updating...`);
      
      // Update existing entry instead of creating new one
      await db.runAsync(`
        UPDATE key_pairs 
        SET public_key = ?, private_key = ?, fingerprint = ?
        WHERE name = ?
      `, [
        publicKey, 
        privateKey || null, 
        crypto.createHash('md5').update(publicKey).digest('hex').match(/.{2}/g)!.join(':'),
        name
      ]);
      
      const updatedKeyPair = await db.getAsync('SELECT * FROM key_pairs WHERE name = ?', [name]);
      const parsedKeyPair = {
        ...updatedKeyPair,
        createdAt: new Date(updatedKeyPair.created_at),
      };
      
      console.log(`✅ Key pair updated successfully: ${name}`);
      return res.status(200).json(parsedKeyPair);
    }
    
    // Try to import to AWS (but don't fail if it already exists)
    let awsImportSuccess = false;
    try {
      const awsService = new AWSService();
      await awsService.importKeyPair(name, publicKey);
      awsImportSuccess = true;
      console.log('✅ Successfully imported key pair to AWS:', name);
    } catch (awsError) {
      console.warn('⚠️ AWS import failed (this is OK):', awsError.message);
      
      // If it's a duplicate error, that's fine - the key pair already exists in AWS
      if (awsError.message?.includes('Duplicate') || awsError.message?.includes('already exists')) {
        console.log('ℹ️ Key pair already exists in AWS, proceeding with database storage');
        awsImportSuccess = true; // Consider this a success
      }
    }
    
    // Always store in local database for SSH terminal functionality
    const id = uuidv4();
    
    // Generate fingerprint
    const fingerprint = crypto
      .createHash('md5')
      .update(publicKey)
      .digest('hex')
      .match(/.{2}/g)!
      .join(':');
    
    await db.runAsync(`
      INSERT INTO key_pairs (id, name, public_key, private_key, fingerprint)
      VALUES (?, ?, ?, ?, ?)
    `, [id, name, publicKey, privateKey || null, fingerprint]);
    
    const keyPair = await db.getAsync('SELECT * FROM key_pairs WHERE id = ?', [id]);
    const parsedKeyPair = {
      ...keyPair,
      createdAt: new Date(keyPair.created_at),
    };
    
    console.log(`✅ Key pair uploaded successfully: ${name} (Private key: ${privateKey ? 'YES' : 'NO'})`);
    res.status(201).json(parsedKeyPair);
  } catch (error) {
    console.error('❌ Failed to upload key pair:', error);
    res.status(500).json({ error: 'Failed to upload key pair', details: error.message });
  }
});

// Delete key pair - IMPROVED LOGIC
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🗑️ Attempting to delete key pair: ${id}`);
    
    // Find the key pair (by ID or name)
    let keyPair = await db.getAsync('SELECT * FROM key_pairs WHERE id = ? OR name = ?', [id, id]);
    
    if (!keyPair) {
      console.log(`❌ Key pair not found in database: ${id}`);
      
      // Try to delete from AWS anyway (in case it exists there but not in DB)
      try {
        const awsService = new AWSService();
        await awsService.deleteKeyPair(id);
        console.log(`✅ Deleted key pair from AWS: ${id}`);
        return res.json({ message: 'Key pair deleted from AWS' });
      } catch (awsError) {
        console.warn(`⚠️ Key pair not found in AWS either: ${awsError.message}`);
        return res.status(404).json({ error: 'Key pair not found' });
      }
    }
    
    console.log(`✅ Found key pair in database: ${keyPair.name} (${keyPair.id})`);
    
    // Delete from AWS first (use the name, not the ID)
    try {
      const awsService = new AWSService();
      await awsService.deleteKeyPair(keyPair.name);
      console.log(`✅ Successfully deleted key pair from AWS: ${keyPair.name}`);
    } catch (awsError) {
      console.warn(`⚠️ Failed to delete key pair from AWS: ${awsError.message}`);
      // Continue with database deletion even if AWS fails
    }
    
    // Delete from database
    const result = await db.runAsync('DELETE FROM key_pairs WHERE id = ?', [keyPair.id]);
    
    console.log('📊 Database delete result:', result);
    
    // Handle different sqlite3 result formats more robustly
    let deletedRows = 0;
    if (result && typeof result === 'object') {
      if ('changes' in result && typeof result.changes === 'number') {
        deletedRows = result.changes;
      } else if ('affectedRows' in result && typeof result.affectedRows === 'number') {
        deletedRows = result.affectedRows;
      } else {
        // If we can't determine, assume success since we found the record
        deletedRows = 1;
      }
    } else {
      // For older sqlite3 versions or different return formats
      deletedRows = 1;
    }
    
    console.log(`📊 Deleted ${deletedRows} rows from database`);
    
    if (deletedRows === 0) {
      console.warn(`⚠️ No rows affected when deleting key pair: ${keyPair.id}`);
      return res.status(500).json({ error: 'Failed to delete key pair from database' });
    }
    
    console.log(`✅ Key pair deleted successfully: ${keyPair.name} (${keyPair.id})`);
    res.json({ message: 'Key pair deleted successfully' });
  } catch (error) {
    console.error('❌ Failed to delete key pair:', error);
    res.status(500).json({ error: 'Failed to delete key pair', details: error.message });
  }
});

export default router;