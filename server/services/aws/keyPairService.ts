import {
  EC2Client,
  DescribeKeyPairsCommand,
  CreateKeyPairCommand,
  ImportKeyPairCommand,
  DeleteKeyPairCommand,
} from '@aws-sdk/client-ec2';
import { createEC2Client, isAWSConfigured } from './awsClient.js';

export class KeyPairService {
  constructor() {
    if (!isAWSConfigured()) {
      throw new Error('AWS credentials not configured');
    }
  }

  // ==========================================
  // KEY PAIR MANAGEMENT
  // ==========================================
  async getKeyPairs(): Promise<any[]> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new DescribeKeyPairsCommand({});
      const response = await ec2Client.send(command);

      return response.KeyPairs?.map(kp => ({
        id: kp.KeyPairId!,
        name: kp.KeyName!,
        publicKey: kp.PublicKeyMaterial || '',
        fingerprint: kp.KeyFingerprint!,
        createdAt: kp.CreateTime || new Date(),
      })) || [];
    } catch (error) {
      console.error('❌ Failed to get key pairs:', error);
      throw error;
    }
  }

  async createKeyPair(name: string): Promise<any> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new CreateKeyPairCommand({
        KeyName: name,
      });

      const response = await ec2Client.send(command);

      return {
        id: response.KeyPairId!,
        name: response.KeyName!,
        publicKey: response.PublicKeyMaterial || '',
        privateKey: response.KeyMaterial || '',
        fingerprint: response.KeyFingerprint!,
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('❌ Failed to create key pair in AWS:', error);
      throw error;
    }
  }

  async importKeyPair(name: string, publicKey: string): Promise<any> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new ImportKeyPairCommand({
        KeyName: name,
        PublicKeyMaterial: Buffer.from(publicKey),
      });

      const response = await ec2Client.send(command);

      return {
        id: response.KeyPairId!,
        name: response.KeyName!,
        publicKey: publicKey,
        fingerprint: response.KeyFingerprint!,
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('❌ Failed to import key pair to AWS:', error);
      throw error;
    }
  }

  async deleteKeyPair(keyName: string): Promise<void> {
    const ec2Client = createEC2Client();
    if (!ec2Client) {
      throw new Error('Failed to create AWS client');
    }

    try {
      const command = new DeleteKeyPairCommand({
        KeyName: keyName,
      });

      await ec2Client.send(command);
    } catch (error) {
      console.error('❌ Failed to delete key pair from AWS:', error);
      throw error;
    }
  }
}