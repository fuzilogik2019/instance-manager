import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/index.js';
import { deployInstance, terminateInstance, startInstance, stopInstance } from '../services/instanceOperationsService.js';
import { EC2Instance, InstanceCreationRequest } from '../../src/types/aws.js';
import AWSService from '../services/awsService.js';

const router = express.Router();

// Helper function to find instance by AWS ID or internal ID
async function findInstanceByAnyId(id: string) {
  console.log(`🔍 Looking for instance with ID: ${id}`);
  
  // First try to find by AWS instance ID
  let instance = await db.getAsync('SELECT * FROM instances WHERE aws_instance_id = ?', [id]);
  if (instance) {
    console.log(`✅ Found by AWS ID: ${instance.id} (AWS: ${instance.aws_instance_id})`);
    return instance;
  }
  
  // If not found, try by internal ID
  instance = await db.getAsync('SELECT * FROM instances WHERE id = ?', [id]);
  if (instance) {
    console.log(`✅ Found by internal ID: ${instance.id} (AWS: ${instance.aws_instance_id || 'N/A'})`);
    return instance;
  }
  
  console.log(`❌ Instance not found in database: ${id}`);
  
  // If still not found, try to get from AWS and sync to database
  try {
    const awsService = new AWSService();
    const awsInstance = await awsService.getInstanceDetails(id);
    
    if (awsInstance) {
      console.log(`🔄 Found instance in AWS but not in database, syncing: ${id}`);
      
      // Get instance name from tags
      const nameTag = awsInstance.Tags?.find(tag => tag.Key === 'Name');
      const instanceName = nameTag?.Value || awsInstance.InstanceId || 'Imported Instance';
      
      // Create database entry for this AWS instance
      const internalId = uuidv4();
      const stackName = `ec2-${internalId.substring(0, 8)}`;
      
      await db.runAsync(`
        INSERT INTO instances (
          id, name, instance_type, state, region, availability_zone,
          public_ip, private_ip, key_pair_name, security_groups, volumes,
          is_spot_instance, tags, stack_name, aws_instance_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        internalId,
        instanceName,
        awsInstance.InstanceType || 't3.micro',
        awsInstance.State?.Name || 'unknown',
        awsInstance.Placement?.AvailabilityZone?.slice(0, -1) || 'us-east-1',
        awsInstance.Placement?.AvailabilityZone || 'us-east-1a',
        awsInstance.PublicIpAddress,
        awsInstance.PrivateIpAddress,
        awsInstance.KeyName || 'unknown',
        JSON.stringify(awsInstance.SecurityGroups?.map(sg => sg.GroupId!) || []),
        JSON.stringify([]),
        awsInstance.SpotInstanceRequestId ? 1 : 0,
        JSON.stringify({}),
        stackName,
        awsInstance.InstanceId
      ]);
      
      // Return the newly created database entry
      const syncedInstance = await db.getAsync('SELECT * FROM instances WHERE id = ?', [internalId]);
      console.log(`✅ Synced AWS instance to database: ${internalId} (AWS: ${awsInstance.InstanceId})`);
      return syncedInstance;
    }
  } catch (awsError) {
    console.error(`❌ Failed to sync instance from AWS: ${awsError.message}`);
  }
  
  return null;
}

// Get all instances
router.get('/', async (req, res) => {
  try {
    console.log('📋 Fetching instances...');
    
    // Try to get instances from AWS first
    try {
      const awsService = new AWSService();
      const awsInstances = await awsService.getAllInstances();
      
      console.log(`📊 Found ${awsInstances.length} instances from AWS`);
      
      // Sync AWS instances with database for future operations
      for (const awsInstance of awsInstances) {
        try {
          // Check if this AWS instance exists in our database
          const existingInstance = await db.getAsync(
            'SELECT * FROM instances WHERE aws_instance_id = ?', 
            [awsInstance.id]
          );
          
          if (!existingInstance) {
            // Create database entry for this AWS instance
            const internalId = uuidv4();
            const stackName = `ec2-${internalId.substring(0, 8)}`;
            
            await db.runAsync(`
              INSERT INTO instances (
                id, name, instance_type, state, region, availability_zone,
                public_ip, private_ip, key_pair_name, security_groups, volumes,
                is_spot_instance, tags, stack_name, aws_instance_id
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              internalId,
              awsInstance.name,
              awsInstance.instanceType,
              awsInstance.state,
              awsInstance.region,
              awsInstance.availabilityZone,
              awsInstance.publicIp,
              awsInstance.privateIp,
              awsInstance.keyPairName,
              JSON.stringify(awsInstance.securityGroups),
              JSON.stringify(awsInstance.volumes),
              awsInstance.isSpotInstance ? 1 : 0,
              JSON.stringify(awsInstance.tags),
              stackName,
              awsInstance.id
            ]);
            
            console.log(`🔄 Synced new AWS instance to database: ${awsInstance.id}`);
          } else {
            // Update existing database entry with current AWS state
            await db.runAsync(`
              UPDATE instances 
              SET state = ?, public_ip = ?, private_ip = ?, name = ?
              WHERE aws_instance_id = ?
            `, [
              awsInstance.state,
              awsInstance.publicIp,
              awsInstance.privateIp,
              awsInstance.name,
              awsInstance.id
            ]);
          }
        } catch (syncError) {
          console.warn(`⚠️ Failed to sync instance ${awsInstance.id}:`, syncError.message);
        }
      }
      
      if (awsInstances.length >= 0) { // Even if empty, AWS response is valid
        res.json(awsInstances);
        return;
      }
    } catch (awsError) {
      console.warn('⚠️ Failed to get instances from AWS, using database:', awsError.message);
    }
    
    // Fallback to database
    console.log('📂 Falling back to database...');
    const instances = await db.allAsync('SELECT * FROM instances ORDER BY launch_time DESC');
    
    const parsedInstances = instances.map((instance: any) => ({
      ...instance,
      securityGroups: JSON.parse(instance.security_groups || '[]'),
      volumes: JSON.parse(instance.volumes || '[]'),
      tags: JSON.parse(instance.tags || '{}'),
      isSpotInstance: Boolean(instance.is_spot_instance),
      launchTime: new Date(instance.launch_time),
    }));
    
    console.log(`📊 Found ${parsedInstances.length} instances from database`);
    res.json(parsedInstances);
  } catch (error) {
    console.error('❌ Failed to get instances:', error);
    res.status(500).json({ error: 'Failed to get instances' });
  }
});

// Create new instance
router.post('/', async (req, res) => {
  try {
    const request: InstanceCreationRequest = req.body;
    const instanceId = uuidv4();
    const stackName = `ec2-${instanceId.substring(0, 8)}`;
    
    console.log('🚀 Creating instance with request:', request);
    
    // Validate required fields
    if (!request.name || !request.region || !request.instanceType || !request.keyPairId) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, region, instanceType, keyPairId' 
      });
    }
    
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
      JSON.stringify(request.securityGroupIds || []),
      JSON.stringify(request.volumes || []),
      request.isSpotInstance ? 1 : 0,
      JSON.stringify(request.tags || {}),
      stackName
    ]);
    
    // Deploy instance using AWS SDK (async)
    deployInstance(instanceId, request, stackName)
      .then(async (result) => {
        console.log(`✅ Instance ${instanceId} deployed successfully:`, result);
        // Update instance with AWS instance ID and network details
        await db.runAsync(`
          UPDATE instances 
          SET state = ?, public_ip = ?, private_ip = ?, availability_zone = ?, aws_instance_id = ?
          WHERE id = ?
        `, ['running', result.publicIp, result.privateIp, result.availabilityZone, result.instanceId, instanceId]);
      })
      .catch(async (error) => {
        console.error(`❌ Failed to deploy instance ${instanceId}:`, error);
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
    console.error('❌ Failed to create instance:', error);
    res.status(500).json({ error: 'Failed to create instance', details: error.message });
  }
});

// Start instance
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🟢 === START INSTANCE REQUEST ===`);
    console.log(`🔍 Received request to start instance: ${id}`);
    console.log(`📍 Request URL: ${req.originalUrl}`);
    console.log(`🔧 Request method: ${req.method}`);
    
    const instance = await findInstanceByAnyId(id);
    
    if (!instance) {
      console.log(`❌ Instance not found: ${id}`);
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    console.log(`✅ Found instance: ${instance.id} (AWS: ${instance.aws_instance_id})`);
    
    // Check if it's a spot instance
    if (instance.is_spot_instance) {
      console.log(`❌ Cannot start spot instance: ${instance.id}`);
      return res.status(400).json({ 
        error: 'Cannot start Spot instances. Spot instances are terminated when stopped and cannot be restarted.' 
      });
    }
    
    // Check if AWS instance ID exists
    if (!instance.aws_instance_id) {
      console.log(`❌ No AWS instance ID found for: ${instance.id}`);
      return res.status(400).json({ 
        error: 'Instance has no AWS instance ID. It may not have been properly created.' 
      });
    }
    
    console.log(`🔄 Updating instance state to pending...`);
    await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['pending', instance.id]);
    
    // Start instance using AWS SDK (async)
    console.log(`🚀 Starting AWS instance: ${instance.aws_instance_id}`);
    startInstance(instance.stack_name, instance.aws_instance_id)
      .then(async () => {
        console.log(`✅ Instance started successfully: ${instance.id}`);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['running', instance.id]);
      })
      .catch(async (error) => {
        console.error(`❌ Failed to start instance: ${instance.id}`, error);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['stopped', instance.id]);
      });
    
    console.log(`✅ Start request processed for instance: ${instance.id}`);
    res.json({ message: 'Instance start initiated' });
  } catch (error) {
    console.error('❌ Failed to start instance:', error);
    res.status(500).json({ error: 'Failed to start instance', details: error.message });
  }
});

// Stop instance
router.post('/:id/stop', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔴 === STOP INSTANCE REQUEST ===`);
    console.log(`🔍 Received request to stop instance: ${id}`);
    console.log(`📍 Request URL: ${req.originalUrl}`);
    console.log(`🔧 Request method: ${req.method}`);
    
    const instance = await findInstanceByAnyId(id);
    
    if (!instance) {
      console.log(`❌ Instance not found: ${id}`);
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    console.log(`✅ Found instance: ${instance.id} (AWS: ${instance.aws_instance_id})`);
    
    // Check if it's a spot instance
    if (instance.is_spot_instance) {
      console.log(`❌ Cannot stop spot instance: ${instance.id}`);
      return res.status(400).json({ 
        error: 'Cannot stop Spot instances. Spot instances can only be terminated.' 
      });
    }
    
    // Check if AWS instance ID exists
    if (!instance.aws_instance_id) {
      console.log(`❌ No AWS instance ID found for: ${instance.id}`);
      return res.status(400).json({ 
        error: 'Instance has no AWS instance ID. It may not have been properly created.' 
      });
    }
    
    console.log(`🔄 Updating instance state to stopping...`);
    await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['stopping', instance.id]);
    
    // Stop instance using AWS SDK (async)
    console.log(`🛑 Stopping AWS instance: ${instance.aws_instance_id}`);
    stopInstance(instance.stack_name, instance.aws_instance_id)
      .then(async () => {
        console.log(`✅ Instance stopped successfully: ${instance.id}`);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['stopped', instance.id]);
      })
      .catch(async (error) => {
        console.error(`❌ Failed to stop instance: ${instance.id}`, error);
        await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['running', instance.id]);
      });
    
    console.log(`✅ Stop request processed for instance: ${instance.id}`);
    res.json({ message: 'Instance stop initiated' });
  } catch (error) {
    console.error('❌ Failed to stop instance:', error);
    res.status(500).json({ error: 'Failed to stop instance', details: error.message });
  }
});

// Terminate instance
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`💥 === TERMINATE INSTANCE REQUEST ===`);
    console.log(`🔍 Received request to terminate instance: ${id}`);
    console.log(`📍 Request URL: ${req.originalUrl}`);
    console.log(`🔧 Request method: ${req.method}`);
    
    const instance = await findInstanceByAnyId(id);
    
    if (!instance) {
      console.log(`❌ Instance not found: ${id}`);
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    console.log(`✅ Found instance: ${instance.id} (AWS: ${instance.aws_instance_id})`);
    
    console.log(`🔄 Updating instance state to terminated...`);
    await db.runAsync('UPDATE instances SET state = ? WHERE id = ?', ['terminated', instance.id]);
    
    // Terminate instance using AWS SDK (async) - only if AWS instance ID exists
    if (instance.aws_instance_id) {
      console.log(`💥 Terminating AWS instance: ${instance.aws_instance_id}`);
      terminateInstance(instance.stack_name, instance.aws_instance_id)
        .then(async () => {
          console.log(`✅ Instance terminated successfully: ${instance.id}`);
        })
        .catch(async (error) => {
          console.error(`❌ Failed to terminate instance: ${instance.id}`, error);
          // Keep state as terminated even if AWS operation fails
        });
    } else {
      console.log(`⚠️ No AWS instance ID found, only updating database state`);
    }
    
    console.log(`✅ Terminate request processed for instance: ${instance.id}`);
    res.json({ message: 'Instance termination initiated' });
  } catch (error) {
    console.error('❌ Failed to terminate instance:', error);
    res.status(500).json({ error: 'Failed to terminate instance', details: error.message });
  }
});

export default router;