import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Shield, Plus, Trash2, Server, Gamepad2, Globe } from 'lucide-react';
import { SecurityGroupRule } from '../../types/aws';
import { createSecurityGroup } from '../../services/api';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Card from '../ui/Card';
import LoadingSpinner from '../ui/LoadingSpinner';

interface FormData {
  name: string;
  description: string;
}

interface SecurityGroupCreationFormProps {
  region: string;
  onSecurityGroupCreated: () => void;
  onClose: () => void;
}

export default function SecurityGroupCreationForm({ region, onSecurityGroupCreated, onClose }: SecurityGroupCreationFormProps) {
  const [creating, setCreating] = useState(false);
  const [rules, setRules] = useState<Omit<SecurityGroupRule, 'id'>[]>([]);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>();

  const commonPorts = [
    { name: 'SSH', port: 22, protocol: 'tcp', description: 'Secure Shell access' },
    { name: 'HTTP', port: 80, protocol: 'tcp', description: 'Web server (unencrypted)' },
    { name: 'HTTPS', port: 443, protocol: 'tcp', description: 'Web server (encrypted)' },
    { name: 'RDP', port: 3389, protocol: 'tcp', description: 'Remote Desktop Protocol' },
    { name: 'MySQL', port: 3306, protocol: 'tcp', description: 'MySQL database' },
    { name: 'PostgreSQL', port: 5432, protocol: 'tcp', description: 'PostgreSQL database' },
    { name: 'Minecraft', port: 25565, protocol: 'tcp', description: 'Minecraft Java server' },
    { name: 'Minecraft Bedrock', port: 19132, protocol: 'udp', description: 'Minecraft Bedrock server' },
    { name: 'Steam/Source', port: 27015, protocol: 'udp', description: 'Steam/Source game server' },
    { name: 'Game Server', port: 7777, protocol: 'udp', description: 'Common game server port' },
  ];

  const addCommonPort = (port: typeof commonPorts[0]) => {
    const newRule: Omit<SecurityGroupRule, 'id'> = {
      protocol: port.protocol as 'tcp' | 'udp',
      fromPort: port.port,
      toPort: port.port,
      source: '0.0.0.0/0',
      description: port.description,
    };
    setRules([...rules, newRule]);
  };

  const addCustomRule = () => {
    const newRule: Omit<SecurityGroupRule, 'id'> = {
      protocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      source: '0.0.0.0/0',
      description: '',
    };
    setRules([...rules, newRule]);
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, field: keyof Omit<SecurityGroupRule, 'id'>, value: any) => {
    const updatedRules = rules.map((rule, i) => 
      i === index ? { ...rule, [field]: value } : rule
    );
    setRules(updatedRules);
  };

  const getProtocolIcon = (protocol: string) => {
    switch (protocol.toLowerCase()) {
      case 'tcp':
        return <Server className="w-4 h-4 text-blue-600" />;
      case 'udp':
        return <Gamepad2 className="w-4 h-4 text-green-600" />;
      case 'icmp':
        return <Globe className="w-4 h-4 text-orange-600" />;
      default:
        return <Shield className="w-4 h-4 text-gray-600" />;
    }
  };

  const onSubmit = async (data: FormData) => {
    try {
      setCreating(true);
      await createSecurityGroup({
        name: data.name,
        description: data.description,
        region,
        rules,
      });
      onSecurityGroupCreated();
      onClose();
    } catch (error) {
      console.error('Failed to create security group:', error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create Security Group</h2>
          <p className="text-sm text-gray-600 mt-1">Configure firewall rules to control network access in {region}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Security Group Name"
              {...register('name', { 
                required: 'Name is required',
                pattern: {
                  value: /^[a-zA-Z0-9_-]+$/,
                  message: 'Name can only contain letters, numbers, hyphens, and underscores'
                }
              })}
              error={errors.name?.message}
              placeholder="my-web-server-sg"
            />

            <Input
              label="Description"
              {...register('description', { required: 'Description is required' })}
              error={errors.description?.message}
              placeholder="Security group for web server"
            />
          </div>

          <Card title="Quick Setup - Common Ports">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {commonPorts.map((port) => (
                <Button
                  key={`${port.name}-${port.port}`}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addCommonPort(port)}
                  className="flex flex-col items-center p-3 h-auto"
                >
                  {getProtocolIcon(port.protocol)}
                  <span className="text-xs font-medium mt-1">{port.name}</span>
                  <span className="text-xs text-gray-500">{port.port}/{port.protocol.toUpperCase()}</span>
                </Button>
              ))}
            </div>
          </Card>

          <Card title="Inbound Rules (Open Ports)">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">Configure which ports should be accessible from the internet</p>
                <Button type="button" variant="secondary" size="sm" onClick={addCustomRule}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Custom Rule
                </Button>
              </div>

              {rules.map((rule, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                    <Select
                      label="Protocol"
                      value={rule.protocol}
                      onChange={(e) => updateRule(index, 'protocol', e.target.value)}
                      options={[
                        { value: 'tcp', label: 'TCP' },
                        { value: 'udp', label: 'UDP' },
                        { value: 'icmp', label: 'ICMP' },
                      ]}
                    />

                    <Input
                      label="From Port"
                      type="number"
                      value={rule.fromPort}
                      onChange={(e) => updateRule(index, 'fromPort', parseInt(e.target.value))}
                      min="0"
                      max="65535"
                    />

                    <Input
                      label="To Port"
                      type="number"
                      value={rule.toPort}
                      onChange={(e) => updateRule(index, 'toPort', parseInt(e.target.value))}
                      min="0"
                      max="65535"
                    />

                    <Select
                      label="Source"
                      value={rule.source}
                      onChange={(e) => updateRule(index, 'source', e.target.value)}
                      options={[
                        { value: '0.0.0.0/0', label: 'Anywhere (0.0.0.0/0)' },
                        { value: '10.0.0.0/8', label: 'Private Network (10.0.0.0/8)' },
                        { value: '172.16.0.0/12', label: 'Private Network (172.16.0.0/12)' },
                        { value: '192.168.0.0/16', label: 'Private Network (192.168.0.0/16)' },
                      ]}
                    />

                    <Input
                      label="Description"
                      value={rule.description}
                      onChange={(e) => updateRule(index, 'description', e.target.value)}
                      placeholder="Optional description"
                    />

                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => removeRule(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {rules.length === 0 && (
                <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
                  <Shield className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No rules configured</p>
                  <p className="text-sm text-gray-500 mt-1">Add rules above to allow network access</p>
                </div>
              )}
            </div>
          </Card>

          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">Security Best Practices</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Only open ports that your application actually needs</li>
              <li>• Use specific IP ranges instead of "Anywhere" (0.0.0.0/0) when possible</li>
              <li>• SSH (port 22) should be restricted to your IP address</li>
              <li>• For game servers, consider using non-standard ports to reduce automated attacks</li>
              <li>• Regularly review and remove unused rules</li>
            </ul>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-6 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <>
                  <LoadingSpinner size="sm" />
                  <span className="ml-2">Creating Security Group...</span>
                </>
              ) : (
                'Create Security Group'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}