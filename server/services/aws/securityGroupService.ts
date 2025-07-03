import {
  EC2Client,
  DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand,
  DeleteSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
} from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from './awsClient.js';

export class SecurityGroupService {
  constructor() {
    if (!isAWSConfigured()) {
      throw new Error('AWS credentials not configured');
    }
  }

  // ==========================================
  // SECURITY GROUP MANAGEMENT
  // ==========================================
  async getSecurityGroups(region: string): Promise<any[]> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('Failed to create AWS client for region: ' + region);
    }

    try {
      const command = new DescribeSecurityGroupsCommand({});
      const response = await regionClient.send(command);

      return response.SecurityGroups?.map(sg => ({
        id: sg.GroupId!,
        name: sg.GroupName!,
        description: sg.Description!,
        region,
        rules: sg.IpPermissions?.map(rule => ({
          id: `${sg.GroupId}-${rule.IpProtocol}-${rule.FromPort}-${rule.ToPort}`,
          protocol: rule.IpProtocol!,
          fromPort: rule.FromPort || 0,
          toPort: rule.ToPort || 0,
          source: rule.IpRanges?.[0]?.CidrIp || '0.0.0.0/0',
          description: rule.IpRanges?.[0]?.Description || '',
        })) || [],
      })) || [];
    } catch (error) {
      console.error('❌ Failed to get security groups:', error);
      throw error;
    }
  }

  async createSecurityGroup(securityGroup: any): Promise<any> {
    const regionClient = createEC2Client(securityGroup.region);
    if (!regionClient) {
      throw new Error('Failed to create AWS client for region: ' + securityGroup.region);
    }

    try {
      const command = new CreateSecurityGroupCommand({
        GroupName: securityGroup.name,
        Description: securityGroup.description,
      });

      const response = await regionClient.send(command);
      const groupId = response.GroupId!;

      // Add rules if provided
      if (securityGroup.rules && securityGroup.rules.length > 0) {
        await this.updateSecurityGroupRules(groupId, [], securityGroup.rules, securityGroup.region);
      }

      return {
        id: groupId,
        name: securityGroup.name,
        description: securityGroup.description,
        region: securityGroup.region,
        rules: securityGroup.rules || [],
      };
    } catch (error) {
      console.error('❌ Failed to create security group in AWS:', error);
      throw error;
    }
  }

  async updateSecurityGroup(id: string, updates: any): Promise<any> {
    // Note: AWS doesn't allow updating name/description of existing security groups
    // We can only update rules
    if (updates.rules) {
      // Get current rules first
      const currentSG = await this.getSecurityGroupById(id);
      if (currentSG) {
        await this.updateSecurityGroupRules(id, currentSG.rules, updates.rules, currentSG.region);
      }
    }

    return { id, ...updates };
  }

  async deleteSecurityGroup(id: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new DeleteSecurityGroupCommand({
        GroupId: id,
      });

      await ec2Client.send(command);
    } catch (error) {
      console.error('❌ Failed to delete security group from AWS:', error);
      throw error;
    }
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================
  private async getSecurityGroupById(id: string): Promise<any> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new DescribeSecurityGroupsCommand({
        GroupIds: [id],
      });

      const response = await ec2Client.send(command);
      const sg = response.SecurityGroups?.[0];

      if (!sg) return null;

      return {
        id: sg.GroupId!,
        name: sg.GroupName!,
        description: sg.Description!,
        rules: sg.IpPermissions?.map(rule => ({
          id: `${sg.GroupId}-${rule.IpProtocol}-${rule.FromPort}-${rule.ToPort}`,
          protocol: rule.IpProtocol!,
          fromPort: rule.FromPort || 0,
          toPort: rule.ToPort || 0,
          source: rule.IpRanges?.[0]?.CidrIp || '0.0.0.0/0',
          description: rule.IpRanges?.[0]?.Description || '',
        })) || [],
      };
    } catch (error) {
      console.error('❌ Failed to get security group by ID:', error);
      return null;
    }
  }

  private async updateSecurityGroupRules(groupId: string, currentRules: any[], newRules: any[], region: string): Promise<void> {
    const regionClient = createEC2Client(region);
    if (!regionClient) {
      throw new Error('Failed to create AWS client for region: ' + region);
    }

    console.log(`🔄 Updating security group: ${groupId}`);
    console.log(`📊 Current rules:`, currentRules);
    console.log(`📊 New rules:`, newRules);

    // Create a function to normalize rules for comparison
    const normalizeRule = (rule: any) => ({
      protocol: rule.protocol,
      fromPort: rule.fromPort,
      toPort: rule.toPort,
      source: rule.source,
    });

    // Find rules to remove (in current but not in new)
    const rulesToRemove = currentRules.filter(currentRule => {
      const normalizedCurrent = normalizeRule(currentRule);
      return !newRules.some(newRule => {
        const normalizedNew = normalizeRule(newRule);
        return JSON.stringify(normalizedCurrent) === JSON.stringify(normalizedNew);
      });
    });

    // Find rules to add (in new but not in current)
    const rulesToAdd = newRules.filter(newRule => {
      const normalizedNew = normalizeRule(newRule);
      return !currentRules.some(currentRule => {
        const normalizedCurrent = normalizeRule(currentRule);
        return JSON.stringify(normalizedNew) === JSON.stringify(normalizedCurrent);
      });
    });

    console.log(`📊 Rules to remove:`, rulesToRemove);
    console.log(`📊 Rules to add:`, rulesToAdd);

    // Remove old rules
    if (rulesToRemove.length > 0) {
      try {
        const revokeCommand = new RevokeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: rulesToRemove.map(rule => ({
            IpProtocol: rule.protocol,
            FromPort: rule.fromPort,
            ToPort: rule.toPort,
            IpRanges: [{ CidrIp: rule.source, Description: rule.description }],
          })),
        });

        await regionClient.send(revokeCommand);
        console.log(`✅ Successfully revoked ${rulesToRemove.length} rules`);
      } catch (error) {
        console.warn('⚠️ Failed to revoke some security group rules:', error);
      }
    }

    // Add new rules
    if (rulesToAdd.length > 0) {
      try {
        const authorizeCommand = new AuthorizeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: rulesToAdd.map(rule => ({
            IpProtocol: rule.protocol,
            FromPort: rule.fromPort,
            ToPort: rule.toPort,
            IpRanges: [{ CidrIp: rule.source, Description: rule.description }],
          })),
        });

        await regionClient.send(authorizeCommand);
        console.log(`✅ Successfully authorized ${rulesToAdd.length} rules`);
      } catch (error) {
        console.error('❌ Failed to authorize security group rules:', error);
        throw error;
      }
    }
  }
}