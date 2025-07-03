import React, { useState, useEffect } from 'react';
import { Container, X, RefreshCw, Play, Square, Trash2, ExternalLink, Activity, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import LoadingSpinner from '../ui/LoadingSpinner';

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'created' | 'exited';
  ports: string[];
  created: string;
  uptime?: string;
}

interface DockerServicesModalProps {
  instanceId: string;
  instanceName: string;
  onClose: () => void;
}

export default function DockerServicesModal({ instanceId, instanceName, onClose }: DockerServicesModalProps) {
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dockerStatus, setDockerStatus] = useState<'running' | 'stopped' | 'unknown'>('unknown');

  useEffect(() => {
    loadDockerServices();
    // Refresh every 10 seconds
    const interval = setInterval(loadDockerServices, 10000);
    return () => clearInterval(interval);
  }, [instanceId]);

  const loadDockerServices = async () => {
    try {
      setLoading(true);
      
      // Mock data for now - in real implementation, this would call the SSH service
      // to execute docker commands on the instance
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Simulate Docker service status
      setDockerStatus('running');
      
      // Mock container data
      const mockContainers: DockerContainer[] = [
        {
          id: 'minecraft-server-1',
          name: 'minecraft-java',
          image: 'itzg/minecraft-server:latest',
          status: 'running',
          ports: ['25565:25565'],
          created: '2 hours ago',
          uptime: '2h 15m',
        },
        {
          id: 'web-server-1',
          name: 'nginx-proxy',
          image: 'nginx:alpine',
          status: 'running',
          ports: ['80:80', '443:443'],
          created: '1 day ago',
          uptime: '1d 3h',
        },
        {
          id: 'database-1',
          name: 'postgres-db',
          image: 'postgres:15',
          status: 'stopped',
          ports: ['5432:5432'],
          created: '3 days ago',
        },
      ];
      
      setContainers(mockContainers);
    } catch (error) {
      console.error('Failed to load Docker services:', error);
      setDockerStatus('unknown');
    } finally {
      setLoading(false);
    }
  };

  const handleContainerAction = async (containerId: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    try {
      setActionLoading(containerId);
      
      // Mock action - in real implementation, this would execute docker commands via SSH
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update container status based on action
      setContainers(prev => prev.map(container => {
        if (container.id === containerId) {
          switch (action) {
            case 'start':
              return { ...container, status: 'running' as const, uptime: '0m' };
            case 'stop':
              return { ...container, status: 'stopped' as const, uptime: undefined };
            case 'restart':
              return { ...container, status: 'running' as const, uptime: '0m' };
            case 'remove':
              return null; // Will be filtered out
            default:
              return container;
          }
        }
        return container;
      }).filter(Boolean) as DockerContainer[]);
      
    } catch (error) {
      console.error(`Failed to ${action} container:`, error);
      alert(`Failed to ${action} container. Please check the console for details.`);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success';
      case 'stopped': return 'secondary';
      case 'exited': return 'warning';
      case 'created': return 'primary';
      default: return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <CheckCircle className="w-4 h-4" />;
      case 'stopped': return <Square className="w-4 h-4" />;
      case 'exited': return <AlertCircle className="w-4 h-4" />;
      case 'created': return <Clock className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getContainerActions = (container: DockerContainer) => {
    const actions = [];

    if (container.status === 'running') {
      actions.push(
        <Button
          key="stop"
          size="sm"
          variant="warning"
          onClick={() => handleContainerAction(container.id, 'stop')}
          disabled={actionLoading === container.id}
          title="Stop container"
        >
          {actionLoading === container.id ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Square className="w-4 h-4" />
          )}
        </Button>
      );
    } else {
      actions.push(
        <Button
          key="start"
          size="sm"
          variant="success"
          onClick={() => handleContainerAction(container.id, 'start')}
          disabled={actionLoading === container.id}
          title="Start container"
        >
          {actionLoading === container.id ? (
            <LoadingSpinner size="sm" />
          ) : (
            <Play className="w-4 h-4" />
          )}
        </Button>
      );
    }

    actions.push(
      <Button
        key="remove"
        size="sm"
        variant="danger"
        onClick={() => {
          if (confirm(`Are you sure you want to remove container "${container.name}"? This action cannot be undone.`)) {
            handleContainerAction(container.id, 'remove');
          }
        }}
        disabled={actionLoading === container.id}
        title="Remove container"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    );

    return actions;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Container className="w-6 h-6 text-blue-600" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Docker Services</h2>
                <p className="text-sm text-gray-600">{instanceName} - Container Management</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-green-500" />
                <Badge variant={dockerStatus === 'running' ? 'success' : 'danger'}>
                  Docker {dockerStatus}
                </Badge>
              </div>
              <Button variant="secondary" size="sm" onClick={loadDockerServices}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
              <Button variant="secondary" size="sm" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner size="lg" />
              <span className="ml-3 text-gray-600">Loading Docker services...</span>
            </div>
          ) : dockerStatus === 'unknown' ? (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Docker Status Unknown</h3>
              <p className="text-gray-600 mb-4">
                Unable to connect to Docker daemon. Make sure Docker is installed and running on the instance.
              </p>
              <Button onClick={loadDockerServices}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry Connection
              </Button>
            </div>
          ) : containers.length === 0 ? (
            <div className="text-center py-12">
              <Container className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No containers found</h3>
              <p className="text-gray-600 mb-4">
                Docker is running but no containers are currently deployed on this instance.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto">
                <h4 className="font-medium text-blue-900 mb-2">Quick Start Commands</h4>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><code className="bg-blue-100 px-1 rounded">docker run -d --name minecraft -p 25565:25565 itzg/minecraft-server</code></p>
                  <p><code className="bg-blue-100 px-1 rounded">docker run -d --name nginx -p 80:80 nginx:alpine</code></p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  Running Containers ({containers.filter(c => c.status === 'running').length}/{containers.length})
                </h3>
                <div className="text-sm text-gray-600">
                  Last updated: {new Date().toLocaleTimeString()}
                </div>
              </div>

              <div className="grid gap-4">
                {containers.map((container) => (
                  <div key={container.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Container className="w-5 h-5 text-blue-600" />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center space-x-3">
                            <h4 className="text-lg font-semibold text-gray-900">{container.name}</h4>
                            <div className="flex items-center space-x-2">
                              {getStatusIcon(container.status)}
                              <Badge variant={getStatusColor(container.status)}>
                                {container.status}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                            <span>Image: {container.image}</span>
                            <span>Created: {container.created}</span>
                            {container.uptime && <span>Uptime: {container.uptime}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {getContainerActions(container)}
                      </div>
                    </div>

                    {container.ports.length > 0 && (
                      <div className="mt-4">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Port Mappings</h5>
                        <div className="flex flex-wrap gap-2">
                          {container.ports.map((port, index) => (
                            <div key={index} className="bg-gray-100 px-3 py-1 rounded-full text-sm">
                              <span className="font-mono">{port}</span>
                              {container.status === 'running' && port.includes(':80') && (
                                <ExternalLink className="w-3 h-3 inline ml-1 text-blue-600" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {container.status === 'running' && container.ports.some(p => p.includes(':25565')) && (
                      <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <CheckCircle className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium text-green-900">Minecraft Server Ready</span>
                        </div>
                        <p className="text-sm text-green-800 mt-1">
                          Players can connect using the instance's public IP address
                        </p>
                      </div>
                    )}

                    {container.status === 'running' && container.ports.some(p => p.includes(':80')) && (
                      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <CheckCircle className="w-4 h-4 text-blue-600" />
                          <span className="text-sm font-medium text-blue-900">Web Service Available</span>
                        </div>
                        <p className="text-sm text-blue-800 mt-1">
                          Access via browser using the instance's public IP address
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>
              Instance: {instanceName} • Docker Engine: {dockerStatus}
            </div>
            <div className="flex items-center space-x-4">
              <span>Containers: {containers.length}</span>
              <span>Running: {containers.filter(c => c.status === 'running').length}</span>
              <span>Stopped: {containers.filter(c => c.status === 'stopped').length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}