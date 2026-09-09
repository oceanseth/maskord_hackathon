import { useEffect, useState, type ReactNode } from 'react';
import Footer from '../components/Footer';
import {
  architecture,
  challenges,
  priorities,
  submission,
  DEADLINE_UTC,
  type Challenge,
} from './challenges';

export default function HackathonPage() {
  useEffect(() => {
    document.title = 'Maskord × Burning Token — Sponsor plan';
  }, []);

  return (
    <div className="min-h-screen bg-maskord-dark overflow-x-hidden">
      <HackNav />
      <main>
        <Hero />
        <Architecture />
        <Challenges />
        <Priorities />
        <Submission />
      </main>
      <Footer />
    </div>
  );
}

/* ─── Nav ──────────────────────────────────────────────────────────────── */

function HackNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-maskord-border">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <a href="https://maskord.com" className="flex items-center gap-3 shrink-0">
          <MaskIcon className="w-8 h-8 text-maskord-accent" />
          <span className="font-display font-bold text-xl text-maskord-text tracking-tight">
            Maskord
          </span>
          <span className="hidden sm:inline text-maskord-border">×</span>
          <span className="hidden sm:inline font-mono text-xs text-maskord-subtle tracking-widest uppercase">
            Burning Token
          </span>
        </a>

        <div className="hidden md:flex items-center gap-8 text-sm text-maskord-subtle">
          <a href="#stack" className="hover:text-maskord-text transition-colors">The stack</a>
          <a href="#challenges" className="hover:text-maskord-text transition-colors">Challenges</a>
          <a href="#plan" className="hover:text-maskord-text transition-colors">Build order</a>
        </div>

        <Countdown />
      </div>
    </nav>
  );
}

function Countdown() {
  const [left, setLeft] = useState(() => remaining());

  useEffect(() => {
    const id = setInterval(() => setLeft(remaining()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="shrink-0 px-3 py-1.5 rounded-lg border border-maskord-border bg-maskord-surface font-mono text-xs">
      <span className="text-maskord-muted">submissions close </span>
      <span className="text-violet-300">{left}</span>
    </div>
  );
}

function remaining() {
  const ms = new Date(DEADLINE_UTC).getTime() - Date.now();
  if (ms <= 0) return 'closed';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `in ${days}d ${hours}h` : `in ${hours}h`;
}

/* ─── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative px-6 pt-36 pb-24 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
        <div className="absolute top-40 right-1/4 w-80 h-80 bg-purple-800/15 rounded-full blur-3xl" />
      </div>
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(124,58,237,1) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,1) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />

      <div className="relative z-10 max-w-4xl mx-auto text-center animate-slide-up">
        <span className="inline-block px-3 py-1 rounded-full text-xs font-mono font-medium text-violet-300 bg-violet-900/30 border border-violet-800/50 mb-6 tracking-widest uppercase">
          Burning Token · NERDCONF 2026
        </span>

        <h1 className="font-display font-bold text-4xl md:text-6xl leading-tight mb-6">
          Five sponsors, one room,{' '}
          <span className="text-gradient">and everybody in it is wearing a mask</span>
        </h1>

        <p className="text-maskord-subtle text-lg md:text-xl max-w-3xl mx-auto mb-4 leading-relaxed">
          Maskord is an agentic Discord where every participant — human or AI — appears as a mask.
          A mask can anonymise a person or embody an agent, and they share the same channels,
          the same voice, and the same files.
        </p>
        <p className="text-maskord-muted text-base max-w-3xl mx-auto leading-relaxed">
          This page is our working plan for the five sponsor challenges and Fun Build: what each
          integration actually does inside the product, what a judge will see in the demo, and
          where we changed our first instinct to match the brief.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
          <a
            href="#challenges"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-semibold transition-all hover:scale-105 shadow-lg shadow-violet-900/30"
          >
            See the six plans
          </a>
          <a
            href="/app/index.html"
            className="w-full sm:w-auto px-8 py-4 rounded-xl border border-maskord-border hover:border-violet-700/60 text-maskord-text font-semibold transition-all hover:bg-maskord-surface"
          >
            Open your Server →
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-12 font-mono text-xs text-maskord-muted">
          {challenges.map((c) => (
            <span key={c.key} style={{ color: c.accent }}>
              {c.sponsor}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Architecture ─────────────────────────────────────────────────────── */

function Architecture() {
  return (
    <section id="stack" className="py-24 px-6 border-t border-maskord-border">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          eyebrow="One pipeline"
          title={
            <>
              Each sponsor owns a{' '}
              <span className="text-gradient">different stage of the same turn</span>
            </>
          }
          lead="Nothing here is bolted on for the submission. A single goal dropped into a Maskord channel passes through all five."
        />

        <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {architecture.map((step, i) => (
            <li
              key={step.tag}
              className="relative p-5 rounded-2xl bg-maskord-surface border border-maskord-border"
              style={{ borderLeft: `3px solid ${step.accent}` }}
            >
              <div className="font-mono text-xs text-maskord-muted mb-2">
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="text-maskord-text font-medium leading-snug mb-2">{step.label}</div>
              <div className="font-mono text-xs" style={{ color: step.accent }}>
                {step.tag}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─── Challenges ───────────────────────────────────────────────────────── */

function Challenges() {
  return (
    <section id="challenges" className="py-24 px-6 border-t border-maskord-border">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          eyebrow="Six challenges"
          title={
            <>
              The requirement, the build,{' '}
              <span className="text-gradient">and what we changed</span>
            </>
          }
          lead="Eligibility is checked before scoring — a missing integration is a disqualification from that challenge, not a lost 15 points. Every plan below is written against the requirement as published."
        />

        <div className="space-y-6">
          {challenges.map((c) => (
            <ChallengeCard key={c.key} c={c} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ChallengeCard({ c }: { c: Challenge }) {
  return (
    <article
      className="rounded-2xl bg-maskord-surface border border-maskord-border overflow-hidden"
      style={{ borderTop: `3px solid ${c.accent}` }}
    >
      <header className="px-6 md:px-8 pt-7 pb-6 border-b border-maskord-border">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span
            className="font-mono text-xs tracking-widest uppercase px-2.5 py-1 rounded-md"
            style={{ color: c.accent, backgroundColor: `${c.accent}1a` }}
          >
            {c.track}
          </span>
          <span className="font-display font-bold text-xl text-maskord-text">{c.sponsor}</span>
          <span className="ml-auto text-right">
            <span className="font-mono text-sm text-maskord-text">{c.prize}</span>
            {c.prizeNote && (
              <span className="block font-mono text-xs text-maskord-muted">{c.prizeNote}</span>
            )}
          </span>
        </div>

        <p className="text-maskord-text text-lg leading-relaxed">{c.headline}</p>
      </header>

      <div className="px-6 md:px-8 py-7 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <Label>Official entry requirement</Label>
          <blockquote
            className="pl-4 mb-8 text-sm text-maskord-subtle italic leading-relaxed"
            style={{ borderLeft: `2px solid ${c.accent}` }}
          >
            {c.requirement}
          </blockquote>

          <Label>How Maskord integrates it</Label>
          <ul className="space-y-3">
            {c.plan.map((p, i) => (
              <li key={i} className="flex gap-3 text-sm text-maskord-subtle leading-relaxed">
                <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.accent }} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Label>What the judges see</Label>
          <ol className="space-y-3">
            {c.demo.map((d, i) => (
              <li key={i} className="flex gap-3 text-sm text-maskord-subtle leading-relaxed">
                <span
                  className="font-mono text-xs shrink-0 w-5 h-5 rounded flex items-center justify-center mt-0.5"
                  style={{ color: c.accent, backgroundColor: `${c.accent}1a` }}
                >
                  {i + 1}
                </span>
                <span>{d}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="mx-6 md:mx-8 mb-8 p-5 md:p-6 rounded-xl bg-maskord-darker border border-maskord-border">
        <Label>Adjustment from the first draft</Label>
        <p className="text-sm text-maskord-subtle leading-relaxed max-w-4xl">{c.adjustment}</p>
      </div>
    </article>
  );
}

/* ─── Priorities ───────────────────────────────────────────────────────── */

function Priorities() {
  return (
    <section id="plan" className="py-24 px-6 border-t border-maskord-border">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          eyebrow="Build order"
          title={
            <>
              Ranked by what it{' '}
              <span className="text-gradient">costs us to earn</span>
            </>
          }
          lead="Ranked by risk-adjusted value. Convex is third in value but first in the calendar, because Linkup and Render both keep their state in its tables."
        />

        <div className="rounded-2xl border border-maskord-border overflow-hidden">
          {priorities.map((p) => (
            <div
              key={p.challenge}
              className="flex flex-col sm:flex-row gap-3 sm:gap-6 px-6 py-5 bg-maskord-surface border-b border-maskord-border last:border-b-0"
            >
              <div className="flex items-center gap-4 sm:w-56 shrink-0">
                <span className="font-mono text-sm text-maskord-muted">
                  {String(p.order).padStart(2, '0')}
                </span>
                <span className="font-display font-semibold" style={{ color: p.accent }}>
                  {p.challenge}
                </span>
              </div>
              <div className="font-mono text-xs text-maskord-muted sm:w-24 shrink-0 sm:pt-1">
                {p.lift} lift
              </div>
              <p className="text-sm text-maskord-subtle leading-relaxed">{p.why}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Submission ───────────────────────────────────────────────────────── */

function Submission() {
  return (
    <section className="py-24 px-6 border-t border-maskord-border">
      <div className="max-w-3xl mx-auto">
        <SectionHead
          eyebrow="Still to do"
          title={
            <>
              Submission <span className="text-gradient">checklist</span>
            </>
          }
          lead="Global submissions close 13 September 2026 at 23:59 ART. Saving a draft does not submit it."
        />

        <ul className="space-y-3">
          {submission.map((s) => (
            <li
              key={s.label}
              className="flex gap-4 p-4 rounded-xl bg-maskord-surface border border-maskord-border"
            >
              <span
                className={`mt-0.5 w-5 h-5 rounded-md shrink-0 flex items-center justify-center font-mono text-xs ${
                  s.done
                    ? 'bg-violet-900/40 text-violet-300 border border-violet-800/50'
                    : 'border border-maskord-border text-maskord-muted'
                }`}
              >
                {s.done ? '✓' : ''}
              </span>
              <span>
                <span
                  className={`block text-sm ${
                    s.done ? 'text-maskord-muted line-through' : 'text-maskord-text'
                  }`}
                >
                  {s.label}
                </span>
                <span className="block text-xs text-maskord-muted mt-1">{s.note}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-10 text-center">
          <a
            href="https://app.burningtoken.dev"
            className="inline-block px-8 py-4 rounded-xl bg-maskord-accent hover:bg-violet-500 text-white font-semibold transition-all hover:scale-105 shadow-lg shadow-violet-900/30"
          >
            Open the submission form →
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Shared ───────────────────────────────────────────────────────────── */

function SectionHead({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: string;
}) {
  return (
    <div className="mb-14 max-w-3xl">
      <span className="font-mono text-xs tracking-widest uppercase text-violet-400">{eyebrow}</span>
      <h2 className="font-display font-bold text-3xl md:text-4xl mt-3 mb-4 leading-tight">
        {title}
      </h2>
      <p className="text-maskord-subtle leading-relaxed">{lead}</p>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-xs tracking-widest uppercase text-maskord-muted mb-3">
      {children}
    </div>
  );
}

function MaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="16" cy="18" rx="13" ry="10" fill="currentColor" opacity="0.15" />
      <path
        d="M3 14C3 8.477 8.373 4 16 4s13 4.477 13 10c0 3.5-2.1 6.6-5.3 8.4l-1.2 4.6c-.2.8-1 1.3-1.8 1H11.3c-.8.3-1.6-.2-1.8-1L8.3 22.4C5.1 20.6 3 17.5 3 14z"
        fill="currentColor"
      />
      <circle cx="11" cy="13" r="2" fill="white" opacity="0.9" />
      <circle cx="21" cy="13" r="2" fill="white" opacity="0.9" />
      <path d="M12 19c0 0 1.5 2 4 2s4-2 4-2" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}
