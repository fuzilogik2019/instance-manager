import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/index.js';

const router = express.Router();

// Get all volumes
router.get('/', async (req, res) => {
  try {
    const { region } = req.query;
    let query = 'SELECT * FROM volumes ORDER BY created_at DESC';
    let params: any[] = [];
    
    if (region) {
      query = 'SELECT * FROM volumes WHERE region = ? ORDER BY created_at DESC';
      params = [region];
    }
    
    const volumes = await db.allAsync(query, params);
    
    const parsedVolumes = volumes.map((volume: any) => ({
      ...volume,
      encrypted: Boolean(volume.encrypted),
      createdAt: new Date(volume.created_at),
    }));
    
    res.json(parsedVolumes);
  } catch (error) {
    console.error('Failed to get volumes:', error);
    res.status(500).json({ error: 'Failed to get volumes' });
  }
});

// Attach volume to instance
router.post('/:id/attach', async (req, res) => {
  try {
    const { id } = req.params;
    const { instanceId, device } = req.body;
    
    const volume = await db.getAsync('SELECT * FROM volumes WHERE id = ?', [id]);
    if (!volume) {
      return res.status(404).json({ error: 'Volume not found' });
    }
    
    if (volume.instance_id) {
      return res.status(400).json({ error: 'Volume is already attached to an instance' });
    }
    
    await db.runAsync(`
      UPDATE volumes 
      SET instance_id = ?, device = ?, state = 'in-use'
      WHERE id = ?
    `, [instanceId, device, id]);
    
    res.json({ message: 'Volume attached successfully' });
  } catch (error) {
    console.error('Failed to attach volume:', error);
    res.status(500).json({ error: 'Failed to attach volume' });
  }
});

// Detach volume from instance
router.post('/:id/detach', async (req, res) => {
  try {
    const { id } = req.params;
    
    const volume = await db.getAsync('SELECT * FROM volumes WHERE id = ?', [id]);
    if (!volume) {
      return res.status(404).json({ error: 'Volume not found' });
    }
    
    await db.runAsync(`
      UPDATE volumes 
      SET instance_id = NULL, device = NULL, state = 'available'
      WHERE id = ?
    `, [id]);
    
    res.json({ message: 'Volume detached successfully' });
  } catch (error) {
    console.error('Failed to detach volume:', error);
    res.status(500).json({ error: 'Failed to detach volume' });
  }
});

// Delete volume
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const volume = await db.getAsync('SELECT * FROM volumes WHERE id = ?', [id]);
    if (!volume) {
      return res.status(404).json({ error: 'Volume not found' });
    }
    
    if (volume.instance_id) {
      return res.status(400).json({ error: 'Cannot delete attached volume. Detach it first.' });
    }
    
    const result = await db.runAsync('DELETE FROM volumes WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Volume not found' });
    }
    
    res.json({ message: 'Volume deleted successfully' });
  } catch (error) {
    console.error('Failed to delete volume:', error);
    res.status(500).json({ error: 'Failed to delete volume' });
  }
});

export default router;