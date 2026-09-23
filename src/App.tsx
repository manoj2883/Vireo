import React, { useState, useEffect, useRef } from 'react';
import { ConnectionStatus, SessionMode, TeardownReport, Story } from './types';
import { LiveStreamService } from './services/liveStreamService';
import { MetricsEngine, MetricSnapshot } from './utils/metricsEngine';
import { detectFlatStretches, FlatStretchWindow, TranscriptEntry } from './utils/retentionEngine';
import { RehearsalEngine, InterruptionEvent } from './services/rehearsalService';
import { LiveModeHUD } from './components/LiveModeHUD';
import { TeardownView } from './components/TeardownView';
import { StoryBank } from './components/StoryBank';
import { BitBank } from './components/BitBank';
import { SessionHistoryView } from './components/SessionHistoryView';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { getAllStories, saveTeardown, getAllTeardowns, saveSession, StoredSession } from './services/db';

import {
  Mic,
  Video,
  Play,
  Square,
  RefreshCw,
  BookOpen,
  Smile,
  Activity,
  Award,
  Radio,
  Volume2,
  AlertOctagon,
  Gauge,
  Zap,
  Clock,
  Camera,
  AlertTriangle,
  XCircle,
  Menu,
  Key,
  Info,
  X,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'storybank' | 'bitbank' | 'history' | 'teardown'>('dashboard');
  const [sessionMode, setSessionMode] = useState<SessionMode>('rehearsal');

  // Session state
  const [isSessionActive, setIsSessionActive] = useState<boolean>(false);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [lastFrameSnapshot, setLastFrameSnapshot] = useState<string>('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [teardownError, setTeardownError] = useState<string | null>(null);

  // Settings & Tooltip Overlays
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiHealthStatus, setApiHealthStatus] = useState<{ hasKey: boolean; message: string } | null>(null);
  const [isTestingKey, setIsTestingKey] = useState<boolean>(false);
  const [activeModeTooltip, setActiveModeTooltip] = useState<'rehearsal' | 'live' | null>(null);

  // Metrics & transcript logs
  const [metrics, setMetrics] = useState<MetricSnapshot>({
    wpm15s: 0,
    fillerCount30s: 0,
    fillerDensity30s: 0,
    isWpmOutOfRange: false,
    isFillerThresholdExceeded: false,
    detectedFillers: [],
  });

  const [transcripts, setTranscripts] = useState<{ speaker: 'user' | 'coach'; text: string; timestampSec: number }[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionEvent[]>([]);
  const [activeTeardown, setActiveTeardown] = useState<TeardownReport | null>(null);
  const [activeFlatStretches, setActiveFlatStretches] = useState<FlatStretchWindow[]>([]);
  const [isGeneratingTeardown, setIsGeneratingTeardown] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const liveStreamRef = useRef<LiveStreamService | null>(null);
  const metricsEngineRef = useRef<MetricsEngine>(new MetricsEngine());
  const rehearsalEngineRef = useRef<RehearsalEngine | null>(null);

  const timerRef = useRef<number | null>(null);
  const metricTimerRef = useRef<number | null>(null);

  useEffect(() => {
    getAllTeardowns().catch(console.error);
    initPreviewCamera();
    checkBackendHealth();
  }, []);

  const checkBackendHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setApiHealthStatus({
          hasKey: data.hasApiKey,
          message: data.hasApiKey ? 'GEMINI_API_KEY active on server' : 'GEMINI_API_KEY missing in .env',
        });
      }
    } catch {
      setApiHealthStatus({ hasKey: false, message: 'Server offline or unreachable' });
    }
  };

  const initPreviewCamera = async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        videoRef.current.autoplay = true;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.warn('[Camera Init] Preview camera notice:', err);
      setCameraError(err.message || 'Camera access blocked or webcam in use by another app.');
    }
  };

  // Timer loop when session is connected
  useEffect(() => {
    if (isSessionActive && (status === 'connected' || status === 'connecting' || status === 'chunking')) {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);

      metricTimerRef.current = window.setInterval(() => {
        if (metricsEngineRef.current) {
          const snap = metricsEngineRef.current.getSnapshot();
          setMetrics(snap);
        }
        if (liveStreamRef.current) {
          setAudioLevel(liveStreamRef.current.getAudioLevel());
        }
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (metricTimerRef.current) clearInterval(metricTimerRef.current);
      timerRef.current = null;
      metricTimerRef.current = null;
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (metricTimerRef.current) clearInterval(metricTimerRef.current);
    };
  }, [isSessionActive, status]);

  const handleStartSession = async (mode: SessionMode) => {
    setSessionMode(mode);
    setTranscripts([]);
    setInterruptions([]);
    setActiveTeardown(null);
    setElapsedSeconds(0);
    setLastFrameSnapshot('');
    setCameraError(null);
    setTeardownError(null);
    setIsSessionActive(true);
    metricsEngineRef.current.reset();

    if (mode === 'rehearsal') {
      rehearsalEngineRef.current = new RehearsalEngine((evt) => {
        setInterruptions((prev) => [...prev, evt]);
      });
    }

    const service = new LiveStreamService({
      onStatusChange: (newStatus, msg) => {
        setStatus(newStatus);
        if (msg) setStatusMessage(msg);
        if (newStatus === 'failed') {
          setIsSessionActive(false);
        }
      },
      onTranscript: (speaker, text, isInterim) => {
        const nowSec = elapsedSeconds;
        const wallNowSec = Date.now() / 1000;
        // FIX 5: Save ONLY finalized segments
        if (!isInterim) {
          setTranscripts((prev) => [...prev, { speaker, text, timestampSec: nowSec }]);
        }

        if (speaker === 'user') {
          metricsEngineRef.current.addText(text, wallNowSec);
          const currentSnap = metricsEngineRef.current.getSnapshot(wallNowSec);
          setMetrics(currentSnap);

          if (sessionMode === 'rehearsal' && rehearsalEngineRef.current) {
            rehearsalEngineRef.current.checkMetricsAndText(currentSnap, text, wallNowSec);
          }
        }
      },
      onChunkEvent: () => {},
      onFrameSnapshot: (dataUrl) => {
        setLastFrameSnapshot(dataUrl);
      },
      onLog: () => {},
    });

    liveStreamRef.current = service;
    await service.startSession(mode, videoRef.current || undefined);
  };

  const handleStopSession = async () => {
    setIsSessionActive(false);
    setTeardownError(null);

    let recordedMediaUrl: string | undefined = undefined;
    if (liveStreamRef.current) {
      const mediaUrl = liveStreamRef.current.endSession();
      if (mediaUrl) recordedMediaUrl = mediaUrl;
      liveStreamRef.current = null;
    }

    setStatus('disconnected');
    setStatusMessage('Session completed');
    setIsGeneratingTeardown(true);

    const sessionDuration = elapsedSeconds || 1;
    const sessionId = 'sess_' + Date.now();

    try {
      const transcriptEntries: TranscriptEntry[] = transcripts.map((t) => ({
        text: t.text,
        timestampSec: t.timestampSec,
      }));

      const flatStretches = detectFlatStretches(transcriptEntries, sessionDuration);
      setActiveFlatStretches(flatStretches);

      const stories: Story[] = await getAllStories();

      // Request teardown analysis from backend
      const response = await fetch('/api/teardown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          durationSec: sessionDuration,
          mode: sessionMode,
          transcript: transcripts,
          metrics,
          flatStretches,
          stories,
        }),
      });

      let teardownReport: TeardownReport | null = null;
      if (response.ok) {
        teardownReport = await response.json();
        if (teardownReport) {
          await saveTeardown(teardownReport);
          setActiveTeardown(teardownReport);
        }
      } else {
        const errJson = await response.json().catch(() => ({}));
        console.warn('Teardown API note:', errJson.error);
        setTeardownError(errJson.error || `Server returned HTTP ${response.status}`);
      }

      // Save persistent Session History record with video recording & interruption logs
      const sessionRecord: StoredSession = {
        id: sessionId,
        createdAt: new Date().toISOString(),
        mode: sessionMode,
        durationSec: sessionDuration,
        transcript: transcripts,
        metrics: {
          fillerCount: metrics.fillerCount30s,
          flatStretchWindows: flatStretches,
        },
        interruptions: interruptions,
        mediaBlobUrl: recordedMediaUrl,
        compositeScore: teardownReport?.compositeScore,
      };

      await saveSession(sessionRecord);

      if (teardownReport) {
        setActiveTab('teardown');
      }
    } catch (err: any) {
      console.warn('[Teardown Notice]:', err.message);
      setTeardownError(err.message || 'Failed to generate teardown report.');
    } finally {
      setIsGeneratingTeardown(false);
    }
  };

  const formatTime = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#070A12] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Navbar */}
      <nav className="bg-slate-950/80 border-b border-slate-800/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSettingsOpen(true)}
              title="API Setup & Settings Menu"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-white transition-all flex items-center gap-2 text-xs font-semibold"
            >
              <Menu className="w-5 h-5 text-cyan-400" />
            </button>

            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center font-black text-white text-lg shadow-lg shadow-cyan-500/20 ring-1 ring-white/20">
              V
            </div>
            <div>
              <span
                title="Vireo: Named after the North American songbird known for its clear, melodious, and persistent singing — symbolizing articulate, confident speech."
                className="font-extrabold text-white text-base tracking-tight flex items-center gap-2 cursor-help"
              >
                Vireo 🐦
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  Live AI Coach
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 text-xs shadow-inner">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-900/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-4 h-4" />
              Live Studio
            </button>

            <button
              onClick={() => setActiveTab('storybank')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition-all ${
                activeTab === 'storybank'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-900/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Story Bank
            </button>

            <button
              onClick={() => setActiveTab('bitbank')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition-all ${
                activeTab === 'bitbank'
                  ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-900/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smile className="w-4 h-4" />
              Bit Bank
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition-all ${
                activeTab === 'history'
                  ? 'bg-gradient-to-r from-indigo-500 to-cyan-600 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-4 h-4" />
              History
            </button>

            {activeTeardown && (
              <button
                onClick={() => setActiveTab('teardown')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold transition-all ${
                  activeTab === 'teardown'
                    ? 'bg-gradient-to-r from-rose-500 to-orange-600 text-white shadow-lg shadow-rose-900/40'
                    : 'text-rose-400 hover:text-rose-300'
                }`}
              >
                <Award className="w-4 h-4" />
                Latest Teardown
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Hamburger API Setup & Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-extrabold text-white text-base flex items-center gap-2">
                <Key className="w-5 h-5 text-cyan-400" />
                Gemini API Key Setup
              </h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300">
                Vireo uses the Google Gemini API for live speech coaching and detailed teardown reports.
              </p>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Server API Key Status:</span>
                <span className={`font-bold flex items-center gap-1.5 ${apiHealthStatus?.hasKey ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {apiHealthStatus?.hasKey ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {apiHealthStatus?.hasKey ? 'Configured (.env)' : 'Missing (.env)'}
                </span>
              </div>

              <button
                onClick={async () => {
                  setIsTestingKey(true);
                  await checkBackendHealth();
                  setIsTestingKey(false);
                }}
                disabled={isTestingKey}
                className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/40"
              >
                {isTestingKey ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Test Gemini API Connection
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {activeTab === 'dashboard' && (
          <div className="max-w-7xl mx-auto p-6 space-y-6">
            {/* Connection Failure Alert */}
            {status === 'failed' && (
              <div className="bg-rose-950/80 p-4 rounded-2xl border border-rose-600 text-rose-100 text-xs font-bold flex items-center justify-between shadow-2xl animate-pulse">
                <div className="flex items-center gap-2.5">
                  <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                  <div>
                    <span className="uppercase tracking-wider font-extrabold text-rose-300 block">Connection Failure</span>
                    <span>{statusMessage}</span>
                  </div>
                </div>
                <button
                  onClick={() => setStatus('disconnected')}
                  className="px-3 py-1 bg-rose-900 hover:bg-rose-800 rounded-lg text-rose-200 border border-rose-500/40"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Teardown Error Alert */}
            {teardownError && (
              <div className="bg-amber-950/80 p-4 rounded-2xl border border-amber-600 text-amber-100 text-xs font-bold flex items-center justify-between shadow-2xl">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <span className="uppercase tracking-wider font-extrabold text-amber-300 block">Teardown Notice</span>
                    <span>{teardownError}</span>
                  </div>
                </div>
                <button
                  onClick={() => setTeardownError(null)}
                  className="px-3 py-1 bg-amber-900 hover:bg-amber-800 rounded-lg text-amber-200 border border-amber-500/40"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Header Control Panel */}
            <div className="bg-slate-900/80 backdrop-blur-xl p-6 rounded-3xl border border-slate-800 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mode Selection</span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Rehearsal Mode Selection Card */}
                  <div className="relative">
                    <button
                      onClick={() => setSessionMode('rehearsal')}
                      disabled={isSessionActive}
                      className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-xs font-bold border transition-all ${
                        sessionMode === 'rehearsal'
                          ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300 shadow-lg shadow-cyan-950/50 ring-2 ring-cyan-500/30'
                          : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Volume2 className="w-4 h-4 text-cyan-400" />
                      Rehearsal Mode (Live Interruption)
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveModeTooltip(activeModeTooltip === 'rehearsal' ? null : 'rehearsal');
                        }}
                        title="What is Rehearsal Mode?"
                        className="p-1 rounded-full hover:bg-cyan-500/30 text-cyan-400 ml-1 cursor-pointer"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </span>
                    </button>

                    {/* Rehearsal Mode Tooltip Popover */}
                    {activeModeTooltip === 'rehearsal' && (
                      <div className="absolute left-0 top-full mt-2 w-72 bg-slate-950 border border-cyan-500/50 p-3.5 rounded-2xl shadow-2xl text-xs z-50 text-slate-200 space-y-1.5 animate-fadeIn">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-cyan-400">Rehearsal Mode</span>
                          <button onClick={() => setActiveModeTooltip(null)} className="text-slate-500 hover:text-white">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-300">
                          Active voice coach rep mode. Vireo actively monitors speech pace (&gt;180 WPM), filler word stacks (≥5 per 30s), and buried points, interrupting with live Puck audio feedback when thresholds are breached.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Live Mode Selection Card */}
                  <div className="relative">
                    <button
                      onClick={() => setSessionMode('live')}
                      disabled={isSessionActive}
                      className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-xs font-bold border transition-all ${
                        sessionMode === 'live'
                          ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 shadow-lg shadow-amber-950/50 ring-2 ring-amber-500/30'
                          : 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Radio className="w-4 h-4 text-amber-400" />
                      Live Mode (Silent Ambient HUD)
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveModeTooltip(activeModeTooltip === 'live' ? null : 'live');
                        }}
                        title="What is Live Mode?"
                        className="p-1 rounded-full hover:bg-amber-500/30 text-amber-400 ml-1 cursor-pointer"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </span>
                    </button>

                    {/* Live Mode Tooltip Popover */}
                    {activeModeTooltip === 'live' && (
                      <div className="absolute left-0 top-full mt-2 w-72 bg-slate-950 border border-amber-500/50 p-3.5 rounded-2xl shadow-2xl text-xs z-50 text-slate-200 space-y-1.5 animate-fadeIn">
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-amber-400">Live Mode</span>
                          <button onClick={() => setActiveModeTooltip(null)} className="text-slate-500 hover:text-white">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-300">
                          Silent ambient coach for real presentations. Vireo transcribes and logs metrics on screen silently without generating any conversational audio output during your talk.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Timer & Controls */}
              <div className="flex items-center gap-6">
                <div className="text-right space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Elapsed Session Time</span>
                  <div className="text-3xl font-mono font-black tracking-tight text-white flex items-center gap-2 justify-end">
                    <Clock className={`w-5 h-5 ${isSessionActive ? 'text-emerald-400 animate-pulse' : 'text-slate-600'}`} />
                    {formatTime(elapsedSeconds)}
                  </div>
                </div>

                {!isSessionActive ? (
                  <button
                    onClick={() => handleStartSession(sessionMode)}
                    className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-extrabold py-3.5 px-8 rounded-2xl text-sm shadow-xl shadow-cyan-900/40 transition-all hover:scale-105 active:scale-95"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    Start Session
                  </button>
                ) : (
                  <button
                    onClick={handleStopSession}
                    disabled={isGeneratingTeardown}
                    className="flex items-center gap-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold py-3.5 px-8 rounded-2xl text-sm shadow-xl shadow-rose-950/60 transition-all hover:scale-105 active:scale-95"
                  >
                    {isGeneratingTeardown ? (
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    ) : (
                      <Square className="w-5 h-5 fill-current" />
                    )}
                    {isGeneratingTeardown ? 'Generating Teardown...' : 'End & View Teardown'}
                  </button>
                )}
              </div>
            </div>

            {/* Studio Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Camera Feed & Diagnostic Card */}
              <div className="lg:col-span-6 space-y-6">
                <div className="bg-slate-900/90 rounded-3xl border border-slate-800 overflow-hidden relative aspect-video shadow-2xl group flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover bg-slate-950"
                  />

                  {cameraError && (
                    <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md p-6 flex flex-col items-center justify-center text-center space-y-3">
                      <AlertTriangle className="w-10 h-10 text-amber-400 animate-pulse" />
                      <div className="font-bold text-white text-sm">Camera Stream Not Loaded</div>
                      <p className="text-xs text-slate-400 max-w-xs">{cameraError}</p>
                      <button
                        onClick={initPreviewCamera}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-cyan-900/40"
                      >
                        Request Camera Access Again
                      </button>
                    </div>
                  )}

                  {/* Status Overlay Badge */}
                  <div className="absolute top-4 left-4 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-800 text-[11px] font-bold text-slate-300 flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        status === 'connected'
                          ? 'bg-emerald-400 animate-ping'
                          : status === 'connecting'
                          ? 'bg-amber-400 animate-pulse'
                          : status === 'failed'
                          ? 'bg-rose-500'
                          : 'bg-slate-600'
                      }`}
                    />
                    Status: <span className="uppercase tracking-wider font-mono text-white">{status}</span>
                  </div>

                  <div className="absolute bottom-4 left-4 right-4">
                    <WaveformVisualizer level={audioLevel} isActive={isSessionActive} />
                  </div>
                </div>

                <LiveModeHUD metrics={metrics} />
              </div>

              {/* Realtime Transcript & Interruption Log */}
              <div className="lg:col-span-6 bg-slate-900/90 rounded-3xl border border-slate-800 p-6 flex flex-col justify-between space-y-4 shadow-2xl">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <h3 className="font-extrabold text-white text-sm tracking-wide uppercase flex items-center gap-2">
                      <Mic className="w-4 h-4 text-cyan-400" />
                      Realtime Session Log
                    </h3>
                    <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full border border-slate-700">
                      {transcripts.length} Segments
                    </span>
                  </div>

                  {/* Rehearsal Interruption Event List */}
                  {sessionMode === 'rehearsal' && (
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-rose-400">
                        <span className="flex items-center gap-1">
                          <AlertOctagon className="w-3.5 h-3.5" />
                          Rehearsal Interruption Log
                        </span>
                        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300">
                          {interruptions.length} Interruptions
                        </span>
                      </div>

                      {interruptions.length === 0 ? (
                        <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-500 italic">
                          No interruptions triggered yet. Speak in Rehearsal Mode to start reps.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                          {interruptions.map((inter, idx) => (
                            <div
                              key={idx}
                              className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                                inter.isHostileAudienceTurn
                                  ? 'bg-rose-950/50 border-rose-500 text-rose-200'
                                  : 'bg-slate-950 border-slate-800 text-slate-300'
                              }`}
                            >
                              <span className="font-bold flex items-center gap-2">
                                <span className="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded">
                                  #{inter.count}
                                </span>
                                {inter.reason}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {Math.floor(inter.timestampSec / 60)}:{(Math.floor(inter.timestampSec % 60)).toString().padStart(2, '0')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Timestamped Transcripts */}
                  <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3 max-h-72 overflow-y-auto custom-scrollbar text-xs">
                    {transcripts.length === 0 ? (
                      <div className="text-slate-500 text-center py-8 italic">
                        Transcript turns will populate live as you speak...
                      </div>
                    ) : (
                      transcripts.map((t, idx) => {
                        const sec = t.timestampSec || 0;
                        const m = Math.floor(sec / 60).toString().padStart(2, '0');
                        const s = Math.floor(sec % 60).toString().padStart(2, '0');
                        return (
                          <div key={idx} className="flex items-start gap-2.5">
                            <span className="text-[10px] font-mono text-slate-500 pt-0.5">[{m}:{s}]</span>
                            <span
                              className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                t.speaker === 'user' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-purple-500/20 text-purple-400'
                              }`}
                            >
                              {t.speaker === 'user' ? 'Mano' : 'Coach'}
                            </span>
                            <span className="text-slate-300 flex-1">{t.text}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'storybank' && (
          <StoryBank onStartInterviewerSession={() => handleStartSession('interview')} />
        )}

        {activeTab === 'bitbank' && <BitBank />}

        {activeTab === 'history' && (
          <SessionHistoryView
            onViewTeardown={(report) => {
              setActiveTeardown(report);
              setActiveTab('teardown');
            }}
          />
        )}

        {activeTab === 'teardown' && activeTeardown && (
          <TeardownView
            report={activeTeardown}
            flatStretches={activeFlatStretches}
            durationSec={elapsedSeconds || 1}
            onBackToDashboard={() => setActiveTab('dashboard')}
          />
        )}
      </main>
    </div>
  );
};

export default App;
