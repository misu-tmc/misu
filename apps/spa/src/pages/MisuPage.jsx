import { useEffect, useState } from 'preact/hooks';
import { clubApi } from '../lib/api.js';
import { PageError, PageLoading } from '../components/PageState.jsx';

export function MisuPage() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    clubApi.info().then(setInfo).catch((err) => setError(err.message || 'Could not load club information.'));
  }, []);

  if (error) return <PageError message={error} />;
  if (!info) return <PageLoading label="Loading club information…" />;

  return (
    <div class="club-page">
      <section class="card club-hero">
        <img src="/static/Toastmasters_2011.png" alt="Toastmasters International" />
        <p class="eyebrow">Microsoft Suzhou</p>
        <h1>{info.name}</h1>
        <p class="club-motto">“{info.motto}”</p>
      </section>
      <section class="card"><h2>About</h2><p>{info.about}</p></section>
      <section class="card"><h2>Meetings</h2><p><strong>{info.meetings?.cadence}</strong></p><p>{info.meetings?.venue}</p></section>
      <section class="card"><h2>Join us</h2><p>{info.join}</p></section>
      <section class="card"><h2>Contact</h2><p>{info.contact}</p><img class="contact-qr" src="/static/VPM%20QR%20code.jpg" alt="MISU WeChat contact QR code" /></section>
    </div>
  );
}