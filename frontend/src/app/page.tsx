"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:8000", {
  transports: ["websocket"],
});

export default function RadarDashboard() {
  const [findings, setFindings] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [activeScanId, setActiveScanId] = useState<number | null>(null);
  const [scanStatus, setScanStatus] = useState<string>("IDLE");
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);

  // Real-time Telemetry Connection
  useEffect(() => {
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    
    socket.on("new_finding", (data) => {
      // Functional state update prevents race conditions during high-frequency telemetry bursts
      setFindings((prev) => {
        // Prevent duplicates if the socket fires multiple times for the same finding
        if (prev.some(f => f.name === data.name && f.target === data.target)) return prev;
        return [data, ...prev];
      });
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("new_finding");
    };
  }, []);

  // Historical Data Hydration
  useEffect(() => {
    if (!activeScanId) return;

    const fetchHistoricalData = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/v1/scans/${activeScanId}`);
        if (!res.ok) throw new Error("Vault lookup failed");
        const data = await res.json();
        
        setScanStatus(data.status);
        if (data.findings && data.findings.length > 0) {
          setFindings(data.findings.reverse()); // Show newest at the top
        }
      } catch (error) {
        console.error("Failed to hydrate telemetry:", error);
      }
    };

    fetchHistoricalData();
    // In a full implementation, you might poll this endpoint periodically to update scanStatus 
    // from RUNNING to COMPLETED if the backend doesn't push a status_update socket event.
  }, [activeScanId]);

  // Scan Lifecycle Management
  const launchScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl) return;

    setScanStatus("PENDING");
    setFindings([]); // Clear matrix for new scan
    setActiveScanId(null);

    try {
      const res = await fetch("http://localhost:8000/api/v1/scans/launch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_url: targetUrl, label: "Manual Override" }),
      });
      
      const data = await res.json();
      setActiveScanId(data.scan_id);
      setScanStatus("RUNNING");
    } catch (error) {
      console.error("Dispatch failed:", error);
      setScanStatus("FAILED");
    }
  };

  const getSeverityBadge = (severity: string) => {
    const styles: Record<string, string> = {
      critical: "bg-red-500/10 text-red-400 border-red-500/30",
      high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
      medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
      low: "bg-green-500/10 text-green-400 border-green-500/30",
      info: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    };
    
    const style = styles[severity?.toLowerCase()] || styles.info;
    return <span className={`px-2 py-1 text-xs font-semibold uppercase tracking-wider border rounded ${style}`}>{severity}</span>;
  };

  return (
    <main className="min-h-screen bg-[#0a0f18] text-slate-300 font-mono p-6">
      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-6">
        
        {/* Sidebar Navigation / Command Module */}
        <aside className="col-span-12 md:col-span-4 lg:col-span-3 space-y-6">
          <div className="pb-4 border-b border-slate-800">
            <h1 className="text-3xl font-bold text-white tracking-tight">Echelon</h1>
            <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest">C2 Telemetry Matrix</p>
          </div>

          <div className="flex items-center justify-between bg-slate-900/50 border border-slate-800 px-4 py-3 rounded-lg shadow-inner">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Uplink Status</span>
            <div className="flex items-center gap-2">
              <div className="relative flex h-2 w-2">
                {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
              </div>
              <span className={`text-xs font-bold tracking-wide ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
                {isConnected ? "SECURED" : "OFFLINE"}
              </span>
            </div>
          </div>

          <form onSubmit={launchScan} className="bg-[#0f1523] border border-slate-800 p-4 rounded-xl space-y-4 shadow-xl">
            <h2 className="text-sm font-semibold text-white uppercase tracking-widest">New Deployment</h2>
            <div>
              <label className="block text-xs text-slate-500 mb-1 uppercase tracking-wide">Target Designation</label>
              <input 
                type="text" 
                placeholder="https://target.local"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 rounded-lg px-3 py-2 text-sm text-white outline-none transition-all"
                required
              />
            </div>
            <button 
              type="submit"
              disabled={scanStatus === "RUNNING" || scanStatus === "PENDING"}
              className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-semibold text-xs uppercase tracking-widest py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanStatus === "RUNNING" ? "Engaging Target..." : "Launch Sequence"}
            </button>
          </form>
        </aside>

        {/* Telemetry Matrix Main View */}
        <section className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col h-[calc(100vh-3rem)]">
          <div className="bg-[#0f1523] border border-slate-800 rounded-xl flex-grow overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-slate-900/80 px-5 py-4 border-b border-slate-800 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-slate-300 tracking-widest uppercase">Live Intercept Feed</h2>
                {scanStatus !== "IDLE" && (
                  <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-widest ${
                    scanStatus === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    scanStatus === 'FAILED' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                    'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse'
                  }`}>
                    {scanStatus}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 font-medium">Intercepts: {findings.length}</span>
            </div>
            
            <div className="p-4 overflow-y-auto custom-scrollbar flex-grow bg-slate-950/30">
              {findings.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-5">
                  <div className={`w-12 h-12 border-4 border-slate-800 rounded-full ${scanStatus === 'RUNNING' ? 'border-t-emerald-500 animate-spin' : 'border-t-slate-600'}`}></div>
                  <p className={`tracking-widest uppercase text-xs font-semibold ${scanStatus === 'RUNNING' ? 'animate-pulse text-emerald-500/70' : ''}`}>
                    {scanStatus === "RUNNING" ? "Awaiting first payload..." : "System Idle. Awaiting commands."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {findings.map((finding, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => setSelectedFinding(finding)}
                      className="group flex items-center justify-between p-4 bg-slate-900/40 hover:bg-slate-800/60 border border-slate-800/60 hover:border-slate-600 rounded-lg transition-all duration-200 cursor-pointer"
                    >
                      <div className="flex items-center gap-5">
                        <div className="w-24 shrink-0">
                          {getSeverityBadge(finding.severity)}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-slate-200 font-semibold group-hover:text-white transition-colors">{finding.name}</span>
                          <span className="text-xs text-slate-500 truncate max-w-lg mt-0.5">{finding.target || (finding.description ? finding.description.substring(0, 80) + '...' : 'Metadata unavailable')}</span>
                        </div>
                      </div>
                      <div className="text-xs text-slate-600 font-mono flex items-center gap-3">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-500/50">View Details &rarr;</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

      </div>

      {/* Detail View Modal */}
      {selectedFinding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f1523] border border-slate-700 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-start bg-slate-900/50">
              <div>
                <div className="mb-2">{getSeverityBadge(selectedFinding.severity)}</div>
                <h3 className="text-xl font-bold text-white mt-1">{selectedFinding.name}</h3>
              </div>
              <button 
                onClick={() => setSelectedFinding(null)}
                className="text-slate-500 hover:text-white p-1"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Target Asset</h4>
                <div className="p-3 bg-slate-900 rounded border border-slate-800 font-mono text-sm text-slate-300">
                  {selectedFinding.target || targetUrl}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Description</h4>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {selectedFinding.description || "No extensive description provided by the template engine."}
                </p>
              </div>
              {/* Future Expansion: Render raw_nuclei_payload metadata here */}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}