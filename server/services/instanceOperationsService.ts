import AWSService from './awsService.js';
import { InstanceCreationRequest } from '../../src/types/aws.js';

interface DeploymentResult {
  instanceId: string;
  publicIp?: string;
  privateIp: string;
  availabilityZone: string;
}

// Instance operations service that uses AWS SDK
export async function deployInstance(
  instanceId: string, 
  request: InstanceCreationRequest, 
  stackName: string
): Promise<DeploymentResult> {
  console.log(`Deploying instance ${instanceId} with stack ${stackName}`);
  console.log('Request:', request);
  
  try {
    const awsService = new AWSService(request.region);
    const result = await awsService.launchInstance(request);
    
    console.log(`✅ Instance ${instanceId} deployed successfully:`, result);
    return result;
  } catch (error) {
    console.error(`Failed to deploy instance ${instanceId}:`, error);
    throw error;
  }
}

export async function terminateInstance(stackName: string, instanceId?: string): Promise<void> {
  console.log(`Terminating instance with stack: ${stackName}`);
  
  if (!instanceId) {
    console.log('No instance ID provided, skipping AWS termination');
    return;
  }

  try {
    const awsService = new AWSService();
    await awsService.terminateInstance(instanceId);
    console.log(`Instance ${instanceId} terminated successfully`);
  } catch (error) {
    console.error(`Failed to terminate instance ${instanceId}:`, error);
    throw error;
  }
}

export async function startInstance(stackName: string, instanceId?: string): Promise<void> {
  console.log(`Starting instance with stack: ${stackName}`);
  
  if (!instanceId) {
    console.log('No instance ID provided, skipping AWS start');
    return;
  }

  try {
    const awsService = new AWSService();
    await awsService.startInstance(instanceId);
    console.log(`Instance ${instanceId} started successfully`);
  } catch (error) {
    console.error(`Failed to start instance ${instanceId}:`, error);
    throw error;
  }
}

export async function stopInstance(stackName: string, instanceId?: string): Promise<void> {
  console.log(`Stopping instance with stack: ${stackName}`);
  
  if (!instanceId) {
    console.log('No instance ID provided, skipping AWS stop');
    return;
  }

  try {
    const awsService = new AWSService();
    await awsService.stopInstance(instanceId);
    console.log(`Instance ${instanceId} stopped successfully`);
  } catch (error) {
    console.error(`Failed to stop instance ${instanceId}:`, error);
    throw error;
  }
}