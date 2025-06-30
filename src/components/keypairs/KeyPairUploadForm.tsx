import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Upload, Key, FileText, AlertCircle, Terminal, CheckCircle } from 'lucide-react';
import { uploadKeyPair } from '../../services/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import LoadingSpinner from '../ui/LoadingSpinner';

interface FormData {
  name: string;
  publicKey: string;
  privateKey?: string;
}

interface KeyPairUploadFormProps {
  onKeyPairUploaded: () => void;
  onClose: () => void;
}

export default function KeyPairUploadForm({ onKeyPairUploaded, onClose }: KeyPairUploadFormProps) {
  const [uploading, setUploading] = useState(false);
  const [includePrivateKey, setIncludePrivateKey] = useState(true); // Default to true
  const [pemFileLoaded, setPemFileLoaded] = useState(false);
  const [publicKeyGenerated, setPublicKeyGenerated] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>();
  
  const privateKey = watch('privateKey');
  const publicKey = watch('publicKey');

  const onSubmit = async (data: FormData) => {
    try {
      setUploading(true);
      await uploadKeyPair(data.name, data.publicKey, data.privateKey);
      onKeyPairUploaded();
      onClose();
    } catch (error) {
      console.error('Failed to upload key pair:', error);
      alert('Error uploading key pair: ' + (error.message || 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  const handlePemFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setValue('privateKey', content.trim());
        setPemFileLoaded(true);
        
        // Auto-generate public key from private key
        generatePublicKeyFromPrivate(content.trim());
      };
      reader.readAsText(file);
    }
  };

  const generatePublicKeyFromPrivate = async (privateKeyContent: string) => {
    try {
      // This is a simplified approach - in a real implementation, you'd use a crypto library
      // For now, we'll ask the user to provide the public key manually
      setPublicKeyGenerated(false);
    } catch (error) {
      console.error('Failed to generate public key:', error);
    }
  };

  const handlePublicKeyFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setValue('publicKey', content.trim());
        setPublicKeyGenerated(true);
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Upload SSH Key Pair</h2>
          <p className="text-sm text-gray-600 mt-1">Import your existing .pem file or SSH keys for instance access</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <Input
            label="Key Pair Name"
            {...register('name', { 
              required: 'Key pair name is required',
              pattern: {
                value: /^[a-zA-Z0-9_-]+$/,
                message: 'Name can only contain letters, numbers, hyphens, and underscores'
              }
            })}
            error={errors.name?.message}
            placeholder="my-aws-keypair"
            helpText="Choose a name for this key pair"
          />

          {/* Quick Upload for .pem files */}
          <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  🚀 Quick Setup: Upload your .pem file
                </h3>
                <p className="text-sm text-gray-700 mb-4">
                  If you have a .pem file from AWS, upload it here and we'll handle the rest automatically.
                </p>
                
                <div className="flex items-center space-x-3">
                  <input
                    type="file"
                    accept=".pem,.key"
                    onChange={handlePemFileUpload}
                    className="hidden"
                    id="pem-file-upload"
                  />
                  <label
                    htmlFor="pem-file-upload"
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md shadow-sm text-sm font-medium hover:bg-blue-700 cursor-pointer transition-colors"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload .pem file
                  </label>
                  {pemFileLoaded && (
                    <div className="flex items-center text-green-600">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      <span className="text-sm font-medium">Private key loaded!</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Private Key Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Private Key (.pem content)</label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={includePrivateKey}
                  onChange={(e) => setIncludePrivateKey(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                />
                <span className="ml-2 text-sm text-gray-700">Enable SSH terminal</span>
              </label>
            </div>

            {includePrivateKey && (
              <>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <Terminal className="w-5 h-5 text-green-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-green-900">SSH Terminal Enabled</h4>
                      <p className="text-sm text-green-800 mt-1">
                        With the private key included, you'll be able to connect directly to your instances 
                        using the built-in SSH terminal in your browser.
                      </p>
                    </div>
                  </div>
                </div>

                <textarea
                  {...register('privateKey', {
                    required: includePrivateKey ? 'Private key is required for SSH terminal' : false
                  })}
                  rows={8}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;MIIEpAIBAAKCAQEA...&#10;-----END RSA PRIVATE KEY-----"
                />
                {errors.privateKey && (
                  <p className="text-sm text-red-600">{errors.privateKey.message}</p>
                )}
              </>
            )}
          </div>

          {/* Public Key Section */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Public Key *
              {pemFileLoaded && !publicKeyGenerated && (
                <span className="text-orange-600 ml-2">(Generate from your .pem file)</span>
              )}
            </label>
            
            {pemFileLoaded && !publicKeyGenerated && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-orange-900">Generate Public Key</h4>
                    <p className="text-sm text-orange-800 mt-1 mb-3">
                      Run this command in your terminal to generate the public key from your .pem file:
                    </p>
                    <div className="bg-gray-900 text-green-400 p-3 rounded font-mono text-sm">
                      ssh-keygen -y -f your-file.pem
                    </div>
                    <p className="text-sm text-orange-800 mt-2">
                      Copy the output and paste it in the field below.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center space-x-3">
              <input
                type="file"
                accept=".pub,.txt"
                onChange={handlePublicKeyFileUpload}
                className="hidden"
                id="public-keyfile-upload"
              />
              <label
                htmlFor="public-keyfile-upload"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload .pub file
              </label>
              <span className="text-sm text-gray-500">or paste the public key below</span>
              {publicKeyGenerated && (
                <div className="flex items-center text-green-600">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">Public key loaded!</span>
                </div>
              )}
            </div>

            <textarea
              {...register('publicKey', { 
                required: 'Public key is required',
                pattern: {
                  value: /^ssh-(rsa|dss|ed25519|ecdsa)/,
                  message: 'Invalid SSH public key format'
                }
              })}
              rows={3}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
              placeholder="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ..."
            />
            {errors.publicKey && (
              <p className="text-sm text-red-600">{errors.publicKey.message}</p>
            )}
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <Key className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900">Step-by-Step Instructions</h4>
                <div className="text-sm text-blue-800 mt-2 space-y-2">
                  <div>
                    <p className="font-medium">Option 1: Upload .pem file (Recommended)</p>
                    <ol className="list-decimal list-inside ml-4 space-y-1 mt-1">
                      <li>Click "Upload .pem file" above</li>
                      <li>Select your AWS .pem file</li>
                      <li>Generate public key with: <code className="bg-blue-100 px-1 rounded">ssh-keygen -y -f your-file.pem</code></li>
                      <li>Paste the public key output in the public key field</li>
                    </ol>
                  </div>
                  <div>
                    <p className="font-medium">Option 2: Manual entry</p>
                    <ol className="list-decimal list-inside ml-4 space-y-1 mt-1">
                      <li>Copy your .pem file content to the private key field</li>
                      <li>Generate and paste the public key</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Validation Status */}
          {privateKey && publicKey && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <h4 className="font-medium text-green-900">Ready to Upload!</h4>
                  <p className="text-sm text-green-800 mt-1">
                    Both private and public keys are provided. You'll be able to use SSH terminal after upload.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end space-x-3 pt-6 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={uploading || !publicKey || (includePrivateKey && !privateKey)}>
              {uploading ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Uploading...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Key Pair
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}