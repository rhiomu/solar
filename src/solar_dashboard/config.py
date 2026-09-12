from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    solar_api_base_url: str = Field(..., description="Base URL for Solar Mock API")
    solar_api_key: SecretStr = Field(..., description="API Key for Solar Mock API")
    group_id: str = Field(default="g1", description="Solar site group ID")

    # Financial model constants
    grid_import_tariff: float = Field(default=4.50, description="Grid import tariff THB/kWh (self-consumption value)")
    feed_in_tariff: float = Field(default=2.20, description="Feed-in tariff THB/kWh (exported value)")
    cleaning_cost: float = Field(default=15000.0, description="Cleaning dispatch cost THB per site per dispatch")

    def print_config(self) -> None:
        secret_val = self.solar_api_key.get_secret_value()
        masked_key = f"***{secret_val[-4:]}" if len(secret_val) >= 4 else "***"
        print("=" * 40)
        print("  APPLICATION CONFIGURATION")
        print("=" * 40)
        print(f"Host              : {self.host}")
        print(f"Port              : {self.port}")
        print(f"Solar API Base URL: {self.solar_api_base_url}")
        print(f"Group ID          : {self.group_id}")
        print(f"API Key           : {masked_key}")
        print("-" * 40)
        print("  FINANCIAL MODEL")
        print(f"Grid Import Tariff: {self.grid_import_tariff:.2f} THB/kWh")
        print(f"Feed-in Tariff    : {self.feed_in_tariff:.2f} THB/kWh")
        print(f"Cleaning Cost     : {self.cleaning_cost:,.0f} THB/dispatch")
        print("=" * 40)


def load_and_print_config() -> Settings:
    settings = Settings()
    settings.print_config()
    return settings
