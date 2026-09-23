import React, { useState, useEffect, useRef } from 'react';
import { ConnectionStatus, SessionMode } from '../types';
import { LiveStreamService } from '../services/liveStreamService';
import { Video, Mic, RefreshCw, Play, Square, ShieldCheck, Cpu, Terminal, Radio } from 'lucide-react';

export const Milestone1PipeTester: React.FC = () => {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState<string>('Ready to start Live Pipe test');
  const [serverHealth, setServerHealth] = useState<{ hasApiKey: boolean; status: string } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [transcripts, setTranscripts] = useState<{ speaker: 'user' | 'coach'; text: string }[]>([]);
  const [chunkIndex, setChunkIndex] = useState<number>(1);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [activeMode, setActiveMode] = useState<SessionMode>('rehearsal');

  const videoRef = useRef<HTMLVideoElement>(null);
  const liveStreamRef = useRef<LiveStreamService | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  // Check server health on mount
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setServerHealth(data);
        addLog(`[Health] Server connection verified. Has GEMINI_API_KEY: ${data.hasApiKey}`);
      })
      .catch((err) => {
        addLog(`[Health Error] Backend server not reachable at /api/health (${err.message})`);
      });
  }, []);

  // Auto scroll log container
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Session duration timer
  useEffect(() => {
    if (status === 'connected' || status === 'chunking') {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedSeconds(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const addLog = (msg: string) => {
    const timeStr = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timeStr}] ${msg}`]);
  };

  const handleStartSession = async () => {
    setTranscripts([]);
    addLog(`[Pipe Test] Starting session in ${activeMode} mode...`);

    const service = new LiveStreamService({
      onStatusChange: (newStatus, msg) => {
        setStatus(newStatus);
        if (msg) setStatusMessage(msg);
      },
      onTranscript: (speaker, text) => {
        setTranscripts((prev) => [...prev, { speaker, text }]);
      },
      onChunkEvent: (idx, action) => {
        setChunkIndex(idx);
        addLog(`[Chunking Notification] Chunk #${idx} state changed to '${action}'`);
      },
      onLog: (logText) => {
        addLog(logText);
      },
    });

    liveStreamRef.current = service;
    await service.startSession(activeMode, videoRef.current || undefined);
  };

  const handleEndSession = () => {
    if (liveStreamRef.current) {
      liveStreamRef.current.endSession();
      liveStreamRef.current = null;
    }
    setStatus('disconnected');
    setStatusMessage('Session stopped');
    addLog('[Pipe Test] Session ended by user.');
  };

  const handleTriggerChunk = () => {
    if (liveStreamRef.current) {
      liveStreamRef.current.triggerChunkReconnect();
      addLog('[Pipe Test] Triggered transparent session chunk reconnection test.');
    }
  };

  const formatTime = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header & Milestone Status */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white">Vireo</h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              Milestone 1 Verification
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Live Stream Pipe: Mic (16kHz PCM) + Camera (1 FPS JPEG) &rarr; Express Proxy &rarr; Gemini Live API &rarr; 24kHz Audio
          </p>
        </div>

        {/* Server & API Key Status Card */}
        <div className="flex items-center gap-3 bg-dark-800 p-3 rounded-lg border border-slate-700/60 text-xs">
          <ShieldCheck className={`w-5 h-5 ${serverHealth?.hasApiKey ? 'text-emerald-400' : 'text-rose-400'}`} />
          <div>
            <div className="font-semibold text-slate-200">
              API Key Server Proxy: {serverHealth?.hasApiKey ? 'Secure' : 'Missing'}
            </div>
            <div className="text-slate-400">
              {serverHealth?.hasApiKey ? 'Key protected on Node server' : 'Set GEMINI_API_KEY in .env'}
            </div>
          </div>
        </div>
      </header>

      {/* Control Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Mode Selector */}
        <div className="bg-dark-800 p-4 rounded-xl border border-slate-800 space-y-2">
          <label className="text-xs font-medium text-slate-400">Select Mode</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setActiveMode('rehearsal')}
              disabled={status !== 'disconnected'}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                activeMode === 'rehearsal'
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                  : 'bg-dark-700 border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Rehearsal Mode
            </button>
            <button
              onClick={() => setActiveMode('live')}
              disabled={status !== 'disconnected'}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                activeMode === 'live'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-dark-700 border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Live Mode (Ambient HUD)
            </button>
          </div>
        </div>

        {/* Status & Timer */}
        <div className="bg-dark-800 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-400">Pipe Connection</div>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  status === 'connected'
                    ? 'bg-emerald-400 animate-pulse'
                    : status === 'chunking'
                    ? 'bg-amber-400 animate-spin'
                    : status === 'connecting'
                    ? 'bg-cyan-400 animate-pulse'
                    : 'bg-slate-600'
                }`}
              />
              <span className="text-sm font-semibold capitalize text-slate-100">{status}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 truncate max-w-[180px]">{statusMessage}</div>
          </div>

          <div className="text-right">
            <div className="text-xs font-medium text-slate-400">Duration</div>
            <div className="text-lg font-mono font-bold text-white mt-1">{formatTime(elapsedSeconds)}</div>
            <div className="text-xs text-cyan-400 font-semibold mt-0.5">Chunk #{chunkIndex}</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="bg-dark-800 p-4 rounded-xl border border-slate-800 flex items-center gap-3">
          {status === 'disconnected' || status === 'error' ? (
            <button
              onClick={handleStartSession}
              className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-3 px-4 rounded-lg text-sm transition-all shadow-lg shadow-cyan-900/30"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Session
            </button>
          ) : (
            <button
              onClick={handleEndSession}
              className="flex-1 flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white font-medium py-3 px-4 rounded-lg text-sm transition-all shadow-lg shadow-rose-900/30"
            >
              <Square className="w-4 h-4 fill-current" />
              Stop Session
            </button>
          )}

          <button
            onClick={handleTriggerChunk}
            disabled={status !== 'connected'}
            title="Test 10-minute session chunking & transparent reconnection"
            className="flex items-center justify-center p-3 rounded-lg border border-slate-700 bg-dark-700 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${status === 'chunking' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Grid: Video Preview + Transcripts & Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col: Camera & Audio Stream Indicators */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-dark-800 rounded-xl border border-slate-800 overflow-hidden relative group">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full aspect-video object-cover bg-slate-950"
            />

            {/* Video overlay badges */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-slate-200 border border-white/10">
                <Video className="w-3.5 h-3.5 text-cyan-400" />
                1 FPS Camera
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-slate-200 border border-white/10">
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                16kHz PCM
              </span>
            </div>

            {status === 'connected' && (
              <div className="absolute bottom-3 right-3 flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-500/40 text-emerald-400 text-xs font-semibold">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                Streaming Live
              </div>
            )}
          </div>

          {/* Verification checklist card */}
          <div className="bg-dark-800 p-4 rounded-xl border border-slate-800 space-y-3">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-cyan-400" />
              Milestone 1 Technical Criteria
            </h3>
            <ul className="space-y-2 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                API key on Node server only (ephemeral token minting)
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Mic input: 16-bit PCM, 16kHz, little-endian base64
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Audio output: 24kHz Web Audio PCM player
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Session chunking & transparent reconnection engine
              </li>
            </ul>
          </div>
        </div>

        {/* Right Col: Live Transcript & Console Output */}
        <div className="lg:col-span-7 space-y-4">
          {/* Transcript Panel */}
          <div className="bg-dark-800 p-4 rounded-xl border border-slate-800 h-64 flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <span className="text-xs font-semibold tracking-wider uppercase text-slate-400">
                Live Transcript Stream
              </span>
              <span className="text-xs text-slate-500">{transcripts.length} turns recorded</span>
            </div>

            <div className="flex-1 overflow-y-auto mt-3 space-y-3 pr-2 text-xs">
              {transcripts.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 italic">
                  Start session and speak to view live transcript turns...
                </div>
              ) : (
                transcripts.map((t, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-lg border ${
                      t.speaker === 'coach'
                        ? 'bg-cyan-950/40 border-cyan-800/40 text-cyan-200'
                        : 'bg-dark-700 border-slate-700 text-slate-200'
                    }`}
                  >
                    <span className="font-bold mr-2 uppercase text-[10px] tracking-wider opacity-70">
                      {t.speaker}:
                    </span>
                    {t.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Terminal Console Logs */}
          <div className="bg-dark-800 p-4 rounded-xl border border-slate-800 h-52 flex flex-col font-mono text-[11px]">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
              <span className="font-semibold text-slate-400 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                Proxy & Session Diagnostic Logs
              </span>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-slate-500 hover:text-slate-300"
              >
                Clear Logs
              </button>
            </div>

            <div
              ref={logContainerRef}
              className="flex-1 overflow-y-auto mt-2 space-y-1 text-slate-300 pr-2 scrollbar-thin"
            >
              {logs.map((log, i) => (
                <div key={i} className="leading-relaxed">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
