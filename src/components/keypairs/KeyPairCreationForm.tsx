import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Key, Download, AlertCircle, Terminal } from 'lucide-react';
import { createKeyPair } from '../../services/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import LoadingSpinner from '../ui/LoadingSpinner';

interface FormData {
  name: string;
}

interface KeyPairCreationFormProps {
  onKeyPairCreated: () => void;
  onClose: () => void;
}

export default function KeyPairCreationForm({ onKeyPairCreated, onClose }: KeyPairCreationFormProps) {
  const [creating, setCreating] = useState(false);
  const [createdKeyPair, setCreatedKeyPair] = useState<any>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>();

  const onSubmit = async (data: FormData) => {
    try {
      setCreating(true);
      const keyPair = await createKeyPair(data.name);
      setCreatedKeyPair(keyPair);
    } catch (error) {
      console.error('Failed to create key pair:', error);
    } finally {
      setCreating(false);
    }
  };

  const downloadPrivateKey = () => {
    if (!createdKeyPair?.privateKey) return;
    
    const blob = new Blob([createdKeyPair.privateKey], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${createdKeyPair.name}.pem`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFinish = () => {
    onKeyPairCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create SSH Key Pair</h2>
          <p className="text-sm text-gray-600 mt-1">Generate a new SSH key pair for secure instance access</p>
        </div>

        {!createdKeyPair ? (
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
              placeholder="my-keypair"
              helpText="Choose a descriptive name for your key pair"
            />

            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <Key className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-blue-900">About SSH Key Pairs</h4>
                  <p className="text-sm text-blue-800 mt-1">
                    SSH key pairs provide a secure way to connect to your EC2 instances. The private key will be 
                    generated and available for download only once. Keep it secure and never share it.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <Terminal className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-green-900">SSH Terminal Ready</h4>
                  <p className="text-sm text-green-800 mt-1">
                    This key pair will include the private key, allowing you to use the built-in SSH terminal 
                    directly from your browser to connect to instances.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-6 border-t">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span className="ml-2">Creating Key Pair...</span>
                  </>
                ) : (
                  'Create Key Pair'
                )}
              </Button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Key className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Key Pair Created Successfully!</h3>
              <p className="text-gray-600 mt-1">Your SSH key pair "{createdKeyPair.name}" has been created.</p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-900">Important Security Notice</h4>
                  <p className="text-sm text-yellow-800 mt-1">
                    This is the only time you can download the private key. Save it securely and never share it. 
                    You'll need this file to connect to instances that use this key pair.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Terminal className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h4 className="font-medium text-green-900">SSH Terminal Enabled</h4>
                  <p className="text-sm text-green-800 mt-1">
                    This key pair includes the private key, so you can use the SSH terminal feature directly 
                    from the browser when connecting to instances that use this key pair.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Public Key</label>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <code className="text-xs text-gray-800 break-all">{createdKeyPair.publicKey}</code>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fingerprint</label>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <code className="text-sm text-gray-800">{createdKeyPair.fingerprint}</code>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center space-x-3 pt-6 border-t">
              <Button onClick={downloadPrivateKey} variant="success">
                <Download className="w-4 h-4 mr-2" />
                Download Private Key (.pem)
              </Button>
              <Button onClick={handleFinish}>
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}