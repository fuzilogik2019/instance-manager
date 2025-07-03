import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import Layout from './components/Layout';
import InstancesList from './components/instances/InstancesList';
import SecurityGroupsList from './components/securitygroups/SecurityGroupsList';
import KeyPairsList from './components/keypairs/KeyPairsList';
import VolumesList from './components/volumes/VolumesList';
import SSHTerminalManager from './components/terminal/SSHTerminalManager';
import AWSCredentialsSetup from './components/aws/AWSCredentialsSetup';

const queryClient = new QueryClient();

function App() {
  const [activeTab, setActiveTab] = useState('instances');
  const [isAWSConfigured, setIsAWSConfigured] = useState(false);
  const [checkingCredentials, setCheckingCredentials] = useState(true);

  useEffect(() => {
    checkAWSCredentials();
  }, []);

  const checkAWSCredentials = async () => {
    try {
      // Check if credentials are stored locally
      const storedCredentials = localStorage.getItem('aws_credentials');
      
      if (storedCredentials) {
        const credentials = JSON.parse(storedCredentials);
        
        // Set credentials on server
        const response = await fetch('http://localhost:3001/api/aws/set-credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(credentials),
        });

        if (response.ok) {
          setIsAWSConfigured(true);
        } else {
          // Credentials are invalid, remove them
          localStorage.removeItem('aws_credentials');
          setIsAWSConfigured(false);
        }
      } else {
        setIsAWSConfigured(false);
      }
    } catch (error) {
      console.error('Failed to verify AWS credentials:', error);
      setIsAWSConfigured(false);
    } finally {
      setCheckingCredentials(false);
    }
  };

  const handleCredentialsConfigured = () => {
    setIsAWSConfigured(true);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'instances':
        return <InstancesList />;
      case 'security-groups':
        return <SecurityGroupsList />;
      case 'keypairs':
        return <KeyPairsList />;
      case 'volumes':
        return <VolumesList />;
      default:
        return <InstancesList />;
    }
  };

  // Show loading screen while checking credentials
  if (checkingCredentials) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking AWS credentials...</p>
        </div>
      </div>
    );
  }

  // Show credentials setup if not configured
  if (!isAWSConfigured) {
    return (
      <QueryClientProvider client={queryClient}>
        <AWSCredentialsSetup onCredentialsConfigured={handleCredentialsConfigured} />
      </QueryClientProvider>
    );
  }

  // Show main application
  return (
    <QueryClientProvider client={queryClient}>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {renderContent()}
        {/* Terminal Manager - Persiste a través de todas las secciones */}
        <SSHTerminalManager />
      </Layout>
    </QueryClientProvider>
  );
}

export default App;