import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/index.js';
import AWSService from '../services/awsService.js';

const router = express.Router();

// Get all volumes
router.get('/', async (req, res) => {
  try {
    const { region } = req.query;
    
    if (!region) {
      return res.status(400).json({ error: 'Region parameter is required' });
    }

    // Try to get from AWS first
    try {
      const awsService = new AWSService(region as string);
      const awsVolumes = await awsService.getVolumes(region as string);
      
      if (awsVolumes.length >= 0) { // Even if empty, AWS response is valid
        res.json(awsVolumes);
        return;
      }
    } catch (awsError) {
      console.warn('Failed to get volumes from AWS, using database:', awsError);
    }
    
    // Fallback to database
    const volumes = await db.allAsync(
      'SELECT * FROM volumes WHERE region = ? ORDER BY created_at DESC',
      [region]
    );
    
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

// Create new volume
router.post('/', async (req, res) => {
  try {
    const { type, size, region, encrypted, iops, throughput } = req.body;
    
    if (!type || !size || !region) {
      return res.status(400).json({ error: 'Type, size, and region are required' });
    }
    
    const id = uuidv4();
    
    // Try to create in AWS first
    try {
      const awsService = new AWSService(region);
      const awsVolume = await awsService.createVolume({
        type,
        size,
        region,
        encrypted: encrypted || false,
        iops,
        throughput
      });
      
      if (awsVolume) {
        res.status(201).json(awsVolume);
        return;
      }
    } catch (awsError) {
      console.warn('Failed to create volume in AWS, creating locally:', awsError);
    }
    
    // Fallback to local creation
    await db.runAsync(`
      INSERT INTO volumes (id, type, size, region, state, encrypted)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, type, size, region, 'available', encrypted ? 1 : 0]);
    
    const volume = await db.getAsync('SELECT * FROM volumes WHERE id = ?', [id]);
    const parsedVolume = {
      ...volume,
      encrypted: Boolean(volume.encrypted),
      createdAt: new Date(volume.created_at),
    };
    
    res.status(201).json(parsedVolume);
  } catch (error) {
    console.error('Failed to create volume:', error);
    res.status(500).json({ error: 'Failed to create volume' });
  }
});

// Attach volume to instance
router.post('/:id/attach', async (req, res) => {
  try {
    const { id } = req.params;
    const { instanceId, device } = req.body;
    
    console.log(`Attaching volume ${id} to instance ${instanceId} as ${device}`);
    
    if (!instanceId || !device) {
      return res.status(400).json({ error: 'Instance ID and device are required' });
    }
    
    // Try to attach in AWS first
    try {
      const awsService = new AWSService();
      await awsService.attachVolume(id, instanceId, device);
      console.log(`Successfully attached volume ${id} to instance ${instanceId} in AWS`);
    } catch (awsError) {
      console.warn('Failed to attach volume in AWS:', awsError);
      return res.status(500).json({ error: 'Failed to attach volume in AWS', details: awsError.message });
    }
    
    // Update database if AWS operation succeeded
    try {
      await db.runAsync(`
        UPDATE volumes 
        SET instance_id = ?, device = ?, state = 'in-use'
        WHERE id = ?
      `, [instanceId, device, id]);
    } catch (dbError) {
      console.warn('Failed to update volume in database:', dbError);
    }
    
    res.json({ message: 'Volume attached successfully' });
  } catch (error) {
    console.error('Failed to attach volume:', error);
    res.status(500).json({ error: 'Failed to attach volume', details: error.message });
  }
});

// Detach volume from instance
router.post('/:id/detach', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Detaching volume ${id}`);
    
    // Try to detach in AWS first
    try {
      const awsService = new AWSService();
      await awsService.detachVolume(id);
      console.log(`Successfully detached volume ${id} in AWS`);
    } catch (awsError) {
      console.error('Failed to detach volume in AWS:', awsError);
      return res.status(500).json({ error: 'Failed to detach volume in AWS', details: awsError.message });
    }
    
    // Update database if AWS operation succeeded
    try {
      await db.runAsync(`
        UPDATE volumes 
        SET instance_id = NULL, device = NULL, state = 'available'
        WHERE id = ?
      `, [id]);
    } catch (dbError) {
      console.warn('Failed to update volume in database:', dbError);
    }
    
    res.json({ message: 'Volume detached successfully' });
  } catch (error) {
    console.error('Failed to detach volume:', error);
    res.status(500).json({ error: 'Failed to detach volume', details: error.message });
  }
});

// Delete volume
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Deleting volume ${id}`);
    
    // Check if volume is attached before deleting
    try {
      const awsService = new AWSService();
      const awsVolumes = await awsService.getVolumes('us-east-1'); // We'll need to get region properly
      const volume = awsVolumes.find(v => v.id === id);
      
      if (volume && volume.state === 'in-use') {
        return res.status(400).json({ error: 'Cannot delete attached volume. Detach it first.' });
      }
    } catch (awsError) {
      console.warn('Failed to check volume state in AWS:', awsError);
    }
    
    // Try to delete from AWS first
    try {
      const awsService = new AWSService();
      await awsService.deleteVolume(id);
      console.log(`Successfully deleted volume ${id} in AWS`);
    } catch (awsError) {
      console.error('Failed to delete volume from AWS:', awsError);
      return res.status(500).json({ error: 'Failed to delete volume from AWS', details: awsError.message });
    }
    
    // Delete from database if AWS operation succeeded
    try {
      const result = await db.runAsync('DELETE FROM volumes WHERE id = ?', [id]);
      
      // Fix: Check if result exists and has changes property
      if (result && typeof result === 'object' && 'changes' in result) {
        if (result.changes === 0) {
          console.warn(`Volume ${id} not found in database, but AWS deletion succeeded`);
        } else {
          console.log(`Volume ${id} deleted from database successfully`);
        }
      } else {
        console.log(`Volume ${id} deletion completed (database result format unknown)`);
      }
    } catch (dbError) {
      console.error('Failed to delete volume from database:', dbError);
      // Don't return error here since AWS deletion succeeded
    }
    
    res.json({ message: 'Volume deleted successfully' });
  } catch (error) {
    console.error('Failed to delete volume:', error);
    res.status(500).json({ error: 'Failed to delete volume', details: error.message });
  }
});

export default router;