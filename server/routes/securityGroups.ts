import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/index.js';
import AWSService from '../services/awsService.js';
import { SecurityGroup } from '../../src/types/aws.js';

const router = express.Router();

// Get all security groups
router.get('/', async (req, res) => {
  try {
    const { region } = req.query;
    
    if (!region) {
      return res.status(400).json({ error: 'Region parameter is required' });
    }

    console.log(`Getting security groups for region: ${region}`);

    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      console.log('⚠️ AWS credentials not configured, using database only');
      const securityGroups = await db.allAsync(
        'SELECT * FROM security_groups WHERE region = ? ORDER BY created_at DESC',
        [region]
      );
      
      const parsedSecurityGroups = securityGroups.map((sg: any) => ({
        ...sg,
        rules: JSON.parse(sg.rules || '[]'),
      }));
      
      return res.json(parsedSecurityGroups);
    }

    // Try to get from AWS first, fallback to database
    try {
      const awsService = new AWSService(region as string);
      const awsSecurityGroups = await awsService.getSecurityGroups(region as string);
      console.log(`Found ${awsSecurityGroups.length} security groups in AWS`);
      res.json(awsSecurityGroups);
    } catch (awsError) {
      console.warn('Failed to get security groups from AWS, using database:', awsError);
      
      // Fallback to database
      const securityGroups = await db.allAsync(
        'SELECT * FROM security_groups WHERE region = ? ORDER BY created_at DESC',
        [region]
      );
      
      const parsedSecurityGroups = securityGroups.map((sg: any) => ({
        ...sg,
        rules: JSON.parse(sg.rules || '[]'),
      }));
      
      res.json(parsedSecurityGroups);
    }
  } catch (error) {
    console.error('Failed to get security groups:', error);
    res.status(500).json({ error: 'Failed to get security groups' });
  }
});

// Create security group
router.post('/', async (req, res) => {
  try {
    const { name, description, region, rules } = req.body;
    
    console.log(`Creating security group: ${name} in region: ${region}`);
    
    if (!name || !description || !region) {
      return res.status(400).json({ error: 'Name, description, and region are required' });
    }

    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
    // Try to create in AWS first
    try {
      const awsService = new AWSService(region);
      const awsSecurityGroup = await awsService.createSecurityGroup({
        name,
        description,
        region,
        rules: rules || []
      });
      
      if (awsSecurityGroup) {
        console.log(`Security group created in AWS: ${awsSecurityGroup.id}`);
        res.status(201).json(awsSecurityGroup);
        return;
      }
    } catch (awsError) {
      console.warn('Failed to create security group in AWS, creating locally:', awsError);
    }
    
    // Fallback to local creation
    const id = uuidv4();
    await db.runAsync(`
      INSERT INTO security_groups (id, name, description, region, rules)
      VALUES (?, ?, ?, ?, ?)
    `, [id, name, description, region, JSON.stringify(rules || [])]);
    
    const securityGroup = await db.getAsync('SELECT * FROM security_groups WHERE id = ?', [id]);
    const parsedSecurityGroup = {
      ...securityGroup,
      rules: JSON.parse(securityGroup.rules || '[]'),
    };
    
    console.log(`Security group created locally: ${id}`);
    res.status(201).json(parsedSecurityGroup);
  } catch (error) {
    console.error('Failed to create security group:', error);
    res.status(500).json({ error: 'Failed to create security group' });
  }
});

// Update security group
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rules } = req.body;
    
    console.log(`Updating security group: ${id}`);

    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
    // Try to update in AWS first
    try {
      const awsService = new AWSService();
      const awsSecurityGroup = await awsService.updateSecurityGroup(id, {
        name,
        description,
        rules: rules || []
      });
      
      if (awsSecurityGroup) {
        console.log(`Security group updated in AWS: ${id}`);
        res.json(awsSecurityGroup);
        return;
      }
    } catch (awsError) {
      console.warn('Failed to update security group in AWS, updating locally:', awsError);
    }
    
    // Fallback to local update
    await db.runAsync(`
      UPDATE security_groups 
      SET name = ?, description = ?, rules = ?
      WHERE id = ?
    `, [name, description, JSON.stringify(rules || []), id]);
    
    const securityGroup = await db.getAsync('SELECT * FROM security_groups WHERE id = ?', [id]);
    
    if (!securityGroup) {
      return res.status(404).json({ error: 'Security group not found' });
    }
    
    const parsedSecurityGroup = {
      ...securityGroup,
      rules: JSON.parse(securityGroup.rules || '[]'),
    };
    
    console.log(`Security group updated locally: ${id}`);
    res.json(parsedSecurityGroup);
  } catch (error) {
    console.error('Failed to update security group:', error);
    res.status(500).json({ error: 'Failed to update security group' });
  }
});

// Delete security group
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`Deleting security group: ${id}`);

    // Check if AWS is configured
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }
    
    // Try to delete from AWS first
    try {
      const awsService = new AWSService();
      await awsService.deleteSecurityGroup(id);
      console.log(`Security group deleted from AWS: ${id}`);
    } catch (awsError) {
      console.warn('Failed to delete security group from AWS:', awsError);
      // Continue with local deletion even if AWS fails
    }
    
    // Delete from database
    const result = await db.runAsync('DELETE FROM security_groups WHERE id = ?', [id]);
    
    if (result && typeof result === 'object' && 'changes' in result && result.changes === 0) {
      return res.status(404).json({ error: 'Security group not found' });
    }
    
    console.log(`Security group deleted: ${id}`);
    res.json({ message: 'Security group deleted successfully' });
  } catch (error) {
    console.error('Failed to delete security group:', error);
    res.status(500).json({ error: 'Failed to delete security group' });
  }
});

export default router;