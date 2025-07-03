import { AMIService } from './aws/amiService.js';
import { InstanceService } from './aws/instanceService.js';
import { RegionService } from './aws/regionService.js';
import { SecurityGroupService } from './aws/securityGroupService.js';
import { KeyPairService } from './aws/keyPairService.js';
import { VolumeService } from './aws/volumeService.js';
import { isAWSConfigured } from './aws/awsClient.js';
import { InstanceCreationRequest, EC2Instance, AWSRegion, InstanceType, AMI } from '../../src/types/aws.js';

export class AWSService {
  private amiService: AMIService;
  private instanceService: InstanceService;
  private regionService: RegionService;
  private securityGroupService: SecurityGroupService;
  private keyPairService: KeyPairService;
  private volumeService: VolumeService;

  constructor(region?: string) {
    if (!isAWSConfigured()) {
      throw new Error('AWS credentials not configured. Please configure your credentials first.');
    }
    
    this.amiService = new AMIService();
    this.instanceService = new InstanceService();
    this.regionService = new RegionService();
    this.securityGroupService = new SecurityGroupService();
    this.keyPairService = new KeyPairService();
    this.volumeService = new VolumeService();
    
    console.log('✅ AWS Service initialized with valid credentials');
  }

  // ==========================================
  // AMI MANAGEMENT
  // ==========================================
  async getAMIs(region: string): Promise<AMI[]> {
    return this.amiService.getAMIs(region);
  }

  // ==========================================
  // INSTANCE MANAGEMENT
  // ==========================================
  async getAllInstances(): Promise<EC2Instance[]> {
    return this.instanceService.getAllInstances();
  }

  async launchInstance(request: InstanceCreationRequest): Promise<{ instanceId: string; publicIp?: string; privateIp: string; availabilityZone: string }> {
    return this.instanceService.launchInstance(request);
  }

  async terminateInstance(instanceId: string): Promise<void> {
    return this.instanceService.terminateInstance(instanceId);
  }

  async startInstance(instanceId: string): Promise<void> {
    return this.instanceService.startInstance(instanceId);
  }

  async stopInstance(instanceId: string): Promise<void> {
    return this.instanceService.stopInstance(instanceId);
  }

  async getInstanceDetails(instanceId: string) {
    return this.instanceService.getInstanceDetails(instanceId);
  }

  async isSpotInstance(instanceId: string): Promise<boolean> {
    try {
      const instance = await this.instanceService.getInstanceDetails(instanceId);
      return !!(instance?.SpotInstanceRequestId);
    } catch (error) {
      console.error('❌ Failed to check if instance is spot:', error);
      return false;
    }
  }

  // ==========================================
  // REGION AND INSTANCE TYPE INFORMATION
  // ==========================================
  async getRegions(): Promise<AWSRegion[]> {
    return this.regionService.getRegions();
  }

  async getInstanceTypes(region: string): Promise<InstanceType[]> {
    return this.regionService.getInstanceTypes(region);
  }

  async getAvailabilityZones(region: string): Promise<string[]> {
    return this.regionService.getAvailabilityZones(region);
  }

  // ==========================================
  // SECURITY GROUP MANAGEMENT
  // ==========================================
  async getSecurityGroups(region: string): Promise<any[]> {
    return this.securityGroupService.getSecurityGroups(region);
  }

  async createSecurityGroup(securityGroup: any): Promise<any> {
    return this.securityGroupService.createSecurityGroup(securityGroup);
  }

  async updateSecurityGroup(id: string, updates: any): Promise<any> {
    return this.securityGroupService.updateSecurityGroup(id, updates);
  }

  async deleteSecurityGroup(id: string): Promise<void> {
    return this.securityGroupService.deleteSecurityGroup(id);
  }

  // ==========================================
  // KEY PAIR MANAGEMENT
  // ==========================================
  async getKeyPairs(): Promise<any[]> {
    return this.keyPairService.getKeyPairs();
  }

  async createKeyPair(name: string): Promise<any> {
    return this.keyPairService.createKeyPair(name);
  }

  async importKeyPair(name: string, publicKey: string): Promise<any> {
    return this.keyPairService.importKeyPair(name, publicKey);
  }

  async deleteKeyPair(keyName: string): Promise<void> {
    return this.keyPairService.deleteKeyPair(keyName);
  }

  // ==========================================
  // VOLUME MANAGEMENT
  // ==========================================
  async getVolumes(region: string): Promise<any[]> {
    return this.volumeService.getVolumes(region);
  }

  async createVolume(volumeConfig: any): Promise<any> {
    return this.volumeService.createVolume(volumeConfig);
  }

  async attachVolume(volumeId: string, instanceId: string, device: string): Promise<void> {
    return this.volumeService.attachVolume(volumeId, instanceId, device);
  }

  async detachVolume(volumeId: string): Promise<void> {
    return this.volumeService.detachVolume(volumeId);
  }

  async deleteVolume(volumeId: string): Promise<void> {
    return this.volumeService.deleteVolume(volumeId);
  }
}

export default AWSService;