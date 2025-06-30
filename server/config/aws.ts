import { EC2Client } from '@aws-sdk/client-ec2';
import { STSClient } from '@aws-sdk/client-sts';

// AWS Configuration
export const getAWSConfig = () => {
  const region = process.env.AWS_REGION || 'us-east-1';
  
  const config = {
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
  };

  // If running in development without credentials, use localstack or mock
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn('AWS credentials not found. Using mock mode.');
    return null;
  }

  return config;
};

// Create AWS clients
export const createEC2Client = (region?: string) => {
  const config = getAWSConfig();
  if (!config) return null;
  
  return new EC2Client({
    ...config,
    region: region || config.region,
  });
};

export const createSTSClient = () => {
  const config = getAWSConfig();
  if (!config) return null;
  
  return new STSClient(config);
};

// Check if AWS is configured
export const isAWSConfigured = (): boolean => {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
};