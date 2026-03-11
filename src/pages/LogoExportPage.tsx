import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Download, Image as ImageIcon } from 'lucide-react';

export default function LogoExportPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const downloadLogo = (size: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = size;
    canvas.height = size;

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Scaling factor based on original design (approx 150px base for icon + text)
    const scale = size / 200;
    
    // Draw Icon
    const iconWidth = 30 * scale;
    const iconHeight = 22 * scale;
    const x = (size - (iconWidth + 80 * scale)) / 2; // Center horizontal
    const y = (size - iconHeight) / 2;

    // Back card
    ctx.fillStyle = 'rgba(125, 211, 252, 0.2)';
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.4)';
    ctx.lineWidth = 1 * scale;
    
    const backX = x + 7 * scale;
    const backY = y;
    const cardW = 22 * scale;
    const cardH = 15 * scale;
    const radius = 4 * scale;

    ctx.beginPath();
    ctx.roundRect(backX, backY, cardW, cardH, radius);
    ctx.fill();
    ctx.stroke();

    // Front card
    ctx.fillStyle = '#131820';
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.6)';
    
    const frontX = x;
    const frontY = y + 7 * scale;

    ctx.beginPath();
    ctx.roundRect(frontX, frontY, cardW, cardH, radius);
    ctx.fill();
    ctx.stroke();

    // Line on front card
    ctx.fillStyle = 'rgba(125, 211, 252, 0.5)';
    ctx.beginPath();
    ctx.roundRect(frontX + 4 * scale, frontY + 4 * scale, cardW - 8 * scale, 2 * scale, 1 * scale);
    ctx.fill();

    // Text
    ctx.fillStyle = '#eef6ff';
    ctx.font = `800 ${24 * scale}px Inter, sans-serif`;
    ctx.letterSpacing = `${-0.5 * scale}px`;
    ctx.fillText('Ankit', frontX + cardW + 10 * scale, y + 18 * scale);

    // Download
    const link = document.createElement('a');
    link.download = `ankit-logo-${size}x${size}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="min-h-screen bg-[#07090f] text-[#eef6ff] flex flex-col items-center justify-center p-6">
      <nav className="fixed top-0 left-0 right-0 p-6">
        <a href="/" className="flex items-center gap-2 text-[#8899aa] hover:text-[#eef6ff] transition-colors font-medium text-sm">
          <ArrowLeft size={16} />
          Back to Home
        </a>
      </nav>

      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0d1117] border border-white/5 rounded-3xl p-12 max-w-md w-full text-center shadow-2xl"
      >
        <div className="mb-8 flex justify-center">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px', color: '#eef6ff' }}>
            <div style={{ position: 'relative', width: '40px', height: '30px', flexShrink: 0 }}>
              <div style={{ position: 'absolute', width: '30px', height: '20px', background: 'rgba(125,211,252,0.2)', border: '1px solid rgba(125,211,252,0.4)', borderRadius: '5px', top: 0, left: '10px' }} />
              <div style={{ position: 'absolute', width: '30px', height: '20px', background: '#131820', border: '1px solid rgba(125,211,252,0.6)', borderRadius: '5px', bottom: 0, left: 0 }}>
                <div style={{ position: 'absolute', top: '6px', left: '6px', right: '6px', height: '3px', borderRadius: '1px', background: 'rgba(125,211,252,0.5)' }} />
              </div>
            </div>
            Ankit
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-2">Logo Exporter</h1>
        <p className="text-[#8899aa] mb-8 text-sm">Download the official Ankit logo in high resolution PNG format.</p>

        <div className="grid grid-cols-1 gap-4">
          <button 
            onClick={() => downloadLogo(512)}
            className="flex items-center justify-center gap-3 bg-sky-500 hover:bg-sky-400 text-white font-bold py-4 px-6 rounded-xl transition-all group"
          >
            <Download size={20} className="group-hover:translate-y-0.5 transition-transform" />
            Download PNG (512x512)
          </button>
          
          <button 
            onClick={() => downloadLogo(1024)}
            className="flex items-center justify-center gap-3 bg-white/5 hover:bg-white/10 text-[#eef6ff] font-bold py-4 px-6 rounded-xl transition-all"
          >
            <ImageIcon size={20} />
            Download PNG (1024x1024)
          </button>
        </div>

        <canvas ref={canvasRef} className="hidden" />
      </motion.div>
      
      <p className="mt-8 text-[#8899aa] text-xs uppercase tracking-widest opacity-50">
        Transparent Background • High Resolution
      </p>
    </div>
  );
}
