import { X, Clock, Maximize2, Minimize2 } from 'lucide-react';
import { useState } from 'react';
import { SecureImage } from '../ui/SecureImage';

interface ScreenshotLightboxProps {
    enlarged: any;
    setEnlarged: (screenshot: any | null) => void;
}

export function ScreenshotLightbox({ enlarged, setEnlarged }: ScreenshotLightboxProps) {
    const [isMaximized, setIsMaximized] = useState(false);

    if (!enlarged) return null;

    return (
        <div
            className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center backdrop-blur-xl animate-in fade-in duration-500"
            style={{ cursor: 'zoom-out' }}
            onClick={() => setEnlarged(null)}
        >
            {/* 
                Main Container:
                - Uses almost full viewport space to ensure "Full Fit"
                - flex-col layout to stack header, image area, and footer
            */}
            <div
                className={`flex flex-col transition-all duration-500 ease-in-out bg-zinc-900/50 shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/10
                    ${isMaximized ? 'w-screen h-screen rounded-none' : 'w-[95vw] h-[92vh] max-w-[1920px] rounded-[2.5rem]'}
                `}
                onClick={e => e.stopPropagation()}
                style={{ cursor: 'default' }}
            >
                {/* Dynamic Header */}
                <div className="flex justify-between items-center px-8 py-6 shrink-0 border-b border-white/5 bg-zinc-900/40 backdrop-blur-md">
                    <div className="flex items-center gap-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black text-white tracking-tighter uppercase italic opacity-90">
                                Trackora <span className="text-primary not-italic font-bold ml-1">Vision</span>
                            </h2>
                            <div className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">
                                    Secure Capture • ID {enlarged.id}
                                </p>
                            </div>
                        </div>

                        <div className="hidden md:flex h-10 w-px bg-white/10 mx-2"></div>

                        <div className="hidden md:block">
                            <p className="text-[9px] font-bold text-primary uppercase tracking-[0.3em] mb-1">Session Target</p>
                            <p className="text-sm font-mono font-bold text-white/80 leading-none">
                                {enlarged.session_id}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsMaximized(!isMaximized)}
                            className="p-3 bg-white/5 hover:bg-white/15 border border-white/5 rounded-2xl text-white/60 hover:text-white transition-all group"
                            title={isMaximized ? "Restore" : "Maximize"}
                        >
                            {isMaximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                        </button>
                        <button
                            onClick={() => setEnlarged(null)}
                            className="p-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-2xl text-red-500 transition-all hover:scale-105 active:scale-95 group/close"
                        >
                            <X className="w-6 h-6 group-hover/close:rotate-90 transition-transform duration-300" strokeWidth={3} />
                        </button>
                    </div>
                </div>

                {/* Main Viewport: The actual image */}
                <div className="flex-1 min-h-0 w-full relative flex items-center justify-center p-4 md:p-8 bg-[#0a0a0a]">
                    <div className="relative w-full h-full flex items-center justify-center group/img">
                        <SecureImage
                            path={enlarged.file_url}
                            alt="Surveillance Capture"
                            className="max-w-full max-h-full object-contain shadow-[0_30px_60px_rgba(0,0,0,0.8)] rounded-lg"
                            style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }}
                        />

                        {/* Subtle Floating Info Card */}
                        <div className="absolute bottom-6 right-6 p-6 bg-black/80 border border-white/5 rounded-3xl backdrop-blur-2xl shadow-2xl transition-all duration-500 group-hover/img:translate-y-[-10px]">
                            <div className="flex items-center gap-5">
                                <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
                                    <Clock className="w-8 h-8 text-primary" strokeWidth={2.5} />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.4em] leading-none mb-1">
                                        Recorded At
                                    </p>
                                    <p className="text-2xl font-black text-white tracking-tight leading-none">
                                        {new Date(enlarged.recorded_at).toLocaleTimeString(undefined, {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                            second: '2-digit'
                                        })}
                                    </p>
                                    <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mt-1">
                                        {new Date(enlarged.recorded_at).toLocaleDateString(undefined, {
                                            weekday: 'long',
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric'
                                        })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Enhanced Footer Bar */}
                <div className="px-8 py-5 flex justify-between items-center bg-zinc-900/60 border-t border-white/5 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="px-3 py-1 rounded-md bg-white/5 border border-white/10">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
                                Resolution: Auto-Scaled
                            </span>
                        </div>
                        <div className="px-3 py-1 rounded-md bg-white/5 border border-white/10">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
                                Aspect: Original
                            </span>
                        </div>
                    </div>
                    
                    <p className="text-white/20 text-[9px] font-black uppercase tracking-[0.8em] font-mono">
                        Trackora AI Inspection Engine
                    </p>

                    <div className="flex items-center gap-2 text-white/30">
                        <span className="text-[9px] font-bold uppercase tracking-widest">Press</span>
                        <kbd className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-white/60">ESC</kbd>
                        <span className="text-[9px] font-bold uppercase tracking-widest">to Exit</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
