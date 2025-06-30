import React, { useState, useEffect } from 'react';
import { Key, Plus, Upload, Download, Trash2, RefreshCw, Copy, Eye, EyeOff } from 'lucide-react';
import { SSHKeyPair } from '../../types/aws';
import { getKeyPairs, createKeyPair, uploadKeyPair, deleteKeyPair } from '../../services/api';
import Button from '../ui/Button';
import Card from '../ui/Card';
import LoadingSpinner from '../ui/LoadingSpinner';
import KeyPairCreationForm from './KeyPairCreationForm';
import KeyPairUploadForm from './KeyPairUploadForm';

export default function KeyPairsList() {
  const [keyPairs, setKeyPairs] = useState<SSHKeyPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [visiblePrivateKeys, setVisiblePrivateKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadKeyPairs();
  }, []);

  const loadKeyPairs = async () => {
    try {
      setLoading(true);
      const data = await getKeyPairs();
      setKeyPairs(data);
    } catch (error) {
      console.error('Failed to load key pairs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (keyPairId: string) => {
    if (!confirm('Are you sure you want to delete this key pair? This action cannot be undone.')) {
      return;
    }

    try {
      setActionLoading(keyPairId);
      await deleteKeyPair(keyPairId);
      await loadKeyPairs();
    } catch (error) {
      console.error('Failed to delete key pair:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const togglePrivateKeyVisibility = (keyPairId: string) => {
    const newVisible = new Set(visiblePrivateKeys);
    if (newVisible.has(keyPairId)) {
      newVisible.delete(keyPairId);
    } else {
      newVisible.add(keyPairId);
    }
    setVisiblePrivateKeys(newVisible);
  };

  const downloadPrivateKey = (keyPair: SSHKeyPair) => {
    if (!keyPair.privateKey) return;
    
    const blob = new Blob([keyPair.privateKey], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${keyPair.name}.pem`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">SSH Key Pairs</h2>
          <p className="text-gray-600 mt-1">Manage SSH key pairs for secure instance access</p>
        </div>
        <div className="flex items-center space-x-3">
          <Button variant="secondary" onClick={loadKeyPairs}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => setShowUploadForm(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Key
          </Button>
          <Button onClick={() => setShowCreateForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Key Pair
          </Button>
        </div>
      </div>

      {keyPairs.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Key className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No key pairs found</h3>
            <p className="text-gray-600 mb-4">Create or upload a key pair to securely connect to your instances</p>
            <div className="flex items-center justify-center space-x-3">
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Key Pair
              </Button>
              <Button variant="secondary" onClick={() => setShowUploadForm(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Existing Key
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6">
          {keyPairs.map((keyPair) => (
            <Card key={keyPair.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <Key className="w-5 h-5 text-green-600" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{keyPair.name}</h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                      <span>Fingerprint: {keyPair.fingerprint}</span>
                      <span>Created: {new Date(keyPair.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {keyPair.privateKey && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => downloadPrivateKey(keyPair)}
                      title="Download private key"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDelete(keyPair.id)}
                    disabled={actionLoading === keyPair.id}
                  >
                    {actionLoading === keyPair.id ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Public Key</label>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copyToClipboard(keyPair.publicKey)}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <code className="text-xs text-gray-800 break-all">{keyPair.publicKey}</code>
                  </div>
                </div>

                {keyPair.privateKey && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700">Private Key</label>
                      <div className="flex items-center space-x-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => togglePrivateKeyVisibility(keyPair.id)}
                        >
                          {visiblePrivateKeys.has(keyPair.id) ? (
                            <EyeOff className="w-4 h-4 mr-1" />
                          ) : (
                            <Eye className="w-4 h-4 mr-1" />
                          )}
                          {visiblePrivateKeys.has(keyPair.id) ? 'Hide' : 'Show'}
                        </Button>
                        {visiblePrivateKeys.has(keyPair.id) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => copyToClipboard(keyPair.privateKey!)}
                          >
                            <Copy className="w-4 h-4 mr-1" />
                            Copy
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-lg">
                      {visiblePrivateKeys.has(keyPair.id) ? (
                        <code className="text-xs text-gray-800 whitespace-pre-wrap">{keyPair.privateKey}</code>
                      ) : (
                        <div className="text-sm text-gray-500 italic">Private key hidden for security</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {showCreateForm && (
        <KeyPairCreationForm
          onKeyPairCreated={loadKeyPairs}
          onClose={() => setShowCreateForm(false)}
        />
      )}

      {showUploadForm && (
        <KeyPairUploadForm
          onKeyPairUploaded={loadKeyPairs}
          onClose={() => setShowUploadForm(false)}
        />
      )}
    </div>
  );
}