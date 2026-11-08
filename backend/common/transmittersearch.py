# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Validated input shared by transmitter catalog search callers."""

from pydantic import BaseModel, ConfigDict, Field


class TransmitterSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)

    keyword: str = Field(min_length=2, max_length=100)
    page: int = Field(default=0, ge=0, le=10000)
    page_size: int = Field(default=20, ge=1, le=50)
