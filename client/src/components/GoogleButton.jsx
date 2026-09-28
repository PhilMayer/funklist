import { useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let scriptPromise;

function loadGoogleScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Renders Google's own "Sign in with Google" button. On success Google hands us an ID token
// (`credential`), which the server verifies before creating a session.
export default function GoogleButton({ clientId, onCredential, onError }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => onCredential(credential),
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: 280,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setFailed(true);
          onError?.(e.message);
        }
      });
    return () => { cancelled = true; };
  }, [clientId, onCredential, onError]);

  if (failed) return <p className="muted small-text">Google sign-in is unavailable right now.</p>;
  return <div ref={ref} className="google-button" />;
}
