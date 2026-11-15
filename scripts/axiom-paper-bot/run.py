"""Start the Axiom paper-trading bot: python scripts/axiom-paper-bot/run.py"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from axiom_paper.cli import main

if __name__ == "__main__":
    sys.exit(main())
