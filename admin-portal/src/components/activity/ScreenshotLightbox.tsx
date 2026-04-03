import { X, Clock } from 'lucide-react';
import { SecureImage } from '../ui/SecureImage';

interface ScreenshotLightboxProps {
    enlarged: any;
    setEnlarged: (screenshot: any | null) => void;
}

export function ScreenshotLightbox({ enlarged, setEnlarged }: ScreenshotLightboxProps) {
    if (!enlarged) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-6 backdrop-blur-2xl animate-in fade-in duration-300 cursor-zoom-out"
            onClick={() => setEnlarged(null)}
        >
            {/* Container: fixed to 90vh so nothing overflows */}
            <div
                className="flex flex-col w-full max-w-6xl animate-in zoom-in-95 duration-400"
                style={{ maxHeight: '90vh' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header row */}
                <div className="flex justify-between items-center mb-3 px-1 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight leading-none mb-1">
                            Screenshot Viewer
                        </h2>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary font-mono bg-primary/10 px-2.5 py-1 rounded-lg border border-primary/20 inline-block">
                            ID: {enlarged.id} • Session: {enlarged.session_id?.slice(0, 8)}
                        </p>
                    </div>
                    <button
                        onClick={() => setEnlarged(null)}
                        className="p-3 bg-white/10 border border-white/20 hover:bg-white/25 rounded-2xl shadow-lg transition-all group/close shrink-0"
                    >
                        <X className="w-5 h-5 text-white group-hover/close:rotate-90 transition-transform duration-200" strokeWidth={2.5} />
                    </button>
                </div>

                {/* Image — fills remaining space, never overflows */}
                <div className="relative rounded-2xl overflow-hidden border border-white/20 shadow-2xl flex-1 min-h-0">
                    <SecureImage
                        path={enlarged.file_url}
                        alt="Full Screenshot"
                        className="w-full h-full object-contain"
                        style={{ maxHeight: '100%', display: 'block' }}
                    />

                    {/* Timestamp overlay — bottom-left corner of the image */}
                    <div className="absolute bottom-4 left-4 p-4 bg-black/60 border border-white/10 rounded-xl backdrop-blur-xl animate-in slide-in-from-left-4 duration-500 delay-200 shadow-lg">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
                                <Clock className="w-4 h-4 text-primary" strokeWidth={2.5} />
                            </div>
                            <div>
                                <p className="text-[9px] font-semibold text-white/50 uppercase tracking-wider mb-0.5 font-mono">
                                    Captured At
                                </p>
                                <p className="text-sm font-bold text-white tracking-tight leading-none">
                                    {new Date(enlarged.recorded_at).toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer hint */}
                <p className="text-white/20 text-[9px] font-bold uppercase tracking-[0.5em] text-center mt-3 shrink-0 font-mono">
                    Click outside to close
                </p>
            </div>
        </div>
    );
}
