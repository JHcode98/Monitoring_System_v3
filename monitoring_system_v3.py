import time
import json
import random
import logging
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Dict, List
from enum import Enum
from abc import ABC, abstractmethod

# Setup basic logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Models ---

class MetricType(Enum):
    GAUGE = "gauge"
    COUNTER = "counter"

@dataclass
class Metric:
    name: str
    value: float
    timestamp: float = field(default_factory=time.time)
    tags: Dict[str, str] = field(default_factory=dict)
    metric_type: MetricType = MetricType.GAUGE

    def to_json(self) -> str:
        return json.dumps(self.__dict__, default=str)

# --- Interfaces ---

class ICollector(ABC):
    @abstractmethod
    def collect(self) -> List[Metric]:
        pass

class IAlertChannel(ABC):
    @abstractmethod
    def send_alert(self, message: str, severity: str):
        pass

class IStorage(ABC):
    @abstractmethod
    def save(self, metric: Metric):
        pass

# --- Implementations ---

class SystemResourceCollector(ICollector):
    def collect(self) -> List[Metric]:
        metrics = []
        # Simulating CPU Usage
        cpu_val = random.uniform(10.0, 90.0)
        metrics.append(Metric(
            name="cpu_usage",
            value=cpu_val,
            tags={"host": "localhost"}
        ))
        # Simulating Memory Usage
        mem_val = random.uniform(40.0, 85.0)
        metrics.append(Metric(
            name="memory_usage",
            value=mem_val,
            tags={"host": "localhost"}
        ))
        return metrics

class ConsoleAlertChannel(IAlertChannel):
    def send_alert(self, message: str, severity: str):
        prefix = "[INFO]" if severity == "info" else "[CRITICAL]"
        print(f"{prefix} ALERT: {message}")

class SQLiteStorage(IStorage):
    def __init__(self, db_path: str = "metrics.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL,
                    name TEXT,
                    value REAL,
                    tags TEXT
                )
            """)

    def save(self, metric: Metric):
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "INSERT INTO metrics (timestamp, name, value, tags) VALUES (?, ?, ?, ?)",
                    (
                        metric.timestamp,
                        metric.name,
                        metric.value,
                        json.dumps(metric.tags)
                    )
                )
        except Exception as e:
            logger.error(f"Error saving to SQLite: {e}")

# --- Engine ---

class MonitoringEngine:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.collectors: List[ICollector] = []
        self.alert_channels: List[IAlertChannel] = []
        self.storage_backends: List[IStorage] = []
        self._running = False

    def register_collector(self, collector: ICollector):
        self.collectors.append(collector)

    def register_alerter(self, channel: IAlertChannel):
        self.alert_channels.append(channel)

    def register_storage(self, storage: IStorage):
        self.storage_backends.append(storage)

    def _evaluate(self, metric: Metric):
        threshold = self.config["thresholds"].get(metric.name)
        if threshold and metric.value > threshold:
            msg = f"{metric.name} is high: {metric.value:.2f} (Threshold: {threshold})"
            self._trigger_alert(msg, severity="critical")
        else:
            logger.debug(f"Metric {metric.name} is normal: {metric.value:.2f}")

    def _trigger_alert(self, message: str, severity: str):
        for channel in self.alert_channels:
            channel.send_alert(message, severity)

    def run_once(self):
        logger.info("Starting collection cycle...")
        for collector in self.collectors:
            try:
                metrics = collector.collect()
                for metric in metrics:
                    self._evaluate(metric)
                    for storage in self.storage_backends:
                        storage.save(metric)
            except Exception as e:
                logger.error(f"Error collecting metrics: {e}")

    def start(self):
        self._running = True
        logger.info("Monitoring System v3 Started.")
        try:
            while self._running:
                self.run_once()
                time.sleep(self.config["interval"])
        except KeyboardInterrupt:
            self.stop()

# --- Configuration & Entry Point ---

CONFIG = {
    "thresholds": {
        "cpu_usage": 80.0,
        "memory_usage": 75.0
    },
    "interval": 2
}

if __name__ == "__main__":
    engine = MonitoringEngine(CONFIG)
    engine.register_collector(SystemResourceCollector())
    engine.register_alerter(ConsoleAlertChannel())
    engine.register_storage(SQLiteStorage("history.db"))
    
    print("Press Ctrl+C to stop the monitoring system.")
    engine.start()
