import {
  EC2Client,
  DescribeVolumesCommand,
  CreateVolumeCommand,
  AttachVolumeCommand,
  DetachVolumeCommand,
  DeleteVolumeCommand,
  DescribeAvailabilityZonesCommand,
} from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from './awsClient.js';

export class VolumeService {
  constructor() {
    if (!isAWSConfigured()) {
      throw new Error('AWS credentials not configured');
    }
  }

  // ==========================================
  // VOLUME MANAGEMENT
  // ==========================================
  async getVolumes(region: string): Promise<any[]> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('Failed to create AWS client for region: ' + region);
    }

    try {
      const command = new DescribeVolumesCommand({});
      const response = await regionClient.send(command);

      return response.Volumes?.map(volume => ({
        id: volume.VolumeId!,
        type: volume.VolumeType!,
        size: volume.Size!,
        state: volume.State!,
        region: region,
        encrypted: volume.Encrypted || false,
        instanceId: volume.Attachments?.[0]?.InstanceId,
        device: volume.Attachments?.[0]?.Device,
        createdAt: volume.CreateTime || new Date(),
        deleteOnTermination: volume.Attachments?.[0]?.DeleteOnTermination || false,
        iops: volume.Iops,
        throughput: volume.Throughput,
      })) || [];
    } catch (error) {
      console.error('❌ Failed to get volumes:', error);
      throw error;
    }
  }

  async createVolume(volumeConfig: any): Promise<any> {
    const regionClient = createEC2Client(volumeConfig.region);
    if (!regionClient) {
      throw new Error('Failed to create AWS client for region: ' + volumeConfig.region);
    }

    try {
      // Get the first availability zone for the region
      const availabilityZones = await this.getAvailabilityZones(volumeConfig.region);
      const availabilityZone = availabilityZones[0];

      console.log(`🔧 Creating volume in availability zone: ${availabilityZone}`);

      // Prepare command parameters based on volume type
      const commandParams: any = {
        VolumeType: volumeConfig.type,
        Size: volumeConfig.size,
        AvailabilityZone: availabilityZone,
        Encrypted: volumeConfig.encrypted || false,
      };

      // Only add IOPS for volume types that support it
      if ((volumeConfig.type === 'io1' || volumeConfig.type === 'io2') && volumeConfig.iops) {
        commandParams.Iops = volumeConfig.iops;
      } else if (volumeConfig.type === 'gp3' && volumeConfig.iops && volumeConfig.iops !== 3000) {
        // Only set IOPS for gp3 if it's different from default (3000)
        commandParams.Iops = volumeConfig.iops;
      }

      // Only add Throughput for gp3 volumes
      if (volumeConfig.type === 'gp3' && volumeConfig.throughput && volumeConfig.throughput !== 125) {
        // Only set throughput for gp3 if it's different from default (125)
        commandParams.Throughput = volumeConfig.throughput;
      }

      console.log('🔧 Creating volume with parameters:', commandParams);

      const command = new CreateVolumeCommand(commandParams);
      const response = await regionClient.send(command);

      return {
        id: response.VolumeId!,
        type: response.VolumeType!,
        size: response.Size!,
        state: response.State!,
        region: volumeConfig.region,
        encrypted: response.Encrypted || false,
        createdAt: response.CreateTime || new Date(),
        deleteOnTermination: false,
        iops: response.Iops,
        throughput: response.Throughput,
      };
    } catch (error) {
      console.error('❌ Failed to create volume in AWS:', error);
      throw error;
    }
  }

  async attachVolume(volumeId: string, instanceId: string, device: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new AttachVolumeCommand({
        VolumeId: volumeId,
        InstanceId: instanceId,
        Device: device,
      });

      await ec2Client.send(command);
      console.log(`✅ Volume ${volumeId} attached to instance ${instanceId} as ${device}`);
    } catch (error) {
      console.error('❌ Failed to attach volume:', error);
      throw error;
    }
  }

  async detachVolume(volumeId: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      console.log(`🔧 Detaching volume ${volumeId} from AWS`);
      
      const command = new DetachVolumeCommand({
        VolumeId: volumeId,
        Force: false, // Set to true only if you want to force detach
      });

      await ec2Client.send(command);
      console.log(`✅ Volume ${volumeId} detached successfully`);
    } catch (error) {
      console.error('❌ Failed to detach volume:', error);
      throw error;
    }
  }

  async deleteVolume(volumeId: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      console.log(`🔧 Deleting volume ${volumeId} from AWS`);
      
      const command = new DeleteVolumeCommand({
        VolumeId: volumeId,
      });

      await ec2Client.send(command);
      console.log(`✅ Volume ${volumeId} deleted successfully`);
    } catch (error) {
      console.error('❌ Failed to delete volume:', error);
      throw error;
    }
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================
  private async getAvailabilityZones(region: string): Promise<string[]> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      return [`${region}a`, `${region}b`, `${region}c`];
    }

    try {
      const command = new DescribeAvailabilityZonesCommand({});
      const response = await regionClient.send(command);

      return response.AvailabilityZones?.map(az => az.ZoneName!) || [`${region}a`];
    } catch (error) {
      console.error('❌ Failed to get availability zones:', error);
      return [`${region}a`, `${region}b`, `${region}c`];
    }
  }
}