const features = [
  {
    icon: '🎭',
    title: 'Many Masks',
    description:
      'Create multiple identities — each with their own name, avatar, and AI persona. Switch masks between servers. Be a dragon in one room and a detective in the next.',
  },
  {
    icon: '🎙️',
    title: 'Crystal Voice',
    description:
      'Jump into voice channels with zero friction. Low-latency WebRTC audio, per-channel mute controls, and AI voice modulation (coming soon via masky.ai).',
  },
  {
    icon: '💬',
    title: 'Rich Text Channels',
    description:
      'Organized channels with full markdown, reactions, attachments, and pinned messages. Discord-equivalent message history with smooth infinite scroll.',
  },
  {
    icon: '🛡️',
    title: 'Identity Protection',
    description:
      'Your real identity is never exposed. Servers see only your mask. Admins cannot trace masks back to real users without your explicit permission.',
  },
  {
    icon: '🤖',
    title: 'AI as a Lens',
    description:
      'Powered by masky.ai — let AI shape how you appear, speak, and interact. Give your mask a personality, a voice, and a story.',
  },
  {
    icon: '⚙️',
    title: 'Granular Permissions',
    description:
      'Discord-compatible role and permission system. Custom roles per server, channel overwrites, moderation tools, and ban/kick controls.',
  },
];

export default function Features() {
  return (
    <section id="features" className="py-32 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="font-display font-bold text-4xl md:text-5xl mb-4">
            Everything Discord does,{' '}
            <span className="text-gradient">plus a face you choose</span>
          </h2>
          <p className="text-maskord-subtle text-lg max-w-xl mx-auto">
            Built from the ground up for communities that value both authenticity and anonymity.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="group p-6 rounded-2xl bg-maskord-surface border border-maskord-border hover:border-violet-800/50 transition-all hover:bg-maskord-surface/80"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-display font-semibold text-lg text-maskord-text mb-2">
                {f.title}
              </h3>
              <p className="text-maskord-subtle text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
