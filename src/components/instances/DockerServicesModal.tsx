import React, { useState, useEffect } from 'react';
import { Container, X, RefreshCw, Play, Square, Trash2, ExternalLink, Activity, AlertCircle, CheckCircle, Clock, Terminal, Loader } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import LoadingSpinner from '../ui/LoadingSpinner';

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'created' | 'exited' | 'restarting';
  ports: string[];
  created: string;
  uptime?: string;
  command?: string;
  size?: string;
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
  const [dockerStatus, setDockerStatus] = useState<'running' | 'stopped' | 'unknown' | 'installing'>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [dockerInfo, setDockerInfo] = useState<any>(null);

  useEffect(() => {
    checkDockerStatus();
    loadDockerServices();
    // Refresh every 15 seconds
    const interval = setInterval(() => {
      checkDockerStatus();
      loadDockerServices();
    }, 15000);
    return () => clearInterval(interval);
  }, [instanceId]);

  const checkDockerStatus = async () => {
    try {
      const response = await fetch(`http://localhost:3001/api/instances/${instanceId}/docker/status`);
      if (response.ok) {
        const status = await response.json();
        setDockerInfo(status);
        
        switch (status.dockerStatus) {
          case 'running':
            setDockerStatus('running');
            break;
          case 'installing':
            setDockerStatus('installing');
            break;
          case 'not_installed':
          case 'installation_failed':
            setDockerStatus('stopped');
            break;
          default:
            setDockerStatus('unknown');
        }
      }
    } catch (error) {
      console.error('Failed to check Docker status:', error);
      setDockerStatus('unknown');
    }
  };

  const executeDockerCommand = async (command: string): Promise<any> => {
    try {
      console.log(`🐳 Executing Docker command: ${command}`);
      
      const response = await fetch(`http://localhost:3001/api/instances/${instanceId}/docker`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Docker command failed:', error);
      throw error;
    }
  };

  const loadDockerServices = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Check Docker status first
      const statusResult = await executeDockerCommand('docker --version && systemctl is-active docker');
      
      if (!statusResult.success) {
        setError(statusResult.error || 'Docker not available');
        setDockerStatus('stopped');
        return;
      }
      
      // Get container list
      const containersResult = await executeDockerCommand('docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}\\t{{.CreatedAt}}\\t{{.Size}}"');
      
      if (containersResult.success && containersResult.containers) {
        setContainers(containersResult.containers);
        setDockerStatus('running');
      } else {
        setContainers([]);
        setDockerStatus('running'); // Docker is running but no containers
      }
      
    } catch (error) {
      console.error('Failed to load Docker services:', error);
      setError(error.message);
      
      // Determine error type
      if (error.message.includes('command not found') || error.message.includes('Connection refused')) {
        setDockerStatus('stopped');
      } else if (error.message.includes('installing') || error.message.includes('in progress')) {
        setDockerStatus('installing');
      } else {
        setDockerStatus('unknown');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContainerAction = async (containerId: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    try {
      setActionLoading(containerId);
      
      let command = '';
      switch (action) {
        case 'start':
          command = `docker start ${containerId}`;
          break;
        case 'stop':
          command = `docker stop ${containerId}`;
          break;
        case 'restart':
          command = `docker restart ${containerId}`;
          break;
        case 'remove':
          command = `docker rm -f ${containerId}`;
          break;
      }
      
      await executeDockerCommand(command);
      
      // Update container status locally for immediate feedback
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
      
      // Refresh the full list after a short delay
      setTimeout(() => {
        loadDockerServices();
      }, 2000);
      
    } catch (error) {
      console.error(`Failed to ${action} container:`, error);
      alert(`Failed to ${action} container: ${error.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const openSSHTerminal = () => {
    // Use the global terminal manager to open SSH terminal
    if ((window as any).openSSHTerminal) {
      (window as any).openSSHTerminal(
        instanceId,
        instanceName,
        'default-key', // This should be the actual key pair name
        'instance-host' // This should be the actual host
      );
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'success';
      case 'stopped': return 'secondary';
      case 'exited': return 'warning';
      case 'created': return 'primary';
      case 'restarting': return 'warning';
      default: return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <CheckCircle className="w-4 h-4" />;
      case 'stopped': return <Square className="w-4 h-4" />;
      case 'exited': return <AlertCircle className="w-4 h-4" />;
      case 'created': return <Clock className="w-4 h-4" />;
      case 'restarting': return <RefreshCw className="w-4 h-4 animate-spin" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getContainerActions = (container: DockerContainer) => {
    const actions = [];

    if (container.status === 'running') {
      actions.push(
        <Button
          key="restart"
          size="sm"
          variant="warning"
          onClick={() => handleContainerAction(container.id, 'restart')}
          disabled={actionLoading === container.id}
          title="Restart container"
        >
          {actionLoading === container.id ? (
            <LoadingSpinner size="sm" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
        </Button>
      );
      
      actions.push(
        <Button
          key="stop"
          size="sm"
          variant="secondary"
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

  const getServiceTypeInfo = (container: DockerContainer) => {
    const image = container.image.toLowerCase();
    const ports = container.ports.join(' ');
    
    if (image.includes('minecraft') || ports.includes('25565')) {
      return {
        type: 'Minecraft Server',
        icon: '🎮',
        color: 'green',
        description: 'Game server ready for players',
      };
    } else if (image.includes('nginx') || image.includes('apache') || ports.includes(':80') || ports.includes(':443')) {
      return {
        type: 'Web Server',
        icon: '🌐',
        color: 'blue',
        description: 'HTTP/HTTPS web service',
      };
    } else if (image.includes('postgres') || image.includes('mysql') || image.includes('mongo')) {
      return {
        type: 'Database',
        icon: '🗄️',
        color: 'purple',
        description: 'Database service',
      };
    } else if (image.includes('redis') || image.includes('memcached')) {
      return {
        type: 'Cache',
        icon: '⚡',
        color: 'orange',
        description: 'Caching service',
      };
    } else if (image.includes('palworld')) {
      return {
        type: 'Palworld Server',
        icon: '🦄',
        color: 'pink',
        description: 'Palworld game server',
      };
    } else if (image.includes('valheim')) {
      return {
        type: 'Valheim Server',
        icon: '⚔️',
        color: 'yellow',
        description: 'Valheim game server',
      };
    }
    
    return {
      type: 'Container',
      icon: '📦',
      color: 'gray',
      description: 'Docker container',
    };
  };

  const getDockerStatusBadge = () => {
    switch (dockerStatus) {
      case 'running':
        return (
          <Badge variant="success">
            <CheckCircle className="w-4 h-4 mr-1" />
            Docker Running
          </Badge>
        );
      case 'installing':
        return (
          <Badge variant="warning">
            <Loader className="w-4 h-4 mr-1 animate-spin" />
            Installing Docker
          </Badge>
        );
      case 'stopped':
        return (
          <Badge variant="danger">
            <AlertCircle className="w-4 h-4 mr-1" />
            Docker Stopped
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Clock className="w-4 h-4 mr-1" />
            Docker Unknown
          </Badge>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-7xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Container className="w-6 h-6 text-blue-600" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Docker Services</h2>
                <p className="text-sm text-gray-600">{instanceName} - Real-time Container Management</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-green-500" />
                {getDockerStatusBadge()}
              </div>
              <Button variant="secondary" size="sm" onClick={openSSHTerminal}>
                <Terminal className="w-4 h-4 mr-1" />
                SSH Terminal
              </Button>
              <Button variant="secondary" size="sm" onClick={loadDockerServices} disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
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
          ) : dockerStatus === 'installing' ? (
            <div className="text-center py-12">
              <Loader className="w-12 h-12 text-yellow-500 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Docker Installation in Progress</h3>
              <p className="text-gray-600 mb-4">
                Docker is currently being installed on this instance. This process typically takes 2-5 minutes.
              </p>
              {dockerInfo?.dockerImage && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto mb-4">
                  <h4 className="font-medium text-blue-900 mb-2">📦 Configured Image</h4>
                  <p className="text-sm text-blue-800">
                    After installation completes, the following image will be automatically pulled and started:
                  </p>
                  <code className="block mt-2 bg-blue-100 p-2 rounded text-sm">{dockerInfo.dockerImage}</code>
                </div>
              )}
              <div className="flex items-center justify-center space-x-3">
                <Button onClick={loadDockerServices}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Check Status
                </Button>
                <Button variant="secondary" onClick={openSSHTerminal}>
                  <Terminal className="w-4 h-4 mr-2" />
                  Monitor via SSH
                </Button>
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Connection Error</h3>
              <p className="text-gray-600 mb-4">{error}</p>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-md mx-auto mb-4">
                <h4 className="font-medium text-yellow-900 mb-2">Troubleshooting</h4>
                <ul className="text-sm text-yellow-800 space-y-1 text-left">
                  <li>• Make sure Docker is installed on the instance</li>
                  <li>• Check if the Docker service is running</li>
                  <li>• Verify SSH connection is working</li>
                  <li>• Ensure user has Docker permissions</li>
                </ul>
              </div>
              <div className="flex items-center justify-center space-x-3">
                <Button onClick={loadDockerServices}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry Connection
                </Button>
                <Button variant="secondary" onClick={openSSHTerminal}>
                  <Terminal className="w-4 h-4 mr-2" />
                  Open SSH Terminal
                </Button>
              </div>
            </div>
          ) : dockerStatus === 'stopped' ? (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Docker Not Available</h3>
              <p className="text-gray-600 mb-4">
                Docker is not installed or not running on this instance.
              </p>
              {dockerInfo?.installationStatus === 'failed' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-w-md mx-auto mb-4">
                  <h4 className="font-medium text-red-900 mb-2">❌ Installation Failed</h4>
                  <p className="text-sm text-red-800">
                    Docker installation failed during instance setup. You can try installing manually via SSH.
                  </p>
                </div>
              )}
              <Button onClick={openSSHTerminal}>
                <Terminal className="w-4 h-4 mr-2" />
                Open SSH Terminal
              </Button>
            </div>
          ) : containers.length === 0 ? (
            <div className="text-center py-12">
              <Container className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No containers found</h3>
              <p className="text-gray-600 mb-4">
                Docker is running but no containers are currently deployed on this instance.
              </p>
              {dockerInfo?.dockerImage && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-md mx-auto mb-4">
                  <h4 className="font-medium text-yellow-900 mb-2">🤔 Expected Container Missing</h4>
                  <p className="text-sm text-yellow-800 mb-2">
                    This instance was configured to run: <code className="bg-yellow-100 px-1 rounded">{dockerInfo.dockerImage}</code>
                  </p>
                  <p className="text-sm text-yellow-800">
                    The container may have failed to start or been removed. Check the SSH terminal for logs.
                  </p>
                </div>
              )}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-2xl mx-auto">
                <h4 className="font-medium text-blue-900 mb-3">🚀 Quick Start Commands</h4>
                <div className="text-sm text-blue-800 space-y-2">
                  <div className="bg-blue-100 p-2 rounded font-mono text-xs">
                    docker run -d --name minecraft -p 25565:25565 -e EULA=TRUE itzg/minecraft-server
                  </div>
                  <div className="bg-blue-100 p-2 rounded font-mono text-xs">
                    docker run -d --name nginx -p 80:80 nginx:alpine
                  </div>
                  <div className="bg-blue-100 p-2 rounded font-mono text-xs">
                    docker run -d --name palworld -p 8211:8211/udp thijsvanloef/palworld-server-docker
                  </div>
                </div>
                <p className="text-sm text-blue-700 mt-3">
                  💡 Use the SSH terminal to run these commands and deploy your services.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">
                  Container Overview ({containers.filter(c => c.status === 'running').length}/{containers.length} running)
                </h3>
                <div className="text-sm text-gray-600">
                  Last updated: {new Date().toLocaleTimeString()}
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-green-900">Running</p>
                      <p className="text-2xl font-bold text-green-600">
                        {containers.filter(c => c.status === 'running').length}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <Square className="w-8 h-8 text-gray-600" />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900">Stopped</p>
                      <p className="text-2xl font-bold text-gray-600">
                        {containers.filter(c => c.status === 'stopped' || c.status === 'exited').length}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <Container className="w-8 h-8 text-blue-600" />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-blue-900">Total</p>
                      <p className="text-2xl font-bold text-blue-600">{containers.length}</p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <Activity className="w-8 h-8 text-purple-600" />
                    <div className="ml-3">
                      <p className="text-sm font-medium text-purple-900">Services</p>
                      <p className="text-2xl font-bold text-purple-600">
                        {new Set(containers.map(c => getServiceTypeInfo(c).type)).size}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Container List */}
              <div className="grid gap-4">
                {containers.map((container) => {
                  const serviceInfo = getServiceTypeInfo(container);
                  return (
                    <div key={container.id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-xl">
                              {serviceInfo.icon}
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
                              <Badge variant="secondary" size="sm">
                                {serviceInfo.type}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-600 mt-1">
                              <span>Image: {container.image}</span>
                              <span>Created: {container.created}</span>
                              {container.uptime && <span>Uptime: {container.uptime}</span>}
                              {container.size && <span>Size: {container.size}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {getContainerActions(container)}
                        </div>
                      </div>

                      {/* Port Mappings */}
                      {container.ports.length > 0 && (
                        <div className="mt-4">
                          <h5 className="text-sm font-medium text-gray-700 mb-2">Port Mappings</h5>
                          <div className="flex flex-wrap gap-2">
                            {container.ports.map((port, index) => (
                              <div key={index} className="bg-gray-100 px-3 py-1 rounded-full text-sm flex items-center">
                                <span className="font-mono">{port}</span>
                                {container.status === 'running' && (port.includes(':80->') || port.includes(':443->')) && (
                                  <ExternalLink className="w-3 h-3 inline ml-1 text-blue-600" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Service-specific information */}
                      {container.status === 'running' && (
                        <div className="mt-4">
                          {serviceInfo.type === 'Minecraft Server' && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <div className="flex items-center space-x-2">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                <span className="text-sm font-medium text-green-900">🎮 Minecraft Server Ready</span>
                              </div>
                              <p className="text-sm text-green-800 mt-1">
                                Players can connect using the instance's public IP address on port 25565
                              </p>
                            </div>
                          )}

                          {serviceInfo.type === 'Web Server' && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                              <div className="flex items-center space-x-2">
                                <CheckCircle className="w-4 h-4 text-blue-600" />
                                <span className="text-sm font-medium text-blue-900">🌐 Web Service Available</span>
                              </div>
                              <p className="text-sm text-blue-800 mt-1">
                                Access via browser using the instance's public IP address
                              </p>
                            </div>
                          )}

                          {serviceInfo.type.includes('Server') && !serviceInfo.type.includes('Web') && (
                            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                              <div className="flex items-center space-x-2">
                                <CheckCircle className="w-4 h-4 text-purple-600" />
                                <span className="text-sm font-medium text-purple-900">{serviceInfo.icon} {serviceInfo.type} Online</span>
                              </div>
                              <p className="text-sm text-purple-800 mt-1">
                                {serviceInfo.description} - Check the game's documentation for connection details
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Command and additional info */}
                      {container.command && (
                        <div className="mt-4 text-xs text-gray-500">
                          <span className="font-medium">Command:</span> <code className="bg-gray-100 px-1 rounded">{container.command}</code>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div className="flex items-center space-x-4">
              <span>Instance: {instanceName}</span>
              <span>Docker Engine: {dockerStatus}</span>
              <span>Real-time monitoring active</span>
            </div>
            <div className="flex items-center space-x-4">
              <span>Containers: {containers.length}</span>
              <span>Running: {containers.filter(c => c.status === 'running').length}</span>
              <span>Stopped: {containers.filter(c => c.status === 'stopped' || c.status === 'exited').length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}