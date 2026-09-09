import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import CTA from './components/CTA';
import Footer from './components/Footer';
import Nav from './components/Nav';
import HackathonPage from './hackathon/HackathonPage';

// The same bundle is served three ways: from S3 + CloudFront at
// maskord.com/hackathon, and from Convex Static Hosting at
// hackathon.maskord.com (and its <deployment>.convex.site origin), where the
// hackathon page is the whole point of the host. Both fall back to index.html
// for unknown paths, so routing is decided here.
function route(hostname: string, pathname: string) {
  const host = hostname.toLowerCase();
  if (host.split('.')[0] === 'hackathon' || host.endsWith('.convex.site')) return 'hackathon';
  return pathname.replace(/\/+$/, '').toLowerCase() === '/hackathon' ? 'hackathon' : 'home';
}

export default function App() {
  if (route(window.location.hostname, window.location.pathname) === 'hackathon') {
    return <HackathonPage />;
  }

  return (
    <div className="min-h-screen bg-maskord-dark overflow-x-hidden">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
