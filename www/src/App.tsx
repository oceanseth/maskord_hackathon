import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import CTA from './components/CTA';
import Footer from './components/Footer';
import Nav from './components/Nav';
import HackathonPage from './hackathon/HackathonPage';

// CloudFront serves /index.html for any path the S3 origin does not hold, so
// routing is decided here from the pathname. Keep this list in sync with any
// new standalone page under src/.
function route(pathname: string) {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  return path === '/hackathon' ? 'hackathon' : 'home';
}

export default function App() {
  if (route(window.location.pathname) === 'hackathon') {
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
