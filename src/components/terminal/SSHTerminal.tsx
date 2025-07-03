import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { io, Socket } from "socket.io-client";
import {
  X,
  Maximize2,
  Minimize2,
  Terminal as TerminalIcon,
  Wifi,
  WifiOff,
} from "lucide-react";
import Button from "../ui/Button";
import "@xterm/xterm/css/xterm.css";

interface SSHTerminalProps {
  instanceId: string;
  instanceName: string;
  keyPairName: string;
  host: string;
  onClose: () => void;
  onMinimize?: () => void;
  isMinimized: boolean;
}

export default function SSHTerminal({
  instanceId,
  instanceName,
  keyPairName,
  host,
  onClose,
  onMinimize,
  isMinimized,
}: SSHTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const socket = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<string>("Initializing...");

  // Use refs to avoid stale closure issues
  const isConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);

  // Update refs when state changes
  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  useEffect(() => {
    socketRef.current = socket.current;
  }, [socket.current]);

  useEffect(() => {
    if (!isMinimized) {
      initializeTerminal();
      connectToSSH();
    }

    // Handle window resize
    const handleResize = () => {
      if (fitAddon.current && terminal.current && !isMinimized) {
        setTimeout(() => {
          fitAddon.current?.fit();
        }, 100);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (isMinimized) {
        // Don't cleanup when minimizing, just hide
        return;
      }
      cleanup();
    };
  }, [isMinimized]);

  const initializeTerminal = () => {
    if (!terminalRef.current || isMinimized) return;

    // Create terminal instance with better configuration
    terminal.current = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace',
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: "#1a1a1a",
        foreground: "#ffffff",
        cursor: "#ffffff",
        cursorAccent: "#000000",
        black: "#000000",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#bd93f9",
        magenta: "#ff79c6",
        cyan: "#8be9fd",
        white: "#bfbfbf",
        brightBlack: "#4d4d4d",
        brightRed: "#ff6e67",
        brightGreen: "#5af78e",
        brightYellow: "#f4f99d",
        brightBlue: "#caa9fa",
        brightMagenta: "#ff92d0",
        brightCyan: "#9aedfe",
        brightWhite: "#e6e6e6",
      },
      cols: 80,
      rows: 24,
      scrollback: 1000,
      tabStopWidth: 4,
      allowProposedApi: true,
    });

    // Create addons
    fitAddon.current = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    // Load addons
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.loadAddon(webLinksAddon);

    // Open terminal
    terminal.current.open(terminalRef.current);

    // Focus the terminal
    terminal.current.focus();

    // Fit terminal to container
    setTimeout(() => {
      if (fitAddon.current) {
        fitAddon.current.fit();
      }
    }, 100);

    // Handle terminal input
    terminal.current.onData((data) => {
      if (socketRef.current) {
        socketRef.current.emit("ssh:input", { input: data });
      }
    });

    // Handle terminal resize
    terminal.current.onResize(({ cols, rows }) => {
      if (socketRef.current && isConnectedRef.current) {
        socketRef.current.emit("ssh:resize", { cols, rows });
      }
    });

    // Welcome message
    terminal.current.writeln(
      "\x1b[1;32m╭─────────────────────────────────────────────────────────────╮\x1b[0m"
    );
    terminal.current.writeln(
      "\x1b[1;32m│                    🚀 AWS EC2 SSH Terminal                  │\x1b[0m"
    );
    terminal.current.writeln(
      "\x1b[1;32m╰─────────────────────────────────────────────────────────────╯\x1b[0m"
    );
    terminal.current.writeln("");
    terminal.current.writeln(
      `\x1b[1;36mConnecting to: \x1b[1;33m${instanceName}\x1b[0m`
    );
    terminal.current.writeln(`\x1b[1;36mHost: \x1b[1;33m${host}\x1b[0m`);
    terminal.current.writeln(
      `\x1b[1;36mKey Pair: \x1b[1;33m${keyPairName}\x1b[0m`
    );
    terminal.current.writeln("");
  };

  const connectToSSH = () => {
    if (isMinimized) return;
    
    setIsConnecting(true);
    isConnectingRef.current = true;
    setConnectionStatus("Connecting to server...");

    if (terminal.current) {
      terminal.current.writeln(
        "\x1b[1;36m🔌 Connecting to SSH service...\x1b[0m"
      );
    }

    // Create socket connection
    socket.current = io("http://localhost:3001", {
      transports: ["websocket"],
      timeout: 20000,
      forceNew: true,
      reconnection: false,
    });

    socketRef.current = socket.current;

    socket.current.on("connect", () => {
      setConnectionStatus("Establishing SSH connection...");

      if (terminal.current) {
        terminal.current.writeln(
          "\x1b[1;32m✅ Connected to SSH service\x1b[0m"
        );
        terminal.current.writeln(
          "\x1b[1;36m🔐 Authenticating with SSH server...\x1b[0m"
        );
      }

      socket.current?.emit("ssh:connect", {
        instanceId,
        keyPairName,
        username: "ubuntu", // Default for Ubuntu
      });
    });

    socket.current.on("ssh:connected", (data) => {
      setIsConnected(true);
      isConnectedRef.current = true;
      setIsConnecting(false);
      isConnectingRef.current = false;
      setConnectionStatus("Connected");

      if (terminal.current) {
        terminal.current.writeln(
          `\x1b[1;32m✅ Connected to ${data.username}@${data.host}\x1b[0m`
        );
        terminal.current.writeln("");
        terminal.current.writeln(
          "\x1b[1;33m💡 Terminal is ready! You can now type commands.\x1b[0m"
        );
        terminal.current.writeln("");

        setTimeout(() => {
          if (terminal.current) {
            terminal.current.focus();
          }
        }, 100);
      }
    });

    socket.current.on("ssh:data", (data) => {
      if (terminal.current) {
        terminal.current.write(data);
      }
    });

    socket.current.on("ssh:error", (error) => {
      setIsConnecting(false);
      isConnectingRef.current = false;
      setIsConnected(false);
      isConnectedRef.current = false;
      setConnectionStatus(`Error: ${error.message}`);

      if (terminal.current) {
        terminal.current.writeln(
          `\x1b[1;31m❌ Connection failed: ${error.message}\x1b[0m`
        );
      }
    });

    socket.current.on("ssh:disconnected", (data) => {
      setIsConnected(false);
      isConnectedRef.current = false;
      setConnectionStatus("Disconnected");

      if (terminal.current) {
        terminal.current.writeln(`\x1b[1;33m🔌 ${data.message}\x1b[0m`);
      }
    });

    socket.current.on("disconnect", () => {
      setIsConnected(false);
      isConnectedRef.current = false;
      setConnectionStatus("Disconnected");
      socketRef.current = null;
    });

    socket.current.on("connect_error", (error) => {
      setIsConnecting(false);
      isConnectingRef.current = false;
      setConnectionStatus("Connection failed");
      socketRef.current = null;
    });
  };

  const cleanup = () => {
    if (socket.current) {
      socket.current.disconnect();
      socket.current = null;
      socketRef.current = null;
    }

    if (terminal.current) {
      terminal.current.dispose();
      terminal.current = null;
    }
  };

  const handleResize = () => {
    if (fitAddon.current && !isMinimized) {
      setTimeout(() => {
        fitAddon.current?.fit();
        if (terminal.current) {
          terminal.current.focus();
        }
      }, 100);
    }
  };

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
    setTimeout(() => {
      handleResize();
    }, 100);
  };

  const getStatusColor = () => {
    if (isConnected) return "text-green-400";
    if (isConnecting) return "text-yellow-400";
    return "text-red-400";
  };

  const getStatusIcon = () => {
    if (isConnected) return <Wifi className="w-4 h-4 text-green-400" />;
    if (isConnecting)
      return (
        <div className="w-4 h-4 animate-spin border-2 border-yellow-400 border-t-transparent rounded-full" />
      );
    return <WifiOff className="w-4 h-4 text-red-400" />;
  };

  // Don't render if minimized
  if (isMinimized) {
    return null;
  }

  return (
    <div
      className={`fixed bg-white rounded-lg shadow-2xl border border-gray-200 z-50 ${
        isMaximized ? "inset-4" : "bottom-4 right-4 w-[900px] h-[650px]"
      }`}
    >
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 text-white rounded-t-lg">
        <div className="flex items-center space-x-3">
          <TerminalIcon className="w-4 h-4" />
          <span className="font-medium">SSH Terminal - {instanceName}</span>
          <div className="flex items-center space-x-2">
            {getStatusIcon()}
            <span className={`text-xs ${getStatusColor()}`}>
              {connectionStatus}
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {onMinimize && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onMinimize}
              className="p-1 bg-gray-700 hover:bg-gray-600 border-gray-600"
              title="Minimize"
            >
              <Minimize2 className="w-4 h-4" />
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={toggleMaximize}
            className="p-1 bg-gray-700 hover:bg-gray-600 border-gray-600"
          >
            {isMaximized ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={onClose}
            className="p-1 bg-red-600 hover:bg-red-700 border-red-600"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Terminal Content */}
      <div
        className="relative bg-black rounded-b-lg overflow-hidden cursor-text"
        style={{
          height: isMaximized ? "calc(100% - 80px)" : "560px",
        }}
        onClick={() => terminal.current?.focus()}
      >
        <div
          ref={terminalRef}
          className="w-full h-full p-2"
          style={{
            fontFamily:
              'Monaco, Menlo, "Ubuntu Mono", "Courier New", monospace',
          }}
        />

        {/* Connection overlay */}
        {isConnecting && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
            <div className="text-center text-white">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
              <p className="text-lg font-medium">
                Establishing SSH Connection...
              </p>
              <p className="text-sm text-gray-300 mt-2">{connectionStatus}</p>
            </div>
          </div>
        )}
      </div>

      {/* Terminal Footer */}
      <div className="px-4 py-2 bg-gray-100 border-t border-gray-200 rounded-b-lg">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center space-x-4">
            <span>Host: {host}</span>
            <span>User: ubuntu</span>
            <span>Key: {keyPairName}</span>
          </div>
          <div className="flex items-center space-x-2">
            {isConnected ? (
              <>
                <span className="text-green-600">● Connected</span>
                <span>•</span>
                <span>Type commands normally</span>
              </>
            ) : (
              <>
                <span className="text-red-600">● Disconnected</span>
                <span>•</span>
                <span>Check connection status</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}