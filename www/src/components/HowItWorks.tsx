const steps = [
  {
    number: '01',
    title: 'Sign in with your masky.ai account',
    body: 'One login. Your real identity stays with you — Maskord only sees what you choose to share.',
  },
  {
    number: '02',
    title: 'Create or choose a mask',
    body: "Design a mask: pick a name, an avatar, and an optional AI persona. Each server can see a completely different you.",
  },
  {
    number: '03',
    title: 'Join or create a server',
    body: 'Use an invite link to join a friend\'s server, or start your own community in seconds.',
  },
  {
    number: '04',
    title: 'Talk. Text. Play.',
    body: 'Jump into voice channels, post in text channels, share files, and react to messages — just like you\'d expect.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-32 px-6 bg-maskord-darker">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="font-display font-bold text-4xl md:text-5xl mb-4">
            How it works
          </h2>
          <p className="text-maskord-subtle text-lg">
            Getting started takes under a minute.
          </p>
        </div>

        <div className="space-y-12">
          {steps.map((step, i) => (
            <div key={step.number} className="flex gap-8 items-start group">
              <div className="flex-shrink-0">
                <div className="w-14 h-14 rounded-2xl bg-maskord-surface border border-maskord-border group-hover:border-violet-700/60 flex items-center justify-center transition-colors">
                  <span className="font-mono text-sm font-bold text-gradient">{step.number}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className="w-px h-12 bg-maskord-border mx-auto mt-2" />
                )}
              </div>
              <div className="pt-3">
                <h3 className="font-display font-semibold text-xl text-maskord-text mb-2">
                  {step.title}
                </h3>
                <p className="text-maskord-subtle leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
