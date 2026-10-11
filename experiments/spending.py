"""Persist worst-case call reservations before any hosted data transfer."""

import json
import math
import uuid

from checkpoint import atomic_json
from safety import output_path


class Budget:
    """Count unresolved calls at their maximum cost until usage is known."""

    def __init__(self, path, root, fingerprint, limit, *, resume=False):
        self.path = output_path(path, root)
        self.root = root
        if type(limit) not in (float, int) or not math.isfinite(limit) or limit <= 0:
            raise ValueError("spending limit required")
        self.state = {"fingerprint": fingerprint, "limit": limit, "calls": {}}
        if self.path.exists():
            if not resume:
                raise ValueError("spending ledger requires resume")
            saved = json.loads(self.path.read_text())
            if saved.get("fingerprint") != fingerprint or saved.get("limit") != limit:
                raise ValueError("spending fingerprint or limit changed")
            self.state = saved
        elif resume:
            raise ValueError("spending ledger missing")

    @property
    def used(self):
        """Return settled usage estimates plus unresolved reservations."""
        return sum(self.state["calls"].values())

    def reserve(self, ceiling):
        """Save the worst-case cost before a call; refuse excess spending."""
        if type(ceiling) not in (float, int) or not math.isfinite(ceiling) or ceiling <= 0:
            raise ValueError("invalid reservation")
        if self.used + ceiling > self.state["limit"]:
            raise ValueError("spending limit exceeded")
        ticket = uuid.uuid4().hex
        updated = {**self.state, "calls": {**self.state["calls"], ticket: ceiling}}
        atomic_json(self.path, self.root, updated)
        self.state = updated
        return ticket

    def settle(self, ticket, cost):
        """Replace a reservation with a validated usage-derived cost."""
        ceiling = self.state["calls"][ticket]
        if type(cost) not in (float, int) or not math.isfinite(cost) or not 0 <= cost <= ceiling:
            raise ValueError("invalid settlement")
        updated = {**self.state, "calls": {**self.state["calls"], ticket: cost}}
        atomic_json(self.path, self.root, updated)
        self.state = updated
