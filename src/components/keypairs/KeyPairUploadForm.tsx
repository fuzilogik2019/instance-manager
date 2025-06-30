import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Upload, Key } from 'lucide-react';
import { uploadKeyPair } from '../../services/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import LoadingSpinner from '../ui/LoadingSpinner';

interface FormData {
  name: string;
  publicKey: string;
}

interface KeyPairUploadFormProps {
  onKeyPairUploaded: () => void;
  onClose: () => void;
}

export default function KeyPairUploadForm({ onKeyPairUploaded, onClose }: KeyPairUploadFormProps) {
  const [uploading, setUploading] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormData>();

  const onSubmit = async (data: FormData) => {
    try {
      setUploading(true);
      await uploadKeyPair(data.name, data.publicKey);
      onKeyPairUploaded();
      onClose();
    } catch (error) {
      console.error('Failed to upload key pair:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setValue('publicKey', content.trim());
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Upload SSH Key Pair</h2>
          <p className="text-sm text-gray-600 mt-1">Upload an existing public key for instance access</p>
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
            placeholder="my-existing-keypair"
            helpText="Choose a name for this key pair"
          />

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">Public Key</label>
            
            <div className="flex items-center space-x-3">
              <input
                type="file"
                accept=".pub,.txt"
                onChange={handleFileUpload}
                className="hidden"
                id="keyfile-upload"
              />
              <label
                htmlFor="keyfile-upload"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer"
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload .pub file
              </label>
              <span className="text-sm text-gray-500">or paste the key below</span>
            </div>

            <textarea
              {...register('publicKey', { 
                required: 'Public key is required',
                pattern: {
                  value: /^ssh-(rsa|dss|ed25519|ecdsa)/,
                  message: 'Invalid SSH public key format'
                }
              })}
              rows={4}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
              placeholder="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ..."
            />
            {errors.publicKey && (
              <p className="text-sm text-red-600">{errors.publicKey.message}</p>
            )}
          </div>

          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <Key className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-900">Supported Key Formats</h4>
                <ul className="text-sm text-blue-800 mt-1 space-y-1">
                  <li>• SSH-RSA (ssh-rsa)</li>
                  <li>• SSH-DSS (ssh-dss)</li>
                  <li>• SSH-ED25519 (ssh-ed25519)</li>
                  <li>• ECDSA (ecdsa-sha2-nistp256/384/521)</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-6 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={uploading}>
              {uploading ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Uploading...</span>
                </>
              ) : (
                'Upload Key Pair'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}