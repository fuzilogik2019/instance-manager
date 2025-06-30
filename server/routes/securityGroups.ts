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

    // Try to get from AWS first, fallback to database
    try {
      const awsService = new AWSService(region as string);
      const awsSecurityGroups = await awsService.getSecurityGroups(region as string);
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
    const result = await db.runAsync('DELETE FROM security_groups WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Security group not found' });
    }
    
    res.json({ message: 'Security group deleted successfully' });
  } catch (error) {
    console.error('Failed to delete security group:', error);
    res.status(500).json({ error: 'Failed to delete security group' });
  }
});

export default router;