# Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later
"""Share the application's existing environment across remote services."""

import os


def reporting_environment():
    # Match the native application's default. Container builds and CI already
    # supply GS_ENVIRONMENT; do not infer runtime usage from frozen build metadata.
    environment = os.getenv("GS_ENVIRONMENT", "development")
    return (
        environment
        if environment in ("production", "development", "test", "unknown")
        else "unknown"
    )


def usage_environment():
    # The minimal activity contract has no Test category. Keep automated tests
    # out of Production while events retain their existing Test classification.
    environment = reporting_environment()
    return "unknown" if environment == "test" else environment
