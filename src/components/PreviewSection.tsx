import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useInView } from 'motion/react';
import { FileText, ChevronRight, Image as ImageIcon } from 'lucide-react';

const SLIDES = [
  {
    heading: 'Beta-Adrenergic Blockers',
    bullets: ['Competitive antagonists at β1/β2 receptors', 'Decrease HR, contractility, CO', 'Reduce renin release → ↓ BP', 'Class II antiarrhythmic', 'SE: bradycardia, bronchospasm, fatigue'],
    fig: 'Figure 3.2 — Adrenergic signalling pathway',
    page: 'p.12'
  },
  {
    heading: 'Mechanism of Action',
    bullets: ['Block catecholamine binding at receptors', 'Decrease cAMP via Gi coupling', 'Reduce SA node automaticity', 'Prolong AV conduction (↑ PR interval)', 'Negative inotropy + chronotropy'],
    fig: 'Figure 3.3 — cAMP signalling cascade',
    page: 'p.14'
  },
  {
    heading: 'Clinical Uses & Selectivity',
    bullets: ['β1-selective: metoprolol, bisoprolol', 'Non-selective: propranolol, carvedilol', 'HFrEF, HTN, angina, post-MI, AF rate control', 'Avoid in asthma — β2 blockade risk', 'Abrupt withdrawal → rebound tachycardia'],
    fig: 'Figure 3.4 — Receptor selectivity comparison',
    page: 'p.17'
  }
];

const CARDS = [
  {
    type: 'Basic Q&A',
    isCloze: false,
    front: 'Why do beta blockers cause bronchospasm as a side effect?',
    back: 'They block β2 receptors in bronchial smooth muscle, preventing catecholamine-induced bronchodilation.'
  },
  {
    type: 'Image Occlusion',
    isCloze: false,
    isOcclusion: true,
    front: 'Identify the highlighted structure',
    back: 'Sinoatrial (SA) Node'
  },
  {
    type: 'Cloze Deletion',
    isCloze: true,
    clozeText: 'Beta blockers reduce BP partly by blocking __renin__ release from juxtaglomerular cells.',
    back: 'Renin — blocking its release reduces angiotensin II and aldosterone, lowering BP via the RAAS.'
  },
  {
    type: 'Basic Q&A',
    isCloze: false,
    front: 'A patient on propranolol develops worsening dyspnea. What is the mechanism and fix?',
    back: 'Non-selective β2 blockade causes bronchoconstriction. Switch to a β1-selective agent or change drug class.'
  }
];

const ClozeText = ({ text }: { text: string }) => {
  const parts = text.split('__');
  return (
    <span style={{ display: 'inline' }}>
      {parts.map((part, i) =>
        i === 1
          ? <span key={i} style={{ background: 'rgba(125,211,252,0.12)', color: '#7dd3fc', padding: '2px 8px', borderRadius: '6px', fontWeight: 600, display: 'inline-block', margin: '0 4px' }}>[...]</span>
          : <span key={i}>{part}</span>
      )}
    </span>
  );
};

const SlidePanel = ({ active }: { active: boolean }) => {
  const [slideIdx, setSlideIdx] = useState(0);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setSlideIdx(p => (p + 1) % SLIDES.length), 6000);
    return () => clearInterval(t);
  }, [active]);

  const slide = SLIDES[slideIdx];

  return (
    <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Fake toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '11px', color: '#8899aa', fontFamily: 'monospace' }}>
        <FileText size={12} />
        cardiology_week3.pdf
        <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.04)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', color: '#556677' }}>{slide.page}</span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={slideIdx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: '#0d1117', borderRadius: '10px', padding: '16px', border: '1px solid rgba(125, 211, 252, 0.18)', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: 'rgba(125,211,252,0.07)', borderLeft: '3px solid rgba(125,211,252,0.4)', borderRadius: '4px', padding: '8px 12px', marginBottom: '14px', fontSize: '13px', fontWeight: 700, color: '#eef6ff' }}>
              {slide.heading}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', flex: 1 }}>
              {slide.bullets.map((b, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '11.5px', color: '#8899aa', lineHeight: 1.5 }}>
                  <span style={{ color: 'rgba(125,211,252,0.4)', marginTop: '4px', flexShrink: 0 }}>•</span>
                  {b}
                </motion.div>
              ))}
            </div>
            <div style={{ marginTop: 'auto', height: '40px', background: '#131820', borderRadius: '6px', border: '1px dashed rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#8899aa' }}>
              {slide.fig}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

const CardPanel = ({ active }: { active: boolean }) => {
  const [cardIdx, setCardIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!active) return;
    setFlipped(false);
    const flipTimer = setTimeout(() => setFlipped(true), 1800);
    const nextTimer = setTimeout(() => {
      setFlipped(false);
      setCardIdx(p => (p + 1) % CARDS.length);
    }, 4400);
    return () => { clearTimeout(flipTimer); clearTimeout(nextTimer); };
  }, [cardIdx, active]);

  const card = CARDS[cardIdx];

  return (
    <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Type + progress */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '1px' }}>{card.type}</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {CARDS.map((_, i) => (
            <div key={i} style={{ height: '6px', borderRadius: '3px', background: i === cardIdx ? '#7dd3fc' : 'rgba(125,211,252,0.15)', width: i === cardIdx ? '16px' : '6px', transition: 'all 0.3s ease' }} />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div layout key={cardIdx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Front */}
          <motion.div layout style={{ background: '#0d1117', borderRadius: '10px', padding: '14px', border: '1px solid rgba(125, 211, 252, 0.18)', marginBottom: '8px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '10px', color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', fontWeight: 700 }}>Front</div>
            <div style={{ fontSize: '12.5px', color: '#eef6ff', lineHeight: 1.6, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontWeight: 500 }}>
              {card.isCloze ? <ClozeText text={card.clozeText!} /> : card.isOcclusion ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>
                  <div style={{ width: '100%', height: '80px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(125,211,252,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                    <ImageIcon size={24} color="rgba(125,211,252,0.4)" />
                    <div style={{ position: 'absolute', top: '30%', left: '20%', width: '40px', height: '16px', background: '#ef4444', borderRadius: '2px' }} />
                    <div style={{ position: 'absolute', top: '60%', right: '25%', width: '50px', height: '16px', background: '#eab308', borderRadius: '2px' }} />
                  </div>
                  <div>{card.front}</div>
                </div>
              ) : card.front}
            </div>
          </motion.div>

          {/* Answer — reveals after flip */}
          <AnimatePresence>
            {flipped && (
              <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.35 }} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                <div style={{ background: '#0d1117', borderRadius: '10px', padding: '14px', border: '1px solid rgba(125, 211, 252, 0.18)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '10px', color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px', fontWeight: 700 }}>Answer</div>
                  <div style={{ fontSize: '12px', color: '#8899aa', lineHeight: 1.6, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontWeight: 500 }}>
                    {card.isOcclusion ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
                         <div style={{ width: '100%', height: '80px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed rgba(125,211,252,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                          <ImageIcon size={24} color="rgba(125,211,252,0.4)" />
                          <div style={{ position: 'absolute', top: '30%', left: '20%', width: '40px', height: '16px', background: 'transparent', border: '1px solid #ef4444', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#ef4444', fontWeight: 'bold' }}>SA Node</div>
                          <div style={{ position: 'absolute', top: '60%', right: '25%', width: '50px', height: '16px', background: '#eab308', borderRadius: '2px' }} />
                        </div>
                        <div style={{ color: '#7dd3fc', fontWeight: 600 }}>{card.back}</div>
                      </div>
                    ) : card.back}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export const PreviewSection = () => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (inView) {
      const t = setTimeout(() => setActive(true), 400);
      return () => clearTimeout(t);
    }
  }, [inView]);

  return (
    <section className="section" id="preview" ref={ref}>
      <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
        <div className="section-tag">Preview</div>
        <div className="section-h">Flashcards that actually test understanding</div>
        <p style={{ color: '#8899aa', fontSize: '15px', marginTop: '12px', maxWidth: '480px', margin: '12px auto 0', textAlign: 'center', lineHeight: 1.6 }}>
          Watch a lecture slide transform into high-yield Anki cards in real time.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.15 }}
        style={{ marginTop: '48px', width: '100%', maxWidth: '860px', margin: '48px auto 0' }}
      >
        <div className="preview-container">
          {/* LEFT */}
          <div className="preview-panel preview-left">
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(125,211,252,0.15)', border: '1px solid rgba(125,211,252,0.2)' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#8899aa' }}>Source</span>
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#7dd3fc', background: 'rgba(125,211,252,0.08)', border: '1px solid rgba(125,211,252,0.15)', padding: '2px 10px', borderRadius: '10px' }}>
                Slide {1} / {SLIDES.length}
              </span>
            </div>
            <SlidePanel active={active} />
          </div>

          {/* MIDDLE */}
          <div className="preview-divider">
            {/* Animated line connecting left to right */}
            <div className="preview-divider-line" />
            <AnimatePresence>
              {active && (
                <motion.div
                  initial={{ left: '10%', opacity: 0 }}
                  animate={{ left: '90%', opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="preview-divider-glow"
                />
              )}
            </AnimatePresence>
            <motion.div
              animate={active ? { x: [0, 4, 0], opacity: [0.5, 1, 0.5] } : {}}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', zIndex: 1 }}
            >
              <div className="preview-divider-icon">
                <ChevronRight size={14} color='#7dd3fc' />
              </div>
            </motion.div>
          </div>

          {/* RIGHT */}
          <div className="preview-panel preview-right">
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#7dd3fc', boxShadow: '0 0 8px rgba(125,211,252,0.4)' }} />
              <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#7dd3fc' }}>Generated Cards</span>
              <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#7dd3fc', background: 'rgba(125,211,252,0.08)', border: '1px solid rgba(125,211,252,0.15)', padding: '2px 10px', borderRadius: '10px' }}>
                {CARDS.length} cards
              </span>
            </div>
            <CardPanel active={active} />
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: '#445566' }}>
          Cards auto-cycle · front → answer → next card
        </div>
      </motion.div>
    </section>
  );
};
