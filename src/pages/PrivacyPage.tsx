import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Shield, Lock, Eye, Database } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#07090f] text-[#eef6ff] selection:bg-sky-500/30">
      <div className="orb orb1"></div>
      <div className="orb orb2"></div>

      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-6 flex items-center justify-between backdrop-blur-md border-b border-white/5">
        <a href="/" className="flex items-center gap-2 text-[#8899aa] hover:text-[#eef6ff] transition-colors font-medium text-sm">
          <ArrowLeft size={16} />
          Back to Home
        </a>
        <a href="/" className="logo" style={{ textDecoration: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: '#eef6ff' }}>
            <div style={{ position: 'relative', width: '30px', height: '24px', flexShrink: 0 }}>
              <div style={{ position: 'absolute', width: '24px', height: '16px', background: 'rgba(125,211,252,0.2)', border: '1px solid rgba(125,211,252,0.4)', borderRadius: '5px', top: 0, left: '6px' }} />
              <div style={{ position: 'absolute', width: '24px', height: '16px', background: '#131820', border: '1px solid rgba(125,211,252,0.6)', borderRadius: '5px', bottom: 0, left: 0 }}>
                <div style={{ position: 'absolute', top: '5px', left: '5px', right: '5px', height: '2px', borderRadius: '1px', background: 'rgba(125,211,252,0.5)' }} />
              </div>
            </div>
            Ankit
          </div>
        </a>
        <div className="w-24" /> {/* Spacer */}
      </nav>

      <main className="max-w-3xl mx-auto px-6 pt-32 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-[#8899aa] mb-12 font-medium">Last updated: March 11, 2026</p>

          <div className="space-y-12">
            <section>
              <div className="flex items-center gap-3 mb-4 text-sky-400">
                <Shield size={24} />
                <h2 className="text-xl font-bold text-[#eef6ff]">1. Introduction</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[#8899aa] leading-relaxed">
                <p>
                  Welcome to Ankit, operated by <strong>Card It</strong> ("we," "us," or "our"). We are committed to protecting your personal information and your right to privacy. This Privacy Policy explains how we collect, use, and safeguard your data when you use our service.
                </p>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3 mb-4 text-sky-400">
                <Database size={24} />
                <h2 className="text-xl font-bold text-[#eef6ff]">2. Data Collection</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[#8899aa] leading-relaxed space-y-4">
                <p>We collect information that you provide directly to us:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li><strong>Account Information:</strong> Name, email address, and profile picture when you sign in via Google.</li>
                  <li><strong>Uploaded Content:</strong> PDFs and PPTX files you upload for flashcard generation. These are processed and stored temporarily to provide the service.</li>
                  <li><strong>Usage Data:</strong> Information about how you interact with our service, including deck generation history.</li>
                </ul>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3 mb-4 text-sky-400">
                <Eye size={24} />
                <h2 className="text-xl font-bold text-[#eef6ff]">3. How We Use Your Data</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[#8899aa] leading-relaxed space-y-4">
                <p>We use your information for the following purposes:</p>
                <ul className="list-disc pl-5 space-y-2">
                  <li>To provide and maintain our service.</li>
                  <li>To process your uploads and generate flashcards using AI.</li>
                  <li>To manage your subscription and billing via our payment processor, Paddle.</li>
                  <li>To communicate with you about service updates or support.</li>
                </ul>
              </div>
            </section>

            <section>
              <div className="flex items-center gap-3 mb-4 text-sky-400">
                <Lock size={24} />
                <h2 className="text-xl font-bold text-[#eef6ff]">4. Data Security</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[#8899aa] leading-relaxed">
                <p>
                  We implement appropriate technical and organizational security measures to protect your data. Your uploaded files are processed securely, and we do not sell your personal information to third parties.
                </p>
              </div>
            </section>

            <section className="pt-8 border-t border-white/5">
              <p className="text-sm text-[#8899aa]">
                If you have any questions about this Privacy Policy, please contact us at support@ankit.study. Ankit is a product of <strong>Card It</strong>.
              </p>
            </section>
          </div>
        </motion.div>
      </main>

      <footer className="max-w-3xl mx-auto px-6 py-12 border-t border-white/5 text-center">
        <div className="flex justify-center gap-6 mb-4">
          <a href="/terms" className="text-xs text-[#8899aa] hover:text-sky-400 transition-colors">Terms of Service</a>
          <a href="/privacy" className="text-xs text-sky-400 font-bold">Privacy Policy</a>
        </div>
        <p className="text-xs text-[#8899aa]">© 2026 Card It. All rights reserved.</p>
      </footer>
    </div>
  );
}
