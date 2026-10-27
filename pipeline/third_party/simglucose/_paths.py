"""Replacement for pkg_resources.resource_filename (removed from setuptools)."""

from pathlib import Path

_ROOT = Path(__file__).resolve().parent


def resource_filename(package: str, relative: str) -> str:
    return str(_ROOT / relative)
