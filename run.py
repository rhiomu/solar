"""Entry point for the Solar Fleet Operations & Monitoring Dashboard."""
import uvicorn

from src.solar_dashboard.config import load_and_print_config


def main() -> None:
    settings = load_and_print_config()
    uvicorn.run(
        "src.solar_dashboard.app:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
