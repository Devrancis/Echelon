"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

// Define the shape of our incoming telemetry payload
interface Finding {
  scan_id: number;
  severity: string;
  name: string;
  target: string;
}

const socket = io("http://localhost:8000", {
  transports: ["websocket"],
});

export default function RadarDashboard() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    
    socket.on("new_finding", (data: Finding) => {
      setFindings((prev) => [data, ...prev]);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("new_finding");
    };
  }, []);

  const getSeverityBadge = (severity: string) => {
    const styles: Record<string, string> = {
      critical: "bg-red-500/10 text-red-400 border-red-500/30",
      high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
      medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
      low: "bg-green-500/10 text-green-400 border-green-500/30",
      info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    };
    
    const style = styles[severity.toLowerCase()] || styles.info;
    return <span className={`px-2 py-1 text-xs font-semibold uppercase tracking-wider border rounded ${style}`}>{severity}</span>;
  };

  return (
    <main className="min-h-screen bg-[#0a0f18] text-slate-300 font-mono p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Echelon Engine</h1>
            <p className="text-sm text-slate-500 mt-1">Autonomous Reconnaissance & Telemetry</p>
          </div>
          
          <div className="flex items-center gap-3 bg-slate-900/50 border border-slate-800 px-4 py-2 rounded-lg shadow-inner">
            <div className="relative flex h-3 w-3">
              {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            </div>
            <span className={`text-sm font-medium tracking-wide ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
              {isConnected ? "UPLINK SECURED" : "NEXUS OFFLINE"}
            </span>
          </div>
        </header>

        <section className="bg-[#0f1523] border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 px-4 py-3 border-b border-slate-800 flex justify-between items-center">
            <h2 className="text-sm font-semibold text-slate-400 tracking-widest uppercase">Live Intercept Feed</h2>
            <span className="text-xs text-slate-500">Showing {findings.length} records</span>
          </div>
          
          <div className="p-4 h-[600px] overflow-y-auto custom-scrollbar">
            {findings.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
                <div className="w-16 h-16 border-4 border-slate-800 border-t-emerald-500 rounded-full animate-spin"></div>
                <p className="animate-pulse tracking-widest uppercase text-sm">Scanning target perimeter...</p>
              </div>
            ) : (
              <div className="space-y-2">
                {findings.map((finding, idx) => (
                  <div key={idx} className="group flex items-center justify-between p-3 bg-slate-900/50 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 rounded-lg transition-all duration-200">
                    <div className="flex items-center gap-4">
                      <div className="w-24">
                        {getSeverityBadge(finding.severity)}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-medium">{finding.name}</span>
                        <span className="text-xs text-slate-500 truncate max-w-md">{finding.target}</span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 font-mono">
                      {new Date().toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}