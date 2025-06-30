import express from 'express';
import AWSService from '../services/awsService.js';

const router = express.Router();

// Get AWS regions
router.get('/regions', async (req, res) => {
  try {
    const awsService = new AWSService();
    const regions = await awsService.getRegions();
    res.json(regions);
  } catch (error) {
    console.error('Failed to get regions:', error);
    res.status(500).json({ error: 'Failed to get regions' });
  }
});

// Get instance types for a region
router.get('/instance-types', async (req, res) => {
  try {
    const { region } = req.query;
    
    if (!region) {
      return res.status(400).json({ error: 'Region parameter is required' });
    }
    
    const awsService = new AWSService(region as string);
    const instanceTypes = await awsService.getInstanceTypes(region as string);
    res.json(instanceTypes);
  } catch (error) {
    console.error('Failed to get instance types:', error);
    res.status(500).json({ error: 'Failed to get instance types' });
  }
});

// Get available AMIs for a region
router.get('/amis', async (req, res) => {
  try {
    const { region } = req.query;
    
    if (!region) {
      return res.status(400).json({ error: 'Region parameter is required' });
    }
    
    console.log(`Getting AMIs for region: ${region}`);
    const awsService = new AWSService(region as string);
    const amis = await awsService.getAMIs(region as string);
    console.log(`Returning ${amis.length} AMIs for region ${region}`);
    res.json(amis);
  } catch (error) {
    console.error('Failed to get AMIs:', error);
    res.status(500).json({ error: 'Failed to get AMIs' });
  }
});

export default router;