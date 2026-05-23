"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:8000", {
  transports: ["websocket"],
});

type ViewMode = "matrix" | "fleet";

export default function RadarDashboard() {
  // Core UI State
  const [viewMode, setViewMode] = useState<ViewMode>("matrix");
  const [isConnected, setIsConnected] = useState(false);
  
  // Matrix (Live Scan) State
  const [findings, setFindings] = useState<any[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [selectedTool, setSelectedTool] = useState("nuclei");
  const [activeScanId, setActiveScanId] = useState<number | null>(null);
  const [scanStatus, setScanStatus] = useState<string>("IDLE");
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);

  // Fleet (Asset Management) State
  const [fleetData, setFleetData] = useState<any[]>([]);
  const [isFleetLoading, setIsFleetLoading] = useState(false);

  // Real-time Telemetry Connection
  useEffect(() => {
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    
    socket.on("new_finding", (data) => {
      if (viewMode === "matrix") {
        setFindings((prev) => {
          if (prev.some(f => f.name === data.name && f.target === data.target)) return prev;
          return [data, ...prev];
        });
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("new_finding");
    };
  }, [viewMode]);

  // Historical Data Hydration (Matrix)
  useEffect(() => {
    if (!activeScanId) return;
    const fetchHistoricalData = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/v1/scans/${activeScanId}`);
        if (!res.ok) throw new Error("Vault lookup failed");
        const data = await res.json();
        setScanStatus(data.status);
        if (data.findings && data.findings.length > 0) {
          setFindings(data.findings.reverse());
        }
      } catch (error) {
        console.error("Failed to hydrate telemetry:", error);
      }
    };
    fetchHistoricalData();
  }, [activeScanId]);

  // Asset Fleet Hydration
  useEffect(() => {
    if (viewMode === "fleet") {
      setIsFleetLoading(true);
      const fetchFleet = async () => {
        try {
          const res = await fetch(`http://localhost:8000/api/v1/targets`);
          if (!res.ok) throw new Error("Fleet lookup failed");
          const data = await res.json();
          setFleetData(data.fleet);
        } catch (error) {
          console.error("Failed to hydrate fleet:", error);
        } finally {
          setIsFleetLoading(false);
        }
      };
      fetchFleet();
    }
  }, [viewMode]);

  // Scan Lifecycle Management
  const launchScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl) return;

    setScanStatus("PENDING");
    setFindings([]);
    setActiveScanId(null);
    setViewMode("matrix"); // Force view to matrix on launch

    try {
      const res = await fetch("http://localhost:8000/api/v1/scans/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_url: targetUrl, label: "Manual Override", tool: selectedTool }),
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
      critical: "text-rose-500 border-rose-500/50",
      high: "text-orange-500 border-orange-500/50",
      medium: "text-amber-500 border-amber-500/50",
      low: "text-emerald-500 border-emerald-500/50",
      info: "text-cyan-500 border-cyan-500/50",
    };
    
    const style = styles[severity?.toLowerCase()] || styles.info;
    return (
      <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] border-l-2 border-y border-r border-y-transparent border-r-transparent bg-zinc-950 ${style}`}>
        {severity}
      </span>
    );
  };

  return (
    <main className="min-h-screen bg-black text-zinc-400 font-mono p-4 sm:p-6 selection:bg-cyan-500/30 selection:text-cyan-200">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Command Module (Left Column) */}
        <aside className="lg:col-span-3 flex flex-col gap-6">
          <div className="pb-4 border-b border-zinc-800/80">
            <h1 className="text-4xl font-black text-zinc-100 tracking-tighter uppercase flex items-center gap-2">
              Echelon <span className="text-cyan-500 text-lg">_</span>
            </h1>
            <p className="text-[10px] text-zinc-500 mt-2 uppercase tracking-[0.3em]">Autonomous Recon C2</p>
          </div>

          {/* Navigation Toggle */}
          <div className="flex bg-[#050505] border border-zinc-800/80 p-1">
            <button 
              onClick={() => setViewMode("matrix")}
              className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors ${viewMode === 'matrix' ? 'bg-cyan-950/30 text-cyan-400 border border-cyan-900/50' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              Live Matrix
            </button>
            <button 
              onClick={() => setViewMode("fleet")}
              className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors ${viewMode === 'fleet' ? 'bg-cyan-950/30 text-cyan-400 border border-cyan-900/50' : 'text-zinc-600 hover:text-zinc-400'}`}
            >
              Asset Fleet
            </button>
          </div>

          <div className="flex items-center justify-between bg-[#050505] border border-zinc-800/80 p-4">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Net Status</span>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold tracking-[0.2em] uppercase ${isConnected ? 'text-cyan-400' : 'text-rose-500'}`}>
                {isConnected ? "[ LINKED ]" : "[ OFFLINE ]"}
              </span>
              <div className={`h-1.5 w-1.5 ${isConnected ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-rose-500'} rounded-none`}></div>
            </div>
          </div>

          {/* Launch Console */}
          <form onSubmit={launchScan} className="bg-[#050505] border border-zinc-800/80 p-5 flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <h2 className="text-[11px] font-bold text-zinc-300 uppercase tracking-[0.2em]">New Directive</h2>
              <span className="text-zinc-600 text-xs">⌘</span>
            </div>
            
            <div className="space-y-2">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-[0.2em]">Target Vector</label>
              <input 
                type="text" 
                placeholder="target.local"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                className="w-full bg-black border-b border-zinc-800 focus:border-cyan-500 focus:bg-[#0a0a0a] px-3 py-2 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-800 font-mono"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-[0.2em]">Engine Tool</label>
              <select 
                value={selectedTool}
                onChange={(e) => setSelectedTool(e.target.value)}
                className="w-full bg-black border-b border-zinc-800 focus:border-cyan-500 focus:bg-[#0a0a0a] px-3 py-2 text-sm text-zinc-300 outline-none transition-colors font-mono uppercase tracking-widest cursor-pointer appearance-none"
              >
                <option value="nuclei">Nuclei (Vuln Scan)</option>
                <option value="subfinder">Subfinder (DNS Recon)</option>
                <option value="nmap">Nmap (Port Scan)</option>
              </select>
            </div>
            
            <button 
              type="submit"
              disabled={scanStatus === "RUNNING" || scanStatus === "PENDING"}
              className="group relative w-full bg-black border border-zinc-800 hover:border-cyan-500/50 text-zinc-400 hover:text-cyan-400 font-bold text-[11px] uppercase tracking-[0.2em] py-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden mt-2"
            >
              <div className="absolute inset-0 bg-cyan-500/10 translate-y-full group-hover:translate-y-0 transition-transform duration-200"></div>
              <span className="relative z-10 flex items-center justify-center gap-2">
                {scanStatus === "RUNNING" ? "Executing..." : "Initialize"}
              </span>
            </button>
          </form>
        </aside>

        {/* Viewport (Right Column) */}
        <section className="lg:col-span-9 flex flex-col h-[calc(100vh-3rem)]">
          
          {/* MATRIX VIEW */}
          {viewMode === "matrix" && (
            <div className="bg-[#050505] border border-zinc-800/80 flex-grow flex flex-col overflow-hidden relative animate-in fade-in duration-300">
              <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>

              <div className="px-5 py-4 border-b border-zinc-800/80 flex justify-between items-center bg-black/50 backdrop-blur z-10">
                <div className="flex items-center gap-4">
                  <h2 className="text-[11px] font-bold text-zinc-300 tracking-[0.2em] uppercase">Live Intercepts</h2>
                  {scanStatus !== "IDLE" && (
                    <span className={`text-[9px] px-2 py-0.5 border uppercase tracking-[0.2em] ${
                      scanStatus === 'COMPLETED' ? 'text-emerald-400 border-emerald-500/30' :
                      scanStatus === 'FAILED' ? 'text-rose-400 border-rose-500/30' :
                      'text-cyan-400 border-cyan-500/30 animate-pulse'
                    }`}>
                      {scanStatus}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Count: {findings.length.toString().padStart(4, '0')}</span>
              </div>
              
              <div className="p-4 overflow-y-auto custom-scrollbar flex-grow z-10">
                {findings.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-4">
                    <div className="font-mono text-sm tracking-[0.3em] uppercase flex gap-2 items-center">
                      {scanStatus === "RUNNING" ? (
                        <><span className="w-2 h-2 bg-cyan-500 animate-ping"></span> Awaiting packets...</>
                      ) : (
                        "[ SYSTEM IDLE ]"
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {findings.map((finding, idx) => (
                      <div 
                        key={idx} 
                        onClick={() => setSelectedFinding(finding)}
                        className="group flex items-center justify-between p-3 bg-black hover:bg-zinc-900/50 border border-zinc-900 hover:border-zinc-700 transition-colors cursor-crosshair"
                      >
                        <div className="flex items-center gap-6">
                          <div className="w-24 shrink-0">
                            {getSeverityBadge(finding.severity)}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-zinc-200 text-sm font-semibold tracking-wide group-hover:text-cyan-100 transition-colors">{finding.name}</span>
                            <span className="text-[10px] text-zinc-600 truncate max-w-lg mt-1 tracking-wider">{finding.target || (finding.description ? finding.description.substring(0, 80) + '...' : 'Null data')}</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-700 font-mono opacity-0 group-hover:opacity-100 transition-opacity tracking-[0.1em] uppercase">
                          [ Inspect ]
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* FLEET VIEW */}
          {viewMode === "fleet" && (
            <div className="bg-[#050505] border border-zinc-800/80 flex-grow flex flex-col overflow-hidden relative animate-in fade-in duration-300">
              <div className="px-5 py-4 border-b border-zinc-800/80 flex justify-between items-center bg-black">
                <h2 className="text-[11px] font-bold text-zinc-300 tracking-[0.2em] uppercase">Asset Intelligence Fleet</h2>
                <span className="text-[10px] text-zinc-500 tracking-[0.2em] uppercase">Targets Logged: {fleetData.length.toString().padStart(4, '0')}</span>
              </div>
              
              <div className="p-0 overflow-y-auto custom-scrollbar flex-grow bg-black">
                {isFleetLoading ? (
                  <div className="h-full flex items-center justify-center text-zinc-600 font-mono text-[10px] tracking-[0.3em] uppercase">
                    Querying Vault...
                  </div>
                ) : fleetData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-zinc-700 font-mono text-[10px] tracking-[0.3em] uppercase">
                    [ No Historical Assets Found ]
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#050505] sticky top-0 border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-5 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Target Vector</th>
                        <th className="py-3 px-5 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Status</th>
                        <th className="py-3 px-5 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Engagements</th>
                        <th className="py-3 px-5 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Total Intercepts</th>
                        <th className="py-3 px-5 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Last Seen</th>
                        <th className="py-3 px-5 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em] text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900/80">
                      {fleetData.map((asset) => (
                        <tr key={asset.id} className="hover:bg-zinc-900/30 transition-colors group">
                          <td className="py-3 px-5 font-mono text-sm text-cyan-500 font-bold group-hover:text-cyan-400">
                            {asset.target_url}
                          </td>
                          <td className="py-3 px-5">
                            <span className={`text-[9px] uppercase tracking-[0.1em] font-bold ${
                              asset.status === 'completed' ? 'text-emerald-500' : 
                              asset.status === 'failed' ? 'text-rose-500' : 'text-amber-500'
                            }`}>
                              [{asset.status}]
                            </span>
                          </td>
                          <td className="py-3 px-5 font-mono text-[11px] text-zinc-300">
                            {asset.total_scans.toString().padStart(2, '0')}
                          </td>
                          <td className="py-3 px-5 font-mono text-[11px] text-zinc-300">
                            {asset.total_findings.toString().padStart(4, '0')}
                          </td>
                          <td className="py-3 px-5 font-mono text-[10px] text-zinc-600">
                            {asset.last_scan_date ? new Date(asset.last_scan_date).toLocaleString() : 'N/A'}
                          </td>
                          <td className="py-3 px-5 text-right">
                            <a 
                              href={`http://localhost:8000/api/v1/targets/${asset.id}/report`}
                              download
                              className="inline-block text-[9px] bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-cyan-400 hover:border-cyan-900/50 px-3 py-1.5 uppercase tracking-widest transition-all cursor-pointer"
                            >
                              Export PDF
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </section>
      </div>

      {/* Detail View Modal (Matrix specific) */}
      {selectedFinding && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#030303] border border-zinc-800 w-full max-w-4xl flex flex-col shadow-2xl shadow-cyan-900/10 max-h-[90vh]">
            <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-start bg-black shrink-0">
              <div>
                <div className="mb-3">{getSeverityBadge(selectedFinding.severity)}</div>
                <h3 className="text-lg font-bold text-zinc-100 tracking-tight">{selectedFinding.name}</h3>
              </div>
              <button 
                onClick={() => setSelectedFinding(null)}
                className="text-zinc-600 hover:text-cyan-400 text-xl font-light hover:rotate-90 transition-all duration-300"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-8 flex-grow">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] flex items-center gap-2">
                    <span className="w-1 h-1 bg-cyan-500"></span> Target Vector
                  </h4>
                  <div className="p-3 bg-black border border-zinc-800 font-mono text-sm text-cyan-400 break-all">
                    {selectedFinding.target || targetUrl}
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] flex items-center gap-2">
                    <span className="w-1 h-1 bg-zinc-600"></span> Analysis
                  </h4>
                  <p className="text-sm text-zinc-400 leading-relaxed font-mono">
                    {selectedFinding.description || "No extensive description provided by the template engine."}
                  </p>
                </div>
              </div>
              
              {selectedFinding.meta_data && selectedFinding.meta_data.length > 0 ? (
                <div className="space-y-4 pt-4 border-t border-zinc-800/50">
                  {selectedFinding.meta_data.map((meta: any, idx: number) => (
                    <div key={idx} className="space-y-2">
                      <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] flex items-center gap-2">
                        <span className="w-1 h-1 bg-zinc-700"></span> {meta.key} Dump
                      </h4>
                      <div className="bg-black border border-zinc-900 relative group overflow-hidden">
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => navigator.clipboard.writeText(
                              typeof meta.value === 'string' ? meta.value : JSON.stringify(meta.value, null, 2)
                            )}
                            className="text-[9px] bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-cyan-400 px-2 py-1 uppercase tracking-widest cursor-pointer"
                          >
                            Copy
                          </button>
                        </div>
                        <pre className="p-4 overflow-x-auto custom-scrollbar font-mono text-[11px] text-cyan-600/70 leading-relaxed whitespace-pre-wrap">
                          {typeof meta.value === 'string' ? meta.value : JSON.stringify(meta.value, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2 opacity-50 pt-4 border-t border-zinc-800/50">
                  <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] flex items-center gap-2">
                    <span className="w-1 h-1 bg-zinc-800"></span> Raw Memory Dump
                  </h4>
                  <div className="p-4 bg-black border border-zinc-900 font-mono text-[10px] text-zinc-600 uppercase tracking-widest text-center">
                    [ No metadata attached to this finding ]
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}