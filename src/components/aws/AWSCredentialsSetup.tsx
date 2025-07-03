import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Cloud, Key, AlertCircle, CheckCircle, ExternalLink, Shield, Globe } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Card from '../ui/Card';
import LoadingSpinner from '../ui/LoadingSpinner';

interface AWSCredentialsForm {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

interface AWSCredentialsSetupProps {
  onCredentialsConfigured: () => void;
}

export default function AWSCredentialsSetup({ onCredentialsConfigured }: AWSCredentialsSetupProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<AWSCredentialsForm>({
    defaultValues: {
      region: 'us-east-1'
    }
  });

  const testCredentials = async (data: AWSCredentialsForm) => {
    setTesting(true);
    setTestResult(null);

    try {
      // Set credentials in environment variables for the server
      const response = await fetch('http://localhost:3001/api/aws/test-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setTestResult({
          success: true,
          message: 'AWS credentials verified successfully!'
        });
        
        // Store credentials securely
        localStorage.setItem('aws_credentials', JSON.stringify(data));
        
        // Set credentials on server for this session
        await fetch('http://localhost:3001/api/aws/set-credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });
        
        // Notify parent component
        setTimeout(() => {
          onCredentialsConfigured();
        }, 1500);
      } else {
        setTestResult({
          success: false,
          message: result.error || 'Failed to verify AWS credentials'
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Network error. Please check your connection and try again.'
      });
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = (data: AWSCredentialsForm) => {
    testCredentials(data);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Cloud className="w-10 h-10 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">AWS EC2 Manager</h1>
          <p className="text-xl text-gray-600 mb-2">Professional Infrastructure Management Console</p>
          <p className="text-gray-500">Configure your AWS credentials to get started</p>
        </div>

        {/* Main Configuration Card */}
        <Card className="shadow-xl border-0">
          <div className="p-8">
            <div className="flex items-center space-x-3 mb-6">
              <Key className="w-6 h-6 text-blue-600" />
              <h2 className="text-2xl font-semibold text-gray-900">AWS Credentials Setup</h2>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <div className="flex items-start space-x-3">
                  <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900 mb-2">🔐 Secure Credential Storage</h4>
                    <p className="text-sm text-blue-800">
                      Your AWS credentials are stored securely in your browser and are never transmitted to external servers. 
                      All AWS operations are performed directly from your browser to AWS services.
                    </p>
                  </div>
                </div>
              </div>

              <Input
                label="AWS Access Key ID"
                {...register('accessKeyId', { 
                  required: 'Access Key ID is required',
                  pattern: {
                    value: /^AKIA[0-9A-Z]{16}$/,
                    message: 'Invalid Access Key ID format (should start with AKIA)'
                  }
                })}
                error={errors.accessKeyId?.message}
                placeholder="AKIAIOSFODNN7EXAMPLE"
                helpText="Your AWS Access Key ID (starts with AKIA)"
              />

              <Input
                label="AWS Secret Access Key"
                type="password"
                {...register('secretAccessKey', { 
                  required: 'Secret Access Key is required',
                  minLength: {
                    value: 40,
                    message: 'Secret Access Key must be at least 40 characters'
                  }
                })}
                error={errors.secretAccessKey?.message}
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                helpText="Your AWS Secret Access Key"
              />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Default AWS Region</label>
                <select
                  {...register('region', { required: 'Region is required' })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                >
                  <option value="us-east-1">US East (N. Virginia) - us-east-1</option>
                  <option value="us-east-2">US East (Ohio) - us-east-2</option>
                  <option value="us-west-1">US West (N. California) - us-west-1</option>
                  <option value="us-west-2">US West (Oregon) - us-west-2</option>
                  <option value="eu-west-1">Europe (Ireland) - eu-west-1</option>
                  <option value="eu-west-2">Europe (London) - eu-west-2</option>
                  <option value="eu-central-1">Europe (Frankfurt) - eu-central-1</option>
                  <option value="ap-southeast-1">Asia Pacific (Singapore) - ap-southeast-1</option>
                  <option value="ap-southeast-2">Asia Pacific (Sydney) - ap-southeast-2</option>
                  <option value="ap-northeast-1">Asia Pacific (Tokyo) - ap-northeast-1</option>
                </select>
                {errors.region && (
                  <p className="text-sm text-red-600 mt-1">{errors.region.message}</p>
                )}
              </div>

              {/* Test Result */}
              {testResult && (
                <div className={`rounded-lg p-4 ${
                  testResult.success 
                    ? 'bg-green-50 border border-green-200' 
                    : 'bg-red-50 border border-red-200'
                }`}>
                  <div className="flex items-center space-x-3">
                    {testResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-red-600" />
                    )}
                    <p className={`text-sm font-medium ${
                      testResult.success ? 'text-green-900' : 'text-red-900'
                    }`}>
                      {testResult.message}
                    </p>
                  </div>
                  {testResult.success && (
                    <p className="text-sm text-green-800 mt-2">
                      🚀 Redirecting to the main application...
                    </p>
                  )}
                </div>
              )}

              <Button 
                type="submit" 
                disabled={testing}
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700"
                size="lg"
              >
                {testing ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span className="ml-2">Verifying Credentials...</span>
                  </>
                ) : (
                  <>
                    <Shield className="w-5 h-5 mr-2" />
                    Test & Save Credentials
                  </>
                )}
              </Button>
            </form>
          </div>
        </Card>

        {/* Help Section */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-yellow-200 bg-yellow-50">
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Key className="w-5 h-5 text-yellow-600" />
                <h3 className="font-semibold text-yellow-900">Need AWS Credentials?</h3>
              </div>
              <p className="text-sm text-yellow-800 mb-4">
                If you don't have AWS credentials yet, you'll need to create them in the AWS Console.
              </p>
              <a
                href="https://console.aws.amazon.com/iam/home#/users"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm font-medium text-yellow-700 hover:text-yellow-900"
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                Create AWS User
              </a>
            </div>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <div className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Globe className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-blue-900">Required Permissions</h3>
              </div>
              <p className="text-sm text-blue-800 mb-4">
                Your AWS user needs EC2 permissions to manage instances, volumes, and security groups.
              </p>
              <div className="text-xs text-blue-700 space-y-1">
                <div>• AmazonEC2FullAccess</div>
                <div>• AmazonVPCReadOnlyAccess</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Security Notice */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            🔒 Your credentials are stored locally and encrypted. We never store or transmit your AWS credentials to external servers.
          </p>
        </div>
      </div>
    </div>
  );
}