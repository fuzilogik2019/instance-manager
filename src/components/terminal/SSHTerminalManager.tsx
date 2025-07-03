import React, { useState, useCallback } from 'react';
import { Terminal, Minimize2, Maximize2 } from 'lucide-react';
import SSHTerminal from './SSHTerminal';
import Button from '../ui/Button';

interface TerminalSession {
  id: string;
  instanceId: string;
  instanceName: string;
  keyPairName: string;
  host: string;
  isMinimized: boolean;
}

export default function SSHTerminalManager() {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [allMinimized, setAllMinimized] = useState(false);

  const openTerminal = useCallback((instanceId: string, instanceName: string, keyPairName: string, host: string) => {
    const existingTerminal = terminals.find(t => t.instanceId === instanceId);
    
    if (existingTerminal) {
      // Si ya existe, lo desminiaturizamos
      setTerminals(prev => prev.map(t => 
        t.instanceId === instanceId 
          ? { ...t, isMinimized: false }
          : t
      ));
    } else {
      // Crear nueva terminal
      const newTerminal: TerminalSession = {
        id: `terminal-${instanceId}-${Date.now()}`,
        instanceId,
        instanceName,
        keyPairName,
        host,
        isMinimized: false,
      };
      setTerminals(prev => [...prev, newTerminal]);
    }
  }, [terminals]);

  const closeTerminal = useCallback((instanceId: string) => {
    setTerminals(prev => prev.filter(t => t.instanceId !== instanceId));
  }, []);

  const toggleMinimize = useCallback((instanceId: string) => {
    setTerminals(prev => prev.map(t => 
      t.instanceId === instanceId 
        ? { ...t, isMinimized: !t.isMinimized }
        : t
    ));
  }, []);

  const toggleAllMinimized = useCallback(() => {
    const newMinimizedState = !allMinimized;
    setAllMinimized(newMinimizedState);
    setTerminals(prev => prev.map(t => ({ ...t, isMinimized: newMinimizedState })));
  }, [allMinimized]);

  // Exponer función global para abrir terminales
  React.useEffect(() => {
    (window as any).openSSHTerminal = openTerminal;
    return () => {
      delete (window as any).openSSHTerminal;
    };
  }, [openTerminal]);

  const activeTerminals = terminals.filter(t => !t.isMinimized);
  const minimizedTerminals = terminals.filter(t => t.isMinimized);

  return (
    <>
      {/* Terminales activas */}
      {activeTerminals.map((terminal) => (
        <SSHTerminal
          key={terminal.id}
          instanceId={terminal.instanceId}
          instanceName={terminal.instanceName}
          keyPairName={terminal.keyPairName}
          host={terminal.host}
          onClose={() => closeTerminal(terminal.instanceId)}
          onMinimize={() => toggleMinimize(terminal.instanceId)}
          isMinimized={false}
        />
      ))}

      {/* Barra de terminales minimizadas */}
      {minimizedTerminals.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-600 z-40">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-white" />
              <span className="text-white text-sm font-medium">
                SSH Terminals ({minimizedTerminals.length})
              </span>
            </div>
            
            <div className="flex items-center space-x-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={toggleAllMinimized}
                className="bg-gray-700 hover:bg-gray-600 text-white border-gray-600"
              >
                {allMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 px-4 pb-2 overflow-x-auto">
            {minimizedTerminals.map((terminal) => (
              <button
                key={terminal.id}
                onClick={() => toggleMinimize(terminal.instanceId)}
                className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm whitespace-nowrap transition-colors"
              >
                <Terminal className="w-3 h-3" />
                <span>{terminal.instanceName}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminal(terminal.instanceId);
                  }}
                  className="text-gray-400 hover:text-white ml-1"
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}