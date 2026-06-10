import argparse
import asyncio
import logging

from .client import Runner
from .config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="Department Agent Platform Runner")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--state", default="runner_state.json")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = load_config(args.config)
    runner = Runner(cfg, args.state)
    try:
        asyncio.run(runner.main())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
