import { useEffect, useState } from "react";

function App() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/contract")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load contract: ${response.status}`);
        }
        return response.json();
      })
      .then(setPayload)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <main className="page">
        <section className="panel">
          <h1>Complier Visualizer</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Complier Visualizer</h1>
        <p>React app scaffold for static and live contract tracing.</p>
      </section>
      <section className="panel">
        <h2>Contract Payload</h2>
        <pre>{payload ? JSON.stringify(payload, null, 2) : "Loading..."}</pre>
      </section>
    </main>
  );
}

export default App;
