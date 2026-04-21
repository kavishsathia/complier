"""Demo entrypoint for visualizing the sample contract."""

from __future__ import annotations

import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from complier.contract.model import Contract


def main() -> None:
    """Load the demo contract and start the local visualizer server."""
    contract_path = ROOT / "demo" / "contract_demo.cpl"
    contract = Contract.from_file(contract_path)
    session = contract.create_session()
    server = session.visualize()
    print(f"Visualizer running at {server.url}")
    print("Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        server.close()
        print("\nVisualizer stopped.")


if __name__ == "__main__":
    main()
