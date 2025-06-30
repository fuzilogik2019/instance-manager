import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import db from '../database/index.js';
import AWSService from '../services/awsService.js';
import { generateKeyPair } from '../utils/sshUtils.js';

const router = express.Router();

// Get all key pairs
router.get('/', async (req, res) => {
  try {
    // Try to get from AWS first, fallback to database
    try {
      const awsService = new AWSService();
      const awsKeyPairs = await awsService.getKeyPairs();
      
      if (awsKeyPairs.length > 0) {
        res.json(awsKeyPairs);
        return;
      }
    } catch (awsError) {
      console.warn('Failed to get key pairs from AWS, using database:', awsError);
    }
    
    // Fallback to database
    const keyPairs = await db.allAsync('SELECT id, name, public_key, fingerprint, created_at FROM key_pairs ORDER BY created_at DESC');
    
    const parsedKeyPairs = keyPairs.map((kp: any) => ({
      ...kp,
      createdAt: new Date(kp.created_at),
    }));
    
    res.json(parsedKeyPairs);
  } catch (error) {
    console.error('Failed to get key pairs:', error);
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
    
    // Check if name already exists
    const existing = await db.getAsync('SELECT id FROM key_pairs WHERE name = ?', [name]);
    if (existing) {
      return res.status(409).json({ error: 'Key pair with this name already exists' });
    }
    
    const id = uuidv4();
    const { publicKey, privateKey } = await generateKeyPair();
    
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
    `, [id, name, publicKey, privateKey, fingerprint]);
    
    const keyPair = await db.getAsync('SELECT * FROM key_pairs WHERE id = ?', [id]);
    const parsedKeyPair = {
      ...keyPair,
      createdAt: new Date(keyPair.created_at),
    };
    
    res.status(201).json(parsedKeyPair);
  } catch (error) {
    console.error('Failed to create key pair:', error);
    res.status(500).json({ error: 'Failed to create key pair' });
  }
});

// Upload existing key pair
router.post('/upload', async (req, res) => {
  try {
    const { name, publicKey } = req.body;
    
    if (!name || !publicKey) {
      return res.status(400).json({ error: 'Name and public key are required' });
    }
    
    // Check if name already exists
    const existing = await db.getAsync('SELECT id FROM key_pairs WHERE name = ?', [name]);
    if (existing) {
      return res.status(409).json({ error: 'Key pair with this name already exists' });
    }
    
    const id = uuidv4();
    
    // Generate fingerprint
    const fingerprint = crypto
      .createHash('md5')
      .update(publicKey)
      .digest('hex')
      .match(/.{2}/g)!
      .join(':');
    
    await db.runAsync(`
      INSERT INTO key_pairs (id, name, public_key, fingerprint)
      VALUES (?, ?, ?, ?)
    `, [id, name, publicKey, fingerprint]);
    
    const keyPair = await db.getAsync('SELECT id, name, public_key, fingerprint, created_at FROM key_pairs WHERE id = ?', [id]);
    const parsedKeyPair = {
      ...keyPair,
      createdAt: new Date(keyPair.created_at),
    };
    
    res.status(201).json(parsedKeyPair);
  } catch (error) {
    console.error('Failed to upload key pair:', error);
    res.status(500).json({ error: 'Failed to upload key pair' });
  }
});

// Delete key pair
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.runAsync('DELETE FROM key_pairs WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Key pair not found' });
    }
    
    res.json({ message: 'Key pair deleted successfully' });
  } catch (error) {
    console.error('Failed to delete key pair:', error);
    res.status(500).json({ error: 'Failed to delete key pair' });
  }
});

export default router;