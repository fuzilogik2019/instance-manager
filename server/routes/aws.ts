import express from 'express';
import AWSService from '../services/awsService.js';

const router = express.Router();

// Set AWS credentials for the session
router.post('/set-credentials', async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region } = req.body;
    
    if (!accessKeyId || !secretAccessKey || !region) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required credentials' 
      });
    }

    // Set environment variables for the session
    process.env.AWS_ACCESS_KEY_ID = accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
    process.env.AWS_REGION = region;

    console.log('✅ AWS credentials configured successfully');
    
    res.json({ 
      success: true, 
      message: 'Credentials configured successfully' 
    });
  } catch (error) {
    console.error('Failed to set credentials:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Test AWS credentials
router.post('/test-credentials', async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region } = req.body;
    
    if (!accessKeyId || !secretAccessKey || !region) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required credentials' 
      });
    }

    // Temporarily set environment variables for testing
    const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
    const originalSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
    const originalRegion = process.env.AWS_REGION;

    process.env.AWS_ACCESS_KEY_ID = accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
    process.env.AWS_REGION = region;

    try {
      // Test the credentials by trying to get regions
      const awsService = new AWSService();
      const regions = await awsService.getRegions();
      
      if (regions && regions.length > 0) {
        res.json({ 
          success: true, 
          message: 'AWS credentials verified successfully',
          regionsFound: regions.length 
        });
      } else {
        res.status(401).json({ 
          success: false, 
          error: 'Invalid AWS credentials or insufficient permissions' 
        });
      }
    } catch (error) {
      console.error('AWS credentials test failed:', error);
      res.status(401).json({ 
        success: false, 
        error: 'Invalid AWS credentials or network error' 
      });
    } finally {
      // Restore original environment variables
      if (originalAccessKey) {
        process.env.AWS_ACCESS_KEY_ID = originalAccessKey;
      } else {
        delete process.env.AWS_ACCESS_KEY_ID;
      }
      
      if (originalSecretKey) {
        process.env.AWS_SECRET_ACCESS_KEY = originalSecretKey;
      } else {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      }
      
      if (originalRegion) {
        process.env.AWS_REGION = originalRegion;
      } else {
        delete process.env.AWS_REGION;
      }
    }
  } catch (error) {
    console.error('Failed to test credentials:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Get AWS regions
router.get('/regions', async (req, res) => {
  try {
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
    }

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

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
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

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return res.status(401).json({ 
        error: 'AWS credentials not configured' 
      });
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