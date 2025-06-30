import axios from 'axios';
import { 
  AWSRegion, 
  InstanceType, 
  EC2Instance, 
  SecurityGroup, 
  SSHKeyPair, 
  EBSVolume,
  InstanceCreationRequest,
  AMI
} from '../types/aws';

const API_BASE_URL = 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Add response interceptor to handle errors better
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.data?.error) {
      // Create a new error with the server's error message
      const serverError = new Error(error.response.data.error);
      serverError.message = error.response.data.error;
      throw serverError;
    }
    throw error;
  }
);

// AWS Data
export const getRegions = async (): Promise<AWSRegion[]> => {
  const response = await api.get('/aws/regions');
  return response.data;
};

export const getInstanceTypes = async (region: string): Promise<InstanceType[]> => {
  const response = await api.get(`/aws/instance-types?region=${region}`);
  return response.data;
};

export const getAMIs = async (region: string): Promise<AMI[]> => {
  const response = await api.get(`/aws/amis?region=${region}`);
  return response.data;
};

// EC2 Instances
export const getInstances = async (): Promise<EC2Instance[]> => {
  const response = await api.get('/instances');
  return response.data;
};

export const createInstance = async (request: InstanceCreationRequest): Promise<EC2Instance> => {
  const response = await api.post('/instances', request);
  return response.data;
};

export const terminateInstance = async (instanceId: string): Promise<void> => {
  await api.delete(`/instances/${instanceId}`);
};

export const startInstance = async (instanceId: string): Promise<void> => {
  await api.post(`/instances/${instanceId}/start`);
};

export const stopInstance = async (instanceId: string): Promise<void> => {
  await api.post(`/instances/${instanceId}/stop`);
};

// Security Groups
export const getSecurityGroups = async (region: string): Promise<SecurityGroup[]> => {
  const response = await api.get(`/security-groups?region=${region}`);
  return response.data;
};

export const createSecurityGroup = async (securityGroup: Omit<SecurityGroup, 'id'>): Promise<SecurityGroup> => {
  const response = await api.post('/security-groups', securityGroup);
  return response.data;
};

export const updateSecurityGroup = async (id: string, securityGroup: Partial<SecurityGroup>): Promise<SecurityGroup> => {
  const response = await api.put(`/security-groups/${id}`, securityGroup);
  return response.data;
};

export const deleteSecurityGroup = async (id: string): Promise<void> => {
  await api.delete(`/security-groups/${id}`);
};

// SSH Key Pairs
export const getKeyPairs = async (): Promise<SSHKeyPair[]> => {
  const response = await api.get('/keypairs');
  return response.data;
};

export const createKeyPair = async (name: string): Promise<SSHKeyPair> => {
  const response = await api.post('/keypairs', { name });
  return response.data;
};

export const uploadKeyPair = async (name: string, publicKey: string, privateKey?: string): Promise<SSHKeyPair> => {
  const response = await api.post('/keypairs/upload', { name, publicKey, privateKey });
  return response.data;
};

export const deleteKeyPair = async (id: string): Promise<void> => {
  await api.delete(`/keypairs/${id}`);
};

// EBS Volumes
export const getVolumes = async (region: string): Promise<EBSVolume[]> => {
  const response = await api.get(`/volumes?region=${region}`);
  return response.data;
};

export const createVolume = async (volume: Omit<EBSVolume, 'id' | 'createdAt' | 'state'>): Promise<EBSVolume> => {
  const response = await api.post('/volumes', volume);
  return response.data;
};

export const attachVolume = async (volumeId: string, instanceId: string, device: string): Promise<void> => {
  await api.post(`/volumes/${volumeId}/attach`, { instanceId, device });
};

export const detachVolume = async (volumeId: string): Promise<void> => {
  await api.post(`/volumes/${volumeId}/detach`);
};

export const deleteVolume = async (volumeId: string): Promise<void> => {
  await api.delete(`/volumes/${volumeId}`);
};