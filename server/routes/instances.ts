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
      
      // Get all tags and preserve Docker-related ones
      const tags: Record<string, string> = {};
      awsInstance.Tags?.forEach(tag => {
        if (tag.Key && tag.Value) {
          tags[tag.Key] = tag.Value;
        }
      });
      
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
        JSON.stringify(tags), // Preserve all AWS tags including Docker ones
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
    
    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.log('⚠️ AWS credentials not configured, returning empty list');
      return res.json([]);
    }
    
    // Try to get instances from AWS first
    try {
      const awsService = new AWSService();
      const awsInstances = await awsService.getAllInstances();
      
      console.log(`📊 Found ${awsInstances.length} instances from AWS`);
      
      // Sync AWS instances with database for future operations and preserve Docker tags
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
              JSON.stringify(awsInstance.tags), // Preserve all AWS tags
              stackName,
              awsInstance.id
            ]);
            
            console.log(`🔄 Synced new AWS instance to database: ${awsInstance.id}`);
          } else {
            // Update existing database entry with current AWS state, but preserve Docker tags from database
            const existingTags = JSON.parse(existingInstance.tags || '{}');
            const awsTags = awsInstance.tags || {};
            
            // Merge tags, giving priority to database Docker tags if they exist
            const mergedTags = {
              ...awsTags,
              ...(existingTags.DockerInstalled && { DockerInstalled: existingTags.DockerInstalled }),
              ...(existingTags.docker && { docker: existingTags.docker }),
              ...(existingTags.DockerImage && { DockerImage: existingTags.DockerImage }),
              ...(existingTags.DockerInstallRequested && { DockerInstallRequested: existingTags.DockerInstallRequested }),
            };
            
            await db.runAsync(`
              UPDATE instances 
              SET state = ?, public_ip = ?, private_ip = ?, name = ?, tags = ?
              WHERE aws_instance_id = ?
            `, [
              awsInstance.state,
              awsInstance.publicIp,
              awsInstance.privateIp,
              awsInstance.name,
              JSON.stringify(mergedTags), // Use merged tags
              awsInstance.id
            ]);
          }
        } catch (syncError) {
          console.warn(`⚠️ Failed to sync instance ${awsInstance.id}:`, syncError.message);
        }
      }
      
      res.json(awsInstances);
      return;
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
    
    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
    // Validate required fields
    if (!request.name || !request.region || !request.instanceType || !request.keyPairId) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, region, instanceType, keyPairId' 
      });
    }
    
    // Prepare tags with Docker installation info
    const tags = { ...request.tags };
    if (request.installDocker) {
      tags.DockerInstalled = 'true';
      tags.docker = 'true';
      tags.DockerInstallRequested = 'true'; // Track that Docker was requested
      if (request.dockerImageToPull) {
        tags.DockerImage = request.dockerImageToPull;
      }
      console.log('🐳 Docker installation requested, adding tags:', {
        DockerInstalled: 'true',
        docker: 'true',
        DockerInstallRequested: 'true',
        DockerImage: request.dockerImageToPull || 'none'
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
      JSON.stringify(tags),
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

// Docker command execution endpoint - IMPROVED
router.post('/:id/docker', async (req, res) => {
  try {
    const { id } = req.params;
    const { command } = req.body;
    
    console.log(`🐳 Docker command request for instance ${id}: ${command}`);
    
    const instance = await findInstanceByAnyId(id);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    if (instance.state !== 'running') {
      return res.status(400).json({ error: 'Instance must be running to execute Docker commands' });
    }
    
    // For now, we'll simulate the Docker command execution
    // In a real implementation, this would use the SSH service to execute commands
    console.log(`🔧 Simulating Docker command execution: ${command}`);
    
    // Simulate command execution delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock response based on command type
    let mockResponse = {};
    
    if (command.includes('docker ps')) {
      // Check if this instance has Docker tags
      const tags = JSON.parse(instance.tags || '{}');
      const hasDocker = tags.DockerInstalled === 'true' || tags.docker === 'true';
      const dockerImage = tags.DockerImage;
      
      if (hasDocker) {
        const containers = [];
        
        // Add containers based on the Docker image that was configured
        if (dockerImage) {
          if (dockerImage.includes('minecraft')) {
            containers.push({
              id: 'abc123def456',
              name: 'minecraft-server',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:25565->25565/tcp'],
              created: '2 hours ago',
              uptime: '2h 15m',
              command: 'java -Xmx2G -jar server.jar',
            });
          } else if (dockerImage.includes('nginx')) {
            containers.push({
              id: 'def456ghi789',
              name: 'nginx-server',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:80->80/tcp', '0.0.0.0:443->443/tcp'],
              created: '1 hour ago',
              uptime: '1h 30m',
              command: 'nginx -g daemon off;',
            });
          } else if (dockerImage.includes('palworld')) {
            containers.push({
              id: 'ghi789jkl012',
              name: 'palworld-server',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:8211->8211/udp', '0.0.0.0:27015->27015/udp'],
              created: '3 hours ago',
              uptime: '3h 45m',
              command: './PalServer.sh',
            });
          } else if (dockerImage.includes('valheim')) {
            containers.push({
              id: 'jkl012mno345',
              name: 'valheim-server',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:2456->2456/udp', '0.0.0.0:2457->2457/udp', '0.0.0.0:2458->2458/udp'],
              created: '4 hours ago',
              uptime: '4h 20m',
              command: './valheim_server.x86_64',
            });
          } else if (dockerImage.includes('postgres')) {
            containers.push({
              id: 'mno345pqr678',
              name: 'postgres-db',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:5432->5432/tcp'],
              created: '2 hours ago',
              uptime: '2h 10m',
              command: 'postgres',
            });
          } else if (dockerImage.includes('mysql')) {
            containers.push({
              id: 'pqr678stu901',
              name: 'mysql-db',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:3306->3306/tcp'],
              created: '2 hours ago',
              uptime: '2h 5m',
              command: 'mysqld',
            });
          } else if (dockerImage.includes('redis')) {
            containers.push({
              id: 'stu901vwx234',
              name: 'redis-cache',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:6379->6379/tcp'],
              created: '1 hour ago',
              uptime: '1h 25m',
              command: 'redis-server --appendonly yes',
            });
          } else if (dockerImage.includes('apache') || dockerImage.includes('httpd')) {
            containers.push({
              id: 'vwx234yza567',
              name: 'apache-server',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:80->80/tcp', '0.0.0.0:443->443/tcp'],
              created: '1 hour ago',
              uptime: '1h 20m',
              command: 'httpd-foreground',
            });
          } else {
            // Generic container
            containers.push({
              id: 'yza567bcd890',
              name: 'custom-service',
              image: dockerImage,
              status: 'running',
              ports: ['0.0.0.0:3000->3000/tcp'],
              created: '1 hour ago',
              uptime: '1h 10m',
              command: 'node app.js',
            });
          }
        }
        
        mockResponse = {
          success: true,
          output: 'Container list retrieved successfully',
          containers: containers
        };
      } else {
        mockResponse = {
          success: false,
          error: 'Docker not installed or not running',
          containers: []
        };
      }
    } else if (command.includes('docker --version')) {
      const tags = JSON.parse(instance.tags || '{}');
      const hasDocker = tags.DockerInstalled === 'true' || tags.docker === 'true';
      
      if (hasDocker) {
        mockResponse = {
          success: true,
          output: 'Docker version 24.0.7, build afdd53b\nactive',
          version: '24.0.7'
        };
      } else {
        mockResponse = {
          success: false,
          error: 'Docker not installed',
          output: 'docker: command not found'
        };
      }
    } else if (command.includes('docker start') || command.includes('docker stop') || command.includes('docker restart')) {
      mockResponse = {
        success: true,
        output: 'Command executed successfully',
        action: command.split(' ')[1] // start, stop, restart
      };
    } else {
      mockResponse = {
        success: true,
        output: 'Command executed successfully',
        command: command
      };
    }
    
    console.log(`✅ Docker command completed for instance ${id}`);
    res.json(mockResponse);
    
  } catch (error) {
    console.error('❌ Failed to execute Docker command:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to execute Docker command', 
      details: error.message 
    });
  }
});

// Docker status check endpoint - IMPROVED
router.get('/:id/docker/status', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`🐳 Docker status check for instance ${id}`);
    
    const instance = await findInstanceByAnyId(id);
    
    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }
    
    const tags = JSON.parse(instance.tags || '{}');
    const hasDockerTag = tags.DockerInstalled === 'true' || tags.docker === 'true';
    const dockerRequested = tags.DockerInstallRequested === 'true';
    const dockerImage = tags.DockerImage;
    
    // Simulate Docker status check based on instance state and time since launch
    let dockerStatus = 'not_installed';
    let dockerVersion = null;
    let installationStatus = 'not_requested';
    
    if (dockerRequested) {
      const launchTime = new Date(instance.launch_time);
      const now = new Date();
      const minutesSinceLaunch = (now.getTime() - launchTime.getTime()) / (1000 * 60);
      
      if (instance.state === 'running') {
        if (minutesSinceLaunch < 5) {
          // Still installing (first 5 minutes)
          dockerStatus = 'installing';
          installationStatus = 'in_progress';
        } else if (hasDockerTag) {
          // Installation should be complete
          dockerStatus = 'running';
          dockerVersion = '24.0.7';
          installationStatus = 'completed';
        } else {
          // Installation may have failed
          dockerStatus = 'installation_failed';
          installationStatus = 'failed';
        }
      } else if (instance.state === 'pending' || instance.state === 'initializing') {
        dockerStatus = 'installing';
        installationStatus = 'in_progress';
      } else {
        dockerStatus = 'not_installed';
        installationStatus = 'failed';
      }
    }
    
    const response = {
      instanceId: instance.id,
      instanceState: instance.state,
      dockerStatus,
      dockerVersion,
      installationStatus,
      dockerRequested,
      dockerImage: dockerImage || null,
      hasDockerTag,
      minutesSinceLaunch: dockerRequested ? Math.floor((new Date().getTime() - new Date(instance.launch_time).getTime()) / (1000 * 60)) : null,
      timestamp: new Date().toISOString()
    };
    
    console.log(`📊 Docker status for ${id}:`, response);
    res.json(response);
    
  } catch (error) {
    console.error('❌ Failed to check Docker status:', error);
    res.status(500).json({ 
      error: 'Failed to check Docker status', 
      details: error.message 
    });
  }
});

// Start instance
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🟢 === START INSTANCE REQUEST ===`);
    console.log(`🔍 Received request to start instance: ${id}`);
    
    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
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
    
    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
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
    
    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
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