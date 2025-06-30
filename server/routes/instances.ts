import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/index.js';
import { deployInstance, terminateInstance, startInstance, stopInstance } from '../services/instanceOperationsService.js';
import { EC2Instance, InstanceCreationRequest } from '../../src/types/aws.js';

const router = express.Router();

// Get all instances
router.get('/', async (req, res) => {
  try {
    const instances = await db.allAsync('SELECT * FROM instances ORDER BY launch_time DESC');
    
    const parsedInstances = instances.map((instance: any) => ({
      ...instance,
      securityGroups: JSON.parse(instance.security_groups || '[]'),
      volumes: JSON.parse(instance.volumes || '[]'),
      tags: JSON.parse(instance.tags || '{}'),
      isSpotInstance: Boolean(instance.is_spot_instance),
      launchTime: new Date(instance.launch_time),
    }));
    
    res.json(parsedInstances);
  } catch (error) {
    console.error('Failed to get instances:', error);
    res.status(500).json({ error: 'Failed to get instances' });
  }
});

// Create new instance
router.post('/', async (req, res) => {
  try {
    const request: InstanceCreationRequest = req.body;
    const instanceId = uuidv4();
    const stackName = `ec2-${instanceId.substring(0, 8)}`;
    
    // Store instance in database with pending state
    await db.runAsync(`
      INSERT INTO instances (
        id, name, instance_type, state, region, key_pair_name, 
        security_groups, volumes, is_spot_instance, tags, stack_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      instanceId,
      request.name,
      request.instanceType,
      'pending',
      request.region,
      request.keyPairId,
      JSON.stringify(request.securityGroupIds),
      JSON.stringify(request.volumes),
      request.isSpotInstance ? 1 : 0,
      JSON.stringify(request.tags),
      stackName
    ]);
    
    // Deploy instance using AWS SDK (async)
    deployInstance(instanceId, request, stackName)
      .then(async (result) => {
        // Update instance with AWS instance ID and network details
        await db.runAsync(`
          UPDATE instances 
          SET state = ?, public_ip = ?, private_ip = ?, availability_zone = ?, aws_instance_id = ?
          WHERE id = ?
        `, ['running', result.publicIp, result.privateIp, result.availabilityZone, result.instanceId, instanceId]);
      })
      .catch(async (error) => {
        console.error('Failed to deploy instance:', error);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['terminated', instanceId]);
      });
    
    // Return the instance immediately
    const instance = await db.getAsync('SELECT * FROM instances WHERE id = ?', [instanceId]);
    const parsedInstance = {
      ...instance,
      securityGroups: JSON.parse(instance.security_groups || '[]'),
      volumes: JSON.parse(instance.volumes || '[]'),
      tags: JSON.parse(instance.tags || '{}'),
      isSpotInstance: Boolean(instance.is_spot_instance),
      launchTime: new Date(instance.launch_time),
    };
    
    res.status(201).json(parsedInstance);
  } catch (error) {
    console.error('Failed to create instance:', error);
    res.status(500).json({ error: 'Failed to create instance' });
  }
});

// Start instance
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const instance = await db.getAsync('SELECT * FROM instances WHERE id = ?', [id]);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['pending', id]);
    
    // Start instance using AWS SDK (async)
    startInstance(instance.stack_name, instance.aws_instance_id)
      .then(async () => {
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['running', id]);
      })
      .catch(async (error) => {
        console.error('Failed to start instance:', error);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['stopped', id]);
      });
    
    res.json({ message: 'Instance start initiated' });
  } catch (error) {
    console.error('Failed to start instance:', error);
    res.status(500).json({ error: 'Failed to start instance' });
  }
});

// Stop instance
router.post('/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    const instance = await db.getAsync('SELECT * FROM instances WHERE id = ?', [id]);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['stopping', id]);
    
    // Stop instance using AWS SDK (async)
    stopInstance(instance.stack_name, instance.aws_instance_id)
      .then(async () => {
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['stopped', id]);
      })
      .catch(async (error) => {
        console.error('Failed to stop instance:', error);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['running', id]);
      });
    
    res.json({ message: 'Instance stop initiated' });
  } catch (error) {
    console.error('Failed to stop instance:', error);
    res.status(500).json({ error: 'Failed to stop instance' });
  }
});

// Terminate instance
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const instance = await db.getAsync('SELECT * FROM instances WHERE id = ?', [id]);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['terminated', id]);
    
    // Terminate instance using AWS SDK (async)
    terminateInstance(instance.stack_name, instance.aws_instance_id)
      .then(async () => {
        console.log(`Instance ${id} terminated successfully`);
      })
      .catch(async (error) => {
        console.error('Failed to terminate instance:', error);
        // Keep state as terminated even if AWS operation fails
      });
    
    res.json({ message: 'Instance termination initiated' });
  } catch (error) {
    console.error('Failed to terminate instance:', error);
    res.status(500).json({ error: 'Failed to terminate instance' });
  }
});

export default router;