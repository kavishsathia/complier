import React, { useEffect, useState } from "https://esm.sh/react@18";

export function App() {
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
    return React.createElement(
      "main",
      { className: "page" },
      React.createElement(
        "section",
        { className: "panel" },
        React.createElement("h1", null, "Complier Visualizer"),
        React.createElement("p", null, error),
      ),
    );
  }

  return React.createElement(
    "main",
    { className: "page" },
    React.createElement(
      "section",
      { className: "panel" },
      React.createElement("h1", null, "Complier Visualizer"),
      React.createElement("p", null, "React app scaffold for static and live contract tracing."),
    ),
    React.createElement(
      "section",
      { className: "panel" },
      React.createElement("h2", null, "Contract Payload"),
      React.createElement("pre", null, payload ? JSON.stringify(payload, null, 2) : "Loading..."),
    ),
  );
}
