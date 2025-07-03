import { EC2Client, DescribeRegionsCommand, DescribeInstanceTypesCommand, DescribeAvailabilityZonesCommand } from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from './awsClient.js';
import { AWSRegion, InstanceType } from '../../../src/types/aws.js';

export class RegionService {
  constructor() {
    if (!isAWSConfigured()) {
      throw new Error('AWS credentials not configured');
    }
  }

  // ==========================================
  // REGION INFORMATION
  // ==========================================
  async getRegions(): Promise<AWSRegion[]> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new DescribeRegionsCommand({});
      const response = await ec2Client.send(command);

      return response.Regions?.map(region => ({
        code: region.RegionName!,
        name: this.getRegionDisplayName(region.RegionName!),
        location: this.getRegionLocation(region.RegionName!),
      })) || [];
    } catch (error) {
      console.error('❌ Failed to get regions:', error);
      throw error;
    }
  }

  async getInstanceTypes(region: string): Promise<InstanceType[]> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('Failed to create AWS client for region: ' + region);
    }

    try {
      const command = new DescribeInstanceTypesCommand({
        InstanceTypes: [
          't3.nano', 't3.micro', 't3.small', 't3.medium', 't3.large', 't3.xlarge',
          'm5.large', 'm5.xlarge', 'm5.2xlarge',
          'c5.large', 'c5.xlarge',
          'r5.large', 'r5.xlarge'
        ],
      });

      const response = await regionClient.send(command);

      return response.InstanceTypes?.map(type => ({
        name: type.InstanceType!,
        vcpu: type.VCpuInfo?.DefaultVCpus || 0,
        memory: type.MemoryInfo?.SizeInMiB ? type.MemoryInfo.SizeInMiB / 1024 : 0,
        storage: type.InstanceStorageInfo?.TotalSizeInGB ? `${type.InstanceStorageInfo.TotalSizeInGB} GB` : 'EBS-Only',
        network: type.NetworkInfo?.NetworkPerformance || 'Unknown',
        onDemandPrice: 0, // Would need AWS Pricing API
        spotPrice: 0, // Would need AWS EC2 Spot Price API
      })) || [];
    } catch (error) {
      console.error('❌ Failed to get instance types:', error);
      throw error;
    }
  }

  async getAvailabilityZones(region: string): Promise<string[]> {
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

  // ==========================================
  // HELPER METHODS
  // ==========================================
  private getRegionDisplayName(regionCode: string): string {
    const regionNames: Record<string, string> = {
      'us-east-1': 'US East (N. Virginia)',
      'us-east-2': 'US East (Ohio)',
      'us-west-1': 'US West (N. California)',
      'us-west-2': 'US West (Oregon)',
      'eu-west-1': 'Europe (Ireland)',
      'eu-west-2': 'Europe (London)',
      'eu-central-1': 'Europe (Frankfurt)',
      'ap-southeast-1': 'Asia Pacific (Singapore)',
      'ap-southeast-2': 'Asia Pacific (Sydney)',
      'ap-northeast-1': 'Asia Pacific (Tokyo)',
      'sa-east-1': 'South America (São Paulo)',
      'ca-central-1': 'Canada (Central)',
      'ap-south-1': 'Asia Pacific (Mumbai)',
    };

    return regionNames[regionCode] || regionCode;
  }

  private getRegionLocation(regionCode: string): string {
    const regionLocations: Record<string, string> = {
      'us-east-1': 'N. Virginia',
      'us-east-2': 'Ohio',
      'us-west-1': 'N. California',
      'us-west-2': 'Oregon',
      'eu-west-1': 'Ireland',
      'eu-west-2': 'London',
      'eu-central-1': 'Frankfurt',
      'ap-southeast-1': 'Singapore',
      'ap-southeast-2': 'Sydney',
      'ap-northeast-1': 'Tokyo',
      'sa-east-1': 'São Paulo',
      'ca-central-1': 'Central',
      'ap-south-1': 'Mumbai',
    };

    return regionLocations[regionCode] || regionCode;
  }
}