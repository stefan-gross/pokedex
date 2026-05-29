'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, Zap, ZapOff } from 'lucide-react';

interface Props {
  onCapture: (imageBase64: string, mimeType: string) => void;
  scanning: boolean;
}

export function CameraCapture({ onCapture, scanning }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torch, setTorch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setError('Kamera konnte nicht gestartet werden. Bitte Zugriff erlauben.');
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => streamRef.current?.getTracks().forEach(t => t.stop());
  }, [startCamera]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(t => !t);
    } catch { /* torch not supported */ }
  };

  const capture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1];
    onCapture(base64, 'image/jpeg');
  };

  const switchCamera = () => {
    setFacingMode(m => m === 'environment' ? 'user' : 'environment');
  };

  return (
    <div className="relative w-full flex flex-col items-center">
      {error ? (
        <div className="w-full aspect-[3/4] bg-black rounded-2xl flex items-center justify-center text-center px-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : (
        <div className="relative w-full aspect-[3/4] bg-black rounded-2xl overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Card guide frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="relative"
              style={{
                width: 190,
                height: 266,
                border: '2.5px solid #48bb78',
                borderRadius: 12,
                boxShadow: '0 0 0 2px rgba(72,187,120,.15), 0 0 24px rgba(72,187,120,.12)',
              }}
            >
              {/* Corner marks */}
              {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos, i) => (
                <div
                  key={i}
                  className={`absolute w-4 h-4 ${pos}`}
                  style={{
                    borderColor: '#48bb78',
                    borderStyle: 'solid',
                    borderWidth: 0,
                    ...(i === 0 && { borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 }),
                    ...(i === 1 && { borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 }),
                    ...(i === 2 && { borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 }),
                    ...(i === 3 && { borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 }),
                  }}
                />
              ))}
            </div>
          </div>

          {/* Scanning overlay */}
          {scanning && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-white text-sm font-medium">Erkenne Karte…</p>
              </div>
            </div>
          )}

          {/* Top controls */}
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <button
              onClick={toggleTorch}
              className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
            >
              {torch ? <Zap size={16} color="#facc15" /> : <ZapOff size={16} color="#fff" />}
            </button>
            <button
              onClick={switchCamera}
              className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center"
            >
              <RefreshCw size={16} color="#fff" />
            </button>
          </div>
        </div>
      )}

      {/* Capture button */}
      <button
        onClick={capture}
        disabled={scanning || !!error}
        className="mt-5 w-16 h-16 rounded-full flex items-center justify-center disabled:opacity-40 transition-transform active:scale-95"
        style={{ background: 'var(--pokedex-red)', boxShadow: '0 0 0 4px rgba(229,62,62,.25)' }}
        aria-label="Foto aufnehmen"
      >
        <div className="w-12 h-12 rounded-full bg-white/20 border-2 border-white" />
      </button>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
