"""
Global metrics tracker for Hermes Agent.

Provides a singleton MetricsTracker shared across all platforms
(Telegram, Discord, Slack, Web API, Cron, etc.) for tracking
request throughput, latency, and error rates.
"""

import time
from typing import Dict


class MetricsTracker:
    """Thread-safe sliding-window metrics for the API gateway."""

    def __init__(self, window_seconds: float = 60.0, max_latencies: int = 1000):
        import threading
        self._lock = threading.Lock()
        self._window = window_seconds
        self._max_latencies = max_latencies

        # Timestamps of recent requests
        self._request_log: list = []
        # Latency samples in milliseconds
        self._latencies: list = []
        # Total requests and errors (all-time, for error rate baseline)
        self._total_requests: int = 0
        self._total_errors: int = 0

    def record_request(self, latency_ms: float, status_code: int) -> None:
        """Record a completed request with its latency and status code."""
        now = time.time()
        with self._lock:
            self._request_log.append(now)
            self._latencies.append(latency_ms)
            # Trim latencies to prevent unbounded growth
            if len(self._latencies) > self._max_latencies:
                self._latencies = self._latencies[-self._max_latencies:]
            self._total_requests += 1
            if status_code >= 400:
                self._total_errors += 1

    def record_error(self, status_code: int) -> None:
        """Record an error for requests that fail before full processing."""
        with self._lock:
            self._total_requests += 1
            if status_code >= 400:
                self._total_errors += 1

    def get_metrics(self) -> Dict[str, float]:
        """Calculate current metrics from the sliding window."""
        now = time.time()
        cutoff = now - self._window

        with self._lock:
            # Requests per second: count requests in last 1 second
            one_second_ago = now - 1.0
            requests_per_second = sum(1 for ts in self._request_log if ts >= one_second_ago)

            # Average latency (all samples)
            if self._latencies:
                avg_latency_ms = sum(self._latencies) / len(self._latencies)
            else:
                avg_latency_ms = 0.0

            # Error rate: percentage of 4xx/5xx responses
            if self._total_requests > 0:
                error_rate = (self._total_errors / self._total_requests) * 100.0
            else:
                error_rate = 0.0

            # Trim old entries from request log (older than window)
            self._request_log = [ts for ts in self._request_log if ts >= cutoff]

        return {
            "requests_per_second": requests_per_second,
            "avg_latency_ms": round(avg_latency_ms, 2),
            "error_rate": round(error_rate, 2),
        }


# Global singleton — imported and used by both gateway/run.py and
# gateway/platforms/api_server.py so ALL platforms share the same metrics.
global_metrics = MetricsTracker()
