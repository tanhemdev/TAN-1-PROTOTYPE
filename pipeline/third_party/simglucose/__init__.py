"""Vendored copy of simglucose 0.2.11 (https://github.com/jxx123/simglucose,
commit a6f6777), the open-source Python implementation of the UVA/Padova
type 1 diabetes simulator. MIT licensed; see LICENSE in this folder.

Changes from upstream, so it runs on current Python with no extra installs:
- this file no longer registers an OpenAI Gym environment (no gym import);
- package data files are located with _paths.py instead of pkg_resources;
- the Gym environments, the interactive user interface, the PID controller
  and the report module are left out because TAN-1 doesn't use them.
"""
